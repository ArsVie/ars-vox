"""Look at, rename or delete whole sessions in the log.

Deleting is the normal move for a conversation that was only ever a test: the model
copies the register of what it reads, so a session full of the wrong Spanish is not
worth keeping around. Run it with the python that runs the service.

    .venv-win\\Scripts\\python.exe tools\\sessions.py list
    .venv-win\\Scripts\\python.exe tools\\sessions.py drop cli
    .venv-win\\Scripts\\python.exe tools\\sessions.py rename cli vieja
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = REPO_ROOT / "data" / "arsvox.db"
TABLES = (("events", "session"), ("preferences", "session"))


def connect(db: Path) -> sqlite3.Connection:
    return sqlite3.connect(db)


def list_sessions(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        "SELECT session, COUNT(*), MIN(ts), MAX(ts) FROM events GROUP BY session ORDER BY MAX(ts) DESC"
    ).fetchall()
    if not rows:
        print("no hay sesiones")
    for name, count, first, last in rows:
        print(f"{name:20s} {count:5d} eventos   {first} .. {last}")


def drop(connection: sqlite3.Connection, name: str) -> None:
    removed = 0
    for table, column in TABLES:
        removed += connection.execute(f"DELETE FROM {table} WHERE {column}=?", (name,)).rowcount
    connection.commit()
    print(f"'{name}' borrada: {removed} filas")


def rename(connection: sqlite3.Connection, old: str, new: str) -> None:
    moved = 0
    for table, column in TABLES:
        moved += connection.execute(
            f"UPDATE {table} SET {column}=? WHERE {column}=?", (new, old)
        ).rowcount
    connection.commit()
    print(f"'{old}' -> '{new}': {moved} filas")


def main(argv: list[str]) -> int:
    db = Path(argv[-1]) if argv[-1].endswith(".db") else DEFAULT_DB
    args = [a for a in argv[1:] if not a.endswith(".db")]
    connection = connect(db)
    try:
        if not args or args[0] == "list":
            list_sessions(connection)
        elif args[0] == "drop" and len(args) == 2:
            drop(connection, args[1])
        elif args[0] == "rename" and len(args) == 3:
            rename(connection, args[1], args[2])
        else:
            print(__doc__)
            return 2
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
