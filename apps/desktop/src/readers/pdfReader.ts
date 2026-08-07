import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import { defaultFontSize, type Reader, type ReaderLocation, type ReaderTheme } from "./reader";

// pdf.js is loaded lazily (dynamic import) so node/vitest environments
// never touch it — it needs DOM APIs (DOMMatrix, canvas) at import time.
type PdfJsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJsModule> | null = null;

function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      // Vite resolves the worker as a real asset in dev and build.
      mod.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return mod;
    });
  }
  return pdfjsPromise;
}

/** PDF reader over pdf.js. Page-based: next/previous flip pages,
 *  locations are "Página N de M", progress is page fraction. Text comes
 *  from getTextContent so the agent can read without a viewport. */
export class PdfReader implements Reader {
  private doc: PDFDocumentProxy | null = null;
  private loadTask: ReturnType<PdfJsModule["getDocument"]> | null = null;
  private page: PDFPageProxy | null = null;
  private pageNum = 1;
  private fontSize = 17;
  private canvas: HTMLCanvasElement | null = null;
  private scale = 1.4;
  onLocationChange?: (loc: ReaderLocation) => void;

  async open(url: string, container: HTMLElement): Promise<void> {
    this.dispose();
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pdf-page";
    container.appendChild(this.canvas);
    const pdfjs = await loadPdfjs();
    this.loadTask = pdfjs.getDocument({ url });
    const doc = await this.loadTask.promise;
    this.doc = doc;
    this.fontSize = defaultFontSize(container.clientWidth || 700);
    await this.showPage(1);
    this.emit();
  }

  private async showPage(n: number): Promise<void> {
    if (!this.doc || !this.canvas) return;
    const clamped = Math.min(Math.max(1, n), this.doc.numPages);
    this.page?.cleanup();
    this.page = await this.doc.getPage(clamped);
    this.pageNum = clamped;
    const viewport = this.page.getViewport({ scale: this.scale });
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(viewport.width * dpr);
    this.canvas.height = Math.floor(viewport.height * dpr);
    this.canvas.style.width = `${Math.floor(viewport.width)}px`;
    this.canvas.style.height = `${Math.floor(viewport.height)}px`;
    await this.page.render({
      canvas: this.canvas,
      viewport,
    }).promise;
    this.emit();
  }

  private emit(): void {
    if (!this.doc) return;
    this.onLocationChange?.({
      locator: String(this.pageNum),
      label: `Página ${this.pageNum} de ${this.doc.numPages}`,
      progress: this.pageNum / this.doc.numPages,
    });
  }

  next(): void {
    if (this.doc && this.pageNum < this.doc.numPages) void this.showPage(this.pageNum + 1);
  }

  previous(): void {
    if (this.pageNum > 1) void this.showPage(this.pageNum - 1);
  }

  goTo(locator: string): void {
    const n = Number.parseInt(locator, 10);
    if (Number.isFinite(n)) void this.showPage(n);
  }

  async getText(): Promise<string> {
    if (!this.doc) return "";
    const parts: string[] = [];
    for (let n = 1; n <= this.doc.numPages; n += 1) {
      const page = await this.doc.getPage(n);
      const tc = await page.getTextContent();
      parts.push(`— Página ${n} —\n` + tc.items.map((i) => ("str" in i ? i.str : "")).join(" "));
      page.cleanup();
    }
    return parts.join("\n\n");
  }

  getCurrentLocation(): ReaderLocation | null {
    if (!this.doc) return null;
    return {
      locator: String(this.pageNum),
      label: `Página ${this.pageNum} de ${this.doc.numPages}`,
      progress: this.pageNum / this.doc.numPages,
    };
  }

  setFontSize(px: number): void {
    this.fontSize = px;
    this.scale = 1.2 + (px - 14) * 0.08;
    if (this.doc) void this.showPage(this.pageNum);
  }

  setTheme(_theme: ReaderTheme): void {
    // PDF pages are rendered artwork; the surrounding chrome keeps the
    // app theme. Nothing to override inside the page.
  }

  dispose(): void {
    this.page?.cleanup();
    this.page = null;
    if (this.doc) {
      void this.loadTask?.destroy();
      this.doc = null;
    }
    this.canvas?.remove();
    this.canvas = null;
  }
}
