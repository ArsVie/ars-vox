"""Reminder tools. Creating a reminder goes through the confirmation
coordinator (policy approval override): the user always sees the exact
date/time and text before it is scheduled.

GATE-2.5 H2: due_at is normalized to a UTC instant. Naive input is treated
as LOCAL wall time (the store's configured/system zone), never UTC.
"""

from arsvox_agent.tools.context import ToolContext
from arsvox_memory.repos.reminders import normalize_due_utc


def _normalize_due(due_at: str, tz) -> str | None:
    """Parse ``due_at`` into a UTC instant (``+00:00`` ISO string).

    Naive datetimes are interpreted as LOCAL wall time in the store's
    timezone; offset-aware datetimes are converted. Returns None if the
    string is not ISO-parseable.
    """
    return normalize_due_utc(due_at, tz)


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
    reminder_id = tctx.deps.reminders.create(text, due, repeat_rule)
    tctx.deps.audit.log(
        "reminders", "create", {"reminder_id": reminder_id, "due_at": due, "repeat": repeat_rule}
    )
    suffix = f" y se repetirá {repeat_rule}" if repeat_rule != "none" else ""
    return f"Recordatorio programado para {due}: {text}{suffix}."


async def reminders_list(tctx: ToolContext) -> str:
    active = tctx.deps.reminders.list_active()
    if not active:
        return "No hay recordatorios activos."
    lines = [
        f"#{r['id']} {r['due_at']} — {r['text']}"
        + (f" ({r['repeat_rule']})" if r["repeat_rule"] != "none" else "")
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
        " repeat_rule: none, daily or weekly. Requires user confirmation.",
        reminders_create,
        PolicyKind.USER_VISIBLE,
        approval=True,
    ),
    ToolSpec("reminders.list", "List active reminders.", reminders_list, PolicyKind.READ_ONLY),
    ToolSpec("reminders.cancel", "Cancel an active reminder by id.", reminders_cancel, PolicyKind.USER_VISIBLE),
]
