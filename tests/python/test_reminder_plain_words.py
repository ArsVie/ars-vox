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
