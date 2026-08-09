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
from arsvox_agent.local_intents import match_confirmation_utterance
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
        # GATE-3.5 (C4): a turn that dispatches TTS stays in THINKING until
        # the renderer acks physical playback (tts.started -> SPEAKING,
        # tts.finished -> terminal). This flag tells _run_turn's finally
        # to skip settling: LISTENING must never precede speech end (R05).
        self._speech_pending = False

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
        override = self.config.resolved_paths.system_prompt_file
        path = override if override else PROMPT_FILE
        return path.read_text(encoding="utf-8")

    # ------------------------------------------------------------------ #
    async def notify_voice_state(self, state: VoiceState | str, activity: str | None = None) -> None:
        """Bus publisher — the pipeline's on_state_change callback. The
        pipeline owns the state value; this only ships it over the bus."""
        await self.bus.publish(
            StateUpdateEvent(voice_state=VoiceState(state), activity=activity)
        )

    def _set_voice(self, state: VoiceState, activity: str | None = None) -> None:
        """Publish a transition into the canonical voice state machine
        (the pipeline). Falls back to a direct bus publish only when no
        pipeline is wired (unit tests)."""
        if self.pipeline is not None:
            self.pipeline.set_state(state, activity)
        else:
            asyncio.create_task(self.notify_voice_state(state, activity))

    async def handle_user_text(self, text: str) -> None:
        # R35/R36: spoken/typed confirmation vocabulary is resolved here —
        # the single funnel for ALL user text (typed via ws, spoken via
        # the voice pipeline's on_user_text). A confirmation utterance
        # with a pending confirmation resolves it; without one it is
        # IGNORED (conservative: never approve random things, never start
        # a turn on a bare sí/no).
        decision = match_confirmation_utterance(text)
        if decision is not None:
            await self._handle_confirmation_utterance(decision, text)
            return
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
    async def _handle_confirmation_utterance(self, decision: str, text: str) -> None:
        """R35: approve/reject the single global pending confirmation.

        Executes the FROZEN stored args (never model-supplied), exactly
        like the UI confirm/cancel buttons. R36: no pending confirmation
        -> the utterance is ignored entirely (audited, no turn).
        """
        pending = self.deps_base.confirmations.current_pending()
        if pending is None:
            self.deps_base.audit.log(
                "confirmation", "ignored_utterance",
                {"utterance": text[:120], "decision": decision},
            )
            return
        self.deps_base.audit.log(
            "confirmation", "spoken",
            {"pending_id": pending["id"], "decision": decision, "utterance": text[:120]},
        )
        await self.deps_base.confirmations.resolve(
            pending["id"], approve=(decision == "approve")
        )
        remaining = self.deps_base.pending.list_pending()
        state = (
            VoiceState.WAITING_FOR_CONFIRMATION
            if remaining
            else VoiceState.LISTENING
        )
        self._set_voice(state)

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
            # GATE-3.5 (C4/R05): a turn that dispatched TTS must NOT settle
            # to LISTENING here — playback is still ahead. The renderer's
            # tts.finished ack settles it. Turns without TTS settle now.
            if not self._speech_pending:
                self._settle()

    def _settle(self) -> None:
        """Terminal state after a turn's speech is fully done: LISTENING,
        or WAITING_FOR_CONFIRMATION when a pending confirmation exists
        (H5). This is the ONLY place the machine may leave
        THINKING/SPEAKING for the terminal states, and it is only
        reached after physical playback ended (or no speech was
        dispatched)."""
        pending = self.deps_base.pending.list_pending()
        self._set_voice(
            VoiceState.WAITING_FOR_CONFIRMATION if pending else VoiceState.LISTENING
        )

    async def _turn(self, text: str) -> None:
        self._set_voice(VoiceState.THINKING, activity=text[:80])
        if self.session_id is None:
            self.session_id = self.deps_base.sessions.create()
        agent = self._build_agent()
        deps = dataclasses.replace(
            self.deps_base,
            run_id=uuid.uuid4().hex[:12],
            session_id=self.session_id,
        )
        # H5: build the context BEFORE persisting the current turn — the
        # recent-turn history must not include the instruction the model
        # is about to receive (it already gets it verbatim in `prompt`).
        context = build_context(self.config, deps)
        self.deps_base.sessions.append_turn(self.session_id, "user", text)
        await self.bus.publish(
            UserMessageEvent(id=f"u{uuid.uuid4().hex[:8]}", text=text)
        )
        prompt = f"{text}\n\n[Estado actual de la aplicación]\n{context}"

        timeout = self.config.agent.model.timeout_s
        usage_limits = None
        max_steps = self.config.agent.model.max_steps
        if max_steps:
            from pydantic_ai.usage import UsageLimits

            usage_limits = UsageLimits(tool_calls_limit=max_steps)
        async with asyncio.timeout(timeout):
            result = await agent.run(prompt, deps=deps, usage_limits=usage_limits)

        final = (result.output or "").strip()
        if final:
            self.deps_base.sessions.append_turn(self.session_id, "assistant", final)
            await self.bus.publish(AgentMessageEvent(text=final, delta=False))
            if self.config.tts.auto_speak:
                # The UI fetches the audio (GET /tts) and plays it; the
                # stop path clears the UI queue and interrupts playback.
                # GATE-3.5 (C4): do NOT claim SPEAKING here — the machine
                # stays THINKING until the renderer acks tts.started, and
                # only tts.finished settles it to LISTENING (R05/R08).
                self._speech_pending = True
                await self.bus.publish(
                    UiCommandEvent(command=TtsSpeak(text=final, priority=False))
                )

    # ------------------------------------------------------------------ #
    # GATE-3.5 (C4/R08): physical-playback acks from the renderer. The
    # renderer is the playback authority; these are the only transitions
    # that may move the machine into/out of SPEAKING. All handlers are
    # guards against stale acks (R04): ack messages that arrive after a
    # stop (STOPPING/SLEEPING) are consumed as no-ops and can never
    # resurrect a cancelled turn.

    def on_tts_started(self) -> None:
        """Renderer reports physical playback began -> SPEAKING.

        Allowed from THINKING (normal turn flow), LISTENING (a later
        queued phrase of the same turn) and SLEEPING (speech dispatched
        outside a turn, e.g. the telegram tool — the machine corrects to
        the physical truth). Never from STOPPING: a mid-stop started ack
        is stale and the imminent queue clear will ack cancellation."""
        self._speech_pending = False
        if self.pipeline is not None and self.pipeline.state == VoiceState.STOPPING:
            return
        self._set_voice(VoiceState.SPEAKING)

    def on_tts_finished(self) -> None:
        """Renderer reports a phrase ended without cancellation -> settle.

        Settles only while speech is actually in flight or pending
        (SPEAKING, or THINKING with a dispatched phrase that never
        started — fetch/play failure). After a stop (STOPPING/SLEEPING)
        the ack is a no-op: the stop path owns the terminal state."""
        if self.pipeline is None:
            self._speech_pending = False
            self._settle()
            return
        if self.pipeline.state == VoiceState.SPEAKING or self._speech_pending:
            self._speech_pending = False
            self._settle()

    def on_tts_cancelled(self) -> None:
        """Renderer reports playback was interrupted (STOP / queue clear).

        During the STOP path the machine is already STOPPING/SLEEPING —
        the ack confirms physical playback stopped (R07) and is a no-op
        here. Defensively, if speech vanished while SPEAKING without a
        stop (e.g. renderer-side clear), settle so the machine never
        hangs in SPEAKING."""
        if self.pipeline is None:
            self._speech_pending = False
            self._settle()
            return
        if self.pipeline.state == VoiceState.SPEAKING or self._speech_pending:
            self._speech_pending = False
            self._settle()

    # ------------------------------------------------------------------ #
    async def cancel(self) -> None:
        """The local stop path: cancels the running turn, invalidates any
        pending confirmation (documented semantic: stop/cancel aborts the
        action), clears TTS, and returns the app to SLEEPING. Never
        involves the LLM."""
        task = self._active_task
        self._active_task = None
        # A cancelled turn's dispatched speech is dead: late acks must
        # not settle the machine out of the STOP path (R04/R07).
        self._speech_pending = False
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        # H5: stop must also abort pending confirmations, not just the
        # model task — otherwise an invisible pending row stays stuck in
        # SQLite (and in the UI after a reconnect).
        await self.deps_base.confirmations.invalidate_all(
            "Acción cancelada por stop."
        )
        # R38: STOP also cancels an already-EXECUTING approved action
        # (before its point of no return; after it, the result is
        # surfaced by the execution task). A1's STOP primitive should
        # route through this same hook.
        if self.deps_base.confirmations.cancel_executing():
            self.deps_base.audit.log(
                "control", "stop_executing_action", {"scope": "confirmation"}
            )
        # H3: publish into the canonical voice state machine (bus carries
        # it back to the UI).
        self._set_voice(VoiceState.STOPPING)
        self.deps_base.audit.log("control", "stop", {"scope": "run"})
        await asyncio.sleep(0.05)
        self._set_voice(VoiceState.SLEEPING)
