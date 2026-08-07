"""Notes with FTS5 search. Agent may suggest tags but never edits content."""

import json

from arsvox_memory.db import Database



class NoteStore:
    def __init__(self, db: Database):
        self.db = db

    def add(self, text: str, tags: list[str] | None = None, source: str = "user") -> int:
        cur = self.db.execute(
            "INSERT INTO notes (text, tags_json, source) VALUES (?, ?, ?)",
            (text, json.dumps(tags or [], ensure_ascii=False), source),
        )
        note_id = cur.lastrowid
        self.db.execute(
            "INSERT INTO notes_fts (rowid, text) VALUES (?, ?)", (note_id, text)
        )
        self.db.commit()
        return note_id

    def get(self, note_id: int) -> dict | None:
        return self.db.row("SELECT * FROM notes WHERE id = ?", (note_id,))

    def search(self, query: str, limit: int = 20) -> list[dict]:
        try:
            rows = self.db.rows(
                "SELECT notes.id, notes.text, notes.tags_json, notes.source, notes.created_at"
                " FROM notes JOIN notes_fts ON notes_fts.rowid = notes.id"
                " WHERE notes_fts MATCH ? ORDER BY notes_fts.rank LIMIT ?",
                (query, limit),
            )
        except Exception:
            return []
        return [dict(r, tags=json.loads(r["tags_json"] or "[]")) for r in rows]

    def list_recent(self, limit: int = 50) -> list[dict]:
        rows = self.db.rows(
            "SELECT id, text, tags_json, source, created_at FROM notes"
            " ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        return [dict(r, tags=json.loads(r["tags_json"] or "[]")) for r in rows]

    def today(self) -> list[dict]:
        rows = self.db.rows(
            "SELECT id, text, tags_json, source, created_at FROM notes"
            " WHERE date(created_at) = date('now', 'localtime') ORDER BY id DESC"
        )
        return [dict(r, tags=json.loads(r["tags_json"] or "[]")) for r in rows]

    def delete(self, note_id: int) -> bool:
        cur = self.db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        if cur.rowcount == 0:
            return False
        self.db.execute("DELETE FROM notes_fts WHERE rowid = ?", (note_id,))
        self.db.commit()
        return True
