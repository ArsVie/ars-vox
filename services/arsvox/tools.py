"""The tools. Six, real, each one writing real state.

Every handler returns one short Spanish sentence, because that sentence is what
the model reads next and what the user eventually hears.

Four entries are families — one tool with an `action` enum routing to a handler
per action (agenda, documents, media, web); weather and news stay
standalone because each answers one user sentence in one call.

House rule for descriptions (learned from ProjectSight's MCP tools and Pi's):
every sentence must earn its cost on every request — when to use the tool,
where each argument comes from, how to read the reply. A fact the caller needs
only at one moment belongs in the refusal sentence, not in the description: a
refusal costs nothing until it happens, where a description is paid by every
session.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
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
    text = str(arguments.get("text") or "").strip()
    if not text:
        return "¿Qué quiere que le recuerde?"
    when, error = _parse_when(arguments.get("when_local"))
    if error:
        return error
    repeat = arguments.get("repeat") or "once"
    if repeat not in REPEATS:
        repeat = "once"
    reminder_id = context.store.add_reminder(context.session, text, when, repeat)
    if when:
        readable = datetime.fromisoformat(when).strftime("%H:%M del %d/%m")
        line = f"Listo, recordatorio {reminder_id} guardado para las {readable}: {text}"
    else:
        return (
            f"Guardé '{text}' como recordatorio {reminder_id}, pero sin hora no te aviso. "
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
    if arguments.get("reminder_id") is None:
        return "¿Cuál recordatorio? Dígame el número que mostró la lista."
    reminder_id = int(arguments["reminder_id"])
    if not context.store.cancel_reminder(context.session, reminder_id):
        return f"No encontré un recordatorio activo con el número {reminder_id}."
    if context.scheduler is not None:
        context.scheduler.unregister(reminder_id)
    return f"Borrado el recordatorio {reminder_id}."


def tasks_add(context: ToolContext, arguments: dict) -> str:
    text = str(arguments.get("text") or "").strip()
    if not text:
        return "¿Qué anoto?"
    task_id = context.store.add_task(context.session, text)
    return f"Anotado como tarea {task_id}: {text}"


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
    if arguments.get("task_id") is None:
        return "¿Cuál tarea? Dígame el número que mostró la lista."
    task_id = int(arguments["task_id"])
    if context.store.complete_task(context.session, task_id):
        return f"Tarea {task_id} marcada como hecha."
    return f"No encontré una tarea pendiente con el número {task_id}."


def documents_open(context: ToolContext, arguments: dict) -> str:
    """Open by name, without a viewer: the document is something we read aloud."""
    query = str(arguments.get("query") or "").strip()
    if not query:
        return "¿Cuál archivo abro? Dígame cómo lo llama."
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
        return f"Ya le leí todo '{row['title']}'."
    chunk = text[cursor : cursor + documents.CHUNK_CHARS]
    new_cursor = context.store.advance_document(context.session, len(chunk))
    remaining = max(len(text) - new_cursor, 0)
    tail = "[Meta: es todo el documento.]" if remaining == 0 else f"[Meta: quedan {remaining} letras.]"
    return f"{chunk}\n\n{tail}"


def documents_list(context: ToolContext, arguments: dict) -> str:
    """What is on the shelf: the files the assistant can read aloud, newest first."""
    books = documents.list_books(limit=12)
    if not books:
        return "No encontré documentos en sus carpetas. Dígame dónde los tiene y los busco."
    parts = [
        f"{number}) {path.stem.replace('_', ' ').replace('-', ' ').strip()}"
        for number, path in enumerate(books, 1)
    ]
    return "Tengo estos documentos a mano: " + "; ".join(parts) + ". Dígame cuál le leo."


def _music_dir(context: ToolContext) -> Path:
    """Where fetched songs live: the folder set in the window, or the service's cache."""
    configured = (context.store.config(context.session).get("music_path") or "").strip()
    return Path(configured) if configured else context.settings.db_path.parent / "media-cache"


def media_search(context: ToolContext, arguments: dict) -> str:
    """Search and leave the options on screen, so the user picks from the panel."""
    query = str(arguments.get("query") or "").strip()
    if not query:
        return "¿Qué busca? ¿Música o un video?"
    music = str(arguments.get("type") or "video") == "music"
    try:
        found = media.search_music(query, limit=4) if music else media.resolve(query, limit=4)
    except media.MediaError as exc:
        return f"No pude buscar '{query}': {exc}."
    if not found:
        return f"No encontré nada para '{query}'."
    context.store.append(
        context.session,
        "media_offers",
        {"query": query, "items": found, "type": "music" if music else "video"},
    )
    parts = []
    for number, item in enumerate(found, 1):
        channel = f" — {item['channel']}" if item["channel"] else ""
        length = f" — {item['seconds'] // 60}:{item['seconds'] % 60:02d}" if item["seconds"] else ""
        parts.append(f"{number}) {item['title']}{channel}{length} [{item['url']}]")
    opening = "Canciones a la vista: " if music else "Opciones a la vista: "
    return (
        opening
        + "; ".join(parts)
        + ". Cuéntele cada opción con su número y su duración, y pregúntele cuál quiere. "
        "[Meta: lo de corchetes es la dirección de cada opción, para play; no se lee en voz alta.]"
    )


def _media_play_music(context: ToolContext, url: str, query: str, title: str) -> str:
    """The sound path: fetch the audio and put it in the panel. No embed involved."""
    seconds = 0
    if not url:
        try:
            found = media.search_music(query, limit=3)
        except media.MediaError as exc:
            return f"No pude buscar '{query}': {exc}."
        if not found:
            return f"No encontré nada para '{query}'."
        item = found[0]
        url, title, seconds = item["url"], item["title"], int(item.get("seconds") or 0)
    try:
        path, fetched_title = media.fetch_audio(url, _music_dir(context))
    except media.MediaError as exc:
        return f"No pude traer esa canción: {exc}. ¿Le pongo otra cosa?"
    event = media.music_event(path, title or fetched_title, seconds=seconds, origin=url)
    context.store.append(context.session, "media_state", event)
    return f"Ya la puse para oír: '{event['title']}'. Suena en el panel."


def media_play(context: ToolContext, arguments: dict) -> str:
    url = str(arguments.get("url") or "").strip()
    title = str(arguments.get("title") or "").strip()
    query = str(arguments.get("query") or "").strip()
    if not url and not query:
        return "¿Qué pongo? ¿Música o video de qué?"
    if str(arguments.get("type") or "video") == "music":
        return _media_play_music(context, url, query, title)
    if url:
        item = {"title": title, "url": url, "channel": "", "seconds": 0}
    else:
        try:
            found = media.resolve(query, limit=3)
        except media.MediaError as exc:
            return f"No pude buscar '{query}': {exc}."
        if not found:
            return f"No encontré nada para '{query}'."
        item = found[0]
    event = media.youtube_event(item["url"], item["title"], item["channel"], item["seconds"])
    if event is None:
        return f"Ese enlace no es un video de YouTube: {item['url'][:60]}."
    context.store.append(context.session, "media_state", event)
    channel = f", de {event['channel']}" if event["channel"] else ""
    return f"Puse '{event['title']}'{channel}. Ya está en el panel."


def _media_transition(context: ToolContext, action: str, sentence: str, missing: str) -> str:
    """pause / resume / close: only meaningful when the log says something is on."""
    if media.current(context.store, context.session) is None:
        return missing
    context.store.append(context.session, "media_state", {"action": action})
    return sentence


def media_pause(context: ToolContext, arguments: dict) -> str:
    return _media_transition(context, "pause", "Listo, quedó en pausa.", "No hay nada puesto.")


def media_resume(context: ToolContext, arguments: dict) -> str:
    return _media_transition(context, "resume", "Listo, ahí sigue.", "No hay nada que reanudar.")


def media_close(context: ToolContext, arguments: dict) -> str:
    return _media_transition(context, "close", "Ya no está en el panel.", "No hay nada que quitar.")


def web_search(context: ToolContext, arguments: dict) -> str:
    query = str(arguments.get("query") or "").strip()
    if not query:
        return "¿Qué busco?"
    try:
        results = web.search(query, limit=4, region=context.settings.region)
    except web.WebError as exc:
        return f"No pude buscar '{query}': {exc}."
    if not results:
        return f"No encontré resultados para '{query}'."
    return "Esto es lo que encontré: " + web.readable(results, limit=3)


def web_read(context: ToolContext, arguments: dict) -> str:
    url = str(arguments.get("url") or "").strip()
    if not url:
        return "¿Qué página? Páseme la dirección."
    try:
        text = web.read(url, limit=1800)
    except web.WebError as exc:
        return f"No pude leer {url}: {exc}."
    if not text:
        return f"Leí {url} pero no tiene texto que pueda contar."
    return f"De {url}: {text}"


def web_open(context: ToolContext, arguments: dict) -> str:
    url = str(arguments.get("url") or "").strip()
    if not url:
        return "¿Qué página? Páseme la dirección."
    if media.open_in_browser(url):
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
    title = str(arguments.get("title") or "").strip()
    if not title:
        return "¿Cuál libro busco?"
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


# ---- the four families -----------------------------------------------------
# One entry per family, one handler per action. The `action` enum in each schema
# is built from these maps, so the enum and the handlers cannot disagree.

AGENDA_ACTIONS: dict[str, Callable[[ToolContext, dict], str]] = {
    "add_reminder": reminders_set,
    "list_reminders": reminders_list,
    "cancel_reminder": reminders_cancel,
    "add_task": tasks_add,
    "list_tasks": tasks_list,
    "complete_task": tasks_done,
}
DOCUMENTS_ACTIONS: dict[str, Callable[[ToolContext, dict], str]] = {
    "open_document": documents_open,
    "read_next": documents_read,
    "list_documents": documents_list,
    "get_book": books_get,
}
MEDIA_ACTIONS: dict[str, Callable[[ToolContext, dict], str]] = {
    "search": media_search,
    "play": media_play,
    "pause": media_pause,
    "resume": media_resume,
    "close": media_close,
}
WEB_ACTIONS: dict[str, Callable[[ToolContext, dict], str]] = {
    "search": web_search,
    "read": web_read,
    "open": web_open,
}


def _dispatch(actions: dict[str, Callable[[ToolContext, dict], str]], context: ToolContext, arguments: dict) -> str:
    """Route one family call; an unknown action is a sentence, not a crash."""
    handler = actions.get(str(arguments.get("action") or ""))
    if handler is None:
        known = ", ".join(actions)
        return f"No conozco la acción '{arguments.get('action')}'. Las que tengo: {known}."
    return handler(context, arguments)


def route_agenda(context: ToolContext, arguments: dict) -> str:
    return _dispatch(AGENDA_ACTIONS, context, arguments)


def route_documents(context: ToolContext, arguments: dict) -> str:
    return _dispatch(DOCUMENTS_ACTIONS, context, arguments)


def route_media(context: ToolContext, arguments: dict) -> str:
    return _dispatch(MEDIA_ACTIONS, context, arguments)


def route_web(context: ToolContext, arguments: dict) -> str:
    return _dispatch(WEB_ACTIONS, context, arguments)


def build_registry() -> dict[str, Tool]:
    return {
        tool.name: tool
        for tool in (
            Tool(
                "agenda",
                "Recordatorios y tareas del usuario. "
                "add_reminder(text, when_local, repeat) para algo con hora: suena aunque el programa "
                "esté cerrado, y sin hora queda guardado pero no avisa, así que conviene pedir la hora. "
                "list_reminders lista los activos y cancel_reminder(reminder_id) borra uno por su número. "
                "add_task(text) anota un pendiente sin hora; list_tasks y complete_task(task_id) lo mantienen. "
                "Los números para cancelar o completar salen de las listas: nunca inventarlos.",
                {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": list(AGENDA_ACTIONS),
                            "description": "qué hacer",
                        },
                        "text": {"type": "string", "description": "qué hay que recordar o anotar"},
                        "when_local": {
                            "type": "string",
                            "description": "cuándo, en ISO local (2026-09-12T20:00); omitirlo si el usuario no dijo hora",
                        },
                        "repeat": {
                            "type": "string",
                            "enum": ["once", "daily", "weekly"],
                            "description": "once por defecto; daily o weekly si pidió que se repita",
                        },
                        "reminder_id": {"type": "integer", "description": "el número que mostró list_reminders"},
                        "task_id": {"type": "integer", "description": "el número que mostró list_tasks"},
                    },
                    "required": ["action"],
                },
                route_agenda,
            ),
            Tool(
                "documents",
                "Leer en voz alta lo que el usuario pide. "
                "open_document(query) busca un archivo en sus carpetas por el nombre que él usa — "
                "'el diario', 'la receta' — y lo deja listo; si hay varios parecidos, pregunta cuál. "
                "read_next entrega el próximo pedazo del documento abierto cuando el usuario diga "
                "'léalo' o 'siga'; el texto entre corchetes es interno y no se lee en voz alta. "
                "get_book(title) es solo para clásicos de dominio público que el usuario no tiene en "
                "sus carpetas; lo deja abierto como documento (edición en español preferida). "
                "list_documents() enseña qué documentos hay en sus carpetas, del más nuevo al más "
                "viejo; úselo cuando pregunte qué libros tiene o pida leer algo sin decir cuál. "
                "Para seguir leyendo ('léalo', 'siga') siempre es read_next, jamás get_book, aunque el "
                "libro venga del catálogo; si el documento ya se acabó, read_next lo dice y usted se lo "
                "cuenta tal cual, sin buscar el libro otra vez.",
                {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": list(DOCUMENTS_ACTIONS),
                            "description": "qué hacer",
                        },
                        "query": {
                            "type": "string",
                            "description": "cómo llama el usuario al archivo: 'el diario', 'la receta'",
                        },
                        "title": {
                            "type": "string",
                            "description": "el título del libro, como lo dijo el usuario",
                        },
                    },
                    "required": ["action"],
                },
                route_documents,
            ),
            Tool(
                "media",
                "Música y video en el panel de la ventana. "
                "Para música (canciones, artistas) use type='music': busca en YouTube Music y suena "
                "siempre, porque se oye el audio; para ver un video use type='video'. "
                "search(query, type) busca y deja las opciones a la vista para elegir entre varias; "
                "cuéntele cada opción con su número y pregúntele cuál quiere. "
                "play(query, type) pone directamente lo primero que encuentra; play(url, type) pone una opción "
                "puntual de las que mostró search — la dirección se copia del resultado, nunca se inventa. "
                "pause y resume controlan lo que está sonando; close lo quita del panel. "
                "Si un video no se pudo ver, ofrézcale oírlo con type='music' y la misma dirección. "
                "Lo que está entre corchetes en un resultado es interno: no se lee en voz alta.",
                {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": list(MEDIA_ACTIONS),
                            "description": "qué hacer",
                        },
                        "type": {
                            "type": "string",
                            "enum": ["video", "music"],
                            "description": "video = ver un video; music = música para oír (sin video)",
                        },
                        "query": {"type": "string", "description": "qué quiere escuchar o ver"},
                        "url": {
                            "type": "string",
                            "description": "la dirección de una opción que mostró search",
                        },
                        "title": {
                            "type": "string",
                            "description": "el título de esa opción, tal como apareció",
                        },
                    },
                    "required": ["action"],
                },
                route_media,
            ),
            Tool(
                "web",
                "Internet: buscar y leer. "
                "search(query) devuelve lo que encontró, ya leído. "
                "read(url) lee una página en detalle cuando el resumen no alcance. "
                "open(url) abre una página en el navegador para que el usuario la vea. "
                "El clima y los titulares tienen su propia herramienta: weather_get y news_list.",
                {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": list(WEB_ACTIONS),
                            "description": "qué hacer",
                        },
                        "query": {
                            "type": "string",
                            "description": "qué buscar: precios, personas, lugares, cualquier dato actual",
                        },
                        "url": {"type": "string", "description": "la dirección completa, tal como apareció"},
                    },
                    "required": ["action"],
                },
                route_web,
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
