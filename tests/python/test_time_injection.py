"""Time injection: every turn's context carries the current local time.

User requirement (NOT a clock tool): the harness injects the current time
into the model context on every user message and every reminder injection,
so the model always knows the time without calling anything.
"""

import re
from datetime import datetime

from arsvox_contracts import AppConfig

from arsvox_agent.context import build_context, now_line
from arsvox_agent.deps import Deps


class _FakePanels:
    def list(self):
        return []


class _FakePending:
    def list_pending(self):
        return []


class _FakeReminders:
    def __init__(self):
        self.tz = None  # R16: build_context reads the anchored tz

    def list_active(self):
        return []


class _FakeSessions:
    def __init__(self):
        self._calls = 0

    def recent_turns(self, session_id, limit):
        self._calls += 1
        return []


def _make_deps() -> Deps:
    return Deps(
        config=AppConfig(),
        db=None,
        sessions=_FakeSessions(),
        notes=None,
        tasks=None,
        reminders=_FakeReminders(),
        notifications=None,
        panels=_FakePanels(),
        preferences=None,
        progress=None,
        pending=_FakePending(),
        documents=None,
        audit=None,
        bus=None,
        policy=None,
        confirmations=None,
        tts=None,
        telegram=None,
        session_id=None,
    )


def test_now_line_shape():
    line = now_line()
    assert line.startswith("Hora actual: ")
    assert "ISO local:" in line and "UTC:" in line
    local = line.split(". ISO")[0].replace("Hora actual: ", "")
    assert re.search(
        r"^(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} de "
        r"(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) "
        r"de \d{4}, \d{2}:\d{2} \(",
        local,
    ), line


def test_now_line_matches_wall_clock():
    now = datetime.now().astimezone()
    assert now.isoformat(timespec="seconds") in now_line()


def test_build_context_first_line_is_time():
    text = build_context(_make_deps().config, _make_deps())
    assert text.splitlines()[0].startswith("Hora actual: ")
