"""Memory repos: notes FTS search, tasks, reminders, pending, documents."""

from datetime import datetime, timedelta, timezone

from arsvox_memory import Database, search_all
from arsvox_memory.repos import (
    DocumentStore,
    NoteStore,
    PendingStore,
    ProgressStore,
    ReminderStore,
    SessionStore,
    TaskStore,
)


def _make_db(tmp_path):
    return Database(tmp_path / "mem.db")


def test_migrations_idempotent(tmp_path):
    db1 = _make_db(tmp_path)
    version = db1.scalar("SELECT MAX(version) FROM schema_version")
    db1.close()
    db2 = _make_db(tmp_path)
    assert db2.scalar("SELECT MAX(version) FROM schema_version") == version
    db2.close()


def test_notes_fts_search(tmp_path):
    db = _make_db(tmp_path)
    store = NoteStore(db)
    store.add("El médico se llama Roberto", tags=["salud"])
    store.add("Comprar leche y pan")
    hits = store.search("médico")
    assert len(hits) == 1
    assert "Roberto" in hits[0]["text"]
    assert hits[0]["tags"] == ["salud"]
    assert search_all(db, "leche")["notes"]
    assert search_all(db, "leche")["turns"] == []


def test_sessions_fts(tmp_path):
    db = _make_db(tmp_path)
    store = SessionStore(db)
    sid = store.create()
    store.append_turn(sid, "user", "quiero abrir youtube")
    store.append_turn(sid, "assistant", "listo")
    assert len(store.recent_turns(sid)) == 2
    assert store.get(sid)["turn_count"] == 2
    found = store.search("youtube")
    assert len(found) == 1
    assert found[0]["session"]["id"] == sid


def test_tasks_flow(tmp_path):
    db = _make_db(tmp_path)
    store = TaskStore(db)
    tid = store.add("Llamar al médico", due_at="2026-08-07T09:00:00")
    assert store.complete(tid)
    assert not store.complete(tid)
    assert store.list(status="done")[0]["id"] == tid


def test_reminders_due_and_repeat(tmp_path):
    db = _make_db(tmp_path)
    store = ReminderStore(db)
    now = datetime.now(timezone.utc)
    past = (now - timedelta(seconds=5)).isoformat(timespec="seconds")
    rid = store.create("Tomar medicina", past, repeat_rule="daily")
    due = store.due(now.isoformat(timespec="seconds"))
    assert any(r["id"] == rid for r in due)
    store.mark_fired(rid, now.isoformat(timespec="seconds"))
    # recurring stays active with a future due_at
    row = store.get(rid)
    assert row["status"] == "active"
    assert row["due_at"] > now.isoformat(timespec="seconds")
    assert store.occurrences(rid)[0]["status"] == "fired"
    # one-shot goes to fired
    rid2 = store.create("Una vez", past)
    store.mark_fired(rid2, now.isoformat(timespec="seconds"))
    assert store.get(rid2)["status"] == "fired"
    assert store.cancel(rid)
    assert not store.cancel(rid)


def test_pending_expiry_and_supersede(tmp_path):
    db = _make_db(tmp_path)
    store = PendingStore(db)
    now = datetime.now(timezone.utc)
    pid = store.create("r1", "telegram.send_pending", {"text": "a"},
                       "Enviar", "detalle", (now + timedelta(seconds=30)).isoformat(timespec="seconds"))
    assert store.get(pid)["args"] == {"text": "a"}
    store.supersede_tool("telegram.send_pending")
    assert store.get(pid)["status"] == "superseded"
    old = store.create("r2", "notes.add", {}, "x", "y",
                       (now - timedelta(seconds=1)).isoformat(timespec="seconds"))
    assert store.expire_stale(now.isoformat(timespec="seconds")) == [old]
    assert store.get(old)["status"] == "expired"


def test_documents(tmp_path):
    db = _make_db(tmp_path)
    store = DocumentStore(db)
    did = store.create("Lista", str(tmp_path / "lista.md"))
    store.update_content(did, "leche", saved=True)
    assert store.get(did)["content_hash"]
    store.update_content(did, "texto sin guardar", saved=False)
    assert store.get(did)["unsaved_json"] == "texto sin guardar"


def test_progress(tmp_path):
    db = _make_db(tmp_path)
    store = ProgressStore(db)
    store.set("book", "don-quijote", {"section": 3, "progress": 0.5})
    assert store.get("book", "don-quijote")["section"] == 3
    assert store.latest("book")["ref_id"] == "don-quijote"


def test_panels_clear_all_fresh_desk(tmp_path):
    """GATE-3.5: panels survive reconnects but NOT service restarts —
    boot-time clear_all() restores the central-mic default."""
    db = _make_db(tmp_path)
    from arsvox_memory.repos import PanelStore
    store = PanelStore(db)
    store.upsert("document_editor", "Documento nuevo")
    store.upsert("conversation")
    assert len(store.list()) == 2
    store.clear_all()
    assert store.list() == []
