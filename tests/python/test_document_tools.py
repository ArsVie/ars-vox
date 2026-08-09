"""Document tools — list/search (progressive disclosure: on-command,
never ingested) plus the W1-DOC-SHARED bus-spy contract: every agent
edit path (document_save, document_insert_text) publishes
document.changed so an open editor reconciles live."""

import asyncio
import tempfile
from pathlib import Path

from arsvox_contracts.config import AppConfig
from arsvox_contracts.events import DocumentChangedEvent

from arsvox_agent.deps import Deps
from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.document_tools import (
    document_insert_text,
    document_list,
    document_save,
    document_search,
)
from arsvox_agent.tools.register import register_all


def _fake_docs():
    class _Docs:
        def __init__(self):
            self.rows = [
                {"title": "Don Quijote", "id": 1},
                {"title": "Lista de la compra", "id": 2},
                {"title": "Recetas de cocina", "id": 3},
            ]

        def list(self):
            return self.rows

    return _Docs()


class _T:
    def __init__(self, docs):
        self.deps = type("D", (), {"documents": docs})()


def test_document_list_lists_titles():
    tctx = _T(_fake_docs())
    out = asyncio.run(document_list(tctx))
    assert "Don Quijote" in out
    assert "Lista de la compra" in out
    assert "Recetas de cocina" in out


def test_document_list_empty_message():
    class _Empty:
        def list(self):
            return []

    out = asyncio.run(document_list(_T(_Empty())))
    assert "No hay documentos" in out


def test_document_search_filters_by_fragment():
    tctx = _T(_fake_docs())
    out = asyncio.run(document_search(tctx, "QUIJOTE"))
    assert "Don Quijote" in out
    assert "Recetas" not in out
    out2 = asyncio.run(document_search(tctx, "zzz"))
    assert "No encontré" in out2


def test_document_list_search_registered():
    registry = ToolRegistry()
    register_all(registry)
    assert registry.get("document.list") is not None
    assert registry.get("document.search") is not None


class _CaptureBus:
    """Bus spy: records every event published via tctx.emit -> bus.publish."""

    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


class _FakeDocs:
    def __init__(self, row: dict) -> None:
        self.row = row
        self.updates: list[tuple] = []

    def find_by_title(self, title: str) -> dict | None:
        return self.row if title.strip() == self.row["title"] else None

    def update_content(self, doc_id: int, content: str, saved: bool) -> None:
        self.updates.append((doc_id, content, saved))


class _FakeAudit:
    def __init__(self) -> None:
        self.rows: list[tuple] = []

    def log(self, kind: str, action: str, detail: dict) -> None:
        self.rows.append((kind, action, detail))


def _make_doc_context(doc: dict) -> tuple[ToolContext, _CaptureBus, _FakeDocs]:
    bus = _CaptureBus()
    docs = _FakeDocs(doc)
    deps = Deps(
        config=AppConfig(),
        db=None,
        sessions=None,
        notes=None,
        tasks=None,
        reminders=None,
        notifications=None,
        panels=None,
        preferences=None,
        progress=None,
        pending=None,
        documents=docs,
        audit=_FakeAudit(),
        bus=bus,  # type: ignore[arg-type]
        policy=None,
        confirmations=None,
        tts=None,
        telegram=None,
        run_id="test-run",
        session_id="test-session",
    )
    tctx = ToolContext(deps=deps, run_id="test-run", session_id="test-session", bus=bus)
    return tctx, bus, docs


def _changed_events(bus) -> list[DocumentChangedEvent]:
    return [e for e in bus.events if isinstance(e, DocumentChangedEvent)]


def test_document_insert_text_emits_document_changed():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "notas.md"
        path.write_text("Hola ", encoding="utf-8")
        tctx, bus, _ = _make_doc_context({"id": 7, "title": "Notas", "path": str(path)})

        out = asyncio.run(document_insert_text(tctx, "Notas", "más texto"))

        changed = _changed_events(bus)
        assert len(changed) == 1
        assert changed[0].document_id == 7
        assert changed[0].title == "Notas"
        assert changed[0].path == str(path)
        assert changed[0].content == "Hola más texto"
        # The file is the single authority — the event mirrors what landed.
        assert path.read_text(encoding="utf-8") == "Hola más texto"
        assert "añadido" in out


def test_document_save_emits_document_changed():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "notas.md"
        path.write_text("viejo", encoding="utf-8")
        tctx, bus, _ = _make_doc_context({"id": 7, "title": "Notas", "path": str(path)})

        out = asyncio.run(document_save(tctx, "Notas", "contenido nuevo"))

        changed = _changed_events(bus)
        assert len(changed) == 1
        assert changed[0].document_id == 7
        assert changed[0].title == "Notas"
        assert changed[0].content == "contenido nuevo"
        assert path.read_text(encoding="utf-8") == "contenido nuevo"
        assert "guardado" in out
