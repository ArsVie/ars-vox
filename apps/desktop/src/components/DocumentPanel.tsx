import { useStore } from "zustand";
import { useMemo, useState } from "react";

import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { appStore } from "../store";
import { PanelHeader } from "./PanelHeader";
import { ReaderView } from "./ReaderView";
import { DocumentIcon, PenIcon } from "./icons";

const KIND_LABEL: Record<string, string> = {
  txt: "Texto",
  md: "Markdown",
  pdf: "PDF",
  epub: "EPUB",
};

/** Minimal markdown-ish renderer: headings, paragraphs, lists, emphasis. */
function renderText(text: string): React.ReactNode[] {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (/^#{1,3} /.test(trimmed)) {
      const level = trimmed.match(/^(#+)/)?.[1].length ?? 1;
      const body = trimmed.replace(/^#+ /, "");
      return (
        <h3 key={i} className={`doc-h${level}`}>
          {body}
        </h3>
      );
    }
    if (/^[-*] /.test(trimmed)) {
      return (
        <ul key={i} className="doc-list">
          {trimmed
            .split(/\n(?=[-*] )/)
            .map((line) => line.replace(/^[-*] /, ""))
            .map((line, j) => (
              <li key={j}>{line}</li>
            ))}
        </ul>
      );
    }
    return (
      <p key={i} className="doc-paragraph">
        {trimmed}
      </p>
    );
  });
}

/**
 * Document panel — reader for txt/md (rendered) and pdf/epub (text from
 * the extraction layer, kind badge shown) plus a lightweight agent-first
 * editor. The user and the agent edit the same document: user edits are
 * sent as document.save, agent edits arrive via document.load events.
 */
export function DocumentPanel({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const doc = useStore(appStore, (s) => s.content.document_editor);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [draft, setDraft] = useState("");

  const content = doc?.content ?? "";
  const chapters = doc?.chapters ?? [];
  const isBinary = (doc?.kind === "pdf" || doc?.kind === "epub") && Boolean(doc?.url);
  const hasContent =
    doc !== undefined &&
    (content.length > 0 || chapters.length > 0 || (isBinary && Boolean(doc?.url)));

  const fullText = useMemo(() => {
    if (content) return content;
    return chapters.map((c) => `## ${c.title}\n\n${c.content}`).join("\n\n");
  }, [content, chapters]);

  const title = doc?.title ?? meta?.title ?? "Documento";
  const canEdit = doc?.kind === "txt" || doc?.kind === "md" || (!isBinary && hasContent);

  const startEdit = (): void => {
    setDraft(fullText);
    setMode("edit");
  };

  const saveEdit = (): void => {
    dispatchCommand({ action: "document.save", panel_type: panelId, content: draft });
    setMode("read");
  };

  return (
    <section className="panel document-panel" aria-label="Documento">
      <PanelHeader panelId={panelId} icon={<DocumentIcon size={15} />}>
        {title}
      </PanelHeader>
      {!hasContent ? (
        <div className="document-body">
          <div className="content-panel-empty">
            <span className="content-panel-empty-icon">
              <DocumentIcon size={30} />
            </span>
            <span className="content-panel-empty-text">
              No hay documento abierto. Pídeme que abra uno.
            </span>
          </div>
        </div>
      ) : (
        <div className="document-body">
          <div className="document-meta-row">
            <span className="document-kind">{KIND_LABEL[doc!.kind] ?? doc!.kind}</span>
            <span className="document-path">{doc!.path}</span>
            <span className="document-spacer" />
            {mode === "read" && canEdit ? (
              <button type="button" className="document-mode-btn" onClick={startEdit}>
                <PenIcon size={13} /> Editar
              </button>
            ) : null}
          </div>
          {isBinary ? (
            <ReaderView kind={doc!.kind} url={doc!.url!} />
          ) : mode === "edit" ? (
            <div className="document-editor">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Contenido del documento"
                spellCheck={false}
              />
              <div className="document-editor-actions">
                <button
                  type="button"
                  className="document-cancel-btn"
                  onClick={() => setMode("read")}
                >
                  Cancelar
                </button>
                <button type="button" className="document-save-btn" onClick={saveEdit}>
                  Guardar
                </button>
              </div>
            </div>
          ) : (
            <div className="document-reader">
              {chapters.length > 0 ? (
                chapters.map((c) => (
                  <div key={c.title} className="doc-chapter">
                    <h3 className="doc-h2">{c.title}</h3>
                    {renderText(c.content)}
                  </div>
                ))
              ) : (
                renderText(fullText)
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
