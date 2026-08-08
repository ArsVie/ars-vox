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
  /** Fit-width by default: the first page scales so its width fills the
   *  panel (advisor review: fit-page left the text tiny for the target
   *  user). A−/A+ then zoom relative to that base. */
  private scale = 1.4;
  private baseScale = 1.4;
  onLocationChange?: (loc: ReaderLocation) => void;

  async open(url: string, container: HTMLElement): Promise<void> {
    this.dispose();
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pdf-page";
    container.appendChild(this.canvas);
    const pdfjs = await loadPdfjs();
    this.loadTask = pdfjs.getDocument({ url });
    let doc: PDFDocumentProxy;
    try {
      doc = await this.loadTask.promise;
    } catch (err) {
      // Intermittent open failures flashed "No se pudo abrir el documento"
      // (round-2); make the error deterministic and drop the blank canvas.
      this.canvas?.remove();
      this.canvas = null;
      throw new Error(
        `No se pudo abrir el documento: ${(err as Error).message}`,
      );
    }
    this.doc = doc;
    const width = container.clientWidth || 700;
    this.fontSize = defaultFontSize(width);
    // Fit-width: base scale makes page 1 exactly panel-wide (clamped
    // so tiny or huge PDFs stay readable).
    const page1 = await doc.getPage(1);
    const vp = page1.getViewport({ scale: 1 });
    page1.cleanup();
    this.baseScale = Math.min(2.5, Math.max(0.6, (width - 32) / vp.width));
    this.scale = this.baseScale;
    try {
      await this.showPage(1);
    } catch (err) {
      this.canvas?.remove();
      this.canvas = null;
      throw new Error(
        `No se pudo mostrar la página: ${(err as Error).message}`,
      );
    }
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
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo obtener el contexto 2D");
    // pdfjs-dist v6: render() reads the canvas ONLY via canvasContext.canvas
    // — a bare `canvas` param is a SILENT NO-OP (6.2.108, verified
    // empirically: render resolves, nothing paints, canvas stays black).
    // Device-pixel scale through the context transform, then render.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      // `canvas` satisfies pdfjs's RenderParameters TYPE; the v6 RUNTIME
      // reads the surface via canvasContext.canvas (bare canvas no-ops).
      await this.page
        .render({ canvas: this.canvas, canvasContext: ctx, viewport })
        .promise;
    } catch (err) {
      throw new Error(
        `No se pudo dibujar la página: ${(err as Error).message}`,
      );
    }
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
    // Zoom relative to the fit-width base: 17px = base scale.
    this.scale = this.baseScale * (px / 17);
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
