"""Per-turn context builder. Keeps the model's view of the application
small and current: open panels, pending confirmations, active reminders,
recalled preferences (memory section), and the most recent turns (full
history stays in SQLite)."""

import json
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
    # GATE-5 (W1-MEMORY): memory section — recalled preferences guide the
    # agent's searches (vision line: "know user preferences from MEMORIES
    # and query searches accordingly"). The k/v PreferenceStore is NOT a
    # memory authority: "memory:"-prefixed keys (retired misuse) are never
    # embedded. Deeper recall is the memory.search tool.
    if deps.db is not None:
        prefs: list[tuple[str, str]] = []
        for row in deps.db.rows("SELECT key, value_json FROM preferences ORDER BY key"):
            if row["key"].startswith("memory:"):
                continue
            try:
                value = json.loads(row["value_json"])
            except json.JSONDecodeError:
                value = row["value_json"]
            prefs.append(
                (row["key"], value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))
            )
        if prefs:
            lines.append(
                "Preferencias recordadas: "
                + "; ".join(f"{k}: {v}" for k, v in prefs)
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
