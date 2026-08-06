"""Voice pipeline: owns the audio path state machine and silence timer.

The pipeline receives microphone text through the provider chain and
delivers it to the agent runtime. The ``stop`` keyword path is local
(never routed through the LLM): the runtime cancels TTS, media, and
tool work, and the pipeline returns to SLEEPING.

Iteration 1: providers are mocks; ``inject_text`` simulates a wake +
utterance for tests and for the desktop demo.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from arsvox_contracts import AppConfig

log = logging.getLogger(__name__)

UserTextCallback = Callable[[str], Awaitable[None]]
StopCallback = Callable[[], Awaitable[None]]
StateCallback = Callable[[str], Awaitable[None]]


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
        self.state = "sleeping"

    # ------------------------------------------------------------------ #
    async def start(self) -> None:
        self._set_state("listening" if self.config.voice.enabled else "sleeping")
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

    async def _sleep_watch(self) -> None:
        """Rule 3: after N seconds of user silence, SLEEPING."""
        try:
            while self._silence_deadline and datetime.now(timezone.utc) < self._silence_deadline:
                await asyncio.sleep(1)
            if self._silence_deadline:
                self._set_state("sleeping")
        except asyncio.CancelledError:
            return

    def _set_state(self, state: str) -> None:
        if state != self.state:
            self.state = state
            asyncio.create_task(self.on_state_change(state))

    # ------------------------------------------------------------------ #
    async def inject_text(self, text: str) -> None:
        """Simulated wake + utterance (demo/tests until mic providers land)."""
        if self.state == "sleeping":
            self._set_state("listening")
        self._reset_silence_timer()
        await self.on_user_text(text)

    async def handle_stop(self) -> None:
        """Local keyword path — must work in every state, never needs the LLM."""
        self._set_state("stopping")
        await self.on_stop()
        self._reset_silence_timer()
        self._set_state("sleeping")
