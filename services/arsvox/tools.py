"""The tools. Few, real, each one writing real state.

Every handler returns one short Spanish sentence, because that sentence is what
the model reads next and what the user eventually hears.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Protocol

from services.arsvox import books, documents, media, web
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
            "Dígame a qué hora."
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


def documents_open(context: ToolContext, arguments: dict) -> str:
    """Open by name, without a viewer: the document is something we read aloud."""
    query = arguments["query"]
    hits, cut = documents.find(query, limit=4)
    if not hits:
        extra = " Busqué rápido, así que pruebe con otra palabra." if cut else ""
        return f"No encontré ningún archivo que se llame '{query}' en sus carpetas.{extra}"
    best = hits[0]
    if len(hits) > 1 and hits[1].score >= best.score:
        titles = "; ".join(f"{hit.title} ({hit.path.suffix.lstrip('.')})" for hit in hits[:3])
        return f"Encontré varios: {titles}. ¿Cuál abro?"
    try:
        text = documents.extract_text(best.path)
    except ModuleNotFoundError:
        return f"Encontré '{best.title}' pero no tengo con qué leer ese tipo de archivo."
    except Exception as exc:  # noqa: BLE001 - a file we cannot read is a sentence
        return f"Encontré '{best.title}' pero no pude leerlo ({type(exc).__name__})."
    if not text.strip():
        return f"'{best.title}' no tiene texto que pueda leer. ¿Será una foto o algo escaneado?"
    context.store.set_document(context.session, str(best.path), best.title)
    return f"Abrí '{best.title}'. Tiene {len(text)} letras. Dígame 'léalo' y arranco."


def documents_read(context: ToolContext, arguments: dict) -> str:
    row = context.store.get_document(context.session)
    if not row:
        return "No tengo ningún documento abierto. Dígame cuál abro."
    try:
        text = documents.extract_text(row["path"])
    except Exception as exc:  # noqa: BLE001
        return f"No pude volver a leer '{row['title']}' ({type(exc).__name__})."
    cursor = int(row["cursor"])
    if cursor >= len(text):
        return f"Ya te leí todo '{row['title']}'."
    chunk = text[cursor : cursor + documents.CHUNK_CHARS]
    new_cursor = context.store.advance_document(context.session, len(chunk))
    remaining = max(len(text) - new_cursor, 0)
    tail = "[Meta: es todo el documento.]" if remaining == 0 else f"[Meta: quedan {remaining} letras.]"
    return f"{chunk}\n\n{tail}"


def media_play(context: ToolContext, arguments: dict) -> str:
    query = arguments["query"]
    try:
        found = media.resolve(query, limit=3)
    except media.MediaError as exc:
        return f"No pude buscar '{query}': {exc}."
    if not found:
        return f"No encontré nada para '{query}'."
    best = found[0]
    if not media.open_in_browser(best["url"]):
        return f"Encontré '{best['title']}' pero no pude abrirlo."
    length = f", {best['seconds'] // 60} minutos" if best["seconds"] else ""
    channel = f" de {best['channel']}" if best["channel"] else ""
    return (
        f"Puse '{best['title']}'{channel}{length}. Se abrió en el navegador. "
        "Dígame si lo paro."
    )


def media_pause(context: ToolContext, arguments: dict) -> str:
    if media.toggle_playback():
        return "Listo, pausé lo que estaba sonando."
    return "No pude mandar la orden de pausa."


def web_search(context: ToolContext, arguments: dict) -> str:
    query = arguments["query"]
    try:
        results = web.search(query, limit=4, region=context.settings.region)
    except web.WebError as exc:
        return f"No pude buscar '{query}': {exc}."
    if not results:
        return f"No encontré resultados para '{query}'."
    return "Esto es lo que encontré: " + web.readable(results, limit=3)


def web_read(context: ToolContext, arguments: dict) -> str:
    url = arguments["url"]
    try:
        text = web.read(url, limit=1800)
    except web.WebError as exc:
        return f"No pude leer {url}: {exc}."
    if not text:
        return f"Leí {url} pero no tiene texto que pueda contar."
    return f"De {url}: {text}"


def web_open(context: ToolContext, arguments: dict) -> str:
    if media.open_in_browser(arguments["url"]):
        return "Te abrí la página en el navegador."
    return "No pude abrir esa página."


def weather_get(context: ToolContext, arguments: dict) -> str:
    city = str(arguments.get("city") or "").strip() or context.settings.city
    when = str(arguments.get("when") or "hoy")
    try:
        return web.weather(city, when)
    except web.WebError as exc:
        return f"No pude consultar el clima de {city}: {exc}."


def news_list(context: ToolContext, arguments: dict) -> str:
    try:
        titles = web.headlines(limit=5)
    except web.WebError as exc:
        return f"No pude leer las noticias: {exc}."
    if not titles:
        return "El periódico no trae titulares en este momento."
    numbered = "; ".join(f"{number}) {title}" for number, title in enumerate(titles, 1))
    return f"Titulares de La Jornada: {numbered}"


def books_get(context: ToolContext, arguments: dict) -> str:
    title = arguments["title"]
    try:
        book = books.find(title, language=context.settings.language)
    except books.BookError as exc:
        return f"No pude buscar '{title}': {exc}."
    if book is None:
        return f"No encontré '{title}' en el catálogo de dominio público. Puedo intentar con otro título."
    url = books.text_url(book)
    if not url:
        return f"Encontré '{book['title']}' pero no tiene un texto que pueda leer."
    try:
        text = books.fetch(url)
    except books.BookError as exc:
        return f"Encontré '{book['title']}' pero no pude descargarlo: {exc}."
    path, letters = books.save(book, text)
    context.store.set_document(context.session, str(path), books.short_title(book))
    return (
        f"Listo, ya tengo '{books.short_title(book)}', de {books.author_name(book)}."
        f"{books.language_note(book)} Dígame 'léalo' y arranco. "
        f"[Meta: {path.name}, {letters} letras; quedó abierto como documento actual.]"
    )


def build_registry() -> dict[str, Tool]:
    return {
        tool.name: tool
        for tool in (
            Tool(
                "reminders_set",
                "Crear un recordatorio. Usarla cuando el usuario pida que se le recuerde algo.",
                {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "qué hay que recordar"},
                        "when_local": {
                            "type": "string",
                            "description": "cuándo, en ISO local (2026-09-12T20:00). Omitirlo si el usuario no dijo hora.",
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
                "Leer lo que ya se sabe de las preferencias del usuario.",
                {"type": "object", "properties": {}},
                preferences_list,
            ),
            Tool(
                "documents_open",
                "Abrir un documento del usuario por su nombre, para leerlo en voz alta. "
                "Buscar en sus carpetas: diario, carta, receta, manual.",
                {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "cómo lo llama el usuario"}
                    },
                    "required": ["query"],
                },
                documents_open,
            ),
            Tool(
                "documents_read",
                "Leer el próximo pedazo del documento abierto. Usarla cuando el usuario diga 'léalo' "
                "o 'siga'. Lo que va entre corchetes es información interna: no se lee en voz alta.",
                {"type": "object", "properties": {}},
                documents_read,
            ),
            Tool(
                "media_play",
                "Poner música o un video: lo busca y lo abre en el navegador.",
                {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "qué quiere escuchar o ver"}
                    },
                    "required": ["query"],
                },
                media_play,
            ),
            Tool(
                "media_pause",
                "Pausar o reanudar lo que está sonando.",
                {"type": "object", "properties": {}},
                media_pause,
            ),
            Tool(
                "web_search",
                "Buscar en internet: precios, personas, lugares, cualquier dato actual sin herramienta propia.",
                {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
                web_search,
            ),
            Tool(
                "web_read",
                "Leer el texto de una página ya encontrada, cuando el resumen no alcance o haga falta el detalle.",
                {
                    "type": "object",
                    "properties": {"url": {"type": "string", "description": "dirección completa"}},
                    "required": ["url"],
                },
                web_read,
            ),
            Tool(
                "web_open",
                "Abrir una página en el navegador para que el usuario la vea.",
                {
                    "type": "object",
                    "properties": {"url": {"type": "string", "description": "dirección completa"}},
                    "required": ["url"],
                },
                web_open,
            ),
            Tool(
                "weather_get",
                "Consultar el clima de hoy o de mañana en una ciudad; sin ciudad es Mexicali.",
                {
                    "type": "object",
                    "properties": {
                        "city": {
                            "type": "string",
                            "description": "la ciudad; omitirlo si el usuario no dijo ninguna",
                        },
                        "when": {
                            "type": "string",
                            "enum": ["hoy", "mañana"],
                            "description": "hoy por defecto; mañana si preguntó por el día siguiente",
                        },
                    },
                },
                weather_get,
            ),
            Tool(
                "news_list",
                "Leer los titulares de las noticias de hoy.",
                {"type": "object", "properties": {}},
                news_list,
            ),
            Tool(
                "books_get",
                "Conseguir un libro de dominio público y dejarlo listo para leer en voz alta. "
                "Lo busca en el catálogo de Project Gutenberg, prefiere una edición en español y lo "
                "guarda en la carpeta de libros del usuario. Continuar con documents_read si el "
                "usuario pidió que se lo lea.",
                {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "el título del libro, como lo dijo el usuario",
                        }
                    },
                    "required": ["title"],
                },
                books_get,
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
