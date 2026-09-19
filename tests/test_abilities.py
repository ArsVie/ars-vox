"""Documents, media and the web: the tools behind the four quieter abilities."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox import books, documents, media, web  # noqa: E402
from services.arsvox.config import Settings  # noqa: E402
from services.arsvox.store import Store  # noqa: E402
from services.arsvox.tools import ToolContext, build_registry, documents_open, documents_read  # noqa: E402

PAGE = """<html><body>
<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fejemplo.com%2Fclima" class='result-link'>
Tiempo en Mexicali</a><td class='result-snippet'>Ahora hace <b>31</b> grados</td>
<a rel="nofollow" href="https://directo.com/dolar" class='result-link'>Dólar hoy</a>
<td class='result-snippet'>Compra 17,20 - Venta 17,60</td>
</body></html>"""

# Structure per searxng's mojeek engine: ul.results-standard > li, the link in
# `a.ob`, the title in `h2 > a`, the snippet in `p.s`.
MOJEEK_PAGE = """<html><body>
<ul class="results-standard">
<li>
<a class="ob" href="https://ejemplo.com/clima"><span class="i">ejemplo.com</span></a>
<h2><a href="https://ejemplo.com/clima">Tiempo en Mexicali</a></h2>
<p class="s">Ahora hace <b>31</b> grados en la ciudad.</p>
</li>
<li>
<h2><a href="https://otro.mx/dolar">Dólar hoy</a></h2>
<p class="s">Compra 17,20 - Venta 17,60</p>
</li>
</ul>
</body></html>"""

# Shaped like the real open-meteo answer for Mexicali on 2026-09-14.
CURRENT = {"temperature_2m": 33.0, "apparent_temperature": 35.9, "weather_code": 0}
DAILY = {
    "time": ["2026-09-14", "2026-09-15"],
    "temperature_2m_max": [42.2, 40.0],
    "temperature_2m_min": [28.2, 26.3],
    "precipitation_probability_max": [0, 65],
    "weather_code": [0, 95],
}

FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>La Jornada</title>
<item>
  <title>Editorial: BRICS: multilateralismo pragmático</title>
  <link>https://www.jornada.com.mx/1</link>
  <description>Texto largo</description>
</item>
<item>
  <title>   Sismo   de magnitud 5 al sur de Oaxaca </title>
  <link>https://www.jornada.com.mx/2</link>
</item>
<item>
  <title>Agua &amp; sequía en el norte</title>
</item>
<item>
  <title></title>
</item>
</channel></rss>"""

# Shaped like the real Gutendex answer for Don Quijote: the Spanish edition, and
# the utf-8 plain text is the format the reader wants.
GUTENDEX_BOOK = {
    "id": 2000,
    "title": "Don Quijote",
    "authors": [{"name": "Cervantes Saavedra, Miguel de"}],
    "languages": ["es"],
    "formats": {
        "application/epub+zip": "https://www.gutenberg.org/ebooks/2000.epub.noimages",
        "text/html": "https://www.gutenberg.org/ebooks/2000.html",
        "text/plain; charset=utf-8": "https://www.gutenberg.org/ebooks/2000.txt.utf-8",
        "text/plain; charset=us-ascii": "https://www.gutenberg.org/ebooks/2000.txt",
    },
}

BOOK_TEXT = (
    "*** START OF THE PROJECT GUTENBERG EBOOK DON QUIJOTE ***\n\n"
    "En un lugar de la Mancha, de cuyo nombre no quiero acordarme...\n\n"
    "*** END OF THE PROJECT GUTENBERG EBOOK DON QUIJOTE ***\n"
)


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


def test_the_second_engine_page_parses():
    results = web.parse_mojeek(MOJEEK_PAGE)
    assert [result["url"] for result in results] == ["https://ejemplo.com/clima", "https://otro.mx/dolar"]
    assert results[0]["title"] == "Tiempo en Mexicali"
    assert results[0]["snippet"] == "Ahora hace 31 grados en la ciudad."


def test_the_first_engine_retries_once_after_a_soft_block(monkeypatch):
    pages = [(202, "bloqueado"), (200, PAGE)]
    calls: list[str] = []

    def fake_fetch(url, timeout=12):  # noqa: ANN001
        calls.append(url)
        return pages.pop(0)

    monkeypatch.setattr(web, "_fetch", fake_fetch)
    results = web._ddg("clima", 4, "mx-es")
    assert len(calls) == 2 and results[0]["title"] == "Tiempo en Mexicali"


def test_a_200_with_no_results_is_genuinely_empty(monkeypatch):
    calls: list[int] = []

    def fake_fetch(url, timeout=12):  # noqa: ANN001
        calls.append(1)
        return (200, "<html><body>No results.</body></html>")

    monkeypatch.setattr(web, "_fetch", fake_fetch)
    assert web._ddg("xyz", 4, "mx-es") == [] and len(calls) == 1


def test_search_falls_back_to_the_second_engine(monkeypatch):
    def blocked(query, limit, region):
        raise web.WebError("el buscador principal respondió 202")

    monkeypatch.setattr(web, "_ddg", blocked)
    monkeypatch.setattr(web, "_mojeek", lambda query, limit, region: web.parse_mojeek(MOJEEK_PAGE))
    results = web.search("clima")
    assert results[0]["title"] == "Tiempo en Mexicali"


def test_search_with_both_engines_blocked_names_the_failure(monkeypatch):
    monkeypatch.setattr(web, "_fetch", lambda url, timeout=12: (202, "no"))

    with pytest.raises(web.WebError) as caught:
        web.search("clima")
    assert "202" in str(caught.value) and "segundo" in str(caught.value)


def test_search_that_truly_finds_nothing_is_not_an_error(monkeypatch):
    monkeypatch.setattr(web, "_ddg", lambda query, limit, region: [])
    monkeypatch.setattr(web, "_mojeek", lambda query, limit, region: [])
    assert web.search("xyzxyz") == []


def test_the_weather_sentence_speaks_today():
    line = web.weather_sentence("Mexicali", "hoy", CURRENT, DAILY)
    assert "ahora hay 33 grados" in line and "se siente como 36" in line
    assert "Máxima de 42" in line and "mínima de 28" in line
    assert "despejado" in line and "sin lluvia prevista" in line


def test_the_weather_sentence_speaks_tomorrow():
    line = web.weather_sentence("Mexicali", "mañana", CURRENT, DAILY)
    assert "mañana" in line and "Máxima de 40" in line and "mínima de 26" in line
    assert "tormenta eléctrica" in line and "probabilidad de lluvia de 65 por ciento" in line


def test_the_weather_sentence_survives_missing_fields():
    line = web.weather_sentence("Partes", "hoy", {}, {"temperature_2m_max": [10]})
    assert "En Partes." in line and "máxima de 10" in line.lower()


def test_weather_asks_the_map_then_the_forecast(monkeypatch):
    payloads = [
        {"results": [{"name": "Mexicali", "latitude": 32.6, "longitude": -115.4}]},
        {"current": CURRENT, "daily": DAILY},
    ]
    monkeypatch.setattr(web, "_get_json", lambda url: payloads.pop(0))
    assert "ahora hay 33 grados" in web.weather("Mexicali")


def test_a_city_the_map_does_not_know_says_so(monkeypatch):
    monkeypatch.setattr(web, "_get_json", lambda url: {"results": []})
    with pytest.raises(web.WebError) as caught:
        web.geocode("Xyzzy")
    assert "no encontré esa ciudad" in str(caught.value)


def test_the_news_feed_titles_parse():
    titles = web.parse_headlines(FEED, limit=5)
    assert titles == [
        "Editorial: BRICS: multilateralismo pragmático",
        "Sismo de magnitud 5 al sur de Oaxaca",
        "Agua & sequía en el norte",
    ]


def test_search_speaks_its_results(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.web, "search", lambda query, limit=4, region=None: web.parse_results(PAGE))
    answer = tools.web_search(context(tmp_path), {"query": "clima"})
    assert "31 grados" in answer and "Tiempo en Mexicali" in answer


def test_search_that_finds_nothing_admits_it(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.web, "search", lambda query, limit=4, region=None: [])
    assert "No encontré resultados" in tools.web_search(context(tmp_path), {"query": "xyz"})


def test_search_that_is_blocked_names_the_block(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    def blocked(query, limit=4, region=None):
        raise web.WebError("el buscador principal respondió 202")

    monkeypatch.setattr(tools.web, "search", blocked)
    answer = tools.web_search(context(tmp_path), {"query": "xyz"})
    assert "No pude buscar" in answer and "202" in answer


def test_reading_a_page_returns_text(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.web, "read", lambda url, limit=1800: "Compra 17,20 Venta 17,60")
    assert "17,60" in tools.web_read(context(tmp_path), {"url": "https://x"})


def test_reading_a_page_that_fails_says_why(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    def failing(url, limit=1800):
        raise web.WebError("no respondió (TimeoutError)")

    monkeypatch.setattr(tools.web, "read", failing)
    answer = tools.web_read(context(tmp_path), {"url": "https://x"})
    assert "No pude leer" in answer and "TimeoutError" in answer


def test_the_weather_tool_uses_the_default_city(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    seen: dict[str, str] = {}

    def fake_weather(city, when="hoy"):
        seen["city"] = city
        return f"En {city}, despejado."

    monkeypatch.setattr(tools.web, "weather", fake_weather)
    answer = tools.weather_get(context(tmp_path), {})
    assert seen["city"] == "Mexicali" and "Mexicali" in answer


def test_the_weather_tool_says_why_it_could_not(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    def broken(city, when="hoy"):
        raise web.WebError("respondió 500")

    monkeypatch.setattr(tools.web, "weather", broken)
    assert "No pude consultar el clima" in tools.weather_get(context(tmp_path), {"city": "Tijuana"})


def test_the_news_tool_numbers_the_headlines(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.web, "headlines", lambda limit=5: ["Uno", "Dos"])
    answer = tools.news_list(context(tmp_path), {})
    assert "Titulares de La Jornada" in answer and "1) Uno" in answer and "2) Dos" in answer


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


def test_playing_when_the_search_breaks_says_why(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    def broken(query, limit=3):
        raise media.MediaError("la búsqueda falló (DownloadError)")

    monkeypatch.setattr(tools.media, "resolve", broken)
    answer = tools.media_play(context(tmp_path), {"query": "beatles"})
    assert "No pude buscar" in answer and "DownloadError" in answer


def test_an_empty_url_opens_nothing():
    assert media.open_in_browser("") is False


# ---- books -----------------------------------------------------------------

def test_book_search_prefers_spanish_and_falls_back(monkeypatch):
    calls: list = []

    def fake_search(title, language="es"):
        calls.append(language)
        return [] if language else [{"title": "Moby Dick"}]

    monkeypatch.setattr(books, "search", fake_search)
    book = books.find("moby dick")
    assert calls == ["es", None]
    assert book["title"] == "Moby Dick"


def test_book_search_stops_when_spanish_answers(monkeypatch):
    calls: list = []

    def fake_search(title, language="es"):
        calls.append(language)
        return [{"title": "Don Quijote"}]

    monkeypatch.setattr(books, "search", fake_search)
    assert books.find("quijote")["title"] == "Don Quijote"
    assert calls == ["es"]


def test_the_text_link_prefers_utf8_plain():
    assert books.text_url(GUTENDEX_BOOK) == "https://www.gutenberg.org/ebooks/2000.txt.utf-8"


def test_a_book_without_plain_text_has_none():
    assert books.text_url({"formats": {"application/epub+zip": "https://x"}}) is None


def test_the_filename_is_windows_safe_and_carries_the_id():
    name = books.file_name({"id": 2701, "title": "Moby Dick; Or, The Whale", "authors": [{"name": "Melville, Herman"}]})
    assert name == "Moby Dick - Melville, Herman (2701).txt"
    assert not any(bad in name for bad in '<>:"/\\|?*')


def test_the_license_around_the_book_is_not_saved():
    stripped = books.strip_license(BOOK_TEXT)
    assert stripped.startswith("En un lugar")
    assert "GUTENBERG" not in stripped
    assert books.strip_license("sin marcadores") == "sin marcadores"


def test_getting_a_book_saves_it_and_opens_it(tmp_path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.books, "find", lambda title, language="es": GUTENDEX_BOOK)
    monkeypatch.setattr(tools.books, "fetch", lambda url: BOOK_TEXT)
    monkeypatch.setattr(tools.books, "books_home", lambda: tmp_path / "libros")
    ctx = context(tmp_path)
    answer = tools.books_get(ctx, {"title": "don quijote"})
    assert "Listo" in answer and "Don Quijote" in answer
    saved = list((tmp_path / "libros").glob("*.txt"))
    assert len(saved) == 1
    assert saved[0].read_text(encoding="utf-8").startswith("En un lugar")
    assert ctx.store.get_document("cli")["title"] == "Don Quijote"


def test_a_book_that_is_not_in_the_catalog_says_so(tmp_path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.books, "find", lambda title, language="es": None)
    assert "No encontré" in tools.books_get(context(tmp_path), {"title": "cien años de soledad"})


def test_a_book_that_is_not_spanish_says_its_language(tmp_path, monkeypatch):
    from services.arsvox import tools

    english = dict(GUTENDEX_BOOK, languages=["en"])
    monkeypatch.setattr(tools.books, "find", lambda title, language="es": english)
    monkeypatch.setattr(tools.books, "fetch", lambda url: BOOK_TEXT)
    monkeypatch.setattr(tools.books, "books_home", lambda: tmp_path / "libros")
    assert "inglés" in tools.books_get(context(tmp_path), {"title": "moby dick"})


def test_a_book_that_will_not_download_names_the_reason(tmp_path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.books, "find", lambda title, language="es": GUTENDEX_BOOK)

    def broken(url):
        raise books.BookError("no respondió (TimeoutError)")

    monkeypatch.setattr(tools.books, "fetch", broken)
    answer = tools.books_get(context(tmp_path), {"title": "don quijote"})
    assert "no pude descargarlo" in answer and "TimeoutError" in answer


def test_the_catalog_keeps_trying_through_a_stall_wave(monkeypatch):
    attempts: list = []

    class Page:
        status = 200

        def __init__(self, body):
            self.body = body

        def read(self, *args):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(request, timeout=None):
        attempts.append(1)
        if len(attempts) < 3:
            raise TimeoutError("the read never returned")
        return Page(b'{"results": [{"title": "Don Quijote"}]}')

    monkeypatch.setattr(books.urllib.request, "urlopen", fake_urlopen)
    assert books.search("quijote", "es")[0]["title"] == "Don Quijote"
    assert len(attempts) == 3


# ---- the registry ---------------------------------------------------------

def test_every_tool_declares_a_usable_schema():
    registry = build_registry()
    assert len(registry) == 18
    assert {"weather_get", "news_list", "books_get"} <= set(registry)
    for tool in registry.values():
        assert tool.description.strip()
        assert tool.parameters["type"] == "object"
        assert callable(tool.handler)
