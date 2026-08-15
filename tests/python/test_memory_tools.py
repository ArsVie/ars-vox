"""GATE-5 W1-MEMORY: the agent reaches the authoritative memory.

Covers the charter fix end to end on a real tmp SQLite db:
  * memory.search runs arsvox_memory.search_all (notes + turns) through
    Deps.db and routes the hits through the frozen memory.search_results
    wire member;
  * memory.remember / memory.recall are retired (not registered, denied
    by policy) and the k/v path survives only as the demoted
    preferences.set — explicit preference-setting, no "memory:" prefix;
  * PreferenceStore still works for its real purpose;
  * the context builder's memory section embeds recalled preferences
    (and never re-embeds retired "memory:" keys).
"""

import asyncio
import json

from arsvox_contracts import AppConfig
from arsvox_contracts.events import MemorySearchResultsEvent

from arsvox_memory import Database
from arsvox_memory.repos import (
    AuditStore,
    NoteStore,
    PanelStore,
    PendingStore,
    PreferenceStore,
    ReminderStore,
    SessionStore,
)

from arsvox_agent.context import build_context
from arsvox_agent.deps import Deps
from arsvox_agent.policy import PolicyEngine
from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools import memory_tools, notes_tasks_tools
from arsvox_agent.tools.context import ToolContext


class _CaptureBus:
    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


def _make_deps(tmp_path, with_session: bool = True) -> tuple[Deps, _CaptureBus, str]:
    db = Database(tmp_path / "mem.db")
    bus = _CaptureBus()
    notes = NoteStore(db)
    sessions = SessionStore(db)
    sid = ""
    if with_session:
        sid = sessions.create()
        sessions.append_turn(sid, "user", "me gusta el jazz de Miles Davis")
        sessions.append_turn(sid, "assistant", "anotado")
    deps = Deps(
        config=AppConfig(),
        db=db,
        sessions=sessions,
        notes=notes,
        tasks=None,
        reminders=ReminderStore(db),
        notifications=None,
        panels=PanelStore(db),
        preferences=PreferenceStore(db),
        progress=None,
        pending=PendingStore(db),
        documents=None,
        audit=AuditStore(db),
        bus=bus,  # type: ignore[arg-type]
        policy=None,
        confirmations=None,
        tts=None,
        telegram=None,
        run_id="run-1",
        session_id=sid,
    )
    return deps, bus, sid


def _tctx(deps: Deps, bus: _CaptureBus) -> ToolContext:
    return ToolContext(deps=deps, run_id=deps.run_id, session_id=deps.session_id, bus=bus)


# --------------------------------------------------------------------- #
# memory.search — the authoritative recall tool
# --------------------------------------------------------------------- #


def test_memory_search_returns_ranked_hits_and_emits_event(tmp_path):
    deps, bus, sid = _make_deps(tmp_path)
    deps.notes.add("A mi hijo le gusta el jazz", tags=["preferencia"])
    deps.notes.add("Comprar leche y pan")

    result = asyncio.run(memory_tools.memory_search(_tctx(deps, bus), "jazz", limit=10))

    payload = json.loads(result)
    texts = [r["text"] for r in payload]
    assert any("jazz" in t for t in texts)
    assert any("Miles Davis" in t for t in texts)

    # The frozen wire member carries the recall.
    emitted = [e for e in bus.events if isinstance(e, MemorySearchResultsEvent)]
    assert len(emitted) == 1
    event = emitted[0]
    assert event.query == "jazz"
    kinds = {r.kind for r in event.results}
    assert kinds == {"note", "conversation"}
    note = next(r for r in event.results if r.kind == "note")
    assert note.id.startswith("note:") and note.created_at
    turn = next(r for r in event.results if r.kind == "conversation")
    assert turn.id.startswith("turn:") and turn.source == "user"


def test_memory_search_malformed_query_falls_back_to_phrase_query(tmp_path):
    deps, bus, _ = _make_deps(tmp_path)
    deps.notes.add("Comprar leche y pan")

    # "leche OR" is not valid FTS5 MATCH syntax; the tool must not crash
    # and must still find the note through the phrase fallback.
    result = asyncio.run(memory_tools.memory_search(_tctx(deps, bus), "leche OR", limit=10))
    assert "leche" in result


def test_memory_search_empty_query_is_honest(tmp_path):
    deps, bus, _ = _make_deps(tmp_path)
    result = asyncio.run(memory_tools.memory_search(_tctx(deps, bus), "   ", limit=10))
    assert result == "No encontré nada."
    emitted = [e for e in bus.events if isinstance(e, MemorySearchResultsEvent)]
    assert len(emitted) == 1 and emitted[0].results == []


# --------------------------------------------------------------------- #
# Retirement: memory.remember / memory.recall
# --------------------------------------------------------------------- #


def test_kv_memory_tools_retired_from_registry_and_policy():
    registry = ToolRegistry()
    for spec in notes_tasks_tools.SPECS:
        registry.register(spec)
    for spec in memory_tools.SPECS:
        registry.register(spec)
    assert registry.get("memory.remember") is None
    assert registry.get("memory.recall") is None
    assert registry.get("memory.search") is not None
    assert registry.get("preferences.set") is not None

    engine = PolicyEngine()
    assert not engine.decide("memory.recall", {"key": "x"}).allowed
    assert not engine.decide("memory.remember", {"key": "x", "value": "y"}).allowed
    assert engine.decide("memory.search", {"query": "jazz"}).allowed
    assert engine.decide("preferences.set", {"key": "fav_genre", "value": "jazz"}).allowed


def test_notes_tasks_specs_no_longer_carry_memory():
    names = {s.name for s in notes_tasks_tools.SPECS}
    assert "memory.remember" not in names
    assert "memory.recall" not in names


# --------------------------------------------------------------------- #
# preferences.set — the demoted k/v path (explicit preference-setting)
# --------------------------------------------------------------------- #


def test_preferences_set_demoted_path(tmp_path):
    deps, bus, _ = _make_deps(tmp_path)
    result = asyncio.run(
        memory_tools.preferences_set(_tctx(deps, bus), "fav_genre", "jazz")
    )
    assert "Preferencia guardada" in result
    # Written as a real preference key — no "memory:" prefix anywhere.
    assert deps.preferences.get("fav_genre") == "jazz"
    assert deps.preferences.get("memory:fav_genre") is None
    rows = deps.db.rows("SELECT key FROM preferences")
    assert all(not r["key"].startswith("memory:") for r in rows)
    # Write path is audited.
    audit = deps.db.rows("SELECT * FROM audit_events WHERE category = 'preferences'")
    assert audit and audit[0]["action"] == "set"


def test_preferences_set_rejects_memory_prefix(tmp_path):
    deps, bus, _ = _make_deps(tmp_path)
    result = asyncio.run(
        memory_tools.preferences_set(_tctx(deps, bus), "memory:foo", "bar")
    )
    assert "memoria" in result
    assert deps.preferences.get("memory:foo") is None


def test_preference_store_still_works_for_its_real_purpose(tmp_path):
    deps, _, _ = _make_deps(tmp_path)
    deps.preferences.set("volume", 0.7)
    deps.preferences.set("fav_genre", "jazz")
    assert deps.preferences.get("volume") == 0.7
    assert deps.preferences.get("fav_genre") == "jazz"
    assert deps.preferences.get("missing", "default") == "default"


# --------------------------------------------------------------------- #
# Context memory section — the query-shaping seam
# --------------------------------------------------------------------- #


def test_now_line_uses_anchored_tz():
    """R16 (2026-08-14, reviewer round 16 finding): the hour the model
    reports must match the USER's clock (the tz the browser declared via
    client.info), not the backend's system zone."""
    from datetime import datetime

    from zoneinfo import ZoneInfo

    from arsvox_agent.context import now_line

    mazatlan = ZoneInfo("America/Mazatlan")
    line = now_line(mazatlan)
    # The wall-clock hour must equal America/Mazatlan's, not the system's.
    wall = datetime.now(mazatlan)
    assert wall.strftime("%H:%M") in line, line
    assert "America/Mazatlan" in line or wall.tzname() in line, line


def test_context_memory_section_embeds_recalled_preferences(tmp_path):
    deps, _, _ = _make_deps(tmp_path)
    deps.preferences.set("fav_genre", "jazz")
    # Legacy retired-authority data must never be re-embedded.
    deps.preferences.set("memory:old_fact", "invisible")

    text = build_context(deps.config, deps)
    assert "Preferencias recordadas:" in text
    assert "fav_genre: jazz" in text
    assert "old_fact" not in text


def test_context_memory_section_omitted_without_preferences(tmp_path):
    deps, _, _ = _make_deps(tmp_path)
    text = build_context(deps.config, deps)
    assert "Preferencias recordadas" not in text
