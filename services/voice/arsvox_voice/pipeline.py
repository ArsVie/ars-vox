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

log = logging.getLogger(__name__)

UserTextCallback = Callable[[str], Coroutine[Any, Any, None]]
StopCallback = Callable[[], Coroutine[Any, Any, None]]
StateCallback = Callable[[VoiceState, str | None], Coroutine[Any, Any, None]]

# States where the silence timer must be disarmed: a request is in flight
# (thinking), the user must act (waiting), or we are mid-stop — none of
# them may be preempted into SLEEPING by the silence watcher.
_TIMER_FREE_STATES = frozenset(
    {
        VoiceState.THINKING,
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
    ):
        self.config = config
        self.on_user_text = on_user_text
        self.on_stop = on_stop
        self.on_state_change = on_state_change
        self._sleep_task: asyncio.Task | None = None
        self._silence_deadline: datetime | None = None
        self.state = VoiceState.SLEEPING

    # ------------------------------------------------------------------ #
    async def start(self) -> None:
        self.set_state(
            VoiceState.LISTENING if self.config.voice.enabled else VoiceState.SLEEPING
        )
        self._reset_silence_timer()

    async def stop(self) -> None:
        if self._sleep_task:
            self._sleep_task.cancel()
            self._sleep_task = None

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

        Owns the silence-timer policy: the timer stays armed while
        listening/speaking (silence falls back to SLEEPING) and is
        disarmed in _TIMER_FREE_STATES — a long model turn can never flip
        the UI to sleeping while a request is in flight.
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
