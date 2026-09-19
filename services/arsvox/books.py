"""Public-domain books, brought home so they can be read aloud.

The user says "léame el Quijote" and the book should already be here. The catalog
is Project Gutenberg, reached through its keyless JSON API (Gutendex). What gets
saved is the plain text, because the reader (documents) reads text; a Spanish
edition comes first — the product speaks Spanish — and any language is the
fallback, so a request for the English original does not come back empty.

One thing this module refuses to do: read the license aloud. The Project Gutenberg
header and footer are stripped before the file is written, because the first thing
the user hears should be the book.

The catalog flaps: on 2026-09-19 its reads stalled for minutes at a time, and it
rejects the default Python user agent. Every fetch carries a browser-shaped agent
and retries for the stalls — the search takes three 10 s tries, because the tarpit
waves outlasted a single retry, and one more try is cheap next to a dead turn.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from services.arsvox import documents

SEARCH_URL = "https://gutendex.com/books"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ArsVox/0.2"
SEARCH_TIMEOUT_S = 10
DOWNLOAD_TIMEOUT_S = 45
FOLDER_NAME = "Ars Vox Libros"
WINDOWS_BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
LICENSE_START = re.compile(r"\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*{3}", re.S)
LICENSE_END = re.compile(r"\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*", re.S)
LANGUAGE_NAMES = {
    "en": "inglés", "fr": "francés", "de": "alemán", "it": "italiano", "pt": "portugués",
    "hu": "húngaro", "nl": "neerlandés", "ru": "ruso", "sv": "sueco", "da": "danés",
    "pl": "polaco", "el": "griego", "ja": "japonés", "zh": "chino", "la": "latín",
}


class BookError(Exception):
    """A lookup or a download that could not be completed, and the reason is worth saying."""


def _fetch(url: str, timeout: int, attempts: int = 1) -> str:
    """One GET, retried for the stalls; the last reason travels as a BookError."""
    reason = "no respondió"
    for _ in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            reason = f"respondió {exc.code}"
        except Exception as exc:  # noqa: BLE001 - a dead network is a sentence, not a crash
            reason = f"no respondió ({type(exc).__name__})"
    raise BookError(reason)


def search(title: str, language: str | None = "es") -> list[dict]:
    """The catalog's answers, best first. `language` filters the editions."""
    query: dict[str, str] = {"search": title}
    if language:
        query["languages"] = language
    url = SEARCH_URL + "?" + urllib.parse.urlencode(query)
    try:
        payload = json.loads(_fetch(url, SEARCH_TIMEOUT_S, attempts=3))
    except ValueError as exc:
        raise BookError("el catálogo no mandó datos legibles") from exc
    return list(payload.get("results") or [])


def find(title: str, language: str = "es") -> dict | None:
    """The book to bring home: Spanish first — the full title, then a shorter form
    when the catalog finds nothing under it — any language after, None if nothing."""
    if language:
        for candidate in title_candidates(title):
            results = search(candidate, language)
            if results:
                return first_readable(results) or results[0]
    results = search(title, None)
    return (first_readable(results) or results[0]) if results else None


def title_candidates(title: str) -> list[str]:
    """The full title, then its first two words. The catalog matches every word, so
    a long title ('Don Quijote de la Mancha') misses the Spanish short-titled edition
    and the unfiltered fallback lands on whichever translation carries it verbatim."""
    words = title.split()
    short = " ".join(words[:2]) if len(words) > 2 else ""
    return list(dict.fromkeys(part for part in (title, short) if part))


def first_readable(results: list[dict]) -> dict | None:
    for book in results:
        if text_url(book):
            return book
    return None


def text_url(book: dict) -> str | None:
    """The plain-text link, utf-8 preferred: the format the reader wants."""
    formats = book.get("formats") or {}
    for key, url in formats.items():
        if key.startswith("text/plain") and "utf-8" in key:
            return url
    for key, url in formats.items():
        if key.startswith("text/plain"):
            return url
    return None


def fetch(url: str) -> str:
    """The text of one book, as the catalog serves it."""
    return _fetch(url, DOWNLOAD_TIMEOUT_S, attempts=2)


def strip_license(text: str) -> str:
    """The book without Project Gutenberg's header and footer around it."""
    start = LICENSE_START.search(text)
    if start:
        text = text[start.end():]
    # searched after the cut: the start match's offsets no longer apply once text moved
    end = LICENSE_END.search(text)
    if end:
        text = text[:end.start()]
    return text.strip()


def author_name(book: dict) -> str:
    for author in book.get("authors") or []:
        name = str(author.get("name") or "").strip()
        if name:
            return name
    return "autor desconocido"


def short_title(book: dict) -> str:
    """The title before the semicolon some catalog entries carry."""
    title = str(book.get("title") or "").split(";")[0].strip()
    return title or "sin título"


def language_note(book: dict) -> str:
    """Which language the text is in, when it is not Spanish. Empty otherwise."""
    languages = book.get("languages") or []
    if not languages or "es" in languages:
        return ""
    first = str(languages[0])
    return f" Está en {LANGUAGE_NAMES.get(first, first)}."


def file_name(book: dict) -> str:
    """A filename Windows accepts, with the catalog id so editions do not collide."""
    raw = f"{short_title(book)} - {author_name(book)} ({book.get('id', '')})"
    clean = re.sub(r"\s+", " ", WINDOWS_BAD.sub("", raw)).strip(" .")
    return f"{clean[:100]}.txt"


def books_home() -> Path:
    """Where books live: the first folder the user's document search already walks."""
    folders = documents.search_folders()
    base = folders[0] if folders else Path.home() / "Documents"
    return base / FOLDER_NAME


def save(book: dict, text: str) -> tuple[Path, int]:
    """Write the book, license stripped, where document search will find it."""
    folder = books_home()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / file_name(book)
    body = strip_license(text)
    path.write_text(body, encoding="utf-8")
    return path, len(body)
