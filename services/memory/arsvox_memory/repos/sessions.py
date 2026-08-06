"""Session and turn storage (Hermes-style pattern: SQLite + FTS5)."""

import uuid
from datetime import datetime, timezone

from arsvox_memory.db import Database


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class SessionStore:
    def __init__(self, db: Database):
        self.db = db

    def create(self, title: str | None = None) -> str:
        session_id = uuid.uuid4().hex[:16]
        self.db.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (session_id, title, _now(), _now()),
        )
        self.db.commit()
        return session_id

    def get(self, session_id: str) -> dict | None:
        return self.db.row("SELECT * FROM sessions WHERE id = ?", (session_id,))

    def append_turn(self, session_id: str, role: str, text: str, tokens: int | None = None) -> int:
        cur = self.db.execute(
            "INSERT INTO turns (session_id, role, text, tokens) VALUES (?, ?, ?, ?)",
            (session_id, role, text, tokens),
        )
        turn_id = cur.lastrowid
        self.db.execute(
            "INSERT INTO turns_fts (rowid, session_id, role, text) VALUES (?, ?, ?, ?)",
            (turn_id, session_id, role, text),
        )
        self.db.execute(
            "UPDATE sessions SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?",
            (_now(), session_id),
        )
        self.db.commit()
        return turn_id

    def recent_turns(self, session_id: str, limit: int = 10) -> list[dict]:
        return self.db.rows(
            "SELECT id, role, text, created_at FROM turns"
            " WHERE session_id = ? ORDER BY id DESC LIMIT ?",
            (session_id, limit),
        )[::-1]

    def set_summary(self, session_id: str, summary: str) -> None:
        self.db.execute(
            "UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?",
            (summary, _now(), session_id),
        )
        self.db.commit()

    def touch(self, session_id: str) -> None:
        self.db.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?", (_now(), session_id)
        )
        self.db.commit()

    def search(self, query: str, limit: int = 10) -> list[dict]:
        """FTS5 keyword search across turns, grouped by session."""
        try:
            rows = self.db.rows(
                "SELECT t.session_id, snippet(turns_fts, 2, '[', ']', '…', 12) AS snippet,"
                " t.role, t.text FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid"
                " WHERE turns_fts MATCH ? ORDER BY turns_fts.rank LIMIT ?",
                (query, limit),
            )
        except Exception:
            return []
        seen: dict[str, dict] = {}
        for r in rows:
            sid = r["session_id"]
            if sid not in seen:
                session = self.db.row("SELECT id, title, updated_at FROM sessions WHERE id = ?", (sid,))
                seen[sid] = {"session": session, "hits": []}
            seen[sid]["hits"].append({"role": r["role"], "text": r["text"][:300]})
        return list(seen.values())
