"""Documents, media and the web: the tools behind the four quieter abilities."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox import documents, media, web  # noqa: E402
from services.arsvox.config import Settings  # noqa: E402
from services.arsvox.store import Store  # noqa: E402
from services.arsvox.tools import ToolContext, build_registry, documents_open, documents_read  # noqa: E402

PAGE = """<html><body>
<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fejemplo.com%2Fclima" class='result-link'>
Tiempo en Mexicali</a><td class='result-snippet'>Ahora hace <b>31</b> grados</td>
<a rel="nofollow" href="https://directo.com/dolar" class='result-link'>Dólar hoy</a>
<td class='result-snippet'>Compra 17,20 - Venta 17,60</td>
</body></html>"""


def context(tmp_path: Path, session: str = "cli") -> ToolContext:
    settings = Settings(base_url="http://x", model="fake", api_key="k", db_path=tmp_path / "t.db")
    return ToolContext(Store(settings.db_path), session, settings, datetime.now().astimezone())


def tree(tmp_path: Path) -> Path:
    root = tmp_path / "Documents"
    (root / "01-Construction" / "test files").mkdir(parents=True)
    (root / "01-Construction" / "test files" / "6_ProjectManual-V3_3750Blake_06-21-2019.pdf").write_text("x")
    (root / "Diario de hoy.txt").write_text("El diario de hoy: nada importante.")
    (root / "node_modules" / "otro").mkdir(parents=True)
    (root / "node_modules" / "Diario de hoy.js").write_text("console.log(1)")
    return root


# ---- documents ------------------------------------------------------------

def test_the_walk_ignores_noise_and_ranks_by_name(tmp_path: Path):
    root = tree(tmp_path)
    hits, cut = documents.find("manual del proyecto 3750 Blake", folders=[root])
    assert cut is False
    assert hits[0].path.name.startswith("6_ProjectManual")
    found, _ = documents.find("diario de hoy", folders=[root])
    assert [hit.path.suffix for hit in found] == [".txt"]  # node_modules was skipped


def test_extract_reads_text_and_markdown(tmp_path: Path):
    target = tmp_path / "carta.txt"
    target.write_text("Querida Ana:\n\n  te escribo   desde acá.\n\n\n\nFirmado.", encoding="utf-8")
    assert "te escribo desde acá" in documents.extract_text(target)


def test_extract_reads_a_pdf(tmp_path: Path):
    pymupdf = pytest.importorskip("pymupdf")
    target = tmp_path / "receta.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Dos pastillas por dia")
    document.save(str(target))
    document.close()
    assert "Dos pastillas" in documents.extract_text(target)


def test_opening_says_what_it_found(tmp_path: Path):
    root = tree(tmp_path)
    ctx = context(tmp_path)
    ctx.settings = ctx.settings
    import services.arsvox.documents as module

    monkey_roots = module.search_folders
    module.search_folders = lambda: [root]
    try:
        answer = documents_open(ctx, {"query": "diario de hoy"})
    finally:
        module.search_folders = monkey_roots
    assert "Abrí" in answer and "letras" in answer
    assert ctx.store.get_document("cli")["title"] == "Diario de hoy"


def test_opening_reports_a_file_that_is_not_there(tmp_path: Path, monkeypatch):
    empty = tmp_path / "vacio"
    empty.mkdir()
    monkeypatch.setattr(documents, "search_folders", lambda: [empty])
    ctx = context(tmp_path)
    assert "No encontré" in documents_open(ctx, {"query": "la carta de mi madre"})
    assert ctx.store.get_document("cli") is None


def test_ambiguity_asks_instead_of_guessing(tmp_path: Path, monkeypatch):
    two = tmp_path / "dos"
    two.mkdir()
    for name in ("Carta de Ana.txt", "Carta de Ana vieja.txt"):
        (two / name).write_text("hola")
    monkeypatch.setattr(documents, "search_folders", lambda: [two])
    ctx = context(tmp_path)
    answer = documents_open(ctx, {"query": "carta de ana"})
    assert "Encontré varios" in answer and "¿Cuál" in answer
    assert ctx.store.get_document("cli") is None


def test_reading_advances_the_cursor_and_marks_the_end(tmp_path: Path, monkeypatch):
    target = tmp_path / "largo.txt"
    target.write_text("A" * (documents.CHUNK_CHARS + 10), encoding="utf-8")
    monkeypatch.setattr(documents, "search_folders", lambda: [tmp_path])
    ctx = context(tmp_path)
    documents_open(ctx, {"query": "largo"})
    first = documents_read(ctx, {})
    assert len(first) > documents.CHUNK_CHARS and "quedan" in first.lower()
    assert ctx.store.get_document("cli")["cursor"] == documents.CHUNK_CHARS
    second = documents_read(ctx, {})
    assert "es todo el documento" in second.lower()


def test_reading_with_nothing_open_says_so(tmp_path: Path):
    assert "No tengo ningún documento" in documents_read(context(tmp_path), {})


# ---- web ------------------------------------------------------------------

def test_parsing_a_result_page_unwraps_the_links():
    results = web.parse_results(PAGE)
    assert [result["url"] for result in results] == ["https://ejemplo.com/clima", "https://directo.com/dolar"]
    assert results[0]["snippet"] == "Ahora hace 31 grados"


def test_search_speaks_its_results(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.web, "search", lambda query, limit=4: web.parse_results(PAGE))
    answer = tools.web_search(context(tmp_path), {"query": "clima"})
    assert "31 grados" in answer and "Tiempo en Mexicali" in answer


def test_search_that_finds_nothing_admits_it(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.web, "search", lambda query, limit=4: [])
    assert "No pude buscar" in tools.web_search(context(tmp_path), {"query": "xyz"})


def test_reading_a_page_returns_text(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.web, "read", lambda url, limit=1800: "Compra 17,20 Venta 17,60")
    assert "17,60" in tools.web_read(context(tmp_path), {"url": "https://x"})


# ---- media ----------------------------------------------------------------

def test_playing_something_reports_what_it_opened(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    opened: list[str] = []
    monkeypatch.setattr(
        tools.media,
        "resolve",
        lambda query, limit=3: [{"title": "Let It Be", "url": "https://y/1", "channel": "The Beatles", "seconds": 243}],
    )
    monkeypatch.setattr(tools.media, "open_in_browser", lambda url: opened.append(url) or True)
    answer = tools.media_play(context(tmp_path), {"query": "beatles"})
    assert opened == ["https://y/1"]
    assert "Let It Be" in answer and "The Beatles" in answer and "4 minutos" in answer


def test_playing_something_that_does_not_exist(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.media, "resolve", lambda query, limit=3: [])
    assert "No encontré nada" in tools.media_play(context(tmp_path), {"query": "asdf"})


def test_an_empty_url_opens_nothing():
    assert media.open_in_browser("") is False


# ---- the registry ---------------------------------------------------------

def test_every_tool_declares_a_usable_schema():
    registry = build_registry()
    assert len(registry) == 15
    for tool in registry.values():
        assert tool.description.strip()
        assert tool.parameters["type"] == "object"
        assert callable(tool.handler)
