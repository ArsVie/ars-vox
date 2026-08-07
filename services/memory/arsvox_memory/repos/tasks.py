"""Simple task list."""

from arsvox_contracts import TaskStatus
from arsvox_memory.db import Database, utcnow_iso



class TaskStore:
    def __init__(self, db: Database):
        self.db = db

    def add(
        self,
        title: str,
        due_at: str | None = None,
        priority: str = "normal",
        repeat_rule: str | None = None,
    ) -> int:
        cur = self.db.execute(
            "INSERT INTO tasks (title, due_at, priority, repeat_rule) VALUES (?, ?, ?, ?)",
            (title, due_at, priority, repeat_rule),
        )
        self.db.commit()
        return cur.lastrowid

    def list(self, status: str | None = None) -> list[dict]:
        if status:
            return self.db.rows(
                "SELECT * FROM tasks WHERE status = ? ORDER BY id DESC", (status,)
            )
        return self.db.rows("SELECT * FROM tasks ORDER BY id DESC")

    def get(self, task_id: int) -> dict | None:
        return self.db.row("SELECT * FROM tasks WHERE id = ?", (task_id,))

    def complete(self, task_id: int) -> bool:
        cur = self.db.execute(
            "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
            (TaskStatus.DONE.value, utcnow_iso(), task_id, TaskStatus.PENDING.value),
        )
        self.db.commit()
        return cur.rowcount > 0

    def reopen(self, task_id: int) -> bool:
        cur = self.db.execute(
            "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?",
            (TaskStatus.PENDING.value, utcnow_iso(), task_id),
        )
        self.db.commit()
        return cur.rowcount > 0

    def reschedule(self, task_id: int, due_at: str | None) -> bool:
        cur = self.db.execute(
            "UPDATE tasks SET due_at = ?, updated_at = ? WHERE id = ?",
            (due_at, utcnow_iso(), task_id),
        )
        self.db.commit()
        return cur.rowcount > 0
