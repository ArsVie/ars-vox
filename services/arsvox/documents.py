"""Documents the user actually has on the machine, shown on the panel as pages.

The user says "abrí el diario de hoy" or "pase la página". The document is shown
in the window's panel — pdf pages exactly as they are, text cut into page-sized
pieces — and nothing is read out loud: reading aloud is deferred (Ars's call,
2026-09-19). One cursor per session, kept in the log, so the page survives a
restart.
"""

from __future__ import annotations

import os
import re
import subprocess
import time
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path

CHUNK_CHARS = 1400
MAX_FILES_SCANNED = 20_000
MAX_DEPTH = 4
DEADLINE_S = 3.0
READABLE = {".pdf", ".txt", ".md", ".epub", ".html", ".htm"}
FOLDERS = ("Documents", "Desktop", "Downloads")
# Folders that hold tens of thousands of files and never a document the user means.
NOISE = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", "site-packages", ".cache",
    "dist", "build", "packages", "AppData", "$RECYCLE.BIN", ".idea", ".vs", ".mypy_cache",
    ".pytest_cache", "target", "obj", "bin", "out",
}


def _windows_home() -> Path | None:
    """The real Windows profile, even when this service is driven from WSL."""
    profile = os.environ.get("USERPROFILE", "").strip()
    if profile and ":" in profile:
        drive, rest = profile[0].lower(), profile[2:].replace("\\", "/")
        candidate = Path(f"/mnt/{drive}{rest}")
        if candidate.is_dir():
            return candidate
    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", "$env:USERPROFILE"],
            capture_output=True,
            text=True,
            timeout=25,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    text = completed.stdout.strip()
    if ":" not in text:
        return None
    drive, rest = text[0].lower(), text[2:].replace("\\", "/")
    candidate = Path(f"/mnt/{drive}{rest}")
    return candidate if candidate.is_dir() else None


def default_folders() -> list[Path]:
    """Where the user keeps things. On Windows that is the real home directory."""
    if os.name == "nt":
        home = Path.home()
        return [home / name for name in FOLDERS if (home / name).is_dir()]
    # driven from WSL during development: read the Windows side, found by name and
    # not by luck — sorting /mnt/c/Users used to hand back ".NET v4.5"
    home = _windows_home()
    if home is None:
        users = Path("/mnt/c/Users")
        candidates = [
            entry
            for entry in sorted(users.iterdir())
            if entry.is_dir() and not entry.name.startswith((".", "All "))
        ] if users.is_dir() else []
        for entry in candidates:
            if (entry / "Desktop").is_dir():
                home = entry
                break
    if home is not None:
        found = [home / name for name in FOLDERS if (home / name).is_dir()]
        if found:
            return found
    home = Path.home()
    return [home / name for name in FOLDERS if (home / name).is_dir()]


def folder_override() -> list[Path]:
    raw = os.environ.get("ARSVOX_DOCS", "").strip()
    if not raw:
        return []
    return [Path(part) for part in raw.split(os.pathsep) if part.strip()]


_CONFIGURED: list[Path] = []


def set_search_folders(paths: list[str | Path] | None) -> None:
    """The folders the user set in the window; empty drops back to the defaults."""
    global _CONFIGURED
    _CONFIGURED = [Path(path) for path in paths] if paths else []


def search_folders() -> list[Path]:
    return _CONFIGURED or folder_override() or default_folders()


def list_books(limit: int = 12, deadline_s: float = DEADLINE_S) -> list[Path]:
    """The readable files on the shelf, newest first — for "¿qué libros tengo?"."""
    deadline = time.monotonic() + deadline_s
    found: list[Path] = []
    scanned = 0
    for root in search_folders():
        if not root.is_dir():
            continue
        for path in _walk(root, deadline):
            scanned += 1
            if scanned > MAX_FILES_SCANNED:
                break
            if path.suffix.lower() in READABLE:
                found.append(path)
        if scanned > MAX_FILES_SCANNED:
            break

    def moment(path: Path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    found.sort(key=moment, reverse=True)
    return found[:limit]


def normalize(text: str) -> str:
    """Lowercase and strip accents and punctuation: 'Diario de hoy.pdf' -> 'diario de hoy pdf'."""
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", plain.lower()).strip()


@dataclass(slots=True)
class Found:
    path: Path
    score: int

    @property
    def title(self) -> str:
        return self.path.stem.replace("_", " ").replace("-", " ").strip()


def _walk(root: Path, deadline: float, depth_limit: int = MAX_DEPTH):
    """Pruned, depth-limited walk. 145k files live under these folders and a bare
    recursive listing costs 25 seconds, so the noise is skipped and the walk stops
    at a deadline."""
    stack: list[tuple[Path, int]] = [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        if depth > depth_limit or time.monotonic() > deadline:
            continue
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        for entry in entries:
            try:
                if entry.is_dir(follow_symlinks=False):
                    name = entry.name
                    if name in NOISE or name.startswith("."):
                        continue
                    stack.append((Path(entry.path), depth + 1))
                elif entry.is_file(follow_symlinks=False):
                    if entry.name.startswith("."):
                        continue  # hidden files and macOS ._ forks are never the document
                    yield Path(entry.path)
            except OSError:
                continue


def score_match(query: str, name: str) -> int:
    """How well a file name answers what was asked. Higher is better, 0 is no match."""
    wanted = normalize(query)
    candidate = normalize(name)
    if not wanted or not candidate:
        return 0
    if wanted in candidate:
        return 100 + len(wanted)
    words = [word for word in wanted.split() if len(word) > 2]
    if not words:
        return 0
    hits = sum(1 for word in words if word in candidate)
    return hits * 20 if hits else 0


def find(
    query: str, folders: list[Path] | None = None, limit: int = 8, deadline_s: float = DEADLINE_S
) -> tuple[list[Found], bool]:
    """Files whose names answer the query, best first, plus whether the walk was cut."""
    roots = folders if folders is not None else search_folders()
    deadline = time.monotonic() + deadline_s
    found: list[Found] = []
    scanned = 0
    for root in roots:
        if not root.is_dir():
            continue
        for path in _walk(root, deadline):
            scanned += 1
            if scanned > MAX_FILES_SCANNED:
                return _rank(found, limit), True
            if path.suffix.lower() not in READABLE:
                continue
            score = score_match(query, path.stem)
            if score:
                found.append(Found(path, score))
    return _rank(found, limit), scanned >= MAX_FILES_SCANNED or time.monotonic() > deadline


def _rank(found: list[Found], limit: int) -> list[Found]:
    found.sort(key=lambda item: (-item.score, -item.path.stat().st_mtime))
    return found[:limit]


# ---- reading ---------------------------------------------------------------

def _pdf_text(path: Path) -> str:
    import pymupdf

    with pymupdf.open(str(path)) as document:
        return "\n".join(page.get_text() for page in document)


def _epub_text(path: Path) -> str:
    """An epub is a zip of xhtml. Strip the tags with the standard library."""
    pieces: list[str] = []
    with zipfile.ZipFile(path) as archive:
        names = sorted(n for n in archive.namelist() if n.lower().endswith((".xhtml", ".html", ".htm")))
        for name in names:
            raw = archive.read(name).decode("utf-8", "replace")
            raw = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
            pieces.append(re.sub(r"(?s)<[^>]+>", " ", raw))
    return " ".join(pieces)


def extract_text(path: str | Path) -> str:
    target = Path(path)
    suffix = target.suffix.lower()
    if suffix == ".pdf":
        text = _pdf_text(target)
    elif suffix == ".epub":
        text = _epub_text(target)
    else:
        text = target.read_text(encoding="utf-8", errors="replace")
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# ---- showing: the panel's pages --------------------------------------------

PAGE_WIDTH = 1400  # a pdf page renders this wide; the window fits it to the panel


def is_pdf(path: str | Path) -> bool:
    return Path(path).suffix.lower() == ".pdf"


def pdf_pages(path: str | Path) -> int:
    import pymupdf

    with pymupdf.open(str(path)) as document:
        return document.page_count


def render_pdf_page(path: str | Path, page: int, width: int = PAGE_WIDTH) -> bytes:
    """One pdf page as a png, rendered wide enough for the panel to fit it."""
    import pymupdf

    with pymupdf.open(str(path)) as document:
        number = max(1, min(page, document.page_count))
        target = document[number - 1]
        zoom = width / max(target.rect.width, 1)
        pixmap = target.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        return pixmap.tobytes("png")


def page_count(path: str | Path, text: str | None = None) -> int:
    """How many pages the panel shows: pdf pages, or text cut into page-sized pieces."""
    if is_pdf(path):
        return pdf_pages(path)
    body = text if text is not None else extract_text(path)
    return max(1, -(-len(body) // CHUNK_CHARS))


def text_page(text: str, page: int) -> str:
    start = max(page - 1, 0) * CHUNK_CHARS
    return text[start : start + CHUNK_CHARS]


def paginate(path: str | Path, cursor: int, to: int | None = None, step: int | None = None) -> dict:
    """Where a page request lands: the page, the new cursor, and the page's text.

    Pdf documents page over their own pages (the cursor is the page number);
    text documents cut into page-sized pieces (the cursor is a character offset).
    """
    if is_pdf(path):
        pages = pdf_pages(path)
        current = max(1, min(cursor, pages))
        mode = "pdf"
        body = None
    else:
        body = extract_text(path)
        pages = page_count(path, body)
        current = min(cursor // CHUNK_CHARS + 1, pages)
        mode = "text"
    if to:
        page = to
    elif step:
        page = current + step
    else:
        page = current + 1  # "pase la página" means forward
    page = max(1, min(page, pages))
    moved = {
        "mode": mode,
        "page": page,
        "pages": pages,
        "cursor": page if mode == "pdf" else (page - 1) * CHUNK_CHARS,
    }
    if mode == "text":
        moved["text"] = text_page(body, page)
    return moved


def page_payload(title: str, moved: dict) -> dict:
    """The document_state event a page request leaves in the log."""
    payload = {
        "action": "page",
        "title": title,
        "mode": moved["mode"],
        "page": moved["page"],
        "pages": moved["pages"],
    }
    if moved["mode"] == "text":
        payload["text"] = moved["text"]
    return payload
