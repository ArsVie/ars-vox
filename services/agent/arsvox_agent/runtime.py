"""AgentRuntime: owns conversation turns, model calls, cancellation, and
voice-state transitions. Deliberately does NOT own databases, browser
objects, audio devices, or credentials — those live in Deps/stores."""

import asyncio
import dataclasses
import functools
import logging
import re
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
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
from arsvox_agent.local_intents import match_confirmation_utterance, match_time_only_reminder
from arsvox_agent.model_provider import build_model
from arsvox_memory.repos.reminders import normalize_due_utc
from arsvox_agent.effect_ledger import EffectLedger, inverse_for, inverted_tools
from arsvox_agent.tools import Handler, ToolRegistry, ToolSpec, build_pydantic_tools

log = logging.getLogger(__name__)

PROMPT_FILE = Path(__file__).resolve().parent / "prompts" / "system.md"


def _friendly_error(exc: Exception) -> str:
    """Map internal exceptions to short, user-safe Spanish messages.

    The user is an older person: raw exception text (tracebacks, docs URLs,
    pydantic internals) must never reach the UI. Log keeps the real thing.
    """
    from pydantic_ai.exceptions import UsageLimitExceeded
    from pydantic import ValidationError

    if isinstance(exc, UsageLimitExceeded):
        return (
            "Tardé demasiados pasos en hacer eso. "
            "Inténtalo de nuevo con una petición más simple."
        )
    if isinstance(exc, ValidationError):
        return "No pude completar esa acción. Inténtalo de nuevo."
    if isinstance(exc, asyncio.TimeoutError):
        return "Tardé demasiado en responder. Inténtalo de nuevo."
    return "Ocurrió un problema. Inténtalo de nuevo."


def _normalize_reminder_text(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace, drop filler
    lead-ins ("que ", "quiero que ", "necesito que ") so "Llamar a mi
    nieta" and "que llame a mi nieta" compare equal enough to dedupe."""
    folded = "".join(
        c for c in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(c) != "Mn"
    )
    folded = re.sub(r"^(quiero|necesito|tené?|poné?|agendá?|que|por favor)[\s,]+", "", folded)
    return re.sub(r"\s+", " ", folded).strip()


def _find_similar_active(reminders, text: str, due_at: str) -> dict | None:
    """R14 (2026-08-14, reviewer round 14 finding 5): an active reminder
    whose normalized text matches the new one within the SAME wall hour
    counts as a duplicate — the old man saw "Llamar a mi nieta" and "que
    llame a mi nieta" as the same note twice."""
    from difflib import SequenceMatcher

    target = _normalize_reminder_text(text)
    try:
        target_hour = datetime.fromisoformat(due_at).replace(minute=0, second=0, microsecond=0)
    except ValueError:
        return None
    for r in reminders.list_active():
        try:
            hour = datetime.fromisoformat(r["due_at"]).replace(minute=0, second=0, microsecond=0)
        except (ValueError, KeyError):
            continue
        if hour != target_hour:
            continue
        cand = _normalize_reminder_text(r["text"])
        if cand == target:
            return r
        if SequenceMatcher(None, target, cand).ratio() >= 0.75:
            return r
    return None


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
        # A1 (Cordis): the CURRENT turn's EffectLedger, or None outside
        # a turn. _run_turn sets it before _turn runs; the recording
        # tool wrappers (see _recording_handler) read it at call time,
        # so inverses are recorded only inside a live turn.
        self._run_ledger: EffectLedger | None = None
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

            instrumented = self._instrumented_registry()
            # Tool-surface collapse: the instrumented registry travels
            # with the run deps so dispatcher tools (tools/surface.py)
            # can delegate to hidden granular specs via
            # tctx.deps.registry.execute_gated.
            self.deps_base.registry = instrumented
            self._agent = Agent(
                build_model(self.config),
                system_prompt=self._load_system_prompt(),
                deps_type=Deps,
                tools=build_pydantic_tools(instrumented),
                model_settings=ModelSettings(
                    temperature=self.config.agent.model.temperature
                ),
            )
        return self._agent

    def _instrumented_registry(self) -> ToolRegistry:
        """Copy of the shared registry whose opted-in handlers record
        inverses into the CURRENT run's EffectLedger (A1).

        Built from the SAME ToolSpec objects, except opted-in specs
        (effect_ledger.INVERSE_PAIRS) get a recording wrapper around
        their handler. The shared registry is never mutated, so
        execute_direct — the confirmation executor's gate-bypassed
        path — keeps calling the ORIGINAL handlers: inverses are
        recorded only for model tool calls inside a live turn.
        """
        instrumented = ToolRegistry()
        for spec in self.registry.all():
            if spec.name in inverted_tools():
                spec = dataclasses.replace(
                    spec, handler=_recording_handler(self, spec)
                )
            instrumented.register(spec)
        return instrumented

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
        # resolves a pending confirmation when one EXISTS. With none
        # pending it is a NORMAL message (backlog: "Short replies send" —
        # a simple 'si' must be sendable): it falls through and starts a
        # turn so the model answers in conversation context; it is never
        # silently swallowed.
        decision = match_confirmation_utterance(text)
        if decision is not None and self.deps_base.confirmations.current_pending() is not None:
            await self._handle_confirmation_utterance(decision, text)
            return
        # R9 (2026-08-14, reviewer round 9 finding 3): a reminder DRAFT
        # (registered by reminders.create with empty text) is completed
        # by the NEXT user message — deterministically, no model in the
        # loop. The old man's "que llame a mi nieta" answer must become
        # the reminder text, never a brand-new Telegram request.
        draft = self._pending_reminder_draft()
        if draft is not None:
            await self._complete_reminder_draft(draft, text)
            return
        # R11 (2026-08-14, reviewer round 11 finding 5): a time-only
        # reminder request ("poneme un recordatorio para mañana a las
        # 9") is intercepted HERE, LLM-free: the draft is registered
        # with the parsed due and the app asks for the text itself.
        # The model used to ask in plain chat without calling the tool,
        # so the user's answer derailed into a new request. With the
        # interception, the ask is deterministic and the answer always
        # completes the draft.
        local_due = match_time_only_reminder(text)
        if local_due is not None:
            await self._intercept_time_only_reminder(text, local_due)
            return
        if self._busy or (self._active_task and not self._active_task.done()):
            # R8 (2026-08-14, reviewer round 8 finding 2): echo the user's
            # message BEFORE the busy error. The renderer renders chat
            # ONLY from the server echo (no optimistic append), so a
            # swallowed text vanishes from the screen (input clears,
            # nothing appears) and the user retypes — which then starts a
            # SECOND turn once the first finishes ("answered twice with
            # the same list"). With the echo, the message shows in chat
            # and the honest "wait a moment" explains why it did not run.
            await self.bus.publish(
                UserMessageEvent(id=f"u{uuid.uuid4().hex[:8]}", text=text)
            )
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
    async def handle_reminder_fire(self, reminder: dict) -> None:
        """W1-TASKS (GATE-5): a fired reminder starts EXACTLY ONE fresh
        agent turn (cron-style cadence injection) with the reminder in
        context.

        Wired by the app as the scheduler's ``on_fire`` hook, so the
        scheduler stays LLM-independent. The turn prompt carries the
        reminder text verbatim — the model sees it even though one-shot
        reminders leave ``list_active`` once fired. TTS: the turn rides
        the exact ``_turn`` path, so it respects ``tts.auto_speak``
        (default off -> fires stay silent, matching the notification
        path which never speaks on its own).

        Busy guard: while a turn is already running, the fire never
        stacks a second turn (the double-trigger hazard) — the reminder
        already reached the UI via the notification event, and recurring
        reminders refire on their own cadence.
        """
        if self._busy or (self._active_task and not self._active_task.done()):
            if self.deps_base.audit is not None:
                self.deps_base.audit.log(
                    "reminders",
                    "fire_turn_skipped",
                    {"reminder_id": reminder["id"], "reason": "busy"},
                )
            return
        if self.deps_base.audit is not None:
            self.deps_base.audit.log(
                "reminders",
                "fire_turn_started",
                {"reminder_id": reminder["id"], "text": reminder["text"][:120]},
            )
        self._busy = True
        text = f"Recordatorio activado: {reminder['text']}"
        self._active_task = asyncio.create_task(self._run_turn(text))

    # ------------------------------------------------------------------ #
    def _pending_reminder_draft(self) -> dict | None:
        """The oldest pending reminders.create_draft action, or None."""
        for p in self.deps_base.pending.list_pending():
            if p["tool"] == "reminders.create_draft":
                return p
        return None

    async def _complete_reminder_draft(self, draft: dict, text: str) -> None:
        """R9 (2026-08-14, reviewer round 9 finding 3): deterministically
        complete a reminder draft with the user's follow-up message —
        echo it, create the reminder from the FROZEN stored args, refresh
        the panel, confirm in plain words, resolve the draft."""
        args = draft.get("args") or {}
        due_at = args.get("due_at") or ""
        repeat_rule = args.get("repeat_rule") or "none"
        from arsvox_agent.tools.reminder_tools import _due_plain_words

        # R14 (2026-08-14, reviewer round 14 finding 5): dedupe — the old
        # man saw "Llamar a mi nieta" + "que llame a mi nieta" as the same
        # thing twice. Refuse when an active reminder matches at the same
        # hour with similar text (normalized, accent-insensitive).
        existing = _find_similar_active(self.deps_base.reminders, text, due_at)
        if existing:
            self.deps_base.pending.resolve(draft["id"], "executed")
            due_plain = _due_plain_words(due_at, self.deps_base.reminders.tz)
            return await self.bus.publish(
                AgentMessageEvent(
                    id=f"a{uuid.uuid4().hex[:8]}",
                    text=(
                        f"Ya tenés anotado: {existing['text']} — "
                        f"{due_plain}. No lo repito."
                    ),
                )
            )
        # Echo first — the reply must never appear without the question.
        await self.bus.publish(
            UserMessageEvent(id=f"u{uuid.uuid4().hex[:8]}", text=text)
        )
        reminder_id = self.deps_base.reminders.create(text, due_at, repeat_rule)
        self.deps_base.pending.resolve(draft["id"], "executed")
        if self.deps_base.audit is not None:
            self.deps_base.audit.log(
                "reminders",
                "draft_completed",
                {"reminder_id": reminder_id, "text": text[:120]},
            )
        # Refresh the tasks panel content (same payload the tools emit).
        from arsvox_agent.tools.notes_tasks_tools import _tasks_update_payload
        from arsvox_contracts.events import TasksUpdateEvent

        todos, reminders = _tasks_update_payload(self.deps_base)
        await self.bus.publish(TasksUpdateEvent(todos=todos, reminders=reminders))
        due_plain = _due_plain_words(due_at, self.deps_base.reminders.tz)
        if repeat_rule == "daily":
            suffix = " y se repetirá a diario"
        elif repeat_rule == "weekly":
            suffix = " y se repetirá todas las semanas"
        else:
            suffix = ""
        reply = f"Listo. Te puse el recordatorio para {due_plain}: {text}.{suffix}"
        await self.bus.publish(AgentMessageEvent(text=reply, delta=False))
        self.settle_to_terminal()

    # ------------------------------------------------------------------ #
    async def _intercept_time_only_reminder(self, text: str, local_due: str) -> None:
        """R11 finding 5: a time-only reminder request is handled LLM-free.

        ``local_due`` is a local naive YYYY-MM-DDTHH:MM from
        match_time_only_reminder. Register the pending draft and ask for
        the text deterministically — the model never gets a turn in
        which it could ask in plain chat and lose the thread.
        """
        from arsvox_agent.tools.reminder_tools import _due_plain_words

        utc_due = normalize_due_utc(local_due, self.deps_base.reminders.tz)
        if utc_due is None:
            return  # parser gave a malformed instant; let the model turn run
        # Echo first — the question must never appear without the request.
        await self.bus.publish(
            UserMessageEvent(id=f"u{uuid.uuid4().hex[:8]}", text=text)
        )
        pending_id = self.deps_base.pending.create(
            run_id=text[:60],
            tool="reminders.create_draft",
            args={"due_at": utc_due},
            title="Recordatorio (falta el texto)",
            detail=_due_plain_words(utc_due, self.deps_base.reminders.tz),
            expires_at=(
                datetime.now(timezone.utc) + timedelta(minutes=60)
            ).isoformat(timespec="seconds"),
        )
        if self.deps_base.audit is not None:
            self.deps_base.audit.log(
                "reminders", "draft_intercepted",
                {"pending_id": pending_id, "due_at": utc_due},
            )
        due_plain = _due_plain_words(utc_due, self.deps_base.reminders.tz)
        reply = f"¿Qué te recuerdo {due_plain}? Decime el texto y lo agendo."
        await self.bus.publish(AgentMessageEvent(text=reply, delta=False))
        self.settle_to_terminal()

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
        # GATE-3.5 (C4/R05): the unified terminal-state derivation
        # refuses to settle while speech is pending/playing — a spoken
        # confirmation resolved mid-TTS must not yank the machine into
        # LISTENING; the tts.finished ack settles with the fresh pending
        # state instead.
        self.settle_to_terminal()

    # ------------------------------------------------------------------ #
    async def _run_turn(self, text: str) -> None:
        # A1 (Cordis): one EffectLedger per turn. Opted-in model tool
        # calls record inverses as they execute (see
        # _instrumented_registry). On ABORT — cancellation (STOP cancels
        # _active_task, the existing path) or an unhandled exception —
        # rollback restores the pre-turn state. A turn that COMPLETES
        # keeps its effects: the ledger is dropped in finally without
        # rolling back (product invariant — the user wanted them).
        ledger = EffectLedger()
        self._run_ledger = ledger
        try:
            await self._turn(text)
        except asyncio.CancelledError:
            log.info("turn %s cancelled", text[:40])
            await ledger.rollback()
            raise
        except Exception as exc:  # noqa: BLE001 — surface to the UI
            log.exception("turn failed")
            await ledger.rollback()
            await self.bus.publish(
                ErrorEvent(message=_friendly_error(exc), recoverable=True)
            )
        finally:
            self._run_ledger = None
            self._busy = False
            # GATE-3.5 (C4/R05): settle_to_terminal's speech guard
            # refuses while TTS is dispatched-but-unacked or physically
            # playing — playback is still ahead, the renderer's
            # tts.finished ack settles it. Turns without TTS settle now.
            self.settle_to_terminal()

    def settle_to_terminal(self, force: bool = False) -> VoiceState | None:
        """Derive and publish the terminal voice state: LISTENING, or
        WAITING_FOR_CONFIRMATION while a pending confirmation exists
        (H5). THE single derivation — every path that may leave
        THINKING/SPEAKING for a terminal state routes through here:
        turn end, TTS acks, spoken confirmation, button confirm/cancel
        (ws._sync_state_after_resolve), and renderer disconnect.

        The speech guard (R05) refuses to settle while speech is pending
        or physically playing: only the renderer's tts.finished ack may
        end speech, and it settles with the fresh pending state.
        force=True clears the pending-speech flag and settles regardless
        of the guard — only for callers that KNOW no ack can ever arrive
        (renderer disconnect) or that speech just ended (tts.finished /
        tts.cancelled). Returns the published state, or None when the
        guard refused."""
        if force:
            self._speech_pending = False
        elif self.is_speech_pending():
            return None
        pending = self.deps_base.pending.list_pending()
        state = (
            VoiceState.WAITING_FOR_CONFIRMATION
            if pending
            else VoiceState.LISTENING
        )
        self._set_voice(state)
        return state

    def is_speech_pending(self) -> bool:
        """True while TTS speech is dispatched but not yet acked started
        (_speech_pending) or physically playing (pipeline SPEAKING).
        Public accessor so the transport can honor the R05 guard without
        reaching into privates (GATE-3.5)."""
        return self._speech_pending or (
            self.pipeline is not None
            and self.pipeline.state == VoiceState.SPEAKING
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
        the ack is a no-op: the stop path owns the terminal state.
        force=True: the ack IS the end of speech — settle with the fresh
        pending state (the guard would refuse while pipeline SPEAKING)."""
        if (
            self.pipeline is None
            or self.pipeline.state == VoiceState.SPEAKING
            or self._speech_pending
        ):
            self.settle_to_terminal(force=True)

    def on_tts_cancelled(self) -> None:
        """Renderer reports playback was interrupted (STOP / queue clear).

        During the STOP path the machine is already STOPPING/SLEEPING —
        the ack confirms physical playback stopped (R07) and is a no-op
        here. Defensively, if speech vanished while SPEAKING without a
        stop (e.g. renderer-side clear), settle so the machine never
        hangs in SPEAKING. force=True: the ack IS the end of speech."""
        if (
            self.pipeline is None
            or self.pipeline.state == VoiceState.SPEAKING
            or self._speech_pending
        ):
            self.settle_to_terminal(force=True)

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


# --------------------------------------------------------------------- #
# A1 (Cordis): recording wrapper for opted-in tool handlers. Module-level
# (below the class) so the AgentRuntime annotation resolves.

def _recording_handler(runtime: AgentRuntime, spec: ToolSpec) -> Handler:
    """Wrap one opted-in tool handler so a successful effectful call
    records its inverse into the turn's EffectLedger (A1).

    ``functools.wraps`` keeps the ORIGINAL signature/annotations visible
    to inspect.signature, which build_pydantic_tools uses to derive the
    model-facing JSON schema — the wrapper is transparent to the tool
    layer. Inverses are recorded only when ALL of:

      * a turn is live (``runtime._run_ledger`` set — never during
        execute_direct / approval execution);
      * the pair table (effect_ledger.inverse_for) has an inverse and
        the tool's returned text proves the effect happened;
      * no inverse for that key is already armed ("clear media ONLY
        when the same run opened it" — the first successful media.play
        of a run arms the inverse, later ones in the same run do not
        stack duplicates).

    The inverse closure reuses the existing handler via the SHARED
    registry's execute_direct (gate bypassed by design — the effect
    already happened; no new side-effect code paths).
    """
    original = spec.handler

    @functools.wraps(original)
    async def _recorded(tctx, *args, **kwargs):
        result = await original(tctx, *args, **kwargs)
        ledger = runtime._run_ledger
        if ledger is not None and not ledger.has_armed(spec.name):
            pair = inverse_for(spec.name, kwargs, result)
            if pair is not None:
                inverse_tool, inverse_args = pair
                run_id = tctx.run_id
                registry = runtime.registry

                async def _inverse():
                    return await registry.execute_direct(
                        inverse_tool, inverse_args, run_id=run_id
                    )

                ledger.add(spec.name, _inverse)
        return result

    return _recorded
