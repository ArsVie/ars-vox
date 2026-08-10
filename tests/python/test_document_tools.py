"""Document tools — list/search (progressive disclosure: on-command,
never ingested) plus the W1-DOC-SHARED bus-spy contract: every agent
edit path (document_save, document_insert_text) publishes
document.changed so an open editor reconciles live, and create/open
publish document.load so the renderer bag forms in the first place."""

import asyncio
import tempfile
from pathlib import Path

from arsvox_contracts import PanelType
from arsvox_contracts.commands import PanelOpen
from arsvox_contracts.config import AppConfig
from arsvox_contracts.events import DocumentChangedEvent, DocumentLoadEvent, UiCommandEvent

from arsvox_agent.deps import Deps
from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.document_tools import (
    document_create,
    document_insert_text,
    document_list,
    document_open,
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


class _FakePanels:
    def __init__(self) -> None:
        self.upserts: list[tuple] = []

    def upsert(self, panel_type: str, title: str, content_reference: str) -> None:
        self.upserts.append((panel_type, title, content_reference))


class _FakeDocsStore:
    """Minimal in-memory DocumentStore: create/get/find_by_title rows."""

    def __init__(self) -> None:
        self.rows: dict[int, dict] = {}
        self.next_id = 1

    def find_by_title(self, title: str) -> dict | None:
        for row in self.rows.values():
            if row["title"] == title:
                return row
        return None

    def create(self, title: str, path: str) -> int:
        doc_id = self.next_id
        self.next_id += 1
        self.rows[doc_id] = {"id": doc_id, "title": title, "path": path}
        return doc_id

    def get(self, doc_id: int) -> dict | None:
        return self.rows.get(doc_id)


def _make_editor_context(
    config: AppConfig, docs: _FakeDocsStore, panels: _FakePanels
) -> tuple[ToolContext, _CaptureBus]:
    bus = _CaptureBus()
    deps = Deps(
        config=config,
        db=None,
        sessions=None,
        notes=None,
        tasks=None,
        reminders=None,
        notifications=None,
        panels=panels,  # type: ignore[arg-type]
        preferences=None,
        progress=None,
        pending=None,
        documents=docs,  # type: ignore[arg-type]
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
    return tctx, bus


def _load_events(bus) -> list[DocumentLoadEvent]:
    return [e for e in bus.events if isinstance(e, DocumentLoadEvent)]


def _open_commands(bus) -> list[PanelOpen]:
    return [
        e.command
        for e in bus.events
        if isinstance(e, UiCommandEvent) and isinstance(e.command, PanelOpen)
    ]


def test_document_create_emits_document_load_and_panel_open():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        config = AppConfig().anchor(root)
        docs = _FakeDocsStore()
        panels = _FakePanels()
        tctx, bus = _make_editor_context(config, docs, panels)

        out = asyncio.run(document_create(tctx, "Notas de viaje"))

        loads = _load_events(bus)
        opens = _open_commands(bus)
        assert len(loads) == 1
        assert len(opens) == 1
        assert opens[0].panel_type == PanelType.DOCUMENT_EDITOR
        assert opens[0].content_reference == "1"  # the new doc row id
        assert panels.upserts == [
            (PanelType.DOCUMENT_EDITOR.value, "Notas de viaje", "1")
        ]
        load = loads[0]
        assert load.title == "Notas de viaje"
        assert load.kind == "md"  # kind from the .md path suffix
        assert load.path.endswith("Notas de viaje.md")
        assert load.content == ""  # empty new doc — later changed fills it live
        # The file is the authority; the event mirrors what landed.
        assert Path(load.path).read_text(encoding="utf-8") == ""
        assert "creado" in out


def test_document_open_emits_document_load():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        docdir = root / "data" / "documents"
        docdir.mkdir(parents=True)
        path = docdir / "notas.md"
        path.write_text("lista de compras para el viaje", encoding="utf-8")
        config = AppConfig().anchor(root)
        docs = _FakeDocsStore()
        docs.create("Notas", str(path))
        panels = _FakePanels()
        tctx, bus = _make_editor_context(config, docs, panels)

        out = asyncio.run(document_open(tctx, "Notas"))

        loads = _load_events(bus)
        assert len(loads) == 1
        assert loads[0].title == "Notas"
        assert loads[0].kind == "md"
        assert loads[0].path == str(path)
        assert loads[0].content == "lista de compras para el viaje"
        # Open also opens the editor surface (panel.open precedes the load).
        opens = _open_commands(bus)
        assert len(opens) == 1
        assert opens[0].content_reference == "1"
        assert "abierto" in out


def test_document_open_txt_kind_from_suffix():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        docdir = root / "data" / "documents"
        docdir.mkdir(parents=True)
        path = docdir / "apuntes.txt"
        path.write_text("texto plano", encoding="utf-8")
        config = AppConfig().anchor(root)
        docs = _FakeDocsStore()
        docs.create("Apuntes", str(path))
        tctx, bus = _make_editor_context(config, docs, _FakePanels())

        asyncio.run(document_open(tctx, "Apuntes"))

        loads = _load_events(bus)
        assert len(loads) == 1
        assert loads[0].kind == "txt"
        assert loads[0].content == "texto plano"


def test_document_open_missing_emits_no_load():
    with tempfile.TemporaryDirectory() as td:
        config = AppConfig().anchor(Path(td))
        docs = _FakeDocsStore()
        tctx, bus = _make_editor_context(config, docs, _FakePanels())

        out = asyncio.run(document_open(tctx, "Inexistente"))

        assert _load_events(bus) == []
        assert _open_commands(bus) == []
        assert "No encontré" in out
