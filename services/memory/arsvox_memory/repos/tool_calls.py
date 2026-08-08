"""Tool-call audit trail: one row per executed/rejected/pending tool call.

The table has existed since 0001_initial.sql but nothing wrote to it —
every "did the agent really call X?" question was unanswerable. This store
closes that gap: args and results are JSON, status tracks
running/done/error/rejected/pending.
"""

import json
from datetime import datetime, timezone

from arsvox_memory.db import Database


class ToolCallStore:
    def __init__(self, db: Database):
        self.db = db

    def record(
        self,
        session_id: str,
        run_id: str,
        tool: str,
        args: dict,
        status: str = "running",
    ) -> int:
        """Insert one tool-call row; returns its id."""
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        # Client-action contexts (no session yet) must not violate the FK —
        # empty session_id is stored as NULL.
        sid = session_id or None
        cur = self.db.execute(
            "INSERT INTO tool_calls (session_id, run_id, tool, args_json,"
            " status, started_at) VALUES (?, ?, ?, ?, ?, ?)",
            (sid, run_id, tool, json.dumps(args, ensure_ascii=False),
             status, now),
        )
        self.db.commit()
        return int(cur.lastrowid or 0)

    def finish(self, call_id: int, status: str, result: object | None = None) -> None:
        """Close a row with its outcome."""
        if call_id <= 0:
            return
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.db.execute(
            "UPDATE tool_calls SET result_json = ?, status = ?, finished_at = ?"
            " WHERE id = ?",
            (json.dumps(result, ensure_ascii=False) if result is not None else None,
             status, now, call_id),
        )
        self.db.commit()

    def for_run(self, run_id: str) -> list[dict]:
        return self.db.rows(
            "SELECT id, tool, status, args_json, result_json, started_at,"
            " finished_at FROM tool_calls WHERE run_id = ? ORDER BY id",
            (run_id,),
        )
