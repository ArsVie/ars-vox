"""GATE-2.5 H2: reminder lifecycle — UTC instants, local-zone semantics,
occurrence lifecycle (fired/snoozed/dismissed) separate from recurrence.

Audit-required scenarios:
- one-shot fire -> snooze -> refire (status restored, fires at now+10m)
- daily reminder -> snooze today -> next occurrence still tomorrow 8:00
  local (not 8:10)
- local-zone reminder vs UTC clock (naive "08:00" means 08:00 LOCAL)
- two different offsets sort correctly by due instant
"""

import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from arsvox_agent.events import EventBus
from arsvox_agent.tools.scheduler import ReminderScheduler
from arsvox_memory import Database
from arsvox_memory.repos import NotificationStore, ReminderStore
from arsvox_memory.repos.reminders import normalize_due_utc, resolve_tz

# UTC+05:30, no DST -> deterministic assertions.
TZ_NAME = "Asia/Kolkata"
TZ = ZoneInfo(TZ_NAME)


def _setup(tmp_path, interval=1):
    db = Database(tmp_path / "lifecycle.db")
    reminders = ReminderStore(db, tz_name=TZ_NAME)
    notifications = NotificationStore(db)
    bus = EventBus()
    scheduler = ReminderScheduler(interval, reminders, notifications, bus, None)
    return db, reminders, notifications, bus, scheduler


# --------------------------------------------------------------------- #
# 1) one-shot fire -> snooze -> refire
# --------------------------------------------------------------------- #
def test_one_shot_snooze_refire(tmp_path):
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)
    now = datetime.now(timezone.utc)

    rid = reminders.create(
        "pastilla", (now - timedelta(seconds=1)).isoformat(timespec="seconds"), "none"
    )
    asyncio.run(scheduler.tick())
    row = reminders.get(rid)
    assert row["status"] == "fired"
    assert row["occ_status"] == "fired"

    # snooze: status restored to active, due = now+10m, occ snoozed
    assert reminders.snooze(rid, 600, now)
    # the scheduler resolves the fired notification when snoozing (mirror it)
    notifications.resolve(notifications.latest_active()["id"], "snoozed")
    row = reminders.get(rid)
    snooze_target = (now + timedelta(seconds=600)).isoformat(timespec="seconds")
    assert row["status"] == "active"
    assert row["occ_status"] == "snoozed"
    assert row["due_at"] == snooze_target
    assert row["snoozed_until"] == snooze_target

    # at the snooze target the scheduler promotes and refires
    asyncio.run(scheduler.tick(now_iso=snooze_target))
    row = reminders.get(rid)
    assert row["status"] == "fired"  # one-shot exhausted again
    assert row["occ_status"] == "fired"
    assert len(notifications.list_active()) == 1  # a fresh notification
    occ = reminders.occurrences(rid)
    assert [o["status"] for o in occ] == ["fired", "snoozed"]


# --------------------------------------------------------------------- #
# 2) daily -> snooze today -> next occurrence still tomorrow 8:00 local
# --------------------------------------------------------------------- #
def test_daily_snooze_keeps_tomorrow_800_local(tmp_path):
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)

    # deterministic clock: daily 08:00 local (Kolkata) = 02:30 UTC
    due_utc = "2026-08-06T02:30:00+00:00"
    rid = reminders.create("medicina", due_utc, repeat_rule="daily")
    row = reminders.get(rid)
    assert row["repeat_time"] == "08:00"
    assert row["due_at"].endswith("+00:00")

    # fire today's occurrence at 08:00 local
    asyncio.run(scheduler.tick(now_iso="2026-08-06T02:30:01+00:00"))
    row = reminders.get(rid)
    assert row["occ_status"] == "active"
    assert row["due_at"] == "2026-08-07T02:30:00+00:00"  # tomorrow 08:00 local

    # snooze 10 min: the OCCURRENCE moves to now+10m, recurrence untouched
    now = datetime.fromisoformat("2026-08-06T02:30:01+00:00")
    assert reminders.snooze(rid, 600, now)
    row = reminders.get(rid)
    assert row["occ_status"] == "snoozed"
    assert row["due_at"] == "2026-08-06T02:40:01+00:00"  # 08:40:01 local
    assert row["due_at"] != "2026-08-07T02:40:00+00:00"  # not tomorrow 8:10

    # refire at the snooze target -> next occurrence is tomorrow 08:00 local
    asyncio.run(scheduler.tick(now_iso="2026-08-06T02:40:01+00:00"))
    row = reminders.get(rid)
    assert row["occ_status"] == "active"
    assert row["due_at"] == "2026-08-07T02:30:00+00:00"
    assert datetime.fromisoformat(row["due_at"]).astimezone(TZ).strftime("%H:%M") == "08:00"
    assert datetime.fromisoformat(row["due_at"]).astimezone(TZ).date().isoformat() == "2026-08-07"


# --------------------------------------------------------------------- #
# 3) local-zone semantics: naive "08:00" is 08:00 LOCAL, not UTC
# --------------------------------------------------------------------- #
def test_naive_due_is_local_not_utc(tmp_path):
    tz = resolve_tz(TZ_NAME)
    assert normalize_due_utc("2026-08-06T08:00:00", tz) == "2026-08-06T02:30:00+00:00"
    # offset-aware input is converted, not re-interpreted
    assert normalize_due_utc("2026-08-06T08:00:00+02:00", tz) == "2026-08-06T06:00:00+00:00"
    assert normalize_due_utc("no es una fecha", tz) is None

    # store path: naive create lands as the correct UTC instant
    db, reminders, _, _, _ = _setup(tmp_path)
    rid = reminders.create("toma", "2026-08-06T08:00:00")
    assert reminders.get(rid)["due_at"] == "2026-08-06T02:30:00+00:00"


# --------------------------------------------------------------------- #
# 4) two different offsets sort correctly by due instant
# --------------------------------------------------------------------- #
def test_different_offsets_sort_by_due_instant(tmp_path):
    db, reminders, _, _, _ = _setup(tmp_path)
    # -05:00 08:00 == 13:00Z  ;  +02:00 14:00 == 12:00Z (earlier instant)
    rid_late = reminders.create("A", "2026-08-06T08:00:00-05:00")
    rid_early = reminders.create("B", "2026-08-06T14:00:00+02:00")
    assert reminders.get(rid_early)["due_at"] == "2026-08-06T12:00:00+00:00"
    assert reminders.get(rid_late)["due_at"] == "2026-08-06T13:00:00+00:00"
    rows = reminders.due("2026-08-06T13:30:00+00:00")
    assert [r["id"] for r in rows] == [rid_early, rid_late]


# --------------------------------------------------------------------- #
# extras: dismiss lifecycle + recurrence anchor integrity
# --------------------------------------------------------------------- #
def test_dismiss_one_shot_prevents_refire(tmp_path):
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)
    now = datetime.now(timezone.utc)
    rid = reminders.create("una vez", (now - timedelta(seconds=1)).isoformat(timespec="seconds"))
    asyncio.run(scheduler.tick())
    assert reminders.dismiss(rid)
    row = reminders.get(rid)
    assert row["status"] == "fired"
    assert row["occ_status"] == "dismissed"
    # a later tick must NOT refire a dismissed one-shot
    asyncio.run(scheduler.tick(now_iso=(now + timedelta(minutes=30)).isoformat(timespec="seconds")))
    assert reminders.get(rid)["occ_status"] == "dismissed"
    # history CHECK predates 'dismissed'; the fired row records the display
    assert reminders.occurrences(rid)[0]["status"] == "fired"


def test_dismiss_recurring_advances_schedule(tmp_path):
    db, reminders, notifications, bus, scheduler = _setup(tmp_path)
    rid = reminders.create("diaria", "2026-08-06T02:30:00+00:00", repeat_rule="daily")
    asyncio.run(scheduler.tick(now_iso="2026-08-06T02:30:01+00:00"))
    assert reminders.dismiss(rid)
    row = reminders.get(rid)
    assert row["status"] == "active"  # schedule stays live
    assert row["occ_status"] == "active"
    assert row["due_at"] == "2026-08-07T02:30:00+00:00"  # tomorrow 08:00 local


def test_weekly_recurrence_keeps_anchor_weekday(tmp_path):
    db, reminders, _, _, _ = _setup(tmp_path)
    # first occurrence: Wednesday 2026-08-05 08:00 local (02:30 UTC)
    rid = reminders.create("reunion", "2026-08-05T02:30:00+00:00", repeat_rule="weekly")
    row = reminders.get(rid)
    assert row["repeat_anchor_date"] == "2026-08-05"
    # snooze past midnight (Wed 23:55 -> Thu 00:05) then refire: the next
    # occurrence must still be a Wednesday 08:00 local
    now = datetime.fromisoformat("2026-08-05T18:25:00+00:00")  # 23:55 Kolkata
    assert reminders.snooze(rid, 600, now)
    snooze_target = "2026-08-05T18:35:00+00:00"  # 00:05 Thu Kolkata
    db.execute("UPDATE reminders SET due_at = ? WHERE id = ?", (snooze_target, rid))
    db.commit()
    from arsvox_memory.repos.reminders import next_local_occurrence

    nxt, anchor = next_local_occurrence(
        snooze_target, "weekly", "08:00", TZ, after_utc_iso=snooze_target, anchor_date="2026-08-05"
    )
    assert nxt == "2026-08-12T02:30:00+00:00"  # next Wednesday 08:00 local
    assert anchor == "2026-08-05"
    assert datetime.fromisoformat(nxt).astimezone(TZ).strftime("%A") == "Wednesday"
