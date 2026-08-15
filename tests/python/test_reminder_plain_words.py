"""Round-3 regression: reminder lists must speak plain local words,
never raw ISO codes (reviewer round 3 finding 7)."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from arsvox_agent.tools.reminder_tools import _due_plain_words

TZ = ZoneInfo("America/Mexico_City")


def _utc_iso_at(hour_local: int, day_offset: int = 0) -> str:
    """Build a UTC ISO string for a given local hour, offset days from
    now, in the store's zone (Mexico City, UTC-6 no DST edge in test)."""
    now_local = datetime.now(TZ)
    target = (now_local + timedelta(days=day_offset)).replace(
        hour=hour_local, minute=0, second=0, microsecond=0
    )
    return target.astimezone(timezone.utc).isoformat(timespec="seconds")


def test_due_plain_words_today_morning():
    out = _due_plain_words(_utc_iso_at(8), TZ)
    assert out == "hoy a las 8 de la mañana", out


def test_due_plain_words_today_evening():
    out = _due_plain_words(_utc_iso_at(21), TZ)
    assert out == "hoy a las 9 de la noche", out


def test_due_plain_words_tomorrow_morning():
    out = _due_plain_words(_utc_iso_at(9, day_offset=1), TZ)
    assert out == "mañana a las 9 de la mañana", out


def test_due_plain_words_never_leaks_iso():
    for hour, offset in [(8, 0), (21, 0), (9, 1), (15, 10)]:
        out = _due_plain_words(_utc_iso_at(hour, offset), TZ)
        assert "T" not in out, f"raw ISO leaked: {out}"
        assert "-" not in out, f"raw ISO leaked: {out}"
        assert out.startswith(("hoy", "mañana", "lunes", "martes", "miércoles",
                               "jueves", "viernes", "sábado", "domingo")), out


def test_reminders_list_has_no_ids_and_opens_tasks_panel():
    """R13 findings 2+3: the reminders list never shows raw '#N' ids and
    the list tool opens the tasks panel (RECORDATORIOS visible)."""
    import asyncio

    import arsvox_agent.tools.reminder_tools as rt

    class FakeReminders:
        tz = TZ

        def list_active(self):
            return [
                {"id": 2, "text": "Tomar las pastillas", "due_at": _utc_iso_at(8, 1), "repeat_rule": "daily"},
                {"id": 7, "text": "Llamar a mi nieta", "due_at": _utc_iso_at(9, 0), "repeat_rule": "none"},
            ]

    class FakePanels:
        def __init__(self):
            self.opened = []

        def upsert(self, *args):
            self.opened.append(args)

    class FakeAudit:
        @staticmethod
        def log(*args):
            pass

    class FakeDeps:
        reminders = FakeReminders()
        panels = FakePanels()
        audit = FakeAudit()

    emitted = []

    class FakeTctx:
        deps = FakeDeps()

        async def emit(self, event):
            emitted.append(event)

    out = asyncio.run(rt.reminders_list(FakeTctx()))
    assert "#" not in out, f"raw id leaked: {out}"
    assert "Tomar las pastillas" in out and "Llamar a mi nieta" in out
    assert "se repite a diario" in out
    assert any(getattr(e, "type", "") == "ui_command" for e in emitted), "tasks panel was not opened"
