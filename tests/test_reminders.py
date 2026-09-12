"""Reminders: the schedule Windows owns, the migration, and the fire path."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.config import Settings  # noqa: E402
from services.arsvox.model import FakeModel, ModelReply, ToolCall  # noqa: E402
from services.arsvox.runtime import Runtime  # noqa: E402
from services.arsvox.scheduler import TaskScheduler, task_name  # noqa: E402
from services.arsvox.store import Store  # noqa: E402


class FakeRunner:
    def __init__(self, code: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.code, self.stdout, self.stderr = code, stdout, stderr
        self.calls: list[list[str]] = []

    def __call__(self, cmd: list[str]) -> subprocess.CompletedProcess:
        self.calls.append(cmd)
        return subprocess.CompletedProcess(cmd, self.code, self.stdout, self.stderr)


class RecordingScheduler:
    def __init__(self) -> None:
        self.registered: list[tuple[dict, str]] = []
        self.removed: list[int] = []

    def register(self, reminder: dict, session: str) -> str:
        self.registered.append((reminder, session))
        return task_name(int(reminder["id"]))

    def unregister(self, reminder_id: int) -> bool:
        self.removed.append(reminder_id)
        return True


def scheduler(tmp_path: Path, runner=None) -> TaskScheduler:
    return TaskScheduler(
        repo_root=tmp_path,
        python_exe=tmp_path / "pythonw.exe",
        runner=runner or FakeRunner(),
    )


def test_task_xml_for_a_one_shot():
    from services.arsvox.scheduler import build_task_xml

    built = build_task_xml(
        when_local="2026-09-12T20:00-06:00",
        repeat="once",
        command="C:\\py\\pythonw.exe",
        arguments=["C:\\repo\\apps\\cli\\arsvox_cli.py", "fire", "3", "--session", "cli"],
        working_dir="C:\\repo",
        description="recordatorio",
    )
    assert "<TimeTrigger>" in built
    assert "<StartBoundary>2026-09-12T20:00:00-06:00</StartBoundary>" in built
    assert "<StartWhenAvailable>true</StartWhenAvailable>" in built
    assert "<WakeToRun>true</WakeToRun>" in built
    assert "&quot;C:\\repo\\apps\\cli\\arsvox_cli.py&quot; fire 3 --session cli" in built


def test_daily_and_weekly_use_calendar_triggers():
    from services.arsvox.scheduler import build_task_xml

    daily = build_task_xml(
        when_local="2026-09-12T20:00-06:00", repeat="daily", command="c", arguments=["a"],
        working_dir="w", description="d",
    )
    assert "<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>" in daily
    weekly = build_task_xml(
        when_local="2026-09-14T20:00-06:00", repeat="weekly", command="c", arguments=["a"],
        working_dir="w", description="d",
    )
    assert "<Monday />" in weekly  # 2026-09-14 is a Monday


def test_register_calls_schtasks_with_the_reminder_command(tmp_path: Path):
    runner = FakeRunner()
    engine = scheduler(tmp_path, runner)
    engine.register(
        {"id": 3, "text": "tomar la pastilla", "when_local": "2026-09-12T20:00", "repeat": "once"},
        "cli",
    )
    cmd = runner.calls[0]
    assert cmd[0].endswith("schtasks.exe") or cmd[0] == "schtasks"
    assert "/Create" in cmd and task_name(3) in cmd and "/F" in cmd
    xml_file = Path(cmd[cmd.index("/XML") + 1].replace("\\", "/").replace("C:", "/mnt/c", 1))
    assert xml_file.is_file()
    assert "recordatorio" in xml_file.read_text(encoding="utf-16")
    assert "pythonw.exe" in xml_file.read_text(encoding="utf-16")


def test_register_without_a_time_creates_nothing(tmp_path: Path):
    runner = FakeRunner()
    assert scheduler(tmp_path, runner).register({"id": 4, "text": "x", "when_local": None}, "cli") == ""
    assert runner.calls == []


def test_register_failure_is_loud(tmp_path: Path):
    engine = scheduler(tmp_path, FakeRunner(code=1, stderr="Access is denied."))
    with pytest.raises(RuntimeError, match="Access is denied"):
        engine.register({"id": 5, "text": "x", "when_local": "2026-09-12T20:00"}, "cli")


def test_unregister_deletes_the_task(tmp_path: Path):
    runner = FakeRunner()
    assert scheduler(tmp_path, runner).unregister(7) is True
    assert runner.calls[0][1] == "/Delete" and task_name(7) in runner.calls[0]


def test_query_reads_the_next_run_time(tmp_path: Path):
    stdout = "TaskName: \\ArsVox\\reminder-9\nNext Run Time: 9/12/2026 8:00:00 PM\nStatus: Ready\n"
    engine = scheduler(tmp_path, FakeRunner(stdout=stdout))
    info = engine.query(9)
    assert info.next_run == "9/12/2026 8:00:00 PM"
    assert info.state == "Ready"


def test_sync_registers_only_timed_reminders(tmp_path: Path):
    runner = FakeRunner()
    engine = scheduler(tmp_path, runner)
    out = engine.sync(
        [
            {"id": 1, "text": "con hora", "when_local": "2026-09-12T20:00"},
            {"id": 2, "text": "sin hora", "when_local": None},
        ],
        "cli",
    )
    assert out["wanted"] == [1] and out["skipped"] == [2]
    assert len(runner.calls) == 1


# ---- store ---------------------------------------------------------------

def test_one_shot_stops_after_firing_and_a_repeat_does_not(tmp_path: Path):
    store = Store(tmp_path / "a.db")
    once = store.add_reminder("cli", "pastilla", "2026-09-12T20:00", "once")
    daily = store.add_reminder("cli", "caminar", "2026-09-12T09:00", "daily")
    assert store.mark_fired("cli", once) is True
    assert store.mark_fired("cli", daily) is True
    assert store.get_reminder("cli", once)["active"] == 0
    assert store.get_reminder("cli", once)["fired_ts"]
    assert store.get_reminder("cli", daily)["active"] == 1
    assert store.get_reminder("cli", daily)["last_fired_ts"]
    assert [r["id"] for r in store.list_reminders("cli")] == [daily]


def test_a_reminder_saved_before_the_upgrade_still_loads(tmp_path: Path):
    """The old table had no repeat column. Opening it must add the column, not fail."""
    import sqlite3

    path = tmp_path / "old.db"
    conn = sqlite3.connect(str(path))
    conn.executescript(
        """
        CREATE TABLE reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, text TEXT NOT NULL,
            when_local TEXT, created_ts TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
            fired_ts TEXT
        );
        INSERT INTO reminders (session, text, when_local, created_ts) VALUES ('cli','viejo','2026-09-20T08:00','2026-09-01T10:00:00');
        """
    )
    conn.commit()
    conn.close()

    store = Store(path)
    rows = store.list_reminders("cli")
    assert rows[0]["text"] == "viejo"
    assert rows[0]["repeat"] == "once"
    assert store.add_reminder("cli", "nuevo", "2026-09-21T08:00", "weekly") > 0


# ---- the loop ------------------------------------------------------------

def test_the_loop_registers_and_cancels_the_windows_task(tmp_path: Path):
    settings = Settings(base_url="http://x", model="fake", api_key="k", db_path=tmp_path / "b.db")
    store = Store(settings.db_path)
    fake_scheduler = RecordingScheduler()
    model = FakeModel(
        [
            ModelReply(
                text="",
                tool_calls=[
                    ToolCall(
                        id="c1",
                        name="reminders_set",
                        arguments={"text": "pastilla", "when_local": "2026-09-12T20:00"},
                    )
                ],
            ),
            ModelReply(text="Listo."),
            ModelReply(
                text="",
                tool_calls=[ToolCall(id="c2", name="reminders_cancel", arguments={"reminder_id": 1})],
            ),
            ModelReply(text="Borrado."),
        ]
    )
    loop = Runtime(settings, store, model, scheduler=fake_scheduler)
    first = loop.turn("cli", "recordame la pastilla a las ocho")
    assert "Va a sonar aunque el programa esté cerrado" in first.tools[0].result
    assert fake_scheduler.registered[0][0]["id"] == 1
    loop.turn("cli", "borrá el recordatorio uno")
    assert fake_scheduler.removed == [1]


def test_a_reminder_with_no_time_says_so(tmp_path: Path):
    settings = Settings(base_url="http://x", model="fake", api_key="k", db_path=tmp_path / "c.db")
    model = FakeModel(
        [
            ModelReply(text="", tool_calls=[ToolCall(id="c1", name="reminders_set", arguments={"text": "pagar la luz"})]),
            ModelReply(text="¿A qué hora?"),
        ]
    )
    loop = Runtime(settings, Store(settings.db_path), model, scheduler=RecordingScheduler())
    result = loop.turn("cli", "recordame pagar la luz")
    assert "sin hora no te aviso" in result.tools[0].result


# ---- fire ----------------------------------------------------------------

def test_fire_speaks_logs_and_marks_done(tmp_path: Path, monkeypatch):
    from apps.cli import arsvox_cli

    store = Store(tmp_path / "d.db")
    store.add_reminder("cli", "tomar la pastilla", "2026-09-12T20:00", "once")
    monkeypatch.setattr(arsvox_cli, "REPO_ROOT", tmp_path)

    class Args:
        id = 1
        session = "cli"
        db = store.path
        engine = "fake"
        silent = True

    assert arsvox_cli.cmd_fire(Args()) == 0
    assert store.get_reminder("cli", 1)["active"] == 0
    events = [e for e in store.events("cli") if e.kind == "reminder_fired"]
    assert events and events[0].payload["spoken"] == "Acordate: tomar la pastilla."
    assert (tmp_path / "results" / "reminders" / "reminder-1.txt").is_file()
    assert "played=False" in (tmp_path / "results" / "reminders" / "fired.log").read_text(encoding="utf-8")


def test_fire_on_a_missing_reminder_logs_and_fails(tmp_path: Path, monkeypatch):
    from apps.cli import arsvox_cli

    store = Store(tmp_path / "e.db")
    monkeypatch.setattr(arsvox_cli, "REPO_ROOT", tmp_path)

    class Args:
        id = 99
        session = "cli"
        db = store.path
        engine = "fake"
        silent = True

    assert arsvox_cli.cmd_fire(Args()) == 1
    assert "no existe" in (tmp_path / "results" / "reminders" / "fired.log").read_text(encoding="utf-8")
