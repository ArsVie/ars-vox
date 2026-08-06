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
    assert resolved["status"] == "approved"
    assert resolved["message"] == "Mensaje enviado: hola"
    assert pid


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
