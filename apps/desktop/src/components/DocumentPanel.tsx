import { useStore } from "zustand";
import { useMemo, useState } from "react";

import type { PanelId } from "../contracts";
import type { PanelMeta } from "../store";
import type { ReaderLocation } from "../readers/reader";
import { appStore } from "../store";
import { useSurfaceRole } from "../roles/context";
import { PanelHeader } from "./PanelHeader";
import { ReaderView } from "./ReaderView";
import { DocumentIcon, PenIcon } from "./icons";
import { SelectionActions } from "./SelectionActions";
import "./document-panel.css";

/**
 * UI-203: the reading surface adapts to its semantic role. The role host
 * (SurfaceHost) provides useSurfaceRole() — the adaptive mount is the ONLY
 * mount; every DocumentPanel instance renders inside a SurfaceRoleProvider.
 */

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
  const setSurfaceState = useStore(appStore, (s) => s.setSurfaceState);
  // UI-203: authoritative reading position lives in the per-surface state
  // bag (store.surfaceState[panelId]), so it survives role/template
  // changes AND any remount — the host keyed by surfaceId preserves the
  // instance, the store preserves the position.
  const readingLocation = useStore(
    appStore,
    (s) =>
      (s.surfaceState[panelId] as { readingLocation?: ReaderLocation } | undefined)
        ?.readingLocation,
  );
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [draft, setDraft] = useState("");

  const { role } = useSurfaceRole();

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

  // Source chip (gallery style): short type badge + file name + link icon.
  const chipKind = doc?.kind ?? "txt";
  const chipTone = chipKind === "pdf" ? "pdf" : chipKind === "epub" ? "epub" : "file";
  const chipName = doc?.title || doc?.path?.split("/").pop() || meta?.title || "Documento";

  const startEdit = (): void => {
    setDraft(fullText);
    setMode("edit");
  };

  const saveEdit = (): void => {
    dispatchCommand({ action: "document.save", panel_type: panelId, content: draft });
    setMode("read");
  };

  return (
    <section
      className={`panel document-panel reading-surface reading-surface--${role}`}
      data-surface-role={role}
      aria-label="Documento"
    >
      <PanelHeader panelId={panelId} icon={<DocumentIcon size={15} />}>
        <span className="document-panel-title" title={title}>
          {title}
        </span>
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
            <span
              className={`doc-source-chip doc-source-chip--${chipTone}`}
              title={doc!.path}
            >
              <span className={`doc-source-badge doc-source-badge--${chipTone}`}>
                {chipKind.toUpperCase()}
              </span>
              <span className="doc-source-name">{chipName}</span>
              <svg className="doc-source-link" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M6.5 3.5h6v6M12.5 3.5L3.5 12.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
          {isBinary ? (
            <>
              {role === "support" ? (
                <div className="reading-position-strip" data-reading-position>
                  <DocumentIcon size={13} />
                  <span className="reading-position-title">{title}</span>
                  <span className="reading-position-sep" aria-hidden="true" />
                  <span className="reading-position-label">
                    {readingLocation?.label ?? "Cargando…"}
                  </span>
                </div>
              ) : null}
              <ReaderView
                kind={doc!.kind}
                url={doc!.url!}
                role={role}
                onLocationChange={(loc) =>
                  setSurfaceState(panelId, "readingLocation", loc)
                }
              />
            </>
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
      {hasContent ? <SelectionActions /> : null}
    </section>
  );
}
