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
