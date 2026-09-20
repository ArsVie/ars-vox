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
from services.arsvox.tools import (  # noqa: E402
    ToolContext,
    build_registry,
    documents_open,
    documents_page,
)

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


def test_opening_shows_a_page_and_paging_turns_it(tmp_path: Path, monkeypatch):
    root = tmp_path / "Documents"
    root.mkdir()
    (root / "novela.txt").write_text("Párrafo con palabras. " * 130, encoding="utf-8")
    monkeypatch.setattr(documents, "search_folders", lambda: [root])
    ctx = context(tmp_path)
    assert "panel" in documents_open(ctx, {"query": "novela"})
    states = [e for e in ctx.store.events("cli") if e.kind == "document_state"]
    assert states[-1].payload["action"] == "open"
    assert states[-1].payload["mode"] == "text"
    assert states[-1].payload["page"] == 1
    assert states[-1].payload["pages"] == 3
    assert states[-1].payload["text"].startswith("Párrafo")
    assert documents_page(ctx, {"step": 1}) == "Página 2 de 3."
    states = [e for e in ctx.store.events("cli") if e.kind == "document_state"]
    assert states[-1].payload["action"] == "page"
    assert states[-1].payload["page"] == 2 and states[-1].payload["text"]
    assert documents_page(ctx, {"to": 99}) == "Página 3 de 3. Es la última."
    assert documents_page(ctx, {"step": -1}) == "Página 2 de 3."


def test_a_pdf_opens_as_its_own_pages_and_renders(tmp_path: Path, monkeypatch):
    pymupdf = pytest.importorskip("pymupdf")
    root = tmp_path / "Documents"
    root.mkdir()
    document = pymupdf.open()
    for number in range(1, 4):
        document.new_page().insert_text((72, 72), f"Página {number}")
    pdf = root / "cuaderno.pdf"
    document.save(str(pdf))
    document.close()
    monkeypatch.setattr(documents, "search_folders", lambda: [root])
    ctx = context(tmp_path)
    assert "panel" in documents_open(ctx, {"query": "cuaderno"})
    states = [e for e in ctx.store.events("cli") if e.kind == "document_state"]
    assert states[-1].payload["mode"] == "pdf"
    assert states[-1].payload["pages"] == 3
    assert "text" not in states[-1].payload  # a pdf page is an image, not a transcription
    assert documents_page(ctx, {"to": 2}) == "Página 2 de 3."
    png = documents.render_pdf_page(pdf, 2)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


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
    assert "Abrí" in answer and "panel" in answer
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


def test_a_file_with_the_same_name_twice_is_not_an_ambiguity(tmp_path: Path, monkeypatch):
    for folder in ("uno", "dos"):
        target = tmp_path / folder
        target.mkdir()
        (target / "Recetas de la abuela.txt").write_text("sopa", encoding="utf-8")
    monkeypatch.setattr(documents, "search_folders", lambda: [tmp_path])
    ctx = context(tmp_path)
    assert "Abrí" in documents_open(ctx, {"query": "recetas de la abuela"})


def test_paging_advances_the_cursor_and_marks_the_end(tmp_path: Path, monkeypatch):
    target = tmp_path / "largo.txt"
    target.write_text("A" * (documents.CHUNK_CHARS + 10), encoding="utf-8")
    monkeypatch.setattr(documents, "search_folders", lambda: [tmp_path])
    ctx = context(tmp_path)
    documents_open(ctx, {"query": "largo"})
    assert documents_page(ctx, {}) == "Página 2 de 2. Es la última."
    assert ctx.store.get_document("cli")["cursor"] == documents.CHUNK_CHARS
    assert documents_page(ctx, {}) == "Página 2 de 2. Es la última."  # stays on the last page


def test_paging_with_nothing_open_says_so(tmp_path: Path):
    assert "No tengo ningún documento" in documents_page(context(tmp_path), {})


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

VIDEO = {
    "title": "Let It Be",
    "url": "https://www.youtube.com/watch?v=def67890abc",
    "channel": "The Beatles",
    "seconds": 243,
}
VIDEO_2 = {
    "title": "Hey Jude",
    "url": "https://youtu.be/abc12345xyz",
    "channel": "The Beatles",
    "seconds": 431,
}


def play_events(ctx) -> list:
    return [e for e in ctx.store.events("cli") if e.kind == "media_state"]


def test_search_leaves_the_options_in_the_log_and_reads_them_out(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.media, "resolve", lambda query, limit=4: [VIDEO_2, VIDEO])
    ctx = context(tmp_path)
    answer = tools.media_search(ctx, {"query": "beatles"})
    assert "1) Hey Jude" in answer and "2) Let It Be" in answer
    assert "7:11" in answer  # 431 seconds, mm:ss
    assert VIDEO["url"] in answer
    offers = [e for e in ctx.store.events("cli") if e.kind == "media_offers"]
    assert len(offers) == 1
    assert offers[0].payload["items"][0]["title"] == "Hey Jude"


def test_search_without_a_query_asks(tmp_path: Path):
    from services.arsvox import tools

    assert "¿Qué busca?" in tools.media_search(context(tmp_path), {})


def test_play_resolves_the_first_result_and_logs_it(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.media, "resolve", lambda query, limit=3: [VIDEO])
    ctx = context(tmp_path)
    answer = tools.media_play(ctx, {"query": "let it be"})
    assert "Let It Be" in answer and "The Beatles" in answer and "panel" in answer
    (event,) = play_events(ctx)
    assert event.payload["action"] == "play"
    assert event.payload["source"] == "youtube"
    assert event.payload["video_id"] == "def67890abc"


def test_play_with_a_url_takes_exactly_that_one(tmp_path: Path):
    from services.arsvox import tools

    ctx = context(tmp_path)
    answer = tools.media_play(ctx, {"url": VIDEO_2["url"], "title": "Hey Jude"})
    assert "Hey Jude" in answer
    (event,) = play_events(ctx)
    assert event.payload["video_id"] == "abc12345xyz"


def test_play_a_url_that_is_not_youtube_says_so(tmp_path: Path):
    from services.arsvox import tools

    ctx = context(tmp_path)
    answer = tools.media_play(ctx, {"url": "https://example.com/video"})
    assert "no es un video de YouTube" in answer
    assert play_events(ctx) == []


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


def test_controls_do_nothing_when_nothing_is_on(tmp_path: Path):
    from services.arsvox import tools

    ctx = context(tmp_path)
    assert "No hay nada" in tools.media_pause(ctx, {})
    assert "No hay nada" in tools.media_resume(ctx, {})
    assert "No hay nada" in tools.media_close(ctx, {})
    assert play_events(ctx) == []


def test_pause_resume_and_close_follow_a_play(tmp_path: Path, monkeypatch):
    from services.arsvox import tools

    monkeypatch.setattr(tools.media, "resolve", lambda query, limit=3: [VIDEO])
    ctx = context(tmp_path)
    tools.media_play(ctx, {"query": "let it be"})
    assert "pausa" in tools.media_pause(ctx, {})
    assert "sigue" in tools.media_resume(ctx, {})
    assert "panel" in tools.media_close(ctx, {})
    assert [e.payload["action"] for e in play_events(ctx)] == ["play", "pause", "resume", "close"]
    assert "No hay nada" in tools.media_pause(ctx, {})  # the close ended it


def test_the_video_id_survives_every_url_shape():
    assert media.video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s") == "dQw4w9WgXcQ"
    assert media.video_id("https://youtu.be/dQw4w9WgXcQ?si=x") == "dQw4w9WgXcQ"
    assert media.video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert media.video_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert media.video_id("https://example.com/nada") == ""


def test_only_media_files_can_be_served(tmp_path: Path):
    assert media.media_type("cancion.MP3") == ("audio", "audio/mpeg")
    assert media.media_type("video.mp4") == ("video", "video/mp4")
    assert media.media_type("notas.txt") is None
    assert media.local_event(tmp_path / "notas.txt") is None
    sound = tmp_path / "canto.mp3"
    sound.write_bytes(b"ID3")
    event = media.local_event(sound)
    assert event["source"] == "local" and event["kind"] == "audio"
    assert "/media/file?path=" in event["url"]


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


def test_a_long_title_retries_short_in_spanish_before_any_language(monkeypatch):
    calls: list = []

    def fake_search(title, language="es"):
        calls.append((title, language))
        if (title, language) == ("Don Quijote", "es"):
            return [{"title": "Don Quijote", "languages": ["es"]}]
        return []

    monkeypatch.setattr(books, "search", fake_search)
    book = books.find("Don Quijote de la Mancha")
    assert book["title"] == "Don Quijote"
    assert calls == [("Don Quijote de la Mancha", "es"), ("Don Quijote", "es")]


def test_language_note_names_the_language_in_spanish():
    assert books.language_note({"languages": ["hu"]}) == " Está en húngaro."
    assert books.language_note({"languages": ["es"]}) == ""
    assert books.language_note({"languages": ["xx"]}) == " Está en xx."


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

TOOL_NAMES = {"agenda", "documents", "media", "web", "weather_get", "news_list"}


def test_every_tool_declares_a_usable_schema():
    registry = build_registry()
    assert set(registry) == TOOL_NAMES
    for tool in registry.values():
        assert tool.description.strip()
        assert tool.parameters["type"] == "object"
        assert callable(tool.handler)


def test_every_family_action_has_a_handler_and_a_declared_enum():
    from services.arsvox import tools as t

    families = {
        "agenda": t.AGENDA_ACTIONS,
        "documents": t.DOCUMENTS_ACTIONS,
        "media": t.MEDIA_ACTIONS,
        "web": t.WEB_ACTIONS,
    }
    registry = build_registry()
    for name, actions in families.items():
        schema = registry[name].parameters
        assert schema["properties"]["action"]["enum"] == list(actions), name
        assert callable(registry[name].handler)


def test_a_family_routes_its_actions_and_refuses_an_unknown_one(tmp_path):
    from services.arsvox import tools as t

    ctx = context(tmp_path)
    answer = t.route_agenda(ctx, {"action": "add_task", "text": "probar la ventana"})
    assert "probar la ventana" in answer
    assert len(ctx.store.list_tasks("cli")) == 1
    refused = t.route_agenda(ctx, {"action": "saltar"})
    assert "No conozco la acción" in refused and "add_task" in refused


def test_a_missing_argument_gets_a_question_not_a_crash(tmp_path):
    from services.arsvox import tools as t

    ctx = context(tmp_path)
    assert "¿Qué anoto?" in t.route_agenda(ctx, {"action": "add_task"})
    assert "¿Qué quiere que le recuerde?" in t.route_agenda(ctx, {"action": "add_reminder"})
    assert "¿Qué pongo?" in t.route_media(ctx, {"action": "play"})
    assert "¿Cuál archivo" in t.route_documents(ctx, {"action": "open_document"})
    assert "¿Qué busco?" in t.route_web(ctx, {"action": "search"})
    assert "¿Cuál libro busco?" in t.route_documents(ctx, {"action": "get_book"})


def test_music_search_leaves_songs_on_screen(tmp_path, monkeypatch):
    from services.arsvox import media as m
    from services.arsvox import tools as t

    ctx = context(tmp_path)
    monkeypatch.setattr(
        m,
        "search_music",
        lambda query, limit=4: [
            {
                "title": "Let It Be",
                "url": "https://www.youtube.com/watch?v=QDYfEBY9NM4",
                "channel": "The Beatles",
                "seconds": 243,
            }
        ],
    )
    answer = t.route_media(ctx, {"action": "search", "query": "the beatles", "type": "music"})
    assert "Canciones a la vista" in answer and "Let It Be" in answer
    offers = [e for e in ctx.store.events("cli") if e.kind == "media_offers"]
    assert offers and offers[-1].payload.get("type") == "music"


def test_music_play_fetches_the_sound_not_the_video(tmp_path, monkeypatch):
    from services.arsvox import media as m
    from services.arsvox import tools as t

    ctx = context(tmp_path)
    produced = tmp_path / "QDYfEBY9NM4.m4a"
    produced.write_bytes(b"\x00")
    monkeypatch.setattr(m, "fetch_audio", lambda url, folder: (produced, "Let It Be (Remastered 2009)"))
    answer = t.route_media(
        ctx,
        {
            "action": "play",
            "type": "music",
            "url": "https://www.youtube.com/watch?v=QDYfEBY9NM4",
            "title": "Let It Be",
        },
    )
    assert "Let It Be" in answer
    plays = [
        e
        for e in ctx.store.events("cli")
        if e.kind == "media_state" and e.payload.get("source") == "music"
    ]
    assert plays and plays[-1].payload["kind"] == "audio"
    # the video path was never walked
    assert not [e for e in ctx.store.events("cli") if e.kind == "media_state" and e.payload.get("source") == "youtube"]


def test_the_window_folders_become_the_reader_roots(tmp_path):
    from services.arsvox import books, documents

    library = tmp_path / "libros"
    library.mkdir()
    (library / "el coronel no tiene quien le escriba.txt").write_text("hola", encoding="utf-8")
    documents.set_search_folders([library])
    try:
        hits, _ = documents.find("coronel")
        assert hits and hits[0].path == library / "el coronel no tiene quien le escriba.txt"
        assert books.books_home() == library / "Ars Vox Libros"
    finally:
        documents.set_search_folders(None)


def test_documents_list_shows_the_shelf(tmp_path):
    from services.arsvox import documents
    from services.arsvox import tools as t

    ctx = context(tmp_path)
    shelf = tmp_path / "libros"
    shelf.mkdir()
    (shelf / "El Quijote.txt").write_text("x", encoding="utf-8")
    (shelf / "Recetas de la abuela.md").write_text("y", encoding="utf-8")
    (shelf / "notas.png").write_bytes(b"z")  # not readable: stays off the shelf
    documents.set_search_folders([shelf])
    try:
        answer = t.route_documents(ctx, {"action": "list_documents"})
        assert "El Quijote" in answer and "Recetas de la abuela" in answer
        assert "notas" not in answer
        assert "Dígame cuál le leo" in answer
    finally:
        documents.set_search_folders(None)


def test_documents_list_on_an_empty_shelf(tmp_path):
    from services.arsvox import documents
    from services.arsvox import tools as t

    ctx = context(tmp_path)
    empty = tmp_path / "vacio"
    empty.mkdir()
    documents.set_search_folders([empty])
    try:
        answer = t.route_documents(ctx, {"action": "list_documents"})
        assert "No encontré documentos" in answer
    finally:
        documents.set_search_folders(None)


def test_config_lives_in_the_store(tmp_path):
    ctx = context(tmp_path)
    ctx.store.set_config("cli", "books_path", str(tmp_path / "mis libros"))
    ctx.store.set_config("cli", "music_path", str(tmp_path / "mi musica"))
    assert ctx.store.config("cli") == {
        "books_path": str(tmp_path / "mis libros"),
        "music_path": str(tmp_path / "mi musica"),
    }
    ctx.store.set_config("cli", "books_path", str(tmp_path / "otros"))
    assert ctx.store.config("cli")["books_path"] == str(tmp_path / "otros")
