"""Notification events (reminder firings, alarms, info). The UI renders
these; the scheduler and local intents resolve them."""

from arsvox_contracts import NotificationStatus
from arsvox_memory.db import Database, utcnow_iso



class NotificationStore:
    def __init__(self, db: Database):
        self.db = db

    def insert(
        self,
        kind: str,
        title: str,
        text: str,
        reminder_id: int | None = None,
    ) -> int:
        cur = self.db.execute(
            "INSERT INTO notification_events (kind, title, text, reminder_id)"
            " VALUES (?, ?, ?, ?)",
            (kind, title, text, reminder_id),
        )
        self.db.commit()
        return cur.lastrowid

    def get(self, notification_id: int) -> dict | None:
        return self.db.row(
            "SELECT * FROM notification_events WHERE id = ?", (notification_id,)
        )

    def latest_active(self) -> dict | None:
        return self.db.row(
            "SELECT * FROM notification_events WHERE status = ?"
            " ORDER BY id DESC LIMIT 1",
            (NotificationStatus.ACTIVE.value,),
        )

    def resolve(self, notification_id: int, status: str) -> bool:
        cur = self.db.execute(
            "UPDATE notification_events SET status = ?, resolved_at = ?"
            " WHERE id = ? AND status = ?",
            (status, utcnow_iso(), notification_id, NotificationStatus.ACTIVE.value),
        )
        self.db.commit()
        return cur.rowcount > 0

    def list_active(self) -> list[dict]:
        return self.db.rows(
            "SELECT * FROM notification_events WHERE status = ? ORDER BY id DESC",
            (NotificationStatus.ACTIVE.value,),
        )
