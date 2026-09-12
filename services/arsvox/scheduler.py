"""Reminders that fire with the app closed.

The clock belongs to Windows, not to this process. Each timed reminder becomes a
scheduled task: it fires when the machine is awake, and StartWhenAvailable makes
Windows run a missed reminder as soon as the machine comes back, which is what
"survives power-off" has to mean in practice.

The command line used by a task is exactly the command line used by hand, so what
fires at eight o'clock is the same path as `arsvox_cli.py fire 3`.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

TASK_FOLDER = "ArsVox"
REPEATS = ("once", "daily", "weekly")
DAY_ELEMENTS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
TASK_XML_TEMPLATE = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>{description}</Description>
  </RegistrationInfo>
  <Triggers>
{triggers}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{command}</Command>
      <Arguments>{arguments}</Arguments>
      <WorkingDirectory>{working_dir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def windows_path(path: str | Path) -> str:
    text = str(Path(path).resolve())
    if text.startswith("/mnt/") and len(text) > 7:
        return f"{text[5].upper()}:{text[6:]}".replace("/", "\\")
    return text


def task_name(reminder_id: int) -> str:
    return f"\\{TASK_FOLDER}\\reminder-{reminder_id}"


def boundary_text(moment: datetime) -> str:
    """Local wall time plus its offset, so Windows converts instead of assuming.

    The dev rig has WSL at -06:00 and Windows at -07:00. A bare "17:03" was read
    as Windows-local and the task sat unrun for an hour (Last Result 267011).
    """
    if moment.tzinfo is None:
        moment = moment.astimezone()
    offset = moment.strftime("%z")
    if len(offset) == 5:
        offset = f"{offset[:3]}:{offset[3:]}"
    return moment.strftime("%Y-%m-%dT%H:%M:%S") + offset


def build_triggers(when_local: str, repeat: str) -> str:
    """One trigger block, matching the repeat the model asked for."""
    moment = datetime.fromisoformat(when_local)
    boundary = boundary_text(moment)
    if repeat == "daily":
        trigger = (
            f"    <CalendarTrigger>\n"
            f"      <StartBoundary>{boundary}</StartBoundary>\n"
            f"      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n"
            f"    </CalendarTrigger>"
        )
    elif repeat == "weekly":
        day = DAY_ELEMENTS[moment.weekday()]
        trigger = (
            f"    <CalendarTrigger>\n"
            f"      <StartBoundary>{boundary}</StartBoundary>\n"
            f"      <ScheduleByWeek>\n"
            f"        <DaysOfWeek><{day} /></DaysOfWeek>\n"
            f"        <WeeksInterval>1</WeeksInterval>\n"
            f"      </ScheduleByWeek>\n"
            f"    </CalendarTrigger>"
        )
    else:
        trigger = f"    <TimeTrigger>\n      <StartBoundary>{boundary}</StartBoundary>\n    </TimeTrigger>"
    return trigger


def build_task_xml(
    *,
    when_local: str,
    repeat: str,
    command: str,
    arguments: list[str],
    working_dir: str,
    description: str,
) -> str:
    def escape(text: str) -> str:
        return (
            text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
        )

    return TASK_XML_TEMPLATE.format(
        description=escape(description),
        triggers=build_triggers(when_local, repeat),
        command=escape(command),
        arguments=escape(" ".join(f'"{a}"' if " " in a or a.endswith(".py") else a for a in arguments)),
        working_dir=escape(working_dir),
    )


@dataclass(slots=True)
class TaskInfo:
    reminder_id: int
    name: str
    command: str
    next_run: str = ""
    state: str = ""


class TaskScheduler:
    """Talks to schtasks. The runner is injectable so the tests never touch Windows."""

    def __init__(
        self,
        repo_root: str | Path,
        python_exe: str | Path | None = None,
        runner: Callable[[list[str]], subprocess.CompletedProcess] | None = None,
    ) -> None:
        self.repo_root = Path(repo_root)
        self.python_exe = Path(python_exe) if python_exe else self._default_python()
        self.run = runner or (lambda cmd: subprocess.run(cmd, capture_output=True, text=True))
        self.schtasks = "schtasks" if sys.platform == "win32" else "schtasks.exe"

    def _default_python(self) -> Path:
        for candidate in (
            self.repo_root / ".venv-win" / "Scripts" / "pythonw.exe",
            self.repo_root / ".venv-win" / "Scripts" / "python.exe",
            Path(sys.executable),
        ):
            if Path(candidate).exists():
                return Path(candidate)
        return Path(sys.executable)

    def action(self, reminder_id: int, session: str) -> tuple[str, list[str]]:
        cli = windows_path(self.repo_root / "apps" / "cli" / "arsvox_cli.py")
        return windows_path(self.python_exe), [cli, "fire", str(reminder_id), "--session", session]

    def register(self, reminder: dict, session: str) -> str:
        when = reminder.get("when_local")
        repeat = reminder.get("repeat") or "once"
        if not when:
            return ""
        command, arguments = self.action(int(reminder["id"]), session)
        xml = build_task_xml(
            when_local=when,
            repeat=repeat if repeat in REPEATS else "once",
            command=command,
            arguments=arguments,
            working_dir=windows_path(self.repo_root),
            description=f"Ars Vox — recordatorio {reminder['id']}: {reminder['text'][:100]}",
        )
        xml_path = self.repo_root / "results" / "tasks" / f"reminder-{reminder['id']}.xml"
        xml_path.parent.mkdir(parents=True, exist_ok=True)
        xml_path.write_text(xml, encoding="utf-16")
        name = task_name(int(reminder["id"]))
        result = self.run(
            [self.schtasks, "/Create", "/TN", name, "/XML", windows_path(xml_path), "/F"]
        )
        if result.returncode != 0:
            raise RuntimeError(f"schtasks /Create failed: {(result.stderr or result.stdout).strip()[:300]}")
        return name

    def unregister(self, reminder_id: int) -> bool:
        result = self.run([self.schtasks, "/Delete", "/TN", task_name(reminder_id), "/F"])
        return result.returncode == 0

    def query(self, reminder_id: int) -> TaskInfo | None:
        name = task_name(reminder_id)
        result = self.run([self.schtasks, "/Query", "/TN", name, "/FO", "LIST", "/V"])
        if result.returncode != 0:
            return None
        info = TaskInfo(reminder_id=reminder_id, name=name, command="")
        for line in (result.stdout or "").splitlines():
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            key, value = key.strip().lower(), value.strip()
            if key == "next run time":
                info.next_run = value
            elif key == "status":
                info.state = value
            elif key == "task to run":
                info.command = value
        return info

    def sync(self, reminders: list[dict], session: str) -> dict[str, list]:
        """Re-register every active timed reminder, and drop tasks that are gone."""
        registered, failed, skipped = [], [], []
        wanted = set()
        for reminder in reminders:
            if reminder.get("when_local"):
                wanted.add(int(reminder["id"]))
                try:
                    registered.append(self.register(reminder, session))
                except RuntimeError as exc:
                    failed.append(f"{reminder['id']}: {exc}")
            else:
                skipped.append(int(reminder["id"]))
        return {"registered": registered, "failed": failed, "skipped": skipped, "wanted": sorted(wanted)}
