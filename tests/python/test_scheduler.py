"""Scheduler: fires due reminders once, snooze/dismiss intents."""

import time
from datetime import datetime, timedelta, timezone

from arsvox_agent.tools.scheduler import ReminderScheduler
from arsvox_agent.events import EventBus
from arsvox_memory import Database
from arsvox_memory.repos import NotificationStore, ReminderStore


def _setup(tmp_path, interval=1):
    db = Database(tmp_path / "sched.db")
    reminders = ReminderStore(db)
    notifications = NotificationStore(db)
    bus = EventBus()
    scheduler = ReminderScheduler(interval, reminders, notifications, bus, None)
    return db, reminders, notifications, bus, scheduler


def test_fire_due_reminder(tmp_path):
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)

    async def run():
        now = datetime.now(timezone.utc)
        rid = reminders.create(
            "Tomar medicina",
            (now - timedelta(seconds=1)).isoformat(timespec="seconds"),
            "none",
        )
        q = bus.subscribe()
        await scheduler.tick()
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        return rid, events

    rid, events = asyncio_run(run())
    assert reminders.get(rid)["status"] == "fired"
    assert notifications.list_active()  # one active notification
    kinds = {e["type"] for e in events}
    assert "notification" in kinds
    assert "ui_command" in kinds
    cmd = [e for e in events if e["type"] == "ui_command"][0]["command"]
    assert cmd["action"] == "notification.show"
    assert "medicina" in cmd["text"]


def test_fire_only_once(tmp_path):
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)

    async def run():
        now = datetime.now(timezone.utc)
        reminders.create("x", (now - timedelta(seconds=1)).isoformat(timespec="seconds"))
        await scheduler.tick()
        await scheduler.tick()
        return reminders.list_active(), notifications.list_active()

    active, notifications_active = asyncio_run(run())
    assert active == []  # one-shot fired, no refire
    assert len(notifications_active) == 1


def test_snooze_and_dismiss(tmp_path):
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)

    async def run():
        now = datetime.now(timezone.utc)
        rid = reminders.create(
            "Alarma diaria",
            (now - timedelta(seconds=1)).isoformat(timespec="seconds"),
            "daily",
        )
        await scheduler.tick()
        msg = await scheduler.snooze_top(600)
        assert "pospuesto" in msg
        n = notifications.latest_active()
        assert n is None  # snoozed resolves the active notification
        # force due again directly, then refire
        db.execute(
            "UPDATE reminders SET due_at = ? WHERE id = ?",
            ((now - timedelta(seconds=1)).isoformat(timespec="seconds"), rid),
        )
        db.commit()
        await scheduler.tick()
        msg2 = await scheduler.dismiss_top()
        assert "descartado" in msg2
        return rid

    rid = asyncio_run(run())
    assert reminders.get(rid)["status"] == "active"


def test_list_active_text(tmp_path):
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)
    reminders.create("medicina", "2099-01-01T08:00:00")
    text = scheduler.list_active_text()
    assert "medicina" in text


def asyncio_run(coro_or_fn):
    import asyncio

    if callable(coro_or_fn):
        return asyncio.run(coro_or_fn())
    return asyncio.run(coro_or_fn)
