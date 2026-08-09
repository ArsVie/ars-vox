"""Tool layer: registry gating, direct execution, document/library helpers."""

import pytest

from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools.register import register_all


def test_registry_registers_all_tools():
    registry = ToolRegistry()
    n = register_all(registry)
    assert n == 44
    assert registry.get("layout.compose") is not None
    assert registry.get("shell.exec") is None


def test_legacy_ui_apply_layout_tool_removed():
    """C5: the old model-visible layout tool is gone — layout.compose is
    the ONLY model-visible layout surface (legacy wire layout.apply stays
    as a UiCommand/client action for the frontend planner, R23)."""
    registry = ToolRegistry()
    register_all(registry)
    assert registry.get("ui.apply_layout") is None


def test_layout_compose_signature_is_semantic_only():
    """A3: the native tool takes template + surface/role assignments +
    optional proportion — never slots, geometry, or CSS."""
    import inspect

    from arsvox_contracts import AdaptiveTemplate, Proportion

    registry = ToolRegistry()
    register_all(registry)
    spec = registry.get("layout.compose")
    params = list(inspect.signature(spec.handler).parameters)
    assert params == ["tctx", "template", "assignments", "proportion"]
    ann = inspect.signature(spec.handler).parameters
    assert ann["template"].annotation is AdaptiveTemplate
    assert ann["proportion"].annotation == Proportion | None


def test_model_visible_panel_vocabulary_excludes_news():
    """R18: the panel_type enums exposed in the tool schemas never carry
    the news value (panel-vision: the browser covers news)."""
    from arsvox_contracts import PanelType

    from arsvox_agent.tools.ui_tools import ModelPanelType

    model_values = {p.value for p in ModelPanelType}
    wire_values = {p.value for p in PanelType}
    assert model_values == wire_values - {"news"}


def test_unknown_tool_denied_by_gate():
    registry = ToolRegistry()
    assert registry.get("nope.tool") is None


def test_library_helpers(client):
    services = client.app.state.services
    from arsvox_agent.tools.library_tools import list_books, read_book_text

    books = list_books(services.config)
    assert books and books[0]["title"] == "don-quijote"
    text = read_book_text(services.config, "don-quijote")
    assert "Capítulo uno" in text


def test_documents_rest_api(client):
    resp = client.post("/api/documents", json={"title": "Lista de compras"})
    assert resp.status_code == 200
    doc_id = resp.json()["id"]
    resp = client.put(f"/api/documents/{doc_id}/content", json={"content": "leche\npan", "saved": True})
    assert resp.status_code == 200
    resp = client.get(f"/api/documents/{doc_id}")
    assert resp.json()["content"] == "leche\npan"
    assert client.post("/api/documents", json={"title": "Lista de compras"}).status_code == 409
    assert client.post("/api/documents", json={"title": "../evil"}).status_code == 422


def test_books_api(client):
    books = client.get("/api/books").json()
    assert books and books[0]["title"] == "don-quijote"
    content = client.get("/api/books/don-quijote/content").json()
    assert "Capítulo uno" in content["content"]
    assert client.get("/api/books/inexistente/content").status_code == 404


def test_progress_api(client):
    resp = client.put("/api/progress/book/don-quijote", json={"position": {"section": 2}})
    assert resp.status_code == 200
