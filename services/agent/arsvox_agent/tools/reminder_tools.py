"""Reminder tools. Creating a reminder goes through the confirmation
coordinator (policy approval override): the user always sees the exact
date/time and text before it is scheduled.

GATE-2.5 H2: due_at is normalized to a UTC instant. Naive input is treated
as LOCAL wall time (the store's configured/system zone), never UTC.
"""

from datetime import datetime, timedelta, timezone

from arsvox_agent.tools.context import ToolContext
from arsvox_memory.repos.reminders import normalize_due_utc

WEEKDAYS_ES = [
    "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo",
]


def _due_plain_words(due_iso: str, tz) -> str:
    """Render a UTC ISO instant in plain local words the user understands:
    'hoy a las 9 de la noche' / 'mañana a las 9 de la mañana' / weekday.

    Reviewer round 3 (2026-08-14): reminders_list pasted raw ISO codes
    ("2026-08-15T15:00:00+00:00") that no normal user can read. The list
    must speak like the confirmation does.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    try:
        dt = datetime.fromisoformat(due_iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        local = dt.astimezone(tz)
    except Exception:
        return due_iso

    hour = local.hour
    if hour < 6:
        period = "de la madrugada"
    elif hour < 12:
        period = "de la mañana"
    elif hour < 19:
        period = "de la tarde"
    else:
        period = "de la noche"
    h12 = hour % 12 or 12

    from datetime import datetime as _dt

    today_local = _dt.now(tz).date()
    tomorrow_local = today_local.fromordinal(today_local.toordinal() + 1)
    due_day = local.date()
    if due_day == today_local:
        when = "hoy"
    elif due_day == tomorrow_local:
        when = "mañana"
    else:
        when = WEEKDAYS_ES[local.weekday()]
    return f"{when} a las {h12} {period}"


def _normalize_due(due_at: str, tz) -> str | None:
    """Parse ``due_at`` into a UTC instant (``+00:00`` ISO string).

    Naive datetimes are interpreted as LOCAL wall time in the store's
    timezone; offset-aware datetimes are converted. Returns None if the
    string is not ISO-parseable.
    """
    return normalize_due_utc(due_at, tz)


_PLACEHOLDER_WORDS = {
    "recordatorio", "recuérdame", "recuerdame", "para", "de", "del", "el", "la",
    "los", "las", "a", "al", "y", "mañana", "manana", "hoy", "pasado", "pasada",
    "día", "dia", "días", "semana", "mes", "año", "noche", "tarde", "temprano",
    "a las", "de la", "de las",
}


def _is_placeholder_text(text: str, due: str, tz: str) -> bool:
    """True when the model invented a generic placeholder instead of a
    real reminder text (R10 finding 4: "Recordatorio para mañana a las
    9"). Strategy: if every significant word in the text is either a
    filler word or a digit, there is no real content — treat as empty."""
    import re

    tokens = re.findall(r"[a-záéíóúñ]+|\d+", text.lower())
    significant = [
        t
        for t in tokens
        if t not in _PLACEHOLDER_WORDS and not t.isdigit()
    ]
    return len(significant) == 0


async def _register_draft(tctx: ToolContext, due: str) -> str:
    """Register a pending reminder draft so the NEXT user message
    completes this reminder in the runtime (deterministic, no model in
    the loop). R9 finding 3 / R10 finding 4."""
    pending_id = tctx.deps.pending.create(
        run_id=tctx.run_id,
        tool="reminders.create_draft",
        args={"due_at": due},
        title="Recordatorio (falta el texto)",
        detail=_due_plain_words(due, tctx.deps.reminders.tz),
        expires_at=(datetime.now(timezone.utc) + timedelta(minutes=60)).isoformat(timespec="seconds"),
    )
    tctx.deps.audit.log("reminders", "draft_registered", {"pending_id": pending_id, "due_at": due})
    return (
        f"¿Qué te recuerdo {_due_plain_words(due, tctx.deps.reminders.tz)}? "
        "Decime el texto y lo agendo."
    )


async def reminders_create(
    tctx: ToolContext,
    text: str,
    due_at: str,
    repeat_rule: str = "none",
) -> str:
    if repeat_rule not in ("none", "daily", "weekly"):
        return "La repetición debe ser none, daily o weekly."
    due = _normalize_due(due_at, tctx.deps.reminders.tz)
    if due is None:
        return f"No entendí la fecha '{due_at}'. Usa formato ISO (2026-08-06T08:00:00)."
    if not text.strip():
        return await _register_draft(tctx, due)
    # R10 (2026-08-14, reviewer round 10 finding 4): the model invented
    # placeholder text ("Recordatorio para mañana a las 9") instead of
    # passing empty — no draft registered, reminder created with a
    # nonsense title, and the user's follow-up answer was ignored.
    # Treat auto-generated placeholders as missing text (same draft path).
    placeholder = _is_placeholder_text(text, due, tctx.deps.reminders.tz)
    if placeholder:
        tctx.deps.audit.log(
            "reminders", "placeholder_as_empty", {"text": text[:80], "due_at": due}
        )
        return await _register_draft(tctx, due)
    reminder_id = tctx.deps.reminders.create(text, due, repeat_rule)
    tctx.deps.audit.log(
        "reminders", "create", {"reminder_id": reminder_id, "due_at": due, "repeat": repeat_rule}
    )
    suffix = f" y se repetirá a diario" if repeat_rule == "daily" else f" y se repetirá todas las semanas" if repeat_rule == "weekly" else ""
    return f"Recordatorio programado para {due}: {text}{suffix}."


async def reminders_list(tctx: ToolContext) -> str:
    active = tctx.deps.reminders.list_active()
    if not active:
        return "No hay recordatorios activos."
    lines = [
        f"#{r['id']} {_due_plain_words(r['due_at'], tctx.deps.reminders.tz)} — {r['text']}"
        + (f" (se repite a diario)" if r["repeat_rule"] == "daily" else f" (se repite todas las semanas)" if r["repeat_rule"] == "weekly" else "")
        for r in active
    ]
    return "\n".join(lines)


async def reminders_cancel(tctx: ToolContext, reminder_id: int) -> str:
    if tctx.deps.reminders.cancel(reminder_id):
        tctx.deps.audit.log("reminders", "cancel", {"reminder_id": reminder_id})
        return f"Recordatorio #{reminder_id} cancelado."
    return f"No encontré el recordatorio #{reminder_id} activo."


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec(
        "reminders.create",
        "Schedule a reminder. due_at must be ISO format (e.g. 2026-08-06T08:00:00)."
        " repeat_rule: none, daily or weekly. If the user gave the TIME but"
        " NOT the text, pass text='' — the system asks for the text and"
        " completes it on the next message. NEVER invent a generic text"
        " like 'Recordatorio para mañana a las 9': if the user didn't say"
        " what to remind, text must be empty.",
        reminders_create,
        PolicyKind.REVERSIBLE,
        effect="emission",
    ),
    ToolSpec("reminders.list", "List active reminders.", reminders_list, PolicyKind.READ_ONLY, effect="revertible"),
    ToolSpec("reminders.cancel", "Cancel an active reminder by id.", reminders_cancel, PolicyKind.REVERSIBLE, effect="revertible"),
]
