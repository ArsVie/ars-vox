"""Unified FTS5 search across the memory domains."""

from arsvox_memory.db import Database


def search_all(db: Database, query: str, limit: int = 10) -> dict:
    """Search notes and session turns. Returns per-domain hit lists."""
    notes = db.rows(
        "SELECT notes.id, notes.text, notes.created_at FROM notes"
        " JOIN notes_fts ON notes_fts.rowid = notes.id"
        " WHERE notes_fts MATCH ? ORDER BY notes_fts.rank LIMIT ?",
        (query, limit),
    )
    turns = db.rows(
        "SELECT t.session_id, t.role, t.text FROM turns_fts"
        " JOIN turns t ON t.id = turns_fts.rowid"
        " WHERE turns_fts MATCH ? ORDER BY turns_fts.rank LIMIT ?",
        (query, limit),
    )
    return {"notes": [dict(r) for r in notes], "turns": [dict(r) for r in turns]}
