"""Documents: registry + crash-recovery payloads. File bytes live on disk
(data/documents); the DB row is the registry and the recovery snapshot."""

import hashlib

from arsvox_memory.db import Database, utcnow_iso



class DocumentStore:
    def __init__(self, db: Database):
        self.db = db

    def create(self, title: str, path: str) -> int:
        cur = self.db.execute(
            "INSERT INTO documents (title, path) VALUES (?, ?)", (title, path)
        )
        self.db.commit()
        return cur.lastrowid

    def get(self, doc_id: int) -> dict | None:
        return self.db.row("SELECT * FROM documents WHERE id = ?", (doc_id,))

    def find_by_title(self, title: str) -> dict | None:
        return self.db.row(
            "SELECT * FROM documents WHERE title = ? ORDER BY id DESC LIMIT 1", (title,)
        )

    def list(self) -> list[dict]:
        return self.db.rows("SELECT * FROM documents ORDER BY updated_at DESC")

    def update_content(self, doc_id: int, content: str, saved: bool = True) -> None:
        """saved=True records a clean save; saved=False stores the recovery
        snapshot (crash recovery) without touching last_saved_at."""
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        if saved:
            self.db.execute(
                "UPDATE documents SET content_hash = ?, unsaved_json = NULL,"
                " updated_at = ?, last_saved_at = ? WHERE id = ?",
                (digest, utcnow_iso(), utcnow_iso(), doc_id),
            )
        else:
            self.db.execute(
                "UPDATE documents SET unsaved_json = ?, updated_at = ? WHERE id = ?",
                (content, utcnow_iso(), doc_id),
            )
        self.db.commit()
