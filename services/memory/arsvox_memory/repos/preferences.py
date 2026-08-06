"""Key-value preferences."""

import json
from datetime import datetime, timezone

from arsvox_memory.db import Database


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class PreferenceStore:
    def __init__(self, db: Database):
        self.db = db

    def get(self, key: str, default=None):
        row = self.db.row("SELECT value_json FROM preferences WHERE key = ?", (key,))
        if not row:
            return default
        try:
            return json.loads(row["value_json"])
        except json.JSONDecodeError:
            return row["value_json"]

    def set(self, key: str, value) -> None:
        self.db.execute(
            "INSERT INTO preferences (key, value_json, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,"
            " updated_at = excluded.updated_at",
            (key, json.dumps(value, ensure_ascii=False), _now()),
        )
        self.db.commit()
