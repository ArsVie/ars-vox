"""Confirmation coordinator: approve/cancel/expire/supersede flows."""

import asyncio
from datetime import datetime, timedelta, timezone

from arsvox_contracts import ConfirmationStatus

from arsvox_agent.confirmations import ConfirmationCoordinator
from arsvox_agent.events import EventBus
from arsvox_memory import Database
from arsvox_memory.repos import AuditStore, PendingStore


def _coordinator(tmp_path, executor):
    db = Database(tmp_path / "confirm.db")
    bus = EventBus()
    return (
        ConfirmationCoordinator(
            PendingStore(db), AuditStore(db), bus, timeout_s=30, executor=executor
        ),
        bus,
    )


def test_approve_executes_snapshot(tmp_path):
    executed = []

    async def executor(tool, args, run_id):
        executed.append((tool, args, run_id))
        return "Mensaje enviado: hola"

    coord, bus = _coordinator(tmp_path, executor)

    async def run():
        q = bus.subscribe()
        pid = await coord.request("r1", "telegram.send_pending", {"text": "hola"}, "Enviar", "hola")
        await coord.resolve(pid, approve=True)
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        return pid, events

    pid, events = asyncio.run(run())
    assert executed == [("telegram.send_pending", {"text": "hola"}, "r1")]
    kinds = {e["type"] for e in events}
    assert "confirmation_requested" in kinds
    assert "confirmation_resolved" in kinds
    resolved = [e for e in events if e["type"] == "confirmation_resolved"][0]
    # H5: approval state is separate from the execution result — the
    # terminal event reports the outcome (executed), not the approval.
    assert resolved["status"] == "executed"
    assert resolved["message"] == "Mensaje enviado: hola"
    assert pid


def test_execute_failure_marks_row_failed(tmp_path):
    """H5: an approved action that throws ends the lifecycle as failed —
    both in the row and on the wire (never a conflated 'approved')."""

    async def executor(tool, args, run_id):
        raise RuntimeError("boom")

    coord, bus = _coordinator(tmp_path, executor)

    async def run():
        q = bus.subscribe()
        pid = await coord.request("r1", "telegram.send_pending", {"text": "x"}, "Enviar", "x")
        await coord.resolve(pid, approve=True)
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        return pid, events

    pid, events = asyncio.run(run())
    row = coord.pending.get(pid)
    assert row["status"] == "failed"
    resolved = [e for e in events if e["type"] == "confirmation_resolved"][-1]
    assert resolved["status"] == "failed"
    assert "Error al ejecutar" in resolved["message"]


def test_lifecycle_passes_through_executing(tmp_path):
    """H5 explicit lifecycle: pending -> approved -> executing -> executed."""

    async def executor(tool, args, run_id):
        started.set()
        await release.wait()
        return "ok"

    coord, _ = _coordinator(tmp_path, executor)
    started = asyncio.Event()
    release = asyncio.Event()

    async def run():
        pid = await coord.request("r1", "telegram.send_pending", {"text": "x"}, "Enviar", "x")
        task = asyncio.create_task(coord.resolve(pid, approve=True))
        await asyncio.wait_for(started.wait(), timeout=2)
        mid = coord.pending.get(pid)["status"]
        release.set()
        await task
        final = coord.pending.get(pid)["status"]
        return mid, final

    mid, final = asyncio.run(run())
    assert mid == "executing"
    assert final == "executed"


def test_two_concurrent_confirmables_one_pending(tmp_path):
    """H5 global one-pending policy: a new confirmable replaces (supersedes)
    any pending confirmation, with a clear resolved event for the old one."""
    executed = []

    async def executor(tool, args, run_id):
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
    superseded = [e for e in events if e["type"] == "confirmation_resolved" and e["pending_id"] == pid1]
    assert superseded and superseded[-1]["status"] == "superseded"
    assert "Reemplazada" in superseded[-1]["message"]
    # approving the survivor still works
    asyncio.run(coord.resolve(pid2, approve=True))
    assert executed == ["notes.add"]


def test_cancel_invalidates_pending(tmp_path):
    """H5: cancel/stop invalidates pending confirmations (documented
    semantic: stop/cancel aborts the action)."""
    executed = []

    async def executor(tool, args, run_id):
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
    resolved = [e for e in events if e["type"] == "confirmation_resolved" and e["pending_id"] == pid]
    assert resolved and resolved[-1]["status"] == "cancelled"
    # a late approve must not execute
    asyncio.run(coord.resolve(pid, approve=True))
    assert executed == []


def test_cancel_does_not_execute(tmp_path):
    executed = []

    async def executor(tool, args, run_id):
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

    async def executor(tool, args, run_id):
        executed.append(tool)

    coord, _ = _coordinator(tmp_path, executor)
    coord.timeout_s = -1  # force expiry

    async def run():
        pid = await coord.request("r1", "telegram.send_pending", {"text": "x"}, "Enviar", "x")
        await coord.resolve(pid, approve=True)
        return pid

    pid = asyncio.run(run())
    assert executed == []
