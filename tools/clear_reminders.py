"""Cancel every reminder a test left behind, and its Windows task with it.

A test that sets a reminder for eight in the evening leaves a real alarm that will
talk to an empty room. This is the undo. Run it with the python that runs the service:

    .venv-win\\Scripts\\python.exe tools\\clear_reminders.py [sesión]
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.config import load_settings  # noqa: E402
from services.arsvox.scheduler import TaskScheduler  # noqa: E402
from services.arsvox.store import Store  # noqa: E402


def main(argv: list[str]) -> int:
    session = argv[1] if len(argv) > 1 else "cli"
    settings = load_settings(session=session)
    store = Store(settings.db_path)
    scheduler = TaskScheduler(REPO_ROOT)
    try:
        for reminder in store.list_reminders(session):
            store.cancel_reminder(session, reminder["id"])
            task_gone = scheduler.unregister(reminder["id"])
            print(
                f"cancelado {reminder['id']}: {reminder['text']} "
                f"({reminder['when_local'] or 'sin hora'}) tarea borrada: {task_gone}"
            )
        print("activos ahora:", len(store.list_reminders(session)))
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
