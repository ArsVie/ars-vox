/** Unified reader API — the agent and the UI talk to ONE ReaderPanel;
 *  pdf.js and epub.js deal with the formats behind it (per the
 *  2026-08-07 reader decision: pdfjs-dist + epubjs, no external reader,
 *  no conversion pipeline). */

export type ReaderTheme = "light" | "sepia" | "dark";

export interface ReaderLocation {
  /** Stable identifier: EPUB CFI or PDF page number. */
  locator: string;
  /** Human-readable position, e.g. "Página 2 de 4" / "Capítulo 1". */
  label: string;
  /** 0..1 within the document. */
  progress: number;
}

export interface Reader {
  /** Load a document from a fetchable URL (web demo / Electron custom
   *  protocol — never file://). Returns once the first page is shown. */
  open(url: string, container: HTMLElement): Promise<void>;
  next(): void;
  previous(): void;
  goTo(locator: string): void;
  /** Full readable text of the document (for the agent's context). */
  getText(): Promise<string>;
  getCurrentLocation(): ReaderLocation | null;
  setFontSize(px: number): void;
  setTheme(theme: ReaderTheme): void;
  /** Called whenever the reading position changes. */
  onLocationChange?: (loc: ReaderLocation) => void;
  dispose(): void;
}

/** Adaptive default font size, scaled from the container width so a
 *  small rail never overflows and a full panel is still comfortable. */
export function defaultFontSize(containerWidth: number): number {
  if (containerWidth < 420) return 14;
  if (containerWidth < 760) return 16;
  return 17;
}

export const THEME_LABELS: Record<ReaderTheme, string> = {
  light: "Papel",
  sepia: "Sepia",
  dark: "Nocturno",
};
