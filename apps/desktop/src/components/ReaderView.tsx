import { useEffect, useRef, useState } from "react";

import type { DocumentKind } from "../contracts";
import type { Reader, ReaderLocation, ReaderTheme } from "../readers/reader";
import { THEME_LABELS } from "../readers/reader";
import { PdfReader } from "../readers/pdfReader";
import { EpubReader } from "../readers/epubReader";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

const FONT_STEPS = [14, 16, 17, 19, 22, 26];

/**
 * Real format rendering for pdf/epub behind ONE control surface (the
 * advisor's ReaderPanel): next/previous, location label, font size,
 * theme. The agent talks to the Reader interface; pdf.js/epub.js deal
 * with the formats.
 */
export function ReaderView({ kind, url }: { kind: DocumentKind; url: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<Reader | null>(null);
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [fontIdx, setFontIdx] = useState(2); // 17px default
  const [theme, setTheme] = useState<ReaderTheme>("light");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || !url) return;
    const reader: Reader | null =
      kind === "pdf" ? new PdfReader() : kind === "epub" ? new EpubReader() : null;
    if (!reader) return;
    readerRef.current = reader;
    reader.onLocationChange = setLocation;
    reader.open(url, container).catch(() => setFailed(true));
    return () => {
      reader.dispose();
      readerRef.current = null;
      container.replaceChildren();
    };
  }, [kind, url]);

  const reader = readerRef.current;

  const bumpFont = (dir: 1 | -1): void => {
    setFontIdx((i) => {
      const next = Math.min(FONT_STEPS.length - 1, Math.max(0, i + dir));
      reader?.setFontSize(FONT_STEPS[next]);
      return next;
    });
  };

  const cycleTheme = (): void => {
    if (kind !== "epub") return;
    setTheme((t) => {
      const next: ReaderTheme = t === "light" ? "sepia" : t === "sepia" ? "dark" : "light";
      reader?.setTheme(next);
      return next;
    });
  };

  return (
    <div className="reader-view">
      <div className="reader-toolbar">
        <button
          type="button"
          className="reader-nav-btn"
          aria-label="Página anterior"
          onClick={() => reader?.previous()}
        >
          <ChevronLeftIcon size={15} />
        </button>
        <button
          type="button"
          className="reader-nav-btn"
          aria-label="Página siguiente"
          onClick={() => reader?.next()}
        >
          <ChevronRightIcon size={15} />
        </button>
        <span className="reader-location">{location?.label ?? "Cargando…"}</span>
        <span className="reader-spacer" />
        <button
          type="button"
          className="reader-a11y-btn"
          aria-label="Reducir letra"
          onClick={() => bumpFont(-1)}
        >
          A−
        </button>
        <button
          type="button"
          className="reader-a11y-btn"
          aria-label="Aumentar letra"
          onClick={() => bumpFont(1)}
        >
          A+
        </button>
        {kind === "epub" ? (
          <button
            type="button"
            className="reader-a11y-btn reader-theme-btn"
            aria-label="Cambiar tema"
            onClick={cycleTheme}
          >
            {THEME_LABELS[theme]}
          </button>
        ) : null}
      </div>
      <div className="reader-stage">
        <div
          className={`reader-mount${kind === "epub" ? " reader-mount--book" : ""}`}
          ref={mountRef}
        />
        {failed ? (
          <div className="content-panel-empty">
            <span className="content-panel-empty-text">
              No se pudo abrir el documento.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
