"""Document list/search (progressive disclosure: on-command, never ingested)."""

import asyncio
from pathlib import Path

from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools.register import register_all
from arsvox_agent.tools.document_tools import document_list, document_search


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
