"""Model-visible tool surface: 11 dispatchers over the granular tools.

The model-visible surface of the agent is 15 tools: browser.navigate,
browser.dom_action, layout.compose and memory.search (unchanged,
registered in their own modules) plus the dispatchers in this module.
Each dispatcher maps an ``action`` (or ``source`` / ``result_id``)
onto exactly ONE granular tool registered by the tool modules. The
granular tools stay registered — the client-command router, policy and
audit depend on them — and are hidden from the model via MODEL_HIDDEN
in tools/__init__.py.

Delegation runs through the registry's full gate:

    hidden = tctx.deps.registry.get("<granular.tool>")
    return await tctx.deps.registry.execute_gated(hidden, tctx, args)

so the hidden tool's own policy classification, approval flow
(telegram.send_pending's confirmation), tool-call recording and bus
events fire exactly as if the model had called the granular tool
directly. The dispatcher spec itself is thin: kind=REVERSIBLE (or
READ_ONLY for pure readers), approval=False, effect='revertible'
except telegram.message (effect='emission').

Dispatcher handler params ARE the model's JSON schema (pydantic-ai
builds it from the typed annotations), so action/source enums are
Literal[...] and every optional argument is Optional[...] with a None
default. The model-visible names are flattened at build time
(ui.panel -> ui_panel); the ToolSpecs keep the dotted names.

NOTE (coordination with the MODEL_HIDDEN worker): the granular
``media.play`` spec in media_tools.py currently owns the name this
module's media.play dispatcher needs, so both cannot register at once.
The MODEL_HIDDEN pass renames the granular spec to
``media.play_youtube`` (mirroring media.search_youtube) to free the
name; _play_by_result_hidden() below tries both names at call time so
the dispatcher works whichever lands first.
"""

from typing import Literal, Optional

from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolRegistry, ToolSpec, spec
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.ui_tools import ModelPanelType


async def _delegate(tctx: ToolContext, hidden_name: str, args: dict) -> str:
    """Run one granular tool through the full registry gate.

    ``tctx.deps.registry`` is the instrumented ToolRegistry (None in
    unit tests that never run tools through the registry — those get a
    clear error string instead of an AttributeError).
    """
    registry = getattr(tctx.deps, "registry", None)
    if registry is None:
        return f"Error: {hidden_name} no está disponible (registro no conectado)."
    hidden = registry.get(hidden_name)
    if hidden is None:
        return f"Error: {hidden_name} no está disponible."
    return await registry.execute_gated(hidden, tctx, args)


def _play_by_result_hidden(registry: "ToolRegistry | None") -> str:
    """Name of the hidden granular play-by-result tool.

    The granular spec is renamed ``media.play`` -> ``media.play_youtube``
    by the MODEL_HIDDEN pass (the dispatcher owns ``media.play``). Prefer
    the post-rename name: once the rename lands, ``media.play`` resolves
    to the dispatcher itself and delegating to it would recurse. The
    pre-rename fallback only matters mid-flight.
    """
    for name in ("media.play_youtube", "media.play"):
        if registry is not None and registry.get(name) is not None:
            return name
    return "media.play_youtube"


# --------------------------------------------------------------------- #
# app.state
# --------------------------------------------------------------------- #

APP_STATE_DESCRIPTION = (
    "Read the application state or set an explicit preference. Use it when the "
    "user's request depends on what is currently on screen: open panels, pending "
    "confirmations, active reminders. action=get returns a compact JSON snapshot "
    "of the application (panels, pending confirmations, active reminders, active "
    "model). action=set_preference saves an explicit key/value preference; both "
    "key and value are required, and preferences are not memory — save facts "
    "with notes.manage action=add and recall them with memory.search. Results "
    "come back in Spanish; pass them through unchanged."
)


async def app_state(
    tctx: ToolContext,
    action: Literal["get", "set_preference"],
    key: Optional[str] = None,
    value: Optional[str] = None,
) -> str:
    if action == "get":
        return await _delegate(tctx, "app.get_state", {})
    if action == "set_preference":
        if not key or value is None:
            return (
                "Acción no válida para app.state: set_preference necesita "
                "'key' y 'value'."
            )
        return await _delegate(
            tctx, "preferences.set", {"key": key, "value": value}
        )
    return f"Acción no válida para app.state: {action!r}."


# --------------------------------------------------------------------- #
# ui.panel
# --------------------------------------------------------------------- #

UI_PANEL_DESCRIPTION = (
    "Panels: open shows a panel in a side slot (panel_type required; title and "
    "content_reference optional) — opening is NOT composing; use layout.compose "
    "for the main surface. close removes a panel (panel_type or panel_id). "
    "set_primary makes a panel primary; fullscreen makes it full-screen; restore "
    "restores the last layout. A persistent conversation pin silently degrades "
    "later composes — call layout.compose when the primary task changes. "
    "panel_type: conversation, browser, youtube, media, book_reader, "
    "document_editor, notes, tasks, reminders, telegram_preview, settings, "
    "confirmation, notification."
)


async def ui_panel(
    tctx: ToolContext,
    action: Literal["open", "close", "set_primary", "fullscreen", "restore"],
    panel_type: Optional[ModelPanelType] = None,
    panel_id: Optional[str] = None,
    title: Optional[str] = None,
    content_reference: Optional[str] = None,
) -> str:
    # Direct-call safety: pydantic-ai hands us a validated ModelPanelType,
    # but unit tests may pass the plain string value — normalize once so
    # the hidden ui.* handlers always receive the enum.
    if panel_type is not None and not isinstance(panel_type, ModelPanelType):
        try:
            panel_type = ModelPanelType(panel_type)
        except ValueError:
            return (
                f"Acción no válida para ui.panel: 'panel_type' desconocido "
                f"({panel_type!r})."
            )
    if action == "open":
        if panel_type is None:
            return (
                "Acción no válida para ui.panel: open necesita 'panel_type'."
            )
        args: dict = {"panel_type": panel_type}
        if title is not None:
            args["title"] = title
        if content_reference is not None:
            args["content_reference"] = content_reference
        return await _delegate(tctx, "ui.open_panel", args)
    if action == "close":
        if panel_type is None and not panel_id:
            return (
                "Acción no válida para ui.panel: close necesita 'panel_type' "
                "o 'panel_id'."
            )
        args = {}
        if panel_type is not None:
            args["panel_type"] = panel_type
        if panel_id:
            args["panel_id"] = panel_id
        return await _delegate(tctx, "ui.close_panel", args)
    if action == "set_primary":
        if panel_type is None:
            return (
                "Acción no válida para ui.panel: set_primary necesita "
                "'panel_type'."
            )
        return await _delegate(
            tctx, "ui.set_primary_panel", {"panel_type": panel_type}
        )
    if action == "fullscreen":
        if panel_type is None:
            return (
                "Acción no válida para ui.panel: fullscreen necesita "
                "'panel_type'."
            )
        return await _delegate(
            tctx, "ui.set_fullscreen", {"panel_type": panel_type}
        )
    if action == "restore":
        return await _delegate(tctx, "ui.restore_layout", {})
    return f"Acción no válida para ui.panel: {action!r}."


# --------------------------------------------------------------------- #
# document.manage
# --------------------------------------------------------------------- #

DOCUMENT_MANAGE_DESCRIPTION = (
    "Manage documents: create, open, list, search, save, insert_text, undo, "
    "redo. Call list or search before open to see what exists; create opens "
    "the editor. create requires title; open requires an existing title; list "
    "shows all saved documents; search filters by title fragment (query "
    "required); save writes content to disk (title and content required — also "
    "creates the document if missing); insert_text appends text to the "
    "document (title and text required); undo and redo act on the editor's own "
    "buttons. Results are in Spanish; pass them through unchanged."
)


async def document_manage(
    tctx: ToolContext,
    action: Literal[
        "create", "open", "list", "search", "save", "insert_text", "undo", "redo"
    ],
    title: Optional[str] = None,
    query: Optional[str] = None,
    content: Optional[str] = None,
    text: Optional[str] = None,
) -> str:
    if action == "create":
        if not title:
            return "Acción no válida para document.manage: create necesita 'title'."
        return await _delegate(tctx, "document.create", {"title": title})
    if action == "open":
        if not title:
            return "Acción no válida para document.manage: open necesita 'title'."
        return await _delegate(tctx, "document.open", {"title": title})
    if action == "list":
        return await _delegate(tctx, "document.list", {})
    if action == "search":
        if not query:
            return "Acción no válida para document.manage: search necesita 'query'."
        return await _delegate(tctx, "document.search", {"query": query})
    if action == "save":
        if not title or content is None:
            return (
                "Acción no válida para document.manage: save necesita "
                "'title' y 'content'."
            )
        return await _delegate(
            tctx, "document.save", {"title": title, "content": content}
        )
    if action == "insert_text":
        if not title or not text:
            return (
                "Acción no válida para document.manage: insert_text necesita "
                "'title' y 'text'."
            )
        return await _delegate(
            tctx, "document.insert_text", {"title": title, "text": text}
        )
    if action == "undo":
        return await _delegate(tctx, "document.undo", {})
    if action == "redo":
        return await _delegate(tctx, "document.redo", {})
    return f"Acción no válida para document.manage: {action!r}."


# --------------------------------------------------------------------- #
# library.read
# --------------------------------------------------------------------- #

LIBRARY_READ_DESCRIPTION = (
    "Read the local book library. Call scan or search before open to see what "
    "exists; search filters by title (query required). open requires book (a "
    "library title) and restores the saved position; continue_reading reopens "
    "the last book at its saved position; get_position returns a book's saved "
    "section/progress; set_position saves it (book, section and progress all "
    "required); read_selection returns the current section's text; "
    "read_next_section advances and returns the next section. Empty results mean "
    "nothing was found — say so. Results are in Spanish; pass them through "
    "unchanged."
)


async def library_read(
    tctx: ToolContext,
    action: Literal[
        "scan",
        "search",
        "open",
        "continue_reading",
        "get_position",
        "set_position",
        "read_selection",
        "read_next_section",
    ],
    book: Optional[str] = None,
    query: Optional[str] = None,
    section: Optional[int] = None,
    progress: Optional[float] = None,
) -> str:
    if action == "scan":
        return await _delegate(tctx, "library.scan", {})
    if action == "search":
        if not query:
            return "Acción no válida para library.read: search necesita 'query'."
        return await _delegate(tctx, "library.search", {"query": query})
    if action == "continue_reading":
        return await _delegate(tctx, "library.continue_reading", {})
    if action == "open":
        if not book:
            return "Acción no válida para library.read: open necesita 'book'."
        # the hidden library.open takes the book title as ``title``
        return await _delegate(tctx, "library.open", {"title": book})
    if action == "get_position":
        if not book:
            return (
                "Acción no válida para library.read: get_position necesita "
                "'book'."
            )
        return await _delegate(tctx, "library.get_position", {"book": book})
    if action == "set_position":
        if not book or section is None or progress is None:
            return (
                "Acción no válida para library.read: set_position necesita "
                "'book', 'section' y 'progress'."
            )
        return await _delegate(
            tctx,
            "library.set_position",
            {"book": book, "section": section, "progress": progress},
        )
    if action == "read_selection":
        if not book:
            return (
                "Acción no válida para library.read: read_selection necesita "
                "'book'."
            )
        return await _delegate(tctx, "library.read_selection", {"book": book})
    if action == "read_next_section":
        if not book:
            return (
                "Acción no válida para library.read: read_next_section "
                "necesita 'book'."
            )
        return await _delegate(
            tctx, "library.read_next_section", {"book": book}
        )
    return f"Acción no válida para library.read: {action!r}."


# --------------------------------------------------------------------- #
# notes.manage
# --------------------------------------------------------------------- #

NOTES_MANAGE_DESCRIPTION = (
    "Save and retrieve quick notes: add, search, today. action=add saves a "
    "note (text required; tags optional suggestions; the original text is "
    "never edited); action=search finds notes by keyword (query required); "
    "action=today lists today's notes. Facts the user wants remembered belong "
    "in notes: save them with add and recall them with memory.search or "
    "notes.manage action=search. Results are in Spanish; pass them through "
    "unchanged."
)


async def notes_manage(
    tctx: ToolContext,
    action: Literal["add", "search", "today"],
    text: Optional[str] = None,
    query: Optional[str] = None,
    tags: Optional[list[str]] = None,
) -> str:
    if action == "add":
        if not text:
            return "Acción no válida para notes.manage: add necesita 'text'."
        args: dict = {"text": text}
        if tags is not None:
            args["tags"] = tags
        return await _delegate(tctx, "notes.add", args)
    if action == "search":
        if not query:
            return "Acción no válida para notes.manage: search necesita 'query'."
        return await _delegate(tctx, "notes.search", {"query": query})
    if action == "today":
        return await _delegate(tctx, "notes.today", {})
    return f"Acción no válida para notes.manage: {action!r}."


# --------------------------------------------------------------------- #
# tasks.manage
# --------------------------------------------------------------------- #

TASKS_MANAGE_DESCRIPTION = (
    "Manage the to-do list: add, list, complete. action=add requires title "
    "(due_at optional, ISO datetime); action=list shows tasks, optionally "
    "filtered by status ('pending' or 'done'); action=complete marks a task "
    "done by task_id — the numeric id from list output, so list first when ids "
    "may have changed. Keep answers short: one add per task the user names. "
    "Results are in Spanish; pass them through unchanged."
)


async def tasks_manage(
    tctx: ToolContext,
    action: Literal["add", "list", "complete"],
    title: Optional[str] = None,
    due_at: Optional[str] = None,
    status: Optional[str] = None,
    task_id: Optional[str] = None,
) -> str:
    if action == "add":
        if not title:
            return "Acción no válida para tasks.manage: add necesita 'title'."
        args: dict = {"title": title}
        if due_at is not None:
            args["due_at"] = due_at
        return await _delegate(tctx, "tasks.add", args)
    if action == "list":
        args: dict = {}
        if status is not None:
            args["status"] = status
        return await _delegate(tctx, "tasks.list", args)
    if action == "complete":
        if not task_id:
            return (
                "Acción no válida para tasks.manage: complete necesita "
                "'task_id'."
            )
        try:
            return await _delegate(
                tctx, "tasks.complete", {"task_id": int(task_id)}
            )
        except ValueError:
            return (
                "Acción no válida para tasks.manage: 'task_id' debe ser un "
                "número."
            )
    return f"Acción no válida para tasks.manage: {action!r}."


# --------------------------------------------------------------------- #
# reminders.manage
# --------------------------------------------------------------------- #

REMINDERS_MANAGE_DESCRIPTION = (
    "Schedule and manage reminders: create, list, cancel. action=create "
    "requires text and due_at (ISO format, e.g. 2026-08-06T08:00:00; "
    "repeat_rule optional: none, daily, weekly) and goes through the "
    "confirmation flow — the user sees the exact date and text before it is "
    "scheduled; if the result starts with PENDING_APPROVAL, say what is "
    "waiting and end your turn. action=list shows active reminders; "
    "action=cancel removes one by reminder_id (numeric id). Results are in "
    "Spanish; pass them through unchanged."
)


async def reminders_manage(
    tctx: ToolContext,
    action: Literal["create", "list", "cancel"],
    text: Optional[str] = None,
    due_at: Optional[str] = None,
    repeat_rule: Optional[str] = None,
    reminder_id: Optional[str] = None,
) -> str:
    if action == "create":
        if not text or not due_at:
            return (
                "Acción no válida para reminders.manage: create necesita "
                "'text' y 'due_at'."
            )
        args: dict = {"text": text, "due_at": due_at}
        if repeat_rule is not None:
            args["repeat_rule"] = repeat_rule
        return await _delegate(tctx, "reminders.create", args)
    if action == "list":
        return await _delegate(tctx, "reminders.list", {})
    if action == "cancel":
        if not reminder_id:
            return (
                "Acción no válida para reminders.manage: cancel necesita "
                "'reminder_id'."
            )
        try:
            return await _delegate(
                tctx, "reminders.cancel", {"reminder_id": int(reminder_id)}
            )
        except ValueError:
            return (
                "Acción no válida para reminders.manage: 'reminder_id' debe "
                "ser un número."
            )
    return f"Acción no válida para reminders.manage: {action!r}."


# --------------------------------------------------------------------- #
# media.search
# --------------------------------------------------------------------- #

MEDIA_SEARCH_DESCRIPTION = (
    "Search media to offer the user: source=youtube searches YouTube by topic "
    "or creator; source=local searches the local music library (mp3, m4a, wav, "
    "ogg, flac). Returns a JSON list of real result cards with ids (youtube) "
    "or local_paths (local). An empty list means nothing was found — tell the "
    "user you found nothing, never invent results. Then play with media.play, "
    "passing the result's id or local_path. Results are in Spanish; pass them "
    "through unchanged."
)


async def media_search(
    tctx: ToolContext,
    source: Literal["youtube", "local"],
    query: str,
) -> str:
    hidden = "media.search_youtube" if source == "youtube" else "media.search_local"
    return await _delegate(tctx, hidden, {"query": query})


# --------------------------------------------------------------------- #
# media.play
# --------------------------------------------------------------------- #

MEDIA_PLAY_DESCRIPTION = (
    "Play media the search just offered. Pass exactly ONE of: result_id (a "
    "YouTube result id from media.search) or local_path (a file path from a "
    "local search result) — both or neither is an error. Only what the search "
    "really offered can be played; never invent ids or paths. Compose the "
    "media surface BEFORE playing: if media is composed after play, the mount "
    "gate may drop it from the layout (silent dock-only playback). Results are "
    "in Spanish; pass them through unchanged."
)


async def media_play(
    tctx: ToolContext,
    result_id: Optional[str] = None,
    local_path: Optional[str] = None,
) -> str:
    if result_id is not None and local_path is not None:
        return (
            "Acción no válida para media.play: pasa 'result_id' o "
            "'local_path', no ambos."
        )
    if result_id is not None:
        hidden = _play_by_result_hidden(getattr(tctx.deps, "registry", None))
        return await _delegate(tctx, hidden, {"result_id": result_id})
    if local_path is not None:
        return await _delegate(
            tctx, "media.play_local", {"local_path": local_path}
        )
    return (
        "Acción no válida para media.play: pasa 'result_id' o 'local_path'."
    )


# --------------------------------------------------------------------- #
# media.control
# --------------------------------------------------------------------- #

MEDIA_CONTROL_DESCRIPTION = (
    "Control what is playing: pause, resume, stop, seek, set_volume. "
    "pause/resume/stop need no extra arguments; seek requires seconds "
    "(position from the start, clamped to 0); set_volume requires volume (0.0 "
    "to 1.0). When nothing is loaded, seek says so honestly. Compose the media "
    "surface BEFORE controlling playback if it is not already visible — media "
    "composed after play may be dropped to the dock. Results are in Spanish; "
    "pass them through unchanged."
)


async def media_control(
    tctx: ToolContext,
    action: Literal["pause", "resume", "stop", "seek", "set_volume"],
    seconds: Optional[int] = None,
    volume: Optional[float] = None,
) -> str:
    if action in ("pause", "resume", "stop"):
        return await _delegate(tctx, f"media.{action}", {})
    if action == "seek":
        if seconds is None:
            return (
                "Acción no válida para media.control: seek necesita "
                "'seconds'."
            )
        return await _delegate(tctx, "media.seek", {"seconds": seconds})
    if action == "set_volume":
        if volume is None:
            return (
                "Acción no válida para media.control: set_volume necesita "
                "'volume'."
            )
        return await _delegate(tctx, "media.set_volume", {"volume": volume})
    return f"Acción no válida para media.control: {action!r}."


# --------------------------------------------------------------------- #
# telegram.message
# --------------------------------------------------------------------- #

TELEGRAM_MESSAGE_DESCRIPTION = (
    "Send a message to the single approved recipient. action=prepare shows "
    "the exact text on screen, reads it back, and requests confirmation — it "
    "returns PENDING_APPROVAL and nothing is sent until the user confirms. "
    "action=send performs the send step; it also goes through the "
    "confirmation gate (returns PENDING_APPROVAL while the user confirms) — "
    "never call send unless the user has explicitly asked to send. When a "
    "result starts with PENDING_APPROVAL, say what is waiting and end your "
    "turn. There is exactly one approved contact; you never choose recipients. "
    "Results are in Spanish."
)


async def telegram_message(
    tctx: ToolContext,
    action: Literal["prepare", "send"],
    text: str,
) -> str:
    hidden = "telegram.prepare_message" if action == "prepare" else "telegram.send_pending"
    return await _delegate(tctx, hidden, {"text": text})


# --------------------------------------------------------------------- #
SPECS: list[ToolSpec] = [
    spec("app.state", APP_STATE_DESCRIPTION, app_state, PolicyKind.REVERSIBLE),
    spec("ui.panel", UI_PANEL_DESCRIPTION, ui_panel, PolicyKind.REVERSIBLE),
    spec(
        "document.manage",
        DOCUMENT_MANAGE_DESCRIPTION,
        document_manage,
        PolicyKind.REVERSIBLE,
    ),
    spec(
        "library.read",
        LIBRARY_READ_DESCRIPTION,
        library_read,
        PolicyKind.REVERSIBLE,
    ),
    spec(
        "notes.manage",
        NOTES_MANAGE_DESCRIPTION,
        notes_manage,
        PolicyKind.REVERSIBLE,
    ),
    spec(
        "tasks.manage",
        TASKS_MANAGE_DESCRIPTION,
        tasks_manage,
        PolicyKind.REVERSIBLE,
    ),
    spec(
        "reminders.manage",
        REMINDERS_MANAGE_DESCRIPTION,
        reminders_manage,
        PolicyKind.REVERSIBLE,
    ),
    spec(
        "media.search",
        MEDIA_SEARCH_DESCRIPTION,
        media_search,
        PolicyKind.READ_ONLY,
    ),
    spec("media.play", MEDIA_PLAY_DESCRIPTION, media_play, PolicyKind.REVERSIBLE),
    spec(
        "media.control",
        MEDIA_CONTROL_DESCRIPTION,
        media_control,
        PolicyKind.REVERSIBLE,
    ),
    spec(
        "telegram.message",
        TELEGRAM_MESSAGE_DESCRIPTION,
        telegram_message,
        PolicyKind.REVERSIBLE,
        effect="emission",
    ),
]
