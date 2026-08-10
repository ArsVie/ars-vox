"""Document tools. File bytes live under data/documents only — the tools
never touch paths outside the configured documents directory."""

from pathlib import Path

from arsvox_contracts import PanelType
from arsvox_contracts.commands import PanelOpen
from arsvox_contracts.enums import DocumentKind
from arsvox_contracts.events import DocumentChangedEvent, DocumentLoadEvent, UiCommandEvent

from arsvox_agent.tools.context import ToolContext


def _documents_dir(tctx: ToolContext) -> Path:
    return tctx.deps.config.resolved_paths.documents_dir


def _safe_title(title: str) -> bool:
    return bool(title.strip()) and "/" not in title and "\\" not in title and ".." not in title


def _doc_path(tctx: ToolContext, title: str) -> Path:
    return _documents_dir(tctx) / f"{title.strip()}.md"


def _kind_for_path(path: Path) -> DocumentKind:
    suffix = path.suffix.lower()
    if suffix == ".txt":
        return DocumentKind.TXT
    if suffix == ".pdf":
        return DocumentKind.PDF
    if suffix == ".epub":
        return DocumentKind.EPUB
    return DocumentKind.MD


def _load_event(doc: dict) -> DocumentLoadEvent:
    """document.load payload for create/open: file content plus kind from
    the path suffix, so the renderer forms the editor bag. Without it the
    bag stays undefined and document.changed merges are dropped."""
    path = Path(doc["path"])
    kind = _kind_for_path(path)
    content = ""
    if kind in (DocumentKind.TXT, DocumentKind.MD) and path.is_file():
        content = path.read_text(encoding="utf-8")
    return DocumentLoadEvent(
        title=doc["title"],
        kind=kind,
        path=doc["path"],
        content=content,
        chapters=[],
    )


async def document_create(tctx: ToolContext, title: str) -> str:
    if not _safe_title(title):
        return "El nombre del documento no es válido."
    existing = tctx.deps.documents.find_by_title(title.strip())
    if existing:
        return f"Ya existe un documento llamado '{title}'."
    path = _doc_path(tctx, title)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")
    doc_id = tctx.deps.documents.create(title.strip(), str(path))
    tctx.deps.panels.upsert(PanelType.DOCUMENT_EDITOR.value, title, str(doc_id))
    await tctx.emit(
        UiCommandEvent(
            command=PanelOpen(
                panel_type=PanelType.DOCUMENT_EDITOR,
                title=title,
                content_reference=str(doc_id),
            )
        )
    )
    doc = tctx.deps.documents.get(doc_id)
    await tctx.emit(_load_event(doc))
    return f"Documento '{title}' creado y abierto."


async def document_list(tctx: ToolContext) -> str:
    """List registered documents (progressive disclosure: the model asks
    when it needs to know what exists — never ingested into context)."""
    docs = tctx.deps.documents.list()
    if not docs:
        return "No hay documentos guardados todavía. Puedes crear uno con document.create."
    return "Documentos disponibles:\n" + "\n".join(
        f"- {d['title']}" for d in docs
    )


async def document_search(tctx: ToolContext, query: str) -> str:
    """Search registered documents by title fragment."""
    q = query.strip().lower()
    docs = tctx.deps.documents.list()
    hits = [d for d in docs if q in d["title"].lower()]
    if not hits:
        return f"No encontré documentos que coincidan con '{query}'."
    return "Documentos encontrados:\n" + "\n".join(
        f"- {d['title']}" for d in hits
    )


async def document_open(tctx: ToolContext, title: str) -> str:
    doc = tctx.deps.documents.find_by_title(title.strip())
    if not doc:
        return f"No encontré el documento '{title}'."
    tctx.deps.panels.upsert(PanelType.DOCUMENT_EDITOR.value, doc["title"], str(doc["id"]))
    await tctx.emit(
        UiCommandEvent(
            command=PanelOpen(
                panel_type=PanelType.DOCUMENT_EDITOR,
                title=doc["title"],
                content_reference=str(doc["id"]),
            )
        )
    )
    await tctx.emit(_load_event(doc))
    return f"Documento '{doc['title']}' abierto."


async def document_save(tctx: ToolContext, title: str, content: str) -> str:
    if not _safe_title(title):
        return "El nombre del documento no es válido."
    doc = tctx.deps.documents.find_by_title(title.strip())
    if not doc:
        path = _doc_path(tctx, title)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        doc_id = tctx.deps.documents.create(title.strip(), str(path))
        doc = tctx.deps.documents.get(doc_id)
    else:
        Path(doc["path"]).write_text(content, encoding="utf-8")
    tctx.deps.documents.update_content(doc["id"], content, saved=True)
    tctx.deps.audit.log("document", "saved", {"doc_id": doc["id"], "title": title})
    await tctx.emit(
        DocumentChangedEvent(
            document_id=doc["id"],
            title=doc["title"],
            path=doc["path"],
            content=content,
        )
    )
    return f"Documento '{title}' guardado."


async def document_insert_text(tctx: ToolContext, title: str, text: str) -> str:
    doc = tctx.deps.documents.find_by_title(title.strip())
    if not doc:
        return f"No encontré el documento '{title}'."
    path = Path(doc["path"])
    current = path.read_text(encoding="utf-8") if path.is_file() else ""
    path.write_text(current + text, encoding="utf-8")
    tctx.deps.documents.update_content(doc["id"], current + text, saved=True)
    tctx.deps.audit.log("document", "insert_text", {"doc_id": doc["id"]})
    await tctx.emit(
        DocumentChangedEvent(
            document_id=doc["id"],
            title=doc["title"],
            path=doc["path"],
            content=current + text,
        )
    )
    return "Texto añadido al documento."


async def document_undo(tctx: ToolContext) -> str:
    return "Usa el botón deshacer del editor (o Ctrl+Z)."


async def document_redo(tctx: ToolContext) -> str:
    return "Usa el botón rehacer del editor (o Ctrl+Y)."


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec(
        "document.create",
        "Create a new document with the given title and open it in the editor.",
        document_create,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec("document.open", "Open an existing document by title. Call document.list first to see what exists.", document_open, PolicyKind.REVERSIBLE),
    ToolSpec("document.list", "List all saved documents.", document_list, PolicyKind.READ_ONLY),
    ToolSpec("document.search", "Search documents by title fragment.", document_search, PolicyKind.READ_ONLY),
    ToolSpec(
        "document.save",
        "Save document content to disk (scoped to the documents directory).",
        document_save,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec(
        "document.insert_text",
        "Append dictated text to the document file.",
        document_insert_text,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec("document.undo", "Undo the last edit.", document_undo, PolicyKind.REVERSIBLE),
    ToolSpec("document.redo", "Redo the last edit.", document_redo, PolicyKind.REVERSIBLE),
]
