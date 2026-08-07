"""Reminders and their occurrences. Scheduling decisions live in the agent
service scheduler; this store is only authoritative persistence."""

from datetime import datetime, timedelta

from arsvox_contracts import NotificationStatus, ReminderStatus
from arsvox_memory.db import Database, utcnow_iso



class ReminderStore:
    def __init__(self, db: Database):
        self.db = db

    def create(self, text: str, due_at: str, repeat_rule: str = "none") -> int:
        cur = self.db.execute(
            "INSERT INTO reminders (text, due_at, repeat_rule) VALUES (?, ?, ?)",
            (text, due_at, repeat_rule),
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
        return self.db.rows(
            "SELECT * FROM reminders WHERE status = ? AND due_at <= ? ORDER BY due_at",
            (ReminderStatus.ACTIVE.value, now_iso),
        )

    def cancel(self, reminder_id: int) -> bool:
        cur = self.db.execute(
            "UPDATE reminders SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
            (ReminderStatus.CANCELLED.value, utcnow_iso(), reminder_id, ReminderStatus.ACTIVE.value),
        )
        self.db.commit()
        return cur.rowcount > 0

    def mark_fired(self, reminder_id: int, fired_at: str) -> None:
        """Record the occurrence; advance recurring reminders, close one-shots."""
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
                "UPDATE reminders SET status = ?, updated_at = ? WHERE id = ?",
                (ReminderStatus.FIRED.value, utcnow_iso(), reminder_id),
            )
        else:
            next_due = self._next_due(r["due_at"], r["repeat_rule"])
            self.db.execute(
                "UPDATE reminders SET due_at = ?, updated_at = ? WHERE id = ?",
                (next_due, utcnow_iso(), reminder_id),
            )
        self.db.commit()

    def snooze(self, reminder_id: int, seconds: int, now: datetime) -> None:
        """Push the next firing out by ``seconds`` and mark the last
        occurrence as snoozed (only meaningful while ACTIVE)."""
        due = self.db.row("SELECT due_at FROM reminders WHERE id = ?", (reminder_id,))
        if not due:
            return
        try:
            current = datetime.fromisoformat(due["due_at"])
        except ValueError:
            current = now
        new_due = current + timedelta(seconds=seconds)
        self.db.execute(
            "UPDATE reminders SET due_at = ?, updated_at = ? WHERE id = ?",
            (new_due.isoformat(timespec="seconds"), utcnow_iso(), reminder_id),
        )
        # mark the most recent fired occurrence as snoozed
        self.db.execute(
            "UPDATE reminder_occurrences SET status = ?"
            " WHERE reminder_id = ? AND id = (SELECT MAX(id) FROM reminder_occurrences WHERE reminder_id = ?)",
            (NotificationStatus.SNOOZED.value, reminder_id, reminder_id),
        )
        self.db.commit()

    def occurrences(self, reminder_id: int) -> list[dict]:
        return self.db.rows(
            "SELECT * FROM reminder_occurrences WHERE reminder_id = ? ORDER BY id DESC",
            (reminder_id,),
        )

    @staticmethod
    def _next_due(current_iso: str, rule: str) -> str:
        current = datetime.fromisoformat(current_iso)
        if rule == "daily":
            next_due = current + timedelta(days=1)
        elif rule == "weekly":
            next_due = current + timedelta(weeks=1)
        else:
            next_due = current
        return next_due.isoformat(timespec="seconds")
