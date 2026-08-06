"""Local audit log. Everything that matters gets a row here."""

import json

from arsvox_memory.db import Database


class AuditStore:
    def __init__(self, db: Database):
        self.db = db

    def log(self, category: str, action: str, detail: dict | None = None) -> int:
        cur = self.db.execute(
            "INSERT INTO audit_events (category, action, detail_json) VALUES (?, ?, ?)",
            (category, action, json.dumps(detail, ensure_ascii=False) if detail else None),
        )
        self.db.commit()
        return cur.lastrowid

    def recent(self, limit: int = 50) -> list[dict]:
        return self.db.rows(
            "SELECT id, ts, category, action, detail_json FROM audit_events"
            " ORDER BY id DESC LIMIT ?",
            (limit,),
        )
