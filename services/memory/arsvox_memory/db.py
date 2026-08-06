"""SQLite connection, migration runner, and low-level helpers."""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    """Owns the SQLite connection and applies ordered migrations.

    Migrations live in arsvox_memory/migrations/ as ``NNNN_name.sql``
    files that begin with BEGIN and end with COMMIT.
    """

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.migrations_dir = Path(__file__).resolve().parent / "migrations"
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA busy_timeout=5000")
        self._migrate()

    # ------------------------------------------------------------------ #
    def _migrate(self) -> None:
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_version ("
            " version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        current = self.conn.execute(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version"
        ).fetchone()[0]
        for path in sorted(self.migrations_dir.glob("*.sql")):
            version = int(path.stem.split("_", 1)[0])
            if version <= current:
                continue
            sql = path.read_text(encoding="utf-8")
            self.conn.executescript(sql)
            self.conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                (version, utcnow_iso()),
            )
            self.conn.commit()

    # ------------------------------------------------------------------ #
    def close(self) -> None:
        self.conn.close()

    def rows(self, sql: str, params: tuple = ()) -> list[dict]:
        cur = self.conn.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]

    def row(self, sql: str, params: tuple = ()) -> dict | None:
        cur = self.conn.execute(sql, params)
        r = cur.fetchone()
        return dict(r) if r else None

    def scalar(self, sql: str, params: tuple = ()):
        cur = self.conn.execute(sql, params)
        row = cur.fetchone()
        return row[0] if row else None

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        return self.conn.execute(sql, params)

    def executemany(self, sql: str, seq: list[tuple]) -> None:
        self.conn.executemany(sql, seq)

    def commit(self) -> None:
        self.conn.commit()
