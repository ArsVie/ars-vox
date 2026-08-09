"""GATE-5 W1-TASKS — cadence injection: the agent FEELS active reminders.

The vision line: reminders get INJECTED INTO THE AGENT'S CONTEXT on a
cadence, like cronjobs — the agent must be reminded periodically, not
just shown a list. build_context (arsvox_agent/context.py) is the
per-turn builder and runtime.py calls it on every turn; these tests pin
that its output carries the active reminders, so the model sees them.

context.py is W1-MEMORY's file — these tests only READ build_context's
behavior, they never modify it.
"""

from arsvox_contracts import AppConfig

from arsvox_agent.context import build_context
from arsvox_agent.deps import Deps


class _FakePanels:
    def list(self):
        return []


class _FakePending:
    def list_pending(self):
        return []


class _FakeReminders:
    def __init__(self, active):
        self._active = active

    def list_active(self):
        return self._active


class _FakeSessions:
    def recent_turns(self, session_id, limit):
        return []


def _make_deps(active_reminders) -> Deps:
    return Deps(
        config=AppConfig(),
        db=None,
        sessions=_FakeSessions(),
        notes=None,
        tasks=None,
        reminders=_FakeReminders(active_reminders),
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


def test_build_context_carries_active_reminders():
    """The next turn's context must contain the active reminders, not
    just the panel list: the agent is reminded periodically (cron style)."""
    deps = _make_deps(
        [
            {"id": 7, "due_at": "2026-08-09T08:00:00+00:00", "text": "Tomar medicina"},
            {"id": 9, "due_at": "2026-08-09T21:00:00+00:00", "text": "Revisar correo"},
        ]
    )
    text = build_context(deps.config, deps)
    assert "Recordatorios activos: " in text
    assert "#7 2026-08-09T08:00:00+00:00 Tomar medicina" in text
    assert "#9 2026-08-09T21:00:00+00:00 Revisar correo" in text
    # the reminder block sits in the SAME turn context as the time line
    assert text.splitlines()[0].startswith("Hora actual: ")


def test_build_context_omits_reminder_line_when_none_active():
    deps = _make_deps([])
    text = build_context(deps.config, deps)
    assert "Recordatorios activos" not in text
