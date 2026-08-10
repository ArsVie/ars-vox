"""Scheduler: fires due reminders once, snooze/dismiss intents.

W2 (GATE-3.5): each fired reminder publishes ONE event (the canonical
`notification` event — the old second publish, UiCommandEvent/
NotificationShow, made the renderer append a second identical chat line),
and snooze/dismiss emit the TasksUpdateEvent so content.tasks refreshes.
"""

import time
from datetime import datetime, timedelta, timezone

from arsvox_agent.tools.scheduler import ReminderScheduler
from arsvox_agent.events import EventBus
from arsvox_memory import Database
from arsvox_memory.repos import NotificationStore, ReminderStore, TaskStore


def _setup(tmp_path, interval=1):
    db = Database(tmp_path / "sched.db")
    reminders = ReminderStore(db)
    notifications = NotificationStore(db)
    bus = EventBus()
    scheduler = ReminderScheduler(interval, reminders, notifications, bus, None)
    return db, reminders, notifications, bus, scheduler


def _drain(q) -> list[dict]:
    events = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


def test_fire_due_reminder_single_publish(tmp_path):
    """W2: one fired reminder -> exactly ONE notification event, and NO
    ui_command (the old NotificationShow duplicate that produced a second
    chat line in the renderer)."""
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
        return rid, _drain(q)

    rid, events = asyncio_run(run())
    assert reminders.get(rid)["status"] == "fired"
    assert notifications.list_active()  # one active notification
    notif_events = [e for e in events if e["type"] == "notification"]
    assert len(notif_events) == 1, events
    assert notif_events[0]["notification_id"] == str(notifications.list_active()[0]["id"])
    assert notif_events[0]["text"] == "Tomar medicina"
    # the duplicate command channel is gone
    ui_commands = [e for e in events if e["type"] == "ui_command"]
    assert ui_commands == [], events


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
        # refire at the snooze target (scheduler promotes snoozed -> active)
        row = reminders.get(rid)
        assert row["occ_status"] == "snoozed"
        await scheduler.tick(now_iso=row["due_at"])
        assert notifications.latest_active() is not None
        msg2 = await scheduler.dismiss_top()
        assert "descartado" in msg2
        return rid

    rid = asyncio_run(run())
    row = reminders.get(rid)
    assert row["status"] == "active"  # recurring schedule stays live
    assert row["occ_status"] == "active"
    assert row["due_at"] > datetime.now(timezone.utc).isoformat(timespec="seconds")


def test_snooze_emits_tasks_update(tmp_path):
    """W2: snooze_top refreshes both stores — the TasksUpdateEvent must be
    published so the renderer's content.tasks does not go stale."""
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)
    tasks = TaskStore(db)
    scheduler.tasks = tasks
    tasks.add("Comprar pan")

    async def run():
        now = datetime.now(timezone.utc)
        rid = reminders.create(
            "pastilla", (now - timedelta(seconds=1)).isoformat(timespec="seconds"), "none"
        )
        await scheduler.tick()
        q = bus.subscribe()
        await scheduler.snooze_top(600)
        return rid, _drain(q)

    rid, events = asyncio_run(run())
    updates = [e for e in events if e["type"] == "tasks.update"]
    assert len(updates) == 1, events
    payload = updates[0]
    # todos come from the wired tasks store (never wiped by a partial event)
    assert [t["title"] for t in payload["todos"]] == ["Comprar pan"]
    # the snoozed reminder is still a live schedule -> still listed
    assert [r["title"] for r in payload["reminders"]] == ["pastilla"]
    assert reminders.get(rid)["occ_status"] == "snoozed"


def test_dismiss_emits_tasks_update(tmp_path):
    """W2: dismiss_top publishes TasksUpdateEvent; the dismissed one-shot
    leaves the active reminders list."""
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)
    tasks = TaskStore(db)
    scheduler.tasks = tasks
    tasks.add("Comprar pan")

    async def run():
        now = datetime.now(timezone.utc)
        rid = reminders.create(
            "pastilla", (now - timedelta(seconds=1)).isoformat(timespec="seconds"), "none"
        )
        await scheduler.tick()
        q = bus.subscribe()
        await scheduler.dismiss_top()
        return rid, _drain(q)

    rid, events = asyncio_run(run())
    updates = [e for e in events if e["type"] == "tasks.update"]
    assert len(updates) == 1, events
    payload = updates[0]
    assert [t["title"] for t in payload["todos"]] == ["Comprar pan"]
    # one-shot dismissed -> exhausted, no longer in the active list
    assert payload["reminders"] == []
    assert reminders.get(rid)["occ_status"] == "dismissed"


def test_tick_emits_tasks_update_after_fire(tmp_path):
    """W1 (GATE-5): a fired reminder reaches BOTH surfaces through the
    wire — exactly ONE notification event AND one tasks.update (ADV-F2:
    mark_fired moves one-shots out of list_active, so content.tasks must
    refresh at fire time, not only on snooze/dismiss)."""
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)
    tasks = TaskStore(db)
    scheduler.tasks = tasks
    tasks.add("Comprar pan")

    async def run():
        now = datetime.now(timezone.utc)
        reminders.create(
            "Tomar medicina",
            (now - timedelta(seconds=1)).isoformat(timespec="seconds"),
            "none",
        )
        q = bus.subscribe()
        await scheduler.tick()
        return _drain(q)

    events = asyncio_run(run())
    notif_events = [e for e in events if e["type"] == "notification"]
    assert len(notif_events) == 1, events
    updates = [e for e in events if e["type"] == "tasks.update"]
    assert len(updates) == 1, events
    payload = updates[0]
    # todos come from the wired tasks store (never wiped by a partial event)
    assert [t["title"] for t in payload["todos"]] == ["Comprar pan"]
    # the one-shot fired -> exhausted, no longer in the active list
    assert payload["reminders"] == []


def test_snooze_without_tasks_store_does_not_emit(tmp_path):
    """Unwired scheduler (tasks=None) must NOT publish a todos=[] update —
    the renderer replaces content.tasks wholesale, so a partial event would
    wipe the user's todo list."""
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)

    async def run():
        now = datetime.now(timezone.utc)
        reminders.create("x", (now - timedelta(seconds=1)).isoformat(timespec="seconds"))
        await scheduler.tick()
        q = bus.subscribe()
        await scheduler.snooze_top(600)
        return _drain(q)

    events = asyncio_run(run())
    assert all(e["type"] != "tasks.update" for e in events), events


def test_list_active_text(tmp_path):
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)
    reminders.create("medicina", "2099-01-01T08:00:00")
    text = scheduler.list_active_text()
    assert "medicina" in text


def test_fire_invokes_on_fire_once_per_reminder(tmp_path):
    """W1-TASKS (GATE-5): the cadence-injection hook (the app wires it to
    runtime.handle_reminder_fire) is called EXACTLY once per fired
    reminder, after the fire's own frames, and a second tick never
    refires a one-shot."""
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)
    calls: list[dict] = []

    async def on_fire(reminder):
        calls.append(reminder)

    scheduler.on_fire = on_fire

    async def run():
        now = datetime.now(timezone.utc)
        rid = reminders.create(
            "Cadencia W1", (now - timedelta(seconds=1)).isoformat(timespec="seconds"), "none"
        )
        rid2 = reminders.create(
            "Cadencia W2", (now - timedelta(seconds=2)).isoformat(timespec="seconds"), "none"
        )
        await scheduler.tick()
        await scheduler.tick()  # one-shots fired -> nothing due -> no hook
        return rid, rid2

    rid, rid2 = asyncio_run(run())
    # due() orders by due_at, so the hook fires in due order — once per
    # fired reminder, never more
    assert {c["id"] for c in calls} == {rid, rid2}, calls
    assert {c["text"] for c in calls} == {"Cadencia W1", "Cadencia W2"}, calls
    # one-shot fired: nothing is due on later ticks, so the hook can never
    # be re-invoked for the same occurrence (single-fire guarantee)
    assert len(calls) == 2


def test_on_fire_without_hook_is_inert(tmp_path):
    """The hook is optional: a scheduler without on_fire (unit tests,
    LLM-free deployments) ticks exactly as before — no turn, no error."""
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)

    async def run():
        now = datetime.now(timezone.utc)
        reminders.create(
            "x", (now - timedelta(seconds=1)).isoformat(timespec="seconds"), "none"
        )
        q = bus.subscribe()
        await scheduler.tick()
        return _drain(q)

    events = asyncio_run(run())
    assert len([e for e in events if e["type"] == "notification"]) == 1


def asyncio_run(coro_or_fn):
    import asyncio

    if callable(coro_or_fn):
        return asyncio.run(coro_or_fn())
    return asyncio.run(coro_or_fn)
