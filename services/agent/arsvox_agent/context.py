"""Per-turn context builder. Keeps the model's view of the application
small and current: open panels, pending confirmations, active reminders,
and the most recent turns (full history stays in SQLite)."""

from datetime import datetime, timezone

from arsvox_contracts import AppConfig

from arsvox_agent.deps import Deps

WEEKDAYS_ES = [
    "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo",
]
MONTHS_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def now_line() -> str:
    """One-line current local time, Spanish + unambiguous ISO/UTC.

    Injected at the TOP of every turn's context (user message AND reminder
    injection) so the model never needs a clock tool — the time is simply
    always there (user requirement; do NOT replace with a clock tool).
    """
    now = datetime.now().astimezone()
    local = (
        f"{WEEKDAYS_ES[now.weekday()]} {now.day} de {MONTHS_ES[now.month - 1]} "
        f"de {now.year}, {now.strftime('%H:%M')} ({now.tzname()})"
    )
    return (
        f"Hora actual: {local}. ISO local: {now.isoformat(timespec='seconds')}. "
        f"UTC: {now.astimezone(timezone.utc).isoformat(timespec='seconds')}."
    )


def build_context(config: AppConfig, deps: Deps) -> str:
    lines: list[str] = [now_line()]
    panels = deps.panels.list()
    lines.append(
        "Paneles abiertos: "
        + (", ".join(p["panel_type"] for p in panels) if panels else "ninguno")
    )
    pending = deps.pending.list_pending()
    if pending:
        lines.append(
            "Confirmaciones pendientes: "
            + "; ".join(f"{p['tool']} — {p['title']}" for p in pending)
        )
    reminders = deps.reminders.list_active()
    if reminders:
        lines.append(
            "Recordatorios activos: "
            + "; ".join(f"#{r['id']} {r['due_at']} {r['text']}" for r in reminders[:5])
        )
    if deps.session_id:
        turns = deps.sessions.recent_turns(
            deps.session_id, config.agent.recent_turns_in_context
        )
        if turns:
            history = "\n".join(
                f"{'Usuario' if t['role'] == 'user' else 'Asistente'}: {t['text'][:200]}"
                for t in turns
            )
            lines.append(f"Historial reciente:\n{history}")
    return "\n".join(lines)
