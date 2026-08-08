"""Notes and tasks tools. The agent can suggest tags but never edits the
original note content."""

import json

from arsvox_agent.tools.context import ToolContext


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


async def memory_remember(tctx: ToolContext, key: str, value: str) -> str:
    tctx.deps.preferences.set(f"memory:{key}", value)
    tctx.deps.audit.log("memory", "remember", {"key": key})
    return f"Recordado: {key}."


async def memory_recall(tctx: ToolContext, key: str) -> str:
    value = tctx.deps.preferences.get(f"memory:{key}")
    if value is None:
        return f"No tengo nada guardado como '{key}'."
    return json.dumps({key: value}, ensure_ascii=False)


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec(
        "notes.add",
        "Save a quick note. tags are optional suggestions; the original text is never edited.",
        notes_add,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec("notes.search", "Search saved notes by keyword.", notes_search, PolicyKind.READ_ONLY),
    ToolSpec("notes.today", "List today's notes.", notes_today, PolicyKind.READ_ONLY),
    ToolSpec(
        "tasks.add",
        "Add a task to the to-do list. due_at is an optional ISO datetime.",
        tasks_add,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec("tasks.list", "List tasks; status is optional ('pending' or 'done').", tasks_list, PolicyKind.READ_ONLY),
    ToolSpec("tasks.complete", "Mark a task as done by id.", tasks_complete, PolicyKind.REVERSIBLE),
    ToolSpec("memory.remember", "Store a small durable fact (key/value).", memory_remember, PolicyKind.REVERSIBLE),
    ToolSpec("memory.recall", "Recall a stored fact by key.", memory_recall, PolicyKind.READ_ONLY),
]
