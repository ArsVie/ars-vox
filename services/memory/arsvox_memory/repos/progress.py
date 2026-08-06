"""Content progress (book positions, video positions, ...)."""

import json
from datetime import datetime, timezone

from arsvox_memory.db import Database


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ProgressStore:
    def __init__(self, db: Database):
        self.db = db

    def get(self, kind: str, ref_id: str) -> dict | None:
        row = self.db.row(
            "SELECT position_json FROM content_progress WHERE kind = ? AND ref_id = ?",
            (kind, ref_id),
        )
        if not row:
            return None
        try:
            return json.loads(row["position_json"])
        except json.JSONDecodeError:
            return None

    def set(self, kind: str, ref_id: str, position: dict) -> None:
        self.db.execute(
            "INSERT INTO content_progress (kind, ref_id, position_json, updated_at)"
            " VALUES (?, ?, ?, ?)"
            " ON CONFLICT(kind, ref_id) DO UPDATE SET position_json = excluded.position_json,"
            " updated_at = excluded.updated_at",
            (kind, ref_id, json.dumps(position, ensure_ascii=False), _now()),
        )
        self.db.commit()

    def latest(self, kind: str) -> dict | None:
        return self.db.row(
            "SELECT ref_id, position_json FROM content_progress WHERE kind = ?"
            " ORDER BY updated_at DESC LIMIT 1",
            (kind,),
        )
