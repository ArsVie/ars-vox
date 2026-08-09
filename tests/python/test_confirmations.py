"""Confirmation coordinator: approve/cancel/expire/supersede flows + R38
executing-action cancellation (cancellation tokens + point of no return)."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from arsvox_contracts import ConfirmationStatus

from arsvox_agent.confirmations import CancellationToken, ConfirmationCoordinator
from arsvox_agent.events import EventBus
from arsvox_memory import Database
from arsvox_memory.repos import AuditStore, PendingStore


def _coordinator(tmp_path, executor):
    db = Database(tmp_path / "confirm.db")
    bus = EventBus()

    async def _exec(tool, args, run_id, token=None):
        return await executor(tool, args, run_id, token)

    return (
        ConfirmationCoordinator(
            PendingStore(db), AuditStore(db), bus, timeout_s=30, executor=_exec
        ),
        bus,
    )


def _resolved(events, pending_id):
    return [
        e for e in events
        if e["type"] == "confirmation_resolved" and e["pending_id"] == pending_id
    ]


def test_approve_executes_snapshot(tmp_path):
    executed = []

    async def executor(tool, args, run_id, token=None):
        executed.append((tool, args, run_id))
        return "Mensaje enviado: hola"

    coord, bus = _coordinator(tmp_path, executor)

    async def run():
        q = bus.subscribe()
        pid = await coord.request("r1", "telegram.send_pending", {"text": "hola"}, "Enviar", "hola")
        await coord.resolve(pid, approve=True)
        await coord.wait_for_execution()
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        return pid, events

    pid, events = asyncio.run(run())
    assert executed == [("telegram.send_pending", {"text": "hola"}, "r1")]
    kinds = {e["type"] for e in events}
    assert "confirmation_requested" in kinds
    assert "confirmation_resolved" in kinds
    resolved = _resolved(events, pid)[-1]
    # H5: approval state is separate from the execution result — the
    # terminal event reports the outcome (executed), not the approval.
    assert resolved["status"] == "executed"
    assert resolved["message"] == "Mensaje enviado: hola"
    assert pid


def test_execute_failure_marks_row_failed(tmp_path):
    """H5: an approved action that throws ends the lifecycle as failed —
    both in the row and on the wire (never a conflated 'approved')."""

    async def executor(tool, args, run_id, token=None):
        raise RuntimeError("boom")

    coord, bus = _coordinator(tmp_path, executor)

    async def run():
        q = bus.subscribe()
        pid = await coord.request("r1", "telegram.send_pending", {"text": "x"}, "Enviar", "x")
        await coord.resolve(pid, approve=True)
        await coord.wait_for_execution()
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        return pid, events

    pid, events = asyncio.run(run())
    row = coord.pending.get(pid)
    assert row["status"] == "failed"
    resolved = _resolved(events, pid)[-1]
    assert resolved["status"] == "failed"
    assert "Error al ejecutar" in resolved["message"]


def test_lifecycle_passes_through_executing(tmp_path):
    """H5 explicit lifecycle: pending -> approved -> executing -> executed."""

    async def executor(tool, args, run_id, token=None):
        started.set()
        await release.wait()
        return "ok"

    coord, _ = _coordinator(tmp_path, executor)
    started = asyncio.Event()
    release = asyncio.Event()

    async def run():
        pid = await coord.request("r1", "telegram.send_pending", {"text": "x"}, "Enviar", "x")
        await coord.resolve(pid, approve=True)
        await asyncio.wait_for(started.wait(), timeout=2)
        mid = coord.pending.get(pid)["status"]
        release.set()
        await coord.wait_for_execution()
        final = coord.pending.get(pid)["status"]
        return mid, final

    mid, final = asyncio.run(run())
    assert mid == "executing"
    assert final == "executed"


def test_two_concurrent_confirmables_one_pending(tmp_path):
    """R37 (kept): global one-pending policy — a new confirmable replaces
    (supersedes) any pending confirmation, with a clear resolved event for
    the old one."""
    executed = []

    async def executor(tool, args, run_id, token=None):
        executed.append(tool)
        return "ok"

    coord, bus = _coordinator(tmp_path, executor)

    async def run():
        q = bus.subscribe()
        pid1 = await coord.request("r1", "telegram.send_pending", {"text": "a"}, "Enviar A", "a")
        pid2 = await coord.request("r2", "notes.add", {"text": "b"}, "Nota B", "b")
        pendings = coord.pending.list_pending()
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        return pid1, pid2, pendings, events

    pid1, pid2, pendings, events = asyncio.run(run())
    # exactly one active confirmation — the newest
    assert len(pendings) == 1
    assert pendings[0]["id"] == pid2
    # the replaced one is superseded in the store and reported on the wire
    assert coord.pending.get(pid1)["status"] == "superseded"
    superseded = _resolved(events, pid1)
    assert superseded and superseded[-1]["status"] == "superseded"
    assert "Reemplazada" in superseded[-1]["message"]
    # approving the survivor still works
    asyncio.run(coord.resolve(pid2, approve=True))
    asyncio.run(coord.wait_for_execution())
    assert executed == ["notes.add"]


def test_cancel_invalidates_pending(tmp_path):
    """H5: cancel/stop invalidates pending confirmations (documented
    semantic: stop/cancel aborts the action)."""
    executed = []

    async def executor(tool, args, run_id, token=None):
        executed.append(tool)
        return "ok"

    coord, bus = _coordinator(tmp_path, executor)

    async def run():
        q = bus.subscribe()
        pid = await coord.request("r1", "telegram.send_pending", {"text": "x"}, "Enviar", "x")
        n = await coord.invalidate_all()
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        return pid, n, events

    pid, n, events = asyncio.run(run())
    assert n == 1
    assert coord.pending.get(pid)["status"] == "cancelled"
    assert coord.current_pending() is None
    resolved = _resolved(events, pid)
    assert resolved and resolved[-1]["status"] == "cancelled"
    # a late approve must not execute
    asyncio.run(coord.resolve(pid, approve=True))
    assert executed == []


def test_cancel_does_not_execute(tmp_path):
    executed = []

    async def executor(tool, args, run_id, token=None):
        executed.append(tool)

    coord, _ = _coordinator(tmp_path, executor)

    async def run():
        pid = await coord.request("r1", "telegram.send_pending", {"text": "x"}, "Enviar", "x")
        await coord.resolve(pid, approve=False)
        return pid

    pid = asyncio.run(run())
    assert executed == []


def test_expired_never_executes(tmp_path):
    executed = []

    async def executor(tool, args, run_id, token=None):
        executed.append(tool)

    coord, _ = _coordinator(tmp_path, executor)
    coord.timeout_s = -1  # force expiry

    async def run():
        pid = await coord.request("r1", "telegram.send_pending", {"text": "x"}, "Enviar", "x")
        await coord.resolve(pid, approve=True)
        return pid

    pid = asyncio.run(run())
    assert executed == []


# --------------------------------------------------------------------- #
# R38: STOP cancels an already-EXECUTING approved action.
# --------------------------------------------------------------------- #


def test_stop_cancels_executing_action_before_point_of_no_return(tmp_path):
    """R38 (before PNR): a STOP while the approved action runs cancels
    it — the row resolves as cancelled and the executor is interrupted."""

    async def executor(tool, args, run_id, token=None):
        started.set()
        await release.wait()  # simulate the in-flight side effect
        return "Mensaje enviado: hola"

    coord, bus = _coordinator(tmp_path, executor)
    started = asyncio.Event()
    release = asyncio.Event()

    async def run():
        q = bus.subscribe()
        pid = await coord.request("r1", "telegram.send_pending", {"text": "hola"}, "Enviar", "hola")
        await coord.resolve(pid, approve=True)
        await asyncio.wait_for(started.wait(), timeout=2)
        mid = coord.pending.get(pid)["status"]
        # STOP arrives mid-execution
        cancelled = coord.cancel_executing()
        await coord.wait_for_execution()
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        final = coord.pending.get(pid)["status"]
        return cancelled, mid, final, events

    cancelled, mid, final, events = asyncio.run(run())
    assert cancelled is True
    assert mid == "executing"
    assert final == "cancelled"
    resolved = [e for e in events if e["type"] == "confirmation_resolved"][-1]
    assert resolved["status"] == "cancelled"
    assert "cancelada durante la ejecución" in resolved["message"]


def test_stop_after_point_of_no_return_surfaces_result(tmp_path):
    """R38 (after PNR): once the tool passed its point of no return
    (e.g. telegram.send invoked), STOP does NOT cancel — the execution
    completes and the result is surfaced as executed."""

    async def executor(tool, args, run_id, token=None):
        started.set()
        assert token is not None
        # the tool marks its point of no return...
        token.mark_point_of_no_return()
        await release.wait()  # ...and the side effect is in flight
        return "Mensaje enviado: hola"

    coord, bus = _coordinator(tmp_path, executor)
    started = asyncio.Event()
    release = asyncio.Event()

    async def run():
        pid = await coord.request("r1", "telegram.send_pending", {"text": "hola"}, "Enviar", "hola")
        await coord.resolve(pid, approve=True)
        await asyncio.wait_for(started.wait(), timeout=2)
        # STOP arrives AFTER the point of no return
        cancelled = coord.cancel_executing()
        # the task must NOT be cancelled — it completes and surfaces
        await coord.wait_for_execution()
        final = coord.pending.get(pid)["status"]
        events = []
        q = bus.subscribe()
        # re-read the terminal event: subscribe too late, so check the row
        return cancelled, final

    cancelled, final = asyncio.run(run())
    assert cancelled is True  # an execution WAS in flight
    assert final == "executed"  # ...but it was past the point of no return


def test_stop_cancels_executing_action_never_runs_side_effect(tmp_path):
    """R38 race guard: STOP while the execution is running but before the
    side effect completes — the executor is interrupted and the row
    resolves as cancelled (the executor's post-effect flag never sets)."""

    async def executor(tool, args, run_id, token=None):
        entered.set()
        await release.wait()  # would perform the side effect after this
        ran.set()
        return "ok"

    coord, _ = _coordinator(tmp_path, executor)
    entered = asyncio.Event()
    release = asyncio.Event()
    ran = asyncio.Event()

    async def run():
        pid = await coord.request("r1", "telegram.send_pending", {"text": "x"}, "Enviar", "x")
        await coord.resolve(pid, approve=True)
        await asyncio.wait_for(entered.wait(), timeout=2)  # execution running
        coord.cancel_executing()
        await coord.wait_for_execution()
        final = coord.pending.get(pid)["status"]
        return final, ran.is_set()

    final, ran_flag = asyncio.run(run())
    assert final == "cancelled"
    assert ran_flag is False


def test_cancel_token_raise_if_cancelled():
    token = CancellationToken()
    token.cancel()
    with pytest.raises(asyncio.CancelledError):
        token.raise_if_cancelled()
    token2 = CancellationToken()
    assert token2.point_of_no_return_reached is False
    token2.mark_point_of_no_return()
    assert token2.point_of_no_return_reached is True
