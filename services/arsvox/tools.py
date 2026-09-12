"""The tools. Few, real, each one writing real state.

Every handler returns one short Spanish sentence, because that sentence is what
the model reads next and what the user eventually hears.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Protocol

from services.arsvox.config import Settings
from services.arsvox.scheduler import REPEATS
from services.arsvox.store import Store


class Scheduler(Protocol):
    def register(self, reminder: dict, session: str) -> str: ...

    def unregister(self, reminder_id: int) -> bool: ...


@dataclass(slots=True)
class ToolContext:
    store: Store
    session: str
    settings: Settings
    now: datetime
    scheduler: Scheduler | None = None


@dataclass(slots=True)
class Tool:
    name: str
    description: str
    parameters: dict
    handler: Callable[[ToolContext, dict], str]


def _parse_when(value: str | None) -> tuple[str | None, str | None]:
    """Accept an ISO local datetime. Return (normalised, error)."""
    if not value:
        return None, None
    text = value.strip().replace("Z", "+00:00")
    for candidate in (text, text.replace(" ", "T")):
        try:
            moment = datetime.fromisoformat(candidate)
        except ValueError:
            continue
        if moment.tzinfo is None:
            moment = moment.astimezone()
        return moment.isoformat(timespec="minutes"), None
    return None, (
        f"no entendí la fecha '{value}'. Usá formato ISO local, por ejemplo 2026-09-12T20:00"
    )


def reminders_set(context: ToolContext, arguments: dict) -> str:
    when, error = _parse_when(arguments.get("when_local"))
    if error:
        return error
    repeat = arguments.get("repeat") or "once"
    if repeat not in REPEATS:
        repeat = "once"
    reminder_id = context.store.add_reminder(context.session, arguments["text"], when, repeat)
    if when:
        readable = datetime.fromisoformat(when).strftime("%H:%M del %d/%m")
        line = f"Listo, recordatorio {reminder_id} guardado para las {readable}: {arguments['text']}"
    else:
        return (
            f"Guardé '{arguments['text']}' como recordatorio {reminder_id}, pero sin hora no te aviso. "
            "Decime a qué hora."
        )
    if context.scheduler is None:
        return line
    try:
        context.scheduler.register(context.store.get_reminder(context.session, reminder_id), context.session)
    except Exception as exc:  # noqa: BLE001 - a task that will not fire must be said out loud
        return f"{line}. Ojo: no pude programarlo en Windows ({type(exc).__name__}), no va a sonar."
    repeat_text = {"daily": " (todos los días)", "weekly": " (una vez por semana)"}.get(repeat, "")
    return f"{line}{repeat_text}. Va a sonar aunque el programa esté cerrado."


def reminders_list(context: ToolContext, arguments: dict) -> str:
    rows = context.store.list_reminders(context.session)
    if not rows:
        return "No hay recordatorios activos."
    parts = []
    for row in rows:
        when = f" para {row['when_local'][:16].replace('T', ' a las ')}" if row["when_local"] else ""
        repeat = {"daily": " todos los días", "weekly": " cada semana"}.get(row.get("repeat") or "", "")
        parts.append(f"{row['id']}) {row['text']}{when}{repeat}")
    return "Recordatorios activos: " + "; ".join(parts)


def reminders_cancel(context: ToolContext, arguments: dict) -> str:
    reminder_id = int(arguments["reminder_id"])
    if not context.store.cancel_reminder(context.session, reminder_id):
        return f"No encontré un recordatorio activo con el número {reminder_id}."
    if context.scheduler is not None:
        context.scheduler.unregister(reminder_id)
    return f"Borrado el recordatorio {reminder_id}."


def tasks_add(context: ToolContext, arguments: dict) -> str:
    task_id = context.store.add_task(context.session, arguments["text"])
    return f"Anotado como tarea {task_id}: {arguments['text']}"


def tasks_list(context: ToolContext, arguments: dict) -> str:
    rows = context.store.list_tasks(context.session)
    if not rows:
        return "No hay tareas anotadas."
    open_rows = [r for r in rows if not r["done_ts"]]
    done_rows = [r for r in rows if r["done_ts"]]
    parts = [f"{r['id']}) {r['text']}" for r in open_rows]
    text = "Tareas pendientes: " + ("; ".join(parts) if parts else "ninguna")
    if done_rows:
        text += f". Ya hechas: {len(done_rows)}"
    return text


def tasks_done(context: ToolContext, arguments: dict) -> str:
    task_id = int(arguments["task_id"])
    if context.store.complete_task(context.session, task_id):
        return f"Tarea {task_id} marcada como hecha."
    return f"No encontré una tarea pendiente con el número {task_id}."


def preferences_set(context: ToolContext, arguments: dict) -> str:
    context.store.set_preference(context.session, arguments["key"], arguments["value"])
    return f"Me acuerdo: {arguments['key']} = {arguments['value']}"


def preferences_list(context: ToolContext, arguments: dict) -> str:
    preferences = context.store.preferences(context.session)
    if not preferences:
        return "Todavía no me acuerdo de nada en particular."
    return "Me acuerdo de: " + "; ".join(f"{k}: {v}" for k, v in preferences.items())


def build_registry() -> dict[str, Tool]:
    return {
        tool.name: tool
        for tool in (
            Tool(
                "reminders_set",
                "Crear un recordatorio. Usala cuando el usuario pida que le recuerdes algo.",
                {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "qué hay que recordar"},
                        "when_local": {
                            "type": "string",
                            "description": "cuándo, en ISO local (2026-09-12T20:00). Omitilo si no dijo hora.",
                        },
                        "repeat": {
                            "type": "string",
                            "enum": ["once", "daily", "weekly"],
                            "description": "once por defecto; daily o weekly si pidió que se repita",
                        },
                    },
                    "required": ["text"],
                },
                reminders_set,
            ),
            Tool(
                "reminders_list",
                "Leer los recordatorios activos.",
                {"type": "object", "properties": {}},
                reminders_list,
            ),
            Tool(
                "reminders_cancel",
                "Borrar un recordatorio por su número.",
                {
                    "type": "object",
                    "properties": {"reminder_id": {"type": "integer"}},
                    "required": ["reminder_id"],
                },
                reminders_cancel,
            ),
            Tool(
                "tasks_add",
                "Anotar una tarea o algo que hay que hacer.",
                {
                    "type": "object",
                    "properties": {"text": {"type": "string"}},
                    "required": ["text"],
                },
                tasks_add,
            ),
            Tool(
                "tasks_list",
                "Leer las tareas anotadas.",
                {"type": "object", "properties": {}},
                tasks_list,
            ),
            Tool(
                "tasks_done",
                "Marcar una tarea como hecha.",
                {
                    "type": "object",
                    "properties": {"task_id": {"type": "integer"}},
                    "required": ["task_id"],
                },
                tasks_done,
            ),
            Tool(
                "preferences_set",
                "Guardar algo que al usuario le gusta o prefiere, para futuras búsquedas.",
                {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "description": "tema, por ejemplo musica"},
                        "value": {"type": "string", "description": "lo que prefiere, por ejemplo jazz suave"},
                    },
                    "required": ["key", "value"],
                },
                preferences_set,
            ),
            Tool(
                "preferences_list",
                "Leer lo que ya sabés de las preferencias del usuario.",
                {"type": "object", "properties": {}},
                preferences_list,
            ),
        )
    }


def tool_schemas(registry: dict[str, Tool]) -> list[dict]:
    """Sorted by name so the tool block is byte-stable across turns (cache hygiene)."""
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }
        for tool in (registry[name] for name in sorted(registry))
    ]


JSON_TYPES: dict[str, object] = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
}
MAX_ARGUMENT_CHARS = 500


def check_arguments(tool: Tool, arguments: dict) -> tuple[dict, str]:
    """Validate against the tool's own schema: one source of truth, no second copy.

    Returns (clean_arguments, error). On error the caller hands the message back to
    the model, which is the only recovery path the loop needs.
    """
    schema = tool.parameters or {}
    properties = schema.get("properties") or {}
    clean: dict = {}
    for key, value in (arguments or {}).items():
        if key not in properties:
            continue
        expected = JSON_TYPES.get((properties[key] or {}).get("type", "string"))
        if expected is int and isinstance(value, str):
            try:
                value = int(value.strip())  # models send "2" for an id often enough
            except ValueError:
                return {}, f"'{key}' debe ser un número entero"
        if expected is not None and not isinstance(value, expected):
            if not (expected is (int, float) and isinstance(value, int)):
                return {}, f"'{key}' tiene el tipo equivocado"
        if isinstance(value, str):
            value = value.strip()[:MAX_ARGUMENT_CHARS]
        clean[key] = value
    missing = [key for key in schema.get("required", []) if clean.get(key) in (None, "")]
    if missing:
        return {}, f"faltan datos: {', '.join(missing)}"
    return clean, ""


def tool_guidance(registry: dict[str, Tool]) -> list[tuple[str, str]]:
    return [(name, registry[name].description) for name in sorted(registry)]
