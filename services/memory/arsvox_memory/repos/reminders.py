"""Reminders and their occurrences. Scheduling decisions live in the agent
service scheduler; this store is only authoritative persistence.

Lifecycle model (GATE-2.5 H2):
- recurrence : repeat_rule (none|daily|weekly) + repeat_time "HH:MM" LOCAL
  wall clock in the reminder's tz (IANA name; NULL -> system local zone) +
  repeat_anchor_date (local calendar date of the first occurrence).
- occurrence : due_at (UTC instant, always "+00:00" ISO-8601), occ_status
  active|fired|snoozed|dismissed, snoozed_until (UTC instant at which a
  snoozed occurrence reactivates).
The legacy `status` column keeps SCHEDULE liveness only: active (live),
cancelled (user cancelled), fired (one-shot exhausted). Snooze restores it
to active so the scheduler can refire.
"""

import os
from datetime import datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from arsvox_contracts import NotificationStatus, ReminderStatus
from arsvox_memory.db import Database, utcnow_iso

_UTC = timezone.utc

# Occurrence lifecycle values (occ_status column)
OCC_ACTIVE = "active"
OCC_FIRED = "fired"
OCC_SNOOZED = "snoozed"
OCC_DISMISSED = "dismissed"


# --------------------------------------------------------------------- #
# Timezone + instant helpers (shared with the agent-side reminder tools)
# --------------------------------------------------------------------- #
def _system_tz() -> tzinfo:
    tz = datetime.now().astimezone().tzinfo
    return tz if tz is not None else _UTC


def resolve_tz(tz_name: str | None) -> tzinfo:
    """IANA zone from config if given, else the system local zone.

    System resolution: $TZ env var if set, else the interpreter's local
    offset (``datetime.now().astimezone()``). An invalid configured name
    falls back to the system zone rather than crashing the scheduler.
    """
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            pass
    env_tz = os.environ.get("TZ")
    if env_tz:
        try:
            return ZoneInfo(env_tz)
        except ZoneInfoNotFoundError:
            pass
    return _system_tz()


def normalize_due_utc(due_at: str, tz: tzinfo) -> str | None:
    """Parse a due datetime into a UTC instant.

    Naive input is treated as LOCAL wall time in ``tz`` (never UTC);
    offset-aware input is converted, not re-interpreted. Returns a uniform
    ``+00:00`` ISO-8601 string (timespec seconds) or None if unparseable.
    """
    try:
        parsed = datetime.fromisoformat(due_at)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(_UTC).isoformat(timespec="seconds")


def wall_clock(utc_iso: str, tz: tzinfo) -> str:
    """'HH:MM' wall-clock time of the instant in the given zone."""
    return datetime.fromisoformat(utc_iso).astimezone(tz).strftime("%H:%M")


def next_local_occurrence(
    consumed_utc_iso: str,
    repeat_rule: str,
    repeat_time: str | None,
    tz: tzinfo,
    after_utc_iso: str | None = None,
    anchor_date: str | None = None,
) -> tuple[str, str]:
    """Next occurrence instant for a recurring reminder, computed from the
    LOCAL-clock schedule — never a timedelta on the consumed instant, so
    snoozing cannot shift the recurrence.

    daily  -> the first local ``repeat_time`` after ``after``, starting from
              ``anchor_date`` (or the consumed occurrence's local date).
    weekly -> same, stepping 7 days from the anchor date.

    Returns (next_utc_iso, anchor_date_iso) — the anchor date may be
    back-filled for legacy rows without one.
    """
    if not repeat_time:
        repeat_time = wall_clock(consumed_utc_iso, tz)
    try:
        hour, minute = (int(p) for p in repeat_time.split(":", 1))
    except (ValueError, TypeError):
        repeat_time = wall_clock(consumed_utc_iso, tz)
        hour, minute = (int(p) for p in repeat_time.split(":", 1))
    if anchor_date:
        try:
            anchor = datetime.fromisoformat(anchor_date)
        except ValueError:
            anchor = None
    else:
        anchor = None
    if anchor is None:
        anchor = datetime.fromisoformat(consumed_utc_iso).astimezone(tz)
    anchor = anchor.replace(hour=hour, minute=minute, second=0, microsecond=0)
    anchor = anchor.replace(tzinfo=tz)
    step = timedelta(days=1) if repeat_rule == "daily" else timedelta(weeks=1)
    floor = (
        datetime.fromisoformat(after_utc_iso).astimezone(tz)
        if after_utc_iso
        else datetime.min.replace(tzinfo=_UTC).astimezone(tz)
    )
    candidate = anchor
    while candidate <= floor:
        candidate = candidate + step
    utc = candidate.astimezone(_UTC)
    # the recurrence anchor is stable once known: return the caller's anchor
    # when given (self-heal writes only happen for legacy rows without one)
    return utc.isoformat(timespec="seconds"), (anchor_date or candidate.date().isoformat())


# --------------------------------------------------------------------- #
class ReminderStore:
    def __init__(self, db: Database, tz_name: str | None = None):
        self.db = db
        self.tz_name = tz_name
        self.tz = resolve_tz(tz_name)

    # ------------------------------------------------------------------ #
    def create(
        self,
        text: str,
        due_at: str,
        repeat_rule: str = "none",
        repeat_time: str | None = None,
        tz: str | None = None,
    ) -> int:
        """Insert a reminder. ``due_at`` should already be a UTC instant
        (tools normalize via normalize_due_utc); naive input is defensively
        treated as local wall time in the store's zone."""
        due = normalize_due_utc(due_at, self.tz) or due_at
        if repeat_time is None and repeat_rule != "none":
            repeat_time = wall_clock(due, self.tz)
        anchor_date = (
            datetime.fromisoformat(due).astimezone(self.tz).date().isoformat()
            if repeat_rule != "none"
            else None
        )
        cur = self.db.execute(
            "INSERT INTO reminders (text, due_at, repeat_rule, repeat_time, tz,"
            " repeat_anchor_date, occ_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                text,
                due,
                repeat_rule,
                repeat_time,
                tz or self.tz_name,
                anchor_date,
                OCC_ACTIVE,
            ),
        )
        self.db.commit()
        return cur.lastrowid

    def get(self, reminder_id: int) -> dict | None:
        return self.db.row("SELECT * FROM reminders WHERE id = ?", (reminder_id,))

    def list_active(self) -> list[dict]:
        return self.db.rows(
            "SELECT * FROM reminders WHERE status = ? ORDER BY due_at",
            (ReminderStatus.ACTIVE.value,),
        )

    def due(self, now_iso: str) -> list[dict]:
        """Occurrences due at ``now_iso`` (UTC instant): live schedules whose
        current occurrence is active and at-or-before now, ordered by instant."""
        return self.db.rows(
            "SELECT * FROM reminders WHERE status = ? AND occ_status = ?"
            " AND due_at <= ? ORDER BY due_at",
            (ReminderStatus.ACTIVE.value, OCC_ACTIVE, now_iso),
        )

    def promote_snoozed(self, now_iso: str) -> int:
        """Snoozed occurrences whose snoozed_until has passed become active
        again (snooze -> active at the new due)."""
        cur = self.db.execute(
            "UPDATE reminders SET occ_status = ?, updated_at = ?"
            " WHERE occ_status = ? AND snoozed_until IS NOT NULL"
            " AND snoozed_until <= ?",
            (OCC_ACTIVE, utcnow_iso(), OCC_SNOOZED, now_iso),
        )
        self.db.commit()
        return cur.rowcount

    def cancel(self, reminder_id: int) -> bool:
        cur = self.db.execute(
            "UPDATE reminders SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
            (ReminderStatus.CANCELLED.value, utcnow_iso(), reminder_id, ReminderStatus.ACTIVE.value),
        )
        self.db.commit()
        return cur.rowcount > 0

    # ------------------------------------------------------------------ #
    def mark_fired(self, reminder_id: int, fired_at: str) -> None:
        """Record the occurrence as fired. One-shots close (schedule status
        fired, occurrence fired). Recurring reminders advance ONLY the
        occurrence: the next due is the next LOCAL-clock occurrence, so a
        snooze can never shift the recurrence."""
        r = self.get(reminder_id)
        if not r:
            return
        self.db.execute(
            "INSERT INTO reminder_occurrences (reminder_id, scheduled_for, fired_at, status)"
            " VALUES (?, ?, ?, ?)",
            (reminder_id, r["due_at"], fired_at, ReminderStatus.FIRED.value),
        )
        if r["repeat_rule"] == "none":
            self.db.execute(
                "UPDATE reminders SET status = ?, occ_status = ?, updated_at = ? WHERE id = ?",
                (ReminderStatus.FIRED.value, OCC_FIRED, utcnow_iso(), reminder_id),
            )
        else:
            next_due, anchor = next_local_occurrence(
                r["due_at"],
                r["repeat_rule"],
                r["repeat_time"],
                self.tz,
                after_utc_iso=fired_at,
                anchor_date=r.get("repeat_anchor_date"),
            )
            self.db.execute(
                "UPDATE reminders SET due_at = ?, occ_status = ?,"
                " repeat_anchor_date = COALESCE(repeat_anchor_date, ?),"
                " updated_at = ? WHERE id = ?",
                (next_due, OCC_ACTIVE, anchor, utcnow_iso(), reminder_id),
            )
        self.db.commit()

    def snooze(self, reminder_id: int, seconds: int, now: datetime) -> bool:
        """Snooze the CURRENT occurrence: due = now+seconds (UTC instant),
        occ_status snoozed, snoozed_until = due. Restores schedule liveness
        (status active) so the scheduler refires. Never touches recurrence."""
        new_due = now.astimezone(_UTC) + timedelta(seconds=seconds)
        new_due_iso = new_due.isoformat(timespec="seconds")
        cur = self.db.execute(
            "UPDATE reminders SET status = ?, occ_status = ?, due_at = ?,"
            " snoozed_until = ?, updated_at = ?"
            " WHERE id = ? AND occ_status IN (?, ?)",
            (
                ReminderStatus.ACTIVE.value,
                OCC_SNOOZED,
                new_due_iso,
                new_due_iso,
                utcnow_iso(),
                reminder_id,
                OCC_ACTIVE,
                OCC_FIRED,
            ),
        )
        # history: the most recent occurrence is the one being snoozed
        self.db.execute(
            "UPDATE reminder_occurrences SET status = ?"
            " WHERE reminder_id = ? AND id = (SELECT MAX(id) FROM reminder_occurrences WHERE reminder_id = ?)",
            (NotificationStatus.SNOOZED.value, reminder_id, reminder_id),
        )
        self.db.commit()
        return cur.rowcount > 0

    def dismiss(self, reminder_id: int) -> bool:
        """Dismiss the current occurrence. One-shot: schedule exhausted
        (status fired, occurrence dismissed). Recurring: record the dismissed
        occurrence and advance to the next LOCAL-clock occurrence.

        NOTE: reminder_occurrences.status predates the dismissed state (CHECK
        fired|snoozed|skipped), so history rows for dismissed occurrences
        stay 'fired' — the notification did display; the dismissal state is
        authoritative on reminders.occ_status (additive-only migration).
        """
        r = self.get(reminder_id)
        if not r or r["occ_status"] not in (OCC_ACTIVE, OCC_FIRED):
            return False
        if r["repeat_rule"] == "none":
            self.db.execute(
                "UPDATE reminders SET status = ?, occ_status = ?, updated_at = ? WHERE id = ?",
                (ReminderStatus.FIRED.value, OCC_DISMISSED, utcnow_iso(), reminder_id),
            )
        else:
            next_due, anchor = next_local_occurrence(
                r["due_at"],
                r["repeat_rule"],
                r["repeat_time"],
                self.tz,
                after_utc_iso=utcnow_iso(),
                anchor_date=r.get("repeat_anchor_date"),
            )
            self.db.execute(
                "UPDATE reminders SET occ_status = ?, due_at = ?,"
                " repeat_anchor_date = COALESCE(repeat_anchor_date, ?),"
                " updated_at = ? WHERE id = ?",
                (OCC_ACTIVE, next_due, anchor, utcnow_iso(), reminder_id),
            )
        self.db.commit()
        return True

    def occurrences(self, reminder_id: int) -> list[dict]:
        return self.db.rows(
            "SELECT * FROM reminder_occurrences WHERE reminder_id = ? ORDER BY id DESC",
            (reminder_id,),
        )
