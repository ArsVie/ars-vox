"""Per-turn context builder. Keeps the model's view of the application
small and current: open panels, pending confirmations, active reminders,
and the most recent turns (full history stays in SQLite)."""

from arsvox_contracts import AppConfig

from arsvox_agent.deps import Deps


def build_context(config: AppConfig, deps: Deps) -> str:
    lines: list[str] = []
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
