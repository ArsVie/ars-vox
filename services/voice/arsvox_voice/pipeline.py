"""Voice pipeline: owns the audio path state machine and silence timer.

The pipeline is the ONE canonical owner of the voice state value and the
silence timer. AgentRuntime and the WS handler PUBLISH transitions into
it (mic activated, user speech, model started/finished, TTS
started/finished, stop, silence timeout) instead of each owning state:
``set_state`` is the only entry point, it applies the silence-timer
policy, and the resulting StateUpdateEvent reaches the bus through
``on_state_change``.

The ``stop`` keyword path is local (never routed through the LLM): the
runtime cancels TTS, media, and tool work, and the pipeline returns to
SLEEPING.

Iteration 1: providers are mocks; ``inject_text`` simulates a wake +
utterance for tests and for the desktop demo.
"""

import asyncio
import logging
from collections.abc import Coroutine
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from arsvox_contracts import AppConfig, VoiceState
from arsvox_voice.providers import (
    MockWakeWordDetector,
    Vad,
    WakeWordDetector,
    build_vad,
    build_wake_word_detector,
)

log = logging.getLogger(__name__)

UserTextCallback = Callable[[str], Coroutine[Any, Any, None]]
StopCallback = Callable[[], Coroutine[Any, Any, None]]
StateCallback = Callable[[VoiceState, str | None], Coroutine[Any, Any, None]]

# States where the silence timer must be disarmed: a request is in flight
# (thinking), speech is physically playing (speaking — the timer is
# anchored to speech END, never mid-playback, R06), the user must act
# (waiting), or we are mid-stop — none of them may be preempted into
# SLEEPING by the silence watcher. LISTENING is the only state that arms
# the timer, and it is only reached after speech actually ends (R05).
_TIMER_FREE_STATES = frozenset(
    {
        VoiceState.THINKING,
        VoiceState.SPEAKING,
        VoiceState.STOPPING,
        VoiceState.WAITING_FOR_CONFIRMATION,
        VoiceState.ERROR,
    }
)


class VoicePipeline:
    def __init__(
        self,
        config: AppConfig,
        on_user_text: UserTextCallback,
        on_stop: StopCallback,
        on_state_change: StateCallback,
        vad: Vad | None = None,
        wake_word: WakeWordDetector | None = None,
    ):
        self.config = config
        self.on_user_text = on_user_text
        self.on_stop = on_stop
        self.on_state_change = on_state_change
        self._sleep_task: asyncio.Task | None = None
        self._silence_deadline: datetime | None = None
        self.state = VoiceState.SLEEPING
        # W3-VOICE (GATE-5): real providers behind config (mock default).
        # The wake detector owns the mic stream and feeds BOTH the wake
        # path (on_wake) and the barge-in path (VAD speech-start while
        # TTS is playing). Tests inject mocks; production builds from
        # config.voice.vad / config.voice.wake_word.
        self.vad = vad if vad is not None else build_vad(config)
        self._wake_word = wake_word or build_wake_word_detector(
            config,
            vad=self.vad,
            on_speech_start=self.handle_user_speech_started,
        )
        self._wake_task: asyncio.Task | None = None

    # ------------------------------------------------------------------ #
    async def start(self) -> None:
        self.set_state(
            VoiceState.LISTENING if self.config.voice.enabled else VoiceState.SLEEPING
        )
        self._reset_silence_timer()
        if self.config.voice.enabled:
            await self._start_wake_stream()

    async def stop(self) -> None:
        if self._sleep_task:
            self._sleep_task.cancel()
            self._sleep_task = None
        await self._stop_wake_stream()

    # ------------------------------------------------------------------ #
    async def _start_wake_stream(self) -> None:
        """Open the mic stream when a real detector is configured.

        The mock detector never streams (wake stays simulated). A real
        detector that cannot start (missing deps / no mic device) fails
        loud: the pipeline logs it, and the operator sees the reason in
        the stream task result. Voice remains enabled — the failure is
        confined to the wake path.
        """
        if isinstance(self._wake_word, MockWakeWordDetector):
            return
        if self._wake_task is not None:
            return

        async def _run() -> None:
            try:
                await self._wake_word.start(on_wake=self.handle_wake)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — surface, keep pipeline alive
                log.error("wake-word stream failed: %s", exc)
            finally:
                self._wake_task = None

        self._wake_task = asyncio.create_task(_run())

    async def _stop_wake_stream(self) -> None:
        if self._wake_task is not None:
            self._wake_task.cancel()
            self._wake_task = None
        await self._wake_word.stop()

    # ------------------------------------------------------------------ #
    def _reset_silence_timer(self) -> None:
        if self._sleep_task:
            self._sleep_task.cancel()
        self._silence_deadline = datetime.now(timezone.utc) + timedelta(
            seconds=self.config.voice.silence_timeout_s
        )
        self._sleep_task = asyncio.create_task(self._sleep_watch())

    def _stop_silence_timer(self) -> None:
        if self._sleep_task:
            self._sleep_task.cancel()
            self._sleep_task = None
        self._silence_deadline = None

    async def _sleep_watch(self) -> None:
        """Rule 3: after N seconds of user silence, SLEEPING."""
        try:
            while (
                self._silence_deadline
                and datetime.now(timezone.utc) < self._silence_deadline
            ):
                await asyncio.sleep(1)
            if self._silence_deadline:
                self.set_state(VoiceState.SLEEPING)
        except asyncio.CancelledError:
            return

    def set_state(self, state: VoiceState, activity: str | None = None) -> None:
        """THE canonical state entry — every publisher transitions here.

        Owns the silence-timer policy: the timer is armed ONLY in
        LISTENING (which is only entered after physical TTS playback
        ends, R05) and disarmed in _TIMER_FREE_STATES — a long model
        turn or a long TTS playback can never flip the UI to sleeping
        while speech is still coming (R06).
        """
        if state in _TIMER_FREE_STATES:
            self._stop_silence_timer()
        elif state == VoiceState.LISTENING:
            self._reset_silence_timer()
        if state != self.state or activity is not None:
            self.state = state
            asyncio.create_task(self.on_state_change(state, activity))

    # ------------------------------------------------------------------ #
    async def inject_text(self, text: str) -> None:
        """Simulated wake + utterance (demo/tests until mic providers land)."""
        if self.state == VoiceState.SLEEPING:
            self.set_state(VoiceState.LISTENING)
        self._reset_silence_timer()
        await self.on_user_text(text)

    async def handle_stop(self) -> None:
        """Local keyword path — must work in every state, never needs the LLM."""
        self.set_state(VoiceState.STOPPING)
        await self.on_stop()
        self._reset_silence_timer()
        self.set_state(VoiceState.SLEEPING)

    # ------------------------------------------------------------------ #
    # W3-VOICE (GATE-5): wake + barge-in — the two live-mic entries.
    # Both route through EXISTING wire members: on_stop (the STOP cancel
    # path: cancels the turn, invalidates confirmations, clears the TTS
    # queue — the renderer interrupts physical playback on STOPPING) and
    # on_user_text (the utterance -> turn funnel). No new events.

    async def handle_wake(self) -> None:
        """Wake word fired (real detector or simulated): SLEEPING -> LISTENING.

        Debounced twice: the detector's own cooldown suppresses re-fires
        inside one phrase, and this guard only acts from SLEEPING — a
        wake hit while a turn is active (THINKING/SPEAKING/LISTENING) is
        a no-op and can never restart or disturb the turn.
        """
        if self.state != VoiceState.SLEEPING:
            return
        self.set_state(VoiceState.LISTENING, activity="wake-word")
        self._reset_silence_timer()

    async def handle_user_speech_started(self) -> None:
        """VAD speech-start routing — barge-in while TTS is playing.

        SPEAKING (TTS physically playing): the user interrupted. Cancel
        the utterance through the existing STOP path (on_stop), then arm
        a fresh LISTENING turn: the rest of the utterance is recorded,
        STT'd, and reaches the runtime via on_user_text as the next turn.
        The STOPPING publish is what makes the renderer clear its TTS
        queue, so physical playback stops (existing wire, no new events).

        LISTENING: the user is mid-utterance — just reset the silence
        timer so the watcher never sleeps under speech.

        Any other state (SLEEPING, THINKING, ...): no-op. SLEEPING is
        gated by the wake word; THINKING is model time and is not
        preempted by bare speech.
        """
        if self.state == VoiceState.SPEAKING:
            self.set_state(VoiceState.STOPPING, activity="barge-in")
            await self.on_stop()
            self._reset_silence_timer()
            self.set_state(VoiceState.LISTENING, activity="barge-in")
        elif self.state == VoiceState.LISTENING:
            self._reset_silence_timer()
