"""The event log and everything derived from it.

One append-only table of events is the truth. Model messages are a projection of
that log through a single rule, so history can never drift from what happened,
and a restart rebuilds the conversation by replaying it.

    events      every turn, tool call and snapshot, in order
    reminders   state written by tools
    tasks       state written by tools
    preferences what the assistant remembers about the user
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    session TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_session ON events(session, id);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session TEXT NOT NULL,
    text TEXT NOT NULL,
    when_local TEXT,
    created_ts TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    repeat TEXT NOT NULL DEFAULT 'once',
    fired_ts TEXT,
    last_fired_ts TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session TEXT NOT NULL,
    text TEXT NOT NULL,
    created_ts TEXT NOT NULL,
    done_ts TEXT
);

CREATE TABLE IF NOT EXISTS preferences (
    session TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_ts TEXT NOT NULL,
    PRIMARY KEY (session, key)
);
"""


def now_local() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


# Columns added after the first release. A reminder the user set last week must
# still fire after this upgrade, so the table is migrated, never recreated.
MIGRATIONS: dict[str, dict[str, str]] = {
    "reminders": {
        "repeat": "TEXT NOT NULL DEFAULT 'once'",
        "last_fired_ts": "TEXT",
    },
}


@dataclass(slots=True)
class Event:
    id: int
    ts: str
    session: str
    kind: str
    payload: dict


def project(event: Event) -> dict | None:
    """THE projection rule: one event, one model message. Nothing else decides history."""
    kind = event.kind
    if kind == "user_text":
        return {"role": "user", "content": event.payload["text"]}
    if kind == "assistant_text":
        return {"role": "assistant", "content": event.payload["text"]}
    if kind == "tool_call":
        return {
            "role": "assistant",
            "content": event.payload.get("text") or None,
            "tool_calls": [
                {
                    "id": event.payload["call_id"],
                    "type": "function",
                    "function": {
                        "name": event.payload["name"],
                        "arguments": json.dumps(event.payload["arguments"], ensure_ascii=False),
                    },
                }
            ],
        }
    if kind == "tool_result":
        return {
            "role": "tool",
            "tool_call_id": event.payload["call_id"],
            "content": event.payload["text"],
        }
    if kind == "runtime_snapshot":
        return {"role": "user", "content": event.payload["text"]}
    return None


class Store:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self._migrate()
        self.conn.commit()

    def _migrate(self) -> None:
        for table, columns in MIGRATIONS.items():
            existing = {row["name"] for row in self.conn.execute(f"PRAGMA table_info({table})")}
            for name, declaration in columns.items():
                if name not in existing:
                    self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")

    # ---- the log ---------------------------------------------------------
    def append(self, session: str, kind: str, payload: dict) -> int:
        cursor = self.conn.execute(
            "INSERT INTO events (ts, session, kind, payload) VALUES (?, ?, ?, ?)",
            (now_local(), session, kind, json.dumps(payload, ensure_ascii=False)),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def events(self, session: str, limit: int | None = None) -> list[Event]:
        rows = self.conn.execute(
            "SELECT id, ts, session, kind, payload FROM events WHERE session = ? ORDER BY id",
            (session,),
        ).fetchall()
        events = [
            Event(r["id"], r["ts"], r["session"], r["kind"], json.loads(r["payload"])) for r in rows
        ]
        return events[-limit:] if limit else events

    def messages(self, session: str, limit: int = 60) -> list[dict]:
        projected = [project(e) for e in self.events(session)]
        return [m for m in projected if m is not None][-limit:]

    def last_snapshot(self, session: str) -> str | None:
        for event in reversed(self.events(session)):
            if event.kind == "runtime_snapshot":
                return event.payload["text"]
        return None

    def sessions(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT session, COUNT(*) AS events, MAX(ts) AS last_ts FROM events "
            "GROUP BY session ORDER BY last_ts DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    # ---- state written by tools -----------------------------------------
    def add_reminder(
        self, session: str, text: str, when_local: str | None, repeat: str = "once"
    ) -> int:
        cursor = self.conn.execute(
            "INSERT INTO reminders (session, text, when_local, repeat, created_ts) VALUES (?, ?, ?, ?, ?)",
            (session, text, when_local, repeat if when_local else "once", now_local()),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def get_reminder(self, session: str, reminder_id: int) -> dict | None:
        row = self.conn.execute(
            "SELECT id, text, when_local, repeat, active, fired_ts, last_fired_ts "
            "FROM reminders WHERE session = ? AND id = ?",
            (session, reminder_id),
        ).fetchone()
        return dict(row) if row else None

    def list_reminders(self, session: str, active_only: bool = True) -> list[dict]:
        query = (
            "SELECT id, text, when_local, repeat, active, fired_ts, last_fired_ts "
            "FROM reminders WHERE session = ?"
        )
        if active_only:
            query += " AND active = 1"
        query += " ORDER BY COALESCE(when_local, '9999')"
        return [dict(r) for r in self.conn.execute(query, (session,)).fetchall()]

    def mark_fired(self, session: str, reminder_id: int) -> bool:
        """One-shot reminders stop after firing; repeats keep their slot."""
        row = self.get_reminder(session, reminder_id)
        if row is None:
            return False
        if row["repeat"] == "once":
            cursor = self.conn.execute(
                "UPDATE reminders SET active = 0, fired_ts = ?, last_fired_ts = ? "
                "WHERE session = ? AND id = ?",
                (now_local(), now_local(), session, reminder_id),
            )
        else:
            cursor = self.conn.execute(
                "UPDATE reminders SET last_fired_ts = ? WHERE session = ? AND id = ?",
                (now_local(), session, reminder_id),
            )
        self.conn.commit()
        return cursor.rowcount > 0

    def cancel_reminder(self, session: str, reminder_id: int) -> bool:
        cursor = self.conn.execute(
            "UPDATE reminders SET active = 0 WHERE session = ? AND id = ? AND active = 1",
            (session, reminder_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def add_task(self, session: str, text: str) -> int:
        cursor = self.conn.execute(
            "INSERT INTO tasks (session, text, created_ts) VALUES (?, ?, ?)",
            (session, text, now_local()),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def list_tasks(self, session: str) -> list[dict]:
        return [
            dict(r)
            for r in self.conn.execute(
                "SELECT id, text, done_ts FROM tasks WHERE session = ? ORDER BY done_ts IS NOT NULL, id",
                (session,),
            ).fetchall()
        ]

    def complete_task(self, session: str, task_id: int) -> bool:
        cursor = self.conn.execute(
            "UPDATE tasks SET done_ts = ? WHERE session = ? AND id = ? AND done_ts IS NULL",
            (now_local(), session, task_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def set_preference(self, session: str, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT INTO preferences (session, key, value, updated_ts) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(session, key) DO UPDATE SET value = excluded.value, "
            "updated_ts = excluded.updated_ts",
            (session, key, value, now_local()),
        )
        self.conn.commit()

    def preferences(self, session: str) -> dict[str, str]:
        return {
            r["key"]: r["value"]
            for r in self.conn.execute(
                "SELECT key, value FROM preferences WHERE session = ? ORDER BY key", (session,)
            ).fetchall()
        }

    def state_counts(self, session: str) -> dict[str, int]:
        return {
            "reminders": len(self.list_reminders(session)),
            "tasks_open": sum(1 for t in self.list_tasks(session) if not t["done_ts"]),
            "preferences": len(self.preferences(session)),
            "events": len(self.events(session)),
        }

    def close(self) -> None:
        self.conn.close()


def counts_by_kind(events: Iterable[Event]) -> dict[str, int]:
    result: dict[str, int] = {}
    for event in events:
        result[event.kind] = result.get(event.kind, 0) + 1
    return result


def as_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)
