"""AgentRuntime: owns conversation turns, model calls, cancellation, and
voice-state transitions. Deliberately does NOT own databases, browser
objects, audio devices, or credentials — those live in Deps/stores."""

import asyncio
import dataclasses
import logging
import uuid
from pathlib import Path

from arsvox_contracts import (
    AgentMessageEvent,
    AppConfig,
    ErrorEvent,
    StateUpdateEvent,
    UiCommandEvent,
    UserMessageEvent,
    VoiceState,
)
from arsvox_contracts.commands import TtsSpeak

from arsvox_agent.context import build_context
from arsvox_agent.deps import Deps
from arsvox_agent.events import EventBus
from arsvox_agent.model_provider import build_model
from arsvox_agent.tools import ToolRegistry, build_pydantic_tools

log = logging.getLogger(__name__)

PROMPT_FILE = Path(__file__).resolve().parent / "prompts" / "system.md"


class AgentRuntime:
    def __init__(
        self,
        config: AppConfig,
        deps_base: Deps,
        registry: ToolRegistry,
        bus: EventBus,
    ):
        self.config = config
        self.deps_base = deps_base
        self.registry = registry
        self.bus = bus
        self.session_id: str | None = None
        self.pipeline = None  # set by app.py (voice pipeline)
        self._agent = None
        self._active_task: asyncio.Task | None = None
        self._busy = False

    # ------------------------------------------------------------------ #
    def set_config(self, config: AppConfig) -> None:
        self.config = config
        self._agent = None  # rebuild lazily on next turn

    def _build_agent(self):
        if self._agent is None:
            from pydantic_ai import Agent, ModelSettings

            self._agent = Agent(
                build_model(self.config),
                system_prompt=self._load_system_prompt(),
                deps_type=Deps,
                tools=build_pydantic_tools(self.registry),
                model_settings=ModelSettings(
                    temperature=self.config.agent.model.temperature
                ),
            )
        return self._agent

    def _load_system_prompt(self) -> str:
        override = self.config.agent.system_prompt_file
        path = Path(override) if override else PROMPT_FILE
        return path.read_text(encoding="utf-8")

    # ------------------------------------------------------------------ #
    async def notify_voice_state(self, state: str) -> None:
        await self.bus.publish(StateUpdateEvent(voice_state=VoiceState(state)))

    async def handle_user_text(self, text: str) -> None:
        if self._busy or (self._active_task and not self._active_task.done()):
            await self.bus.publish(
                ErrorEvent(
                    message="Todavía estoy trabajando en lo anterior. Espera un momento.",
                    recoverable=True,
                )
            )
            return
        self._busy = True
        self._active_task = asyncio.create_task(self._run_turn(text))

    # ------------------------------------------------------------------ #
    async def _run_turn(self, text: str) -> None:
        try:
            await self._turn(text)
        except asyncio.CancelledError:
            log.info("turn %s cancelled", text[:40])
            raise
        except Exception as exc:  # noqa: BLE001 — surface to the UI
            log.exception("turn failed")
            await self.bus.publish(
                ErrorEvent(message=f"Error: {exc}", recoverable=True)
            )
        finally:
            self._busy = False
            pending = self.deps_base.pending.list_pending()
            state = (
                VoiceState.WAITING_FOR_CONFIRMATION
                if pending
                else VoiceState.LISTENING
            )
            await self.bus.publish(StateUpdateEvent(voice_state=state))

    async def _turn(self, text: str) -> None:
        await self.bus.publish(
            StateUpdateEvent(voice_state=VoiceState.THINKING, activity=text[:80])
        )
        if self.session_id is None:
            self.session_id = self.deps_base.sessions.create()
        self.deps_base.sessions.append_turn(self.session_id, "user", text)
        await self.bus.publish(
            UserMessageEvent(id=f"u{uuid.uuid4().hex[:8]}", text=text)
        )

        agent = self._build_agent()
        deps = dataclasses.replace(
            self.deps_base,
            run_id=uuid.uuid4().hex[:12],
            session_id=self.session_id,
        )
        context = build_context(self.config, deps)
        prompt = f"{text}\n\n[Estado actual de la aplicación]\n{context}"

        timeout = self.config.agent.model.timeout_s
        async with asyncio.timeout(timeout):
            result = await agent.run(prompt, deps=deps)

        final = (result.output or "").strip()
        if final:
            self.deps_base.sessions.append_turn(self.session_id, "assistant", final)
            await self.bus.publish(AgentMessageEvent(text=final, delta=False))
            if self.config.tts.auto_speak:
                # The UI fetches the audio (GET /tts) and plays it; the
                # stop path clears the UI queue and interrupts playback.
                await self.bus.publish(
                    StateUpdateEvent(voice_state=VoiceState.SPEAKING)
                )
                await self.bus.publish(
                    UiCommandEvent(command=TtsSpeak(text=final, priority=False))
                )

    # ------------------------------------------------------------------ #
    async def cancel(self) -> None:
        """The local stop path: cancels the running turn, clears TTS, and
        returns the app to SLEEPING. Never involves the LLM."""
        task = self._active_task
        self._active_task = None
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        await self.bus.publish(StateUpdateEvent(voice_state=VoiceState.STOPPING))
        self.deps_base.audit.log("control", "stop", {"scope": "run"})
        await asyncio.sleep(0.05)
        await self.bus.publish(StateUpdateEvent(voice_state=VoiceState.SLEEPING))
