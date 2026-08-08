"""Stable panel identities. One instance per panel type in iteration 1;
content lives in the UI and survives layout changes because panels stay
mounted — this table is the service-side registry used for context."""


from arsvox_memory.db import Database, utcnow_iso



class PanelStore:
    def __init__(self, db: Database):
        self.db = db

    def upsert(
        self,
        panel_type: str,
        title: str | None = None,
        content_reference: str | None = None,
    ) -> None:
        self.db.execute(
            "INSERT INTO panel_instances (id, panel_type, title, content_reference,"
            " created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(id) DO UPDATE SET title = COALESCE(excluded.title, title),"
            " content_reference = COALESCE(excluded.content_reference, content_reference),"
            " last_used_at = excluded.last_used_at",
            (panel_type, panel_type, title, content_reference, utcnow_iso(), utcnow_iso()),
        )
        self.db.commit()

    def touch(self, panel_type: str) -> None:
        self.db.execute(
            "UPDATE panel_instances SET last_used_at = ? WHERE id = ?",
            (utcnow_iso(), panel_type),
        )
        self.db.commit()

    def remove(self, panel_type: str) -> None:
        self.db.execute("DELETE FROM panel_instances WHERE id = ?", (panel_type,))
        self.db.commit()

    def clear_all(self) -> None:
        """Start every launch with a fresh desk (central-mic default).

        Panels persist across connections (mid-session reconnect restores
        them via state_snapshot) but NOT across service restarts — the
        default screen is the mic hero, not the last session's panels.
        """
        self.db.execute("DELETE FROM panel_instances")
        self.db.commit()

    def list(self) -> list[dict]:
        return self.db.rows(
            "SELECT * FROM panel_instances ORDER BY last_used_at DESC"
        )
