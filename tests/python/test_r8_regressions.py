"""R8 regression tests: tasks_add dedup + busy-guard echo (reviewer round 8)."""
import asyncio

import pytest

from arsvox_agent.deps import Deps
from arsvox_agent.runtime import AgentRuntime
from arsvox_agent.tools import notes_tasks_tools
from arsvox_agent.tools.context import ToolContext
from arsvox_contracts import AppConfig
from arsvox_contracts import events as ev
from arsvox_memory import Database
from arsvox_memory.repos import (
    AuditStore,
    NoteStore,
    PanelStore,
    PendingStore,
    PreferenceStore,
    ReminderStore,
    SessionStore,
    TaskStore,
)


class _CaptureBus:
    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


def _make_deps(tmp_path) -> tuple[Deps, _CaptureBus]:
    db = Database(tmp_path / "mem.db")
    bus = _CaptureBus()
    sessions = SessionStore(db)
    deps = Deps(
        config=AppConfig(),
        db=db,
        sessions=sessions,
        notes=NoteStore(db),
        tasks=TaskStore(db),
        reminders=ReminderStore(db),
        notifications=None,
        panels=PanelStore(db),
        preferences=PreferenceStore(db),
        progress=None,
        pending=PendingStore(db),
        documents=None,
        audit=AuditStore(db),
        bus=bus,  # type: ignore[arg-type]
        policy=None,
        confirmations=None,
        tts=None,
        telegram=None,
        run_id="run-1",
        session_id="sess-1",
    )
    return deps, bus


def _tctx(deps: Deps, bus: _CaptureBus) -> ToolContext:
    return ToolContext(deps=deps, run_id=deps.run_id, session_id=deps.session_id, bus=bus)


def test_tasks_add_dedups_open_same_title(tmp_path):
    """R8 finding 3: adding 'comprar pan' twice keeps ONE pending task."""
    deps, bus = _make_deps(tmp_path)
    first = asyncio.run(notes_tasks_tools.tasks_add(_tctx(deps, bus), "Comprar pan"))
    assert "agregada" in first or "ya está" in first
    second = asyncio.run(notes_tasks_tools.tasks_add(_tctx(deps, bus), "comprar pan"))
    assert "ya está" in second, f"expected dedup, got: {second}"
    rows = deps.tasks.list()
    same = [t for t in rows if t["title"].strip().lower() == "comprar pan"]
    assert len(same) == 1
    # the panel still opens + tasks.update still emitted on the dedup path
    ui = [e for e in bus.events if isinstance(e, ev.UiCommandEvent)]
    assert ui and ui[-1].command.action == "panel.open"
    assert any(isinstance(e, ev.TasksUpdateEvent) for e in bus.events)


def test_tasks_add_allows_distinct_titles(tmp_path):
    deps, bus = _make_deps(tmp_path)
    asyncio.run(notes_tasks_tools.tasks_add(_tctx(deps, bus), "Comprar pan"))
    asyncio.run(notes_tasks_tools.tasks_add(_tctx(deps, bus), "Llamar al médico"))
    rows = deps.tasks.list()
    assert len(rows) == 2


def test_tasks_add_does_not_dedup_completed(tmp_path):
    """A done 'comprar pan' must not block a NEW pending one."""
    deps, bus = _make_deps(tmp_path)
    asyncio.run(notes_tasks_tools.tasks_add(_tctx(deps, bus), "Comprar pan"))
    tid = deps.tasks.list()[0]["id"]
    deps.tasks.complete(tid)
    result = asyncio.run(notes_tasks_tools.tasks_add(_tctx(deps, bus), "Comprar pan"))
    assert "agregada" in result or "ya está" in result
    pending = [t for t in deps.tasks.list() if t["status"] == "pending"]
    assert len(pending) == 1


@pytest.mark.asyncio
async def test_busy_guard_echoes_user_message_before_error(tmp_path):
    """R8 finding 2: text sent while busy must render in chat (echo)
    and be followed by the honest busy error — never silently swallowed."""
    from arsvox_agent.tools import ToolRegistry

    deps, bus = _make_deps(tmp_path)
    runtime = AgentRuntime(
        config=deps.config,
        deps_base=deps,
        registry=ToolRegistry(),
        bus=bus,  # type: ignore[arg-type]
    )
    runtime._busy = True  # simulate an in-flight turn

    await runtime.handle_user_text("mostrame mis recordatorios")

    types = [type(e).__name__ for e in bus.events]
    assert "UserMessageEvent" in types, f"user text was swallowed: {types}"
    assert "ErrorEvent" in types, f"busy error missing: {types}"
    # echo comes BEFORE the error, exactly like a normal turn renders
    echo_idx = next(i for i, e in enumerate(bus.events) if isinstance(e, ev.UserMessageEvent))
    err_idx = next(i for i, e in enumerate(bus.events) if isinstance(e, ev.ErrorEvent))
    assert echo_idx < err_idx


@pytest.mark.asyncio
async def test_reminder_draft_completes_with_next_message(tmp_path):
    """R9 finding 3: 'poneme un recordatorio para mañana a las 9' (no
    text) registers a draft; the user's next message completes it
    deterministically — echo + create + plain-words confirmation, no
    model in the loop."""
    from arsvox_agent.tools import ToolRegistry
    from arsvox_agent.tools import reminder_tools

    deps, bus = _make_deps(tmp_path)
    result = await reminder_tools.reminders_create(
        _tctx(deps, bus),
        text="",
        due_at="2026-08-15T09:00:00",
    )
    assert "Decime el texto" in result, f"expected draft ask, got: {result}"
    drafts = [p for p in deps.pending.list_pending() if p["tool"] == "reminders.create_draft"]
    assert len(drafts) == 1

    runtime = AgentRuntime(
        config=deps.config,
        deps_base=deps,
        registry=ToolRegistry(),
        bus=bus,  # type: ignore[arg-type]
    )
    await runtime.handle_user_text("que llame a mi nieta")

    # reminder created with the follow-up as text
    active = deps.reminders.list_active()
    assert any("nieta" in r["text"] for r in active), f"draft not completed: {active}"
    # draft consumed
    assert not [p for p in deps.pending.list_pending() if p["tool"] == "reminders.create_draft"]
    # echo before confirmation, plain-words confirmation present
    msgs = [e for e in bus.events if isinstance(e, (ev.UserMessageEvent, ev.AgentMessageEvent))]
    assert isinstance(msgs[0], ev.UserMessageEvent) and msgs[0].text == "que llame a mi nieta"
    assert isinstance(msgs[-1], ev.AgentMessageEvent)
    assert "mañana" in msgs[-1].text and "nieta" in msgs[-1].text
    # tasks panel refreshed
    assert any(isinstance(e, ev.TasksUpdateEvent) for e in bus.events)


async def test_time_only_reminder_intercepted_llm_free(tmp_path):
    """R11 finding 5: 'poneme un recordatorio para mañana a las 9' (no
    text) is intercepted BEFORE the model — draft registered + ask, no
    model turn; the follow-up completes it. The model used to ask in
    plain chat without calling the tool, derailing the answer."""
    from arsvox_agent.tools import ToolRegistry

    deps, bus = _make_deps(tmp_path)
    runtime = AgentRuntime(
        config=deps.config,
        deps_base=deps,
        registry=ToolRegistry(),
        bus=bus,  # type: ignore[arg-type]
    )
    await runtime.handle_user_text("poneme un recordatorio para mañana a las 9")

    drafts = [p for p in deps.pending.list_pending() if p["tool"] == "reminders.create_draft"]
    assert len(drafts) == 1, f"expected intercepted draft, got: {drafts}"
    # the ask is deterministic and plain-words
    msgs = [e for e in bus.events if isinstance(e, ev.AgentMessageEvent)]
    assert msgs, "expected an ask"
    assert "¿Qué te recuerdo" in msgs[-1].text, msgs[-1].text
    assert "2026" not in msgs[-1].text, f"raw date in ask: {msgs[-1].text}"

    # the answer completes the draft, echo first
    await runtime.handle_user_text("que llame a mi nieta")
    active = deps.reminders.list_active()
    assert any("nieta" in r["text"] for r in active), f"draft not completed: {active}"
    msgs2 = [e for e in bus.events if isinstance(e, ev.UserMessageEvent)]
    assert msgs2[-1].text == "que llame a mi nieta"
    # the completion confirms in plain words
    last_agent = [e for e in bus.events if isinstance(e, ev.AgentMessageEvent)][-1]
    assert "nieta" in last_agent.text and "2026" not in last_agent.text


@pytest.mark.asyncio
async def test_reminder_draft_skipped_when_no_draft(tmp_path):
    """Without a draft, a normal message starts a normal turn (the
    confirmation funnel must not swallow arbitrary text)."""
    from arsvox_agent.tools import ToolRegistry

    deps, bus = _make_deps(tmp_path)
    runtime = AgentRuntime(
        config=deps.config,
        deps_base=deps,
        registry=ToolRegistry(),
        bus=bus,  # type: ignore[arg-type]
    )
    await runtime.handle_user_text("hola")
    # no draft exists -> no draft completion path; the text must not have
    # been echoed by the DRAFT path with a confirmation (it starts a turn
    # which is async; here we only assert no draft artifacts)
    assert not [p for p in deps.pending.list_pending() if p["tool"] == "reminders.create_draft"]
