"""Register one real reminder in Windows Task Scheduler, a few minutes out.

Uses the product's own scheduler code. The only difference: the action carries
--silent, so the verification does not speak out loud unasked.
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path("/mnt/c/dev/ars-vox-v2")
sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.scheduler import TaskScheduler  # noqa: E402
from services.arsvox.store import Store  # noqa: E402


class SilentTaskScheduler(TaskScheduler):
    def action(self, reminder_id: int, session: str) -> tuple[str, list[str]]:
        command, arguments = super().action(reminder_id, session)
        return command, arguments + ["--silent"]


def main() -> int:
    minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
    target = (datetime.now().astimezone() + timedelta(minutes=minutes)).replace(second=0, microsecond=0)
    store = Store(REPO_ROOT / "data" / "arsvox.db")
    reminder_id = store.add_reminder(
        "cli", "prueba de recordatorio programado", target.isoformat(timespec="minutes"), "once"
    )
    engine = SilentTaskScheduler(REPO_ROOT)
    name = engine.register(store.get_reminder("cli", reminder_id), "cli")
    print(f"now      {datetime.now().astimezone().isoformat(timespec='seconds')}")
    print(f"reminder {reminder_id} at {target.isoformat(timespec='minutes')}")
    print(f"task     {name}")
    info = engine.query(reminder_id)
    print(f"query    next_run={info.next_run!r} state={info.state!r}" if info else "query    MISSING")
    print(f"action   {info.command if info else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
