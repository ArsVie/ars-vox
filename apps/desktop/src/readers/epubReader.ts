import type { Book, Location as EpubLocation, Rendition } from "epubjs";

import { defaultFontSize, type Reader, type ReaderLocation, type ReaderTheme } from "./reader";

// epub.js is loaded lazily so node/vitest environments never touch it.
type EpubModule = typeof import("epubjs");
let epubPromise: Promise<EpubModule> | null = null;

function loadEpubjs(): Promise<EpubModule> {
  if (!epubPromise) {
    epubPromise = import("epubjs");
  }
  return epubPromise;
}

const THEME_STYLES: Record<ReaderTheme, Record<string, string>> = {
  light: {
    body: "background:#f7f4ee; color:#26221c;",
    a: "color:#2b6cb0;",
  },
  sepia: {
    body: "background:#f1e8d7; color:#4a3f2e;",
    a: "color:#8a6d3b;",
  },
  dark: {
    body: "background:#141b26; color:#c9d2df;",
    a: "color:#5aa7ff;",
  },
};

const THEME_NAME: Record<ReaderTheme, string> = {
  light: "ars-light",
  sepia: "ars-sepia",
  dark: "ars-dark",
};

/** Spine items at runtime are Section instances (which carry load()).
 *  The published SpineItem type omits it; this cast is the honest
 *  runtime contract. */
type LoadableSection = { load(book: Book): Document; href: string };

/** EPUB reader over epub.js (0.3.x, battle-tested). Paginated flow,
 *  CFI locations, theme + font size via rendition.themes. */
export class EpubReader implements Reader {
  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private theme: ReaderTheme = "light";
  private fontSize = 17;
  private title = "";
  private onRelocated = (loc: EpubLocation | undefined): void => {
    if (!loc?.start) return;
    const { page, total } = loc.start.displayed;
    this.onLocationChange?.({
      locator: loc.start.cfi,
      label: page > 0 && total > 0 ? `Página ${page} de ${total}` : this.title,
      progress: total > 0 ? page / total : 0,
    });
  };
  onLocationChange?: (loc: ReaderLocation) => void;

  async open(url: string, container: HTMLElement): Promise<void> {
    this.dispose();
    const width = Math.max(container.clientWidth || 700, 280);
    const height = Math.max(container.clientHeight || 500, 200);
    const { default: ePub } = await loadEpubjs();
    this.book = ePub(url);
    this.rendition = this.book.renderTo(container, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      // Single-page always: no spreads, regardless of panel width.
      spread: "none",
      minSpreadWidth: 100000,
    });
    this.fontSize = defaultFontSize(width);

    // Register + apply the theme immediately so the first page isn't a
    // white flash.
    (Object.keys(THEME_STYLES) as ReaderTheme[]).forEach((t) => {
      this.rendition!.themes.register(THEME_NAME[t], THEME_STYLES[t]);
    });
    this.applyTheme();
    this.applyFontSize();

    const meta = await this.book.loaded.metadata;
    this.title = (meta?.title as string | undefined) ?? "";

    this.rendition.on("relocated", this.onRelocated);
    await this.rendition.display();
  }

  private applyTheme(): void {
    this.rendition?.themes.select(THEME_NAME[this.theme]);
  }

  private applyFontSize(): void {
    this.rendition?.themes.override("font-size", `${this.fontSize}px`);
  }

  next(): void {
    void this.rendition?.next();
  }

  previous(): void {
    void this.rendition?.prev();
  }

  goTo(locator: string): void {
    // rendition.display accepts a CFI string target.
    void this.rendition?.display(locator);
  }

  async getText(): Promise<string> {
    if (!this.book) return "";
    try {
      const spine = (await this.book.loaded.spine) as unknown as LoadableSection[];
      const parts: string[] = [];
      for (const item of spine) {
        const doc = item.load(this.book);
        const text = doc?.body?.innerText?.replace(/\s+/g, " ").trim();
        if (text) parts.push(text);
      }
      return parts.join("\n\n");
    } catch {
      return "";
    }
  }

  getCurrentLocation(): ReaderLocation | null {
    if (!this.rendition) return null;
    try {
      const loc = this.rendition.currentLocation();
      if (!loc?.cfi) return null;
      const { page, total } = loc.displayed;
      return {
        locator: loc.cfi,
        label: page > 0 && total > 0 ? `Página ${page} de ${total}` : this.title,
        progress: total > 0 ? page / total : 0,
      };
    } catch {
      return null;
    }
  }

  setFontSize(px: number): void {
    this.fontSize = px;
    this.applyFontSize();
  }

  setTheme(theme: ReaderTheme): void {
    this.theme = theme;
    this.applyTheme();
  }

  dispose(): void {
    this.rendition?.off("relocated", this.onRelocated);
    this.rendition?.destroy();
    this.rendition = null;
    this.book?.destroy();
    this.book = null;
  }
}
