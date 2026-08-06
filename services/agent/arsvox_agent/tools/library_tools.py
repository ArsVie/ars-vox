"""Library tools: scan the configured library directory, open books,
track and restore reading positions. EPUB support lands in Phase 2;
iteration 1 reads plain-text books (.txt) directly."""

import json
from pathlib import Path

from arsvox_contracts import PanelType
from arsvox_contracts.commands import PanelOpen
from arsvox_contracts.events import UiCommandEvent

from arsvox_agent.tools.context import ToolContext

_TEXT_EXTS = {".txt", ".md", ".epub"}


def list_books(config) -> list[dict]:
    library_dir = Path(config.memory.library_dir)
    books = []
    if library_dir.is_dir():
        for path in sorted(library_dir.iterdir()):
            if path.is_file() and path.suffix.lower() in _TEXT_EXTS:
                books.append({"id": path.stem, "title": path.stem, "path": str(path)})
    return books


def read_book_text(config, book_id: str) -> str:
    library_dir = Path(config.memory.library_dir)
    for ext in (".txt", ".md"):
        path = library_dir / f"{book_id}{ext}"
        if path.is_file():
            return path.read_text(encoding="utf-8", errors="replace")
    return ""


def _find_book(tctx: ToolContext, title: str) -> dict | None:
    for book in list_books(tctx.deps.config):
        if title.lower() in book["title"].lower():
            return book
    return None


async def library_scan(tctx: ToolContext) -> str:
    books = list_books(tctx.deps.config)
    if not books:
        return "No hay libros en la biblioteca configurada."
    return json.dumps(books, ensure_ascii=False)


async def library_search(tctx: ToolContext, query: str) -> str:
    books = [b for b in list_books(tctx.deps.config) if query.lower() in b["title"].lower()]
    return json.dumps(books, ensure_ascii=False) if books else "Sin resultados."


async def library_open(tctx: ToolContext, title: str) -> str:
    book = _find_book(tctx, title)
    if not book:
        return f"No encontré el libro '{title}'."
    position = tctx.deps.progress.get("book", book["id"])
    tctx.deps.panels.upsert(PanelType.BOOK_READER.value, book["title"], book["id"])
    await tctx.emit(
        UiCommandEvent(
            command=PanelOpen(
                panel_type=PanelType.BOOK_READER,
                title=book["title"],
                content_reference=book["id"],
            )
        )
    )
    if position:
        return f"Abriendo '{book['title']}' donde lo dejaste (sección {position.get('section', 0)})."
    return f"Abriendo '{book['title']}'."


async def library_continue_reading(tctx: ToolContext) -> str:
    latest = tctx.deps.progress.latest("book")
    if latest:
        return await library_open(tctx, latest["ref_id"])
    books = list_books(tctx.deps.config)
    if books:
        return await library_open(tctx, books[0]["title"])
    return "No hay libros guardados todavía."


async def library_get_position(tctx: ToolContext, book: str) -> str:
    position = tctx.deps.progress.get("book", book)
    return json.dumps(position) if position else "No hay posición guardada."


async def library_set_position(tctx: ToolContext, book: str, section: int, progress: float) -> str:
    tctx.deps.progress.set("book", book, {"section": section, "progress": round(progress, 4)})
    return f"Posición guardada en '{book}' (sección {section})."


async def library_read_selection(tctx: ToolContext, book: str) -> str:
    position = tctx.deps.progress.get("book", book) or {"section": 0}
    text = read_book_text(tctx.deps.config, book)
    sections = [s for s in text.split("\n\n") if s.strip()]
    idx = min(position.get("section", 0), max(len(sections) - 1, 0))
    if not sections:
        return "El libro está vacío."
    return sections[idx][:600]


async def library_read_next_section(tctx: ToolContext, book: str) -> str:
    position = tctx.deps.progress.get("book", book) or {"section": 0}
    text = read_book_text(tctx.deps.config, book)
    sections = [s for s in text.split("\n\n") if s.strip()]
    if not sections:
        return "El libro está vacío."
    idx = min(position.get("section", 0) + 1, len(sections) - 1)
    tctx.deps.progress.set("book", book, {"section": idx, "progress": round((idx + 1) / len(sections), 4)})
    return sections[idx][:600]


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec("library.scan", "List the books available in the configured library.", library_scan, PolicyKind.READ_ONLY),
    ToolSpec("library.search", "Search the library by title.", library_search, PolicyKind.READ_ONLY),
    ToolSpec(
        "library.open",
        "Open a book by title; restores the saved reading position when present.",
        library_open,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec(
        "library.continue_reading",
        "Open the book the user was last reading, at the saved position.",
        library_continue_reading,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec("library.get_position", "Get the saved reading position of a book.", library_get_position, PolicyKind.READ_ONLY),
    ToolSpec(
        "library.set_position",
        "Save the reading position of a book (section index and 0..1 progress).",
        library_set_position,
        PolicyKind.USER_VISIBLE,
    ),
    ToolSpec("library.read_selection", "Return the current section text of a book.", library_read_selection, PolicyKind.USER_VISIBLE),
    ToolSpec(
        "library.read_next_section",
        "Advance to the next section and return its text.",
        library_read_next_section,
        PolicyKind.USER_VISIBLE,
    ),
]
