"""Notes and tasks tools. The agent can suggest tags but never edits the
original note content.

GATE-5 (W1-MEMORY): memory.remember / memory.recall are RETIRED — the
exact-key k/v path against PreferenceStore with a "memory:" prefix was a
second memory authority the model could only reach by guessing keys
(charter finding). Recall is now memory.search (arsvox_memory FTS over
notes + turns, tools/memory_tools.py); the k/v write path survives only
as the demoted preferences.set there (explicit preference-setting, no
"memory:" prefix).
"""

from arsvox_agent.tools.context import ToolContext
from arsvox_contracts import PanelType
from arsvox_contracts.commands import PanelOpen
from arsvox_contracts.events import ReminderItem, TasksUpdateEvent, TodoItem, UiCommandEvent


async def _emit_tasks_update(tctx: ToolContext) -> None:
    """Emit the tasks.update wire event so a composed tasks panel has
    real content (R5 2026-08-14, reviewer round 5 finding 3: tasks.add
    never emitted content — the panel, when it finally composed, was
    empty and the claim "ya lo ves en el panel" was a lie)."""
    todos = [
        TodoItem(id=str(t["id"]), title=t["title"], done=t["status"] == "done")
        for t in tctx.deps.tasks.list()
    ]
    reminders = [
        ReminderItem(
            id=str(r["id"]),
            title=r.get("text") or r.get("title") or "",
            cadence=r.get("repeat_rule", "none"),
            next_fire=r.get("due_at") or "",
        )
        for r in tctx.deps.reminders.list_active()
    ]
    await tctx.emit(TasksUpdateEvent(todos=todos, reminders=reminders))


async def notes_add(tctx: ToolContext, text: str, tags: list[str] | None = None) -> str:
    note_id = tctx.deps.notes.add(text, tags=tags, source="voice")
    tctx.deps.audit.log("notes", "add", {"note_id": note_id})
    return f"Nota guardada (#{note_id})."


async def notes_search(tctx: ToolContext, query: str) -> str:
    hits = tctx.deps.notes.search(query)
    if not hits:
        return f"No encontré notas sobre '{query}'."
    lines = [f"{n['id']}. {n['text'][:120]}" for n in hits[:8]]
    return "\n".join(lines)


async def notes_today(tctx: ToolContext) -> str:
    hits = tctx.deps.notes.today()
    if not hits:
        return "No tienes notas de hoy."
    lines = [f"{n['id']}. {n['text'][:120]}" for n in hits[:10]]
    return "\n".join(lines)


async def tasks_add(tctx: ToolContext, title: str, due_at: str | None = None) -> str:
    task_id = tctx.deps.tasks.add(title, due_at=due_at)
    tctx.deps.audit.log("tasks", "add", {"task_id": task_id, "title": title})
    # R6 (2026-08-14, reviewer round 6 finding 2): the tasks panel must
    # OPEN as part of adding a task — the model may claim "ya la tenés en
    # el panel" without ever emitting panel.open (prompt rules are weakly
    # binding; the panel is not). Every other surface-opening tool emits
    # its own panel.open; tasks_add must too.
    await tctx.emit(
        UiCommandEvent(
            command=PanelOpen(
                panel_type=PanelType.TASKS,
                title="Tareas",
                content_reference=str(task_id),
            )
        )
    )
    await _emit_tasks_update(tctx)
    return f"Tarea agregada: {title} (#{task_id})."


async def tasks_list(tctx: ToolContext, status: str | None = None) -> str:
    tasks = tctx.deps.tasks.list(status=status)
    if not tasks:
        return "No hay tareas pendientes." if status != "done" else "No hay tareas terminadas."
    lines = [
        f"{'[x]' if t['status'] == 'done' else '[ ]'} #{t['id']} {t['title']}"
        + (f" (para {t['due_at']})" if t["due_at"] else "")
        for t in tasks[:15]
    ]
    return "\n".join(lines)


async def tasks_complete(tctx: ToolContext, task_id: int) -> str:
    if tctx.deps.tasks.complete(task_id):
        tctx.deps.audit.log("tasks", "complete", {"task_id": task_id})
        return f"Tarea #{task_id} terminada."
    return f"No encontré la tarea #{task_id} pendiente."


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec(
        "notes.add",
        "Save a quick note. tags are optional suggestions; the original text is never edited.",
        notes_add,
        PolicyKind.REVERSIBLE,
        effect="revertible",
    ),
    ToolSpec("notes.search", "Search saved notes by keyword.", notes_search, PolicyKind.READ_ONLY, effect="revertible"),
    ToolSpec("notes.today", "List today's notes.", notes_today, PolicyKind.READ_ONLY, effect="revertible"),
    ToolSpec(
        "tasks.add",
        "Add a task to the to-do list. due_at is an optional ISO datetime.",
        tasks_add,
        PolicyKind.REVERSIBLE,
        effect="revertible",
    ),
    ToolSpec("tasks.list", "List tasks; status is optional ('pending' or 'done').", tasks_list, PolicyKind.READ_ONLY, effect="revertible"),
    ToolSpec("tasks.complete", "Mark a task as done by id.", tasks_complete, PolicyKind.REVERSIBLE, effect="revertible"),
]
