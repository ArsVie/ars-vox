"""Tool layer: registry gating, direct execution, document/library helpers."""

import pytest

from arsvox_contracts import PanelType

from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools.register import register_all


def test_registry_registers_all_tools():
    registry = ToolRegistry()
    n = register_all(registry)
    assert n == 44
    assert registry.get("ui.apply_layout") is not None
    assert registry.get("shell.exec") is None


def test_ui_apply_layout_flat_slot_kwargs():
    """B3: the tool signature is FLAT side/rail/dock kwargs (pydantic-ai
    derives the JSON schema from flat typed params; no nested object)."""
    import inspect

    registry = ToolRegistry()
    register_all(registry)
    spec = registry.get("ui.apply_layout")
    params = list(inspect.signature(spec.handler).parameters)
    assert params == [
        "tctx",
        "template",
        "primary_panel",
        "secondary_panel",
        "side",
        "rail",
        "dock",
    ]
    # secondary stays optional; slots kwargs are PanelType|None
    ann = inspect.signature(spec.handler).parameters
    assert ann["side"].annotation == PanelType | None
    assert ann["dock"].annotation == PanelType | None


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
