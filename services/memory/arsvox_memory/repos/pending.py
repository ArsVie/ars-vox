"""Pending human-approval actions (the two-phase confirmation flow).

A pending action snapshots the exact tool + args. Approval executes the
snapshot — the model never re-supplies args for an approved action, so
the user always confirms exactly what they saw.
"""

import json
import uuid

from arsvox_contracts import ConfirmationStatus
from arsvox_memory.db import Database, utcnow_iso

STATUSES = tuple(s.value for s in ConfirmationStatus)



class PendingStore:
    def __init__(self, db: Database):
        self.db = db

    def create(
        self,
        run_id: str,
        tool: str,
        args: dict,
        title: str,
        detail: str,
        expires_at: str,
    ) -> str:
        pending_id = uuid.uuid4().hex[:12]
        self.db.execute(
            "INSERT INTO pending_actions (id, run_id, tool, args_json, title, detail,"
            " created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                pending_id,
                run_id,
                tool,
                json.dumps(args, ensure_ascii=False),
                title,
                detail,
                utcnow_iso(),
                expires_at,
            ),
        )
        self.db.commit()
        return pending_id

    def get(self, pending_id: str) -> dict | None:
        row = self.db.row("SELECT * FROM pending_actions WHERE id = ?", (pending_id,))
        if not row:
            return None
        row["args"] = json.loads(row["args_json"])
        return row

    def resolve(self, pending_id: str, status: str, resolved_at: str | None = None) -> bool:
        if status not in STATUSES:
            raise ValueError(f"bad status {status}")
        cur = self.db.execute(
            "UPDATE pending_actions SET status = ?, resolved_at = ?"
            " WHERE id = ? AND status = ?",
            (status, resolved_at or utcnow_iso(), pending_id, ConfirmationStatus.PENDING.value),
        )
        self.db.commit()
        return cur.rowcount > 0

    def expire_stale(self, now: str) -> list[str]:
        rows = self.db.rows(
            "SELECT id FROM pending_actions WHERE status = ? AND expires_at <= ?",
            (ConfirmationStatus.PENDING.value, now),
        )
        ids = [r["id"] for r in rows]
        if ids:
            self.db.executemany(
                "UPDATE pending_actions SET status = ?, resolved_at = ?"
                " WHERE id = ? AND status = ?",
                [
                    (
                        ConfirmationStatus.EXPIRED.value,
                        utcnow_iso(),
                        i,
                        ConfirmationStatus.PENDING.value,
                    )
                    for i in ids
                ],
            )
            self.db.commit()
        return ids

    def supersede_tool(self, tool: str) -> int:
        cur = self.db.execute(
            "UPDATE pending_actions SET status = ?, resolved_at = ?"
            " WHERE tool = ? AND status = ?",
            (
                ConfirmationStatus.SUPERSEDED.value,
                utcnow_iso(),
                tool,
                ConfirmationStatus.PENDING.value,
            ),
        )
        self.db.commit()
        return cur.rowcount

    def list_pending(self) -> list[dict]:
        rows = self.db.rows(
            "SELECT * FROM pending_actions WHERE status = ? ORDER BY created_at",
            (ConfirmationStatus.PENDING.value,),
        )
        return [dict(r, args=json.loads(r["args_json"])) for r in rows]
