"""Memory tools: the agent reaches the authoritative memory.

GATE-5 (W1-MEMORY): arsvox_memory (SQLite + FTS5) is the ONE memory
authority. ``memory.search`` runs search_all() (notes + conversation
turns) against ``Deps.db`` — the Database that already existed in Deps
and was unused by tools — and routes the hits through the frozen
``memory.search_results`` wire member.

The exact-key k/v path (memory.remember / memory.recall against the
PreferenceStore with a ``memory:`` prefix) is RETIRED. The k/v table
stays only as the preference store, reachable through the demoted
``preferences.set`` (explicit preference-setting, no memory prefix).
"""

import json
import re
import sqlite3

from arsvox_contracts import MemoryResult, MemorySearchResultsEvent, PolicyKind
from arsvox_memory import search_all

from arsvox_agent.tools import ToolSpec
from arsvox_agent.tools.context import ToolContext

_MAX_LIMIT = 50
_WORD_RE = re.compile(r"\w+", re.UNICODE)


def _fts_safe(query: str) -> str:
    """Rebuild a malformed MATCH expression as per-word phrase ANDs.

    search_all() passes the raw query straight into FTS5 MATCH, so
    natural-language input (punctuation, dangling operators) can raise
    OperationalError. Fall back to phrase-quoting each word — a real,
    stricter FTS query, never a fake result set.
    """
    return " ".join(f'"{w}"' for w in _WORD_RE.findall(query))


async def memory_search(tctx: ToolContext, query: str, limit: int = 10) -> str:
    """FTS recall over the authoritative memory: notes + conversation turns.

    Emits the hits on the frozen memory.search_results wire member so the
    recall is visible, and returns them as JSON for the model.
    """
    limit = max(1, min(int(limit), _MAX_LIMIT))
    query = (query or "").strip()
    if not query:
        await tctx.emit(MemorySearchResultsEvent(query=query, results=[]))
        return "No encontré nada."
    try:
        hits = search_all(tctx.deps.db, query, limit=limit)
    except sqlite3.OperationalError:
        safe = _fts_safe(query)
        hits = search_all(tctx.deps.db, safe, limit=limit) if safe else {"notes": [], "turns": []}
    results = [
        MemoryResult(
            id=f"note:{row['id']}",
            kind="note",
            text=row["text"],
            created_at=row["created_at"],
            source="note",
        )
        for row in hits["notes"]
    ]
    results += [
        MemoryResult(
            id=f"turn:{row['session_id']}:{idx}",
            kind="conversation",
            text=row["text"],
            source=row["role"],
        )
        for idx, row in enumerate(hits["turns"])
    ]
    await tctx.emit(MemorySearchResultsEvent(query=query, results=results))
    if not results:
        return f"No encontré nada sobre '{query}'."
    return json.dumps([r.model_dump() for r in results], ensure_ascii=False)


async def preferences_set(tctx: ToolContext, key: str, value: str) -> str:
    """Save an explicit user preference (key/value) in the PreferenceStore.

    Demoted successor of the retired memory.remember: the k/v path is
    explicit preference-setting only — the ``memory:`` prefix misuse is
    rejected, and facts belong in notes (notes.add) recalled via
    memory.search.
    """
    # TODO(gate5-w1-memory, delete-when: PreferenceStore gains a user-facing
    # preference surface or the context memory section no longer reads it —
    # until then this demoted k/v path is explicit preference-setting, never
    # a memory authority (the "memory:" prefix retired at W1).
    key = (key or "").strip()
    if not key:
        return "Necesito un nombre para la preferencia."
    if key.startswith("memory:"):
        return (
            "Eso es memoria, no una preferencia: guarda los hechos con "
            "notes.add y recupéralos con memory.search."
        )
    tctx.deps.preferences.set(key, value)
    tctx.deps.audit.log("preferences", "set", {"key": key})
    return f"Preferencia guardada: {key}."


# --------------------------------------------------------------------- #
SPECS = [
    ToolSpec(
        "memory.search",
        "Search the authoritative memory (notes and past conversation "
        "turns) with a natural query — not an exact key. Use it to recall "
        "what the user said or prefers before shaping searches.",
        memory_search,
        PolicyKind.READ_ONLY,
    ),
    ToolSpec(
        "preferences.set",
        "Save an explicit user preference (key/value). Preferences are not "
        "memory: use notes.add for facts and memory.search to recall them.",
        preferences_set,
        PolicyKind.REVERSIBLE,
    ),
]
