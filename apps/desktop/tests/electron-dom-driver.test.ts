/**
 * W2-DRIVE (GATE-5) — the main-process DOM executor.
 *
 * The driver is pure (takes a WebContents-like object), so these tests
 * hand it a fake webContents directly — no electron mock needed. They
 * pin:
 *  - click by selector AND by aria-label/role hint resolution;
 *  - scroll by pixel value AND scrollIntoView for a target;
 *  - set_value via the NATIVE SETTER + bubbling input event (the
 *    React/Vue silent-noop failure mode);
 *  - query bounded: in-page slice + main-side re-truncation cap with
 *    the honest truncation marker;
 *  - the no-page guard (destroyed / empty URL -> "no page", never
 *    executeJavaScript);
 *  - executeJavaScript failures surface as honest "error: ..." results.
 */
import { describe, expect, it, vi } from "vitest";

import {
  DOM_QUERY_CAP,
  DOM_TRUNCATION_MARKER,
  NO_PAGE_RESULT,
  executeDomAction,
  type DomActionRequest,
} from "../electron/dom-driver";

interface FakeWebContents {
  isDestroyed: () => boolean;
  getURL: () => string;
  executeJavaScript: ReturnType<typeof vi.fn>;
}

function makeWc(overrides: Partial<FakeWebContents> = {}): FakeWebContents {
  return {
    isDestroyed: () => false,
    getURL: () => "https://example.com/page",
    executeJavaScript: vi.fn(async () => "ok"),
    ...overrides,
  };
}

const click: DomActionRequest = { operation: "click", target: "button#go", value: null };
const scroll: DomActionRequest = { operation: "scroll", target: "", value: "400" };
const setValue: DomActionRequest = { operation: "set_value", target: "#search", value: "pasta" };
const query: DomActionRequest = { operation: "query", target: "", value: null };

describe("click", () => {
  it("runs a selector-based click script against the view's webContents and returns its result", async () => {
    const wc = makeWc({ executeJavaScript: vi.fn(async () => "clicked button#go") });
    const result = await executeDomAction(wc as never, click);
    expect(result).toBe("clicked button#go");
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(1);
    const [script] = wc.executeJavaScript.mock.calls[0];
    expect(script).toContain("document.querySelector");
    expect(script).toContain(".click()");
    expect(script).toContain("button#go");
  });

  it("resolves aria-label/role hints (getByRole-ish) when the selector misses", async () => {
    const wc = makeWc({ executeJavaScript: vi.fn(async () => "clicked Buscar") });
    const result = await executeDomAction(
      wc as never,
      { operation: "click", target: "Buscar", value: null },
    );
    expect(result).toBe("clicked Buscar");
    const [script] = wc.executeJavaScript.mock.calls[0];
    expect(script).toContain('[aria-label="');
    expect(script).toContain('[role="');
    expect(script).toContain("CSS.escape");
  });

  it("returns the honest not-found result when the page cannot resolve the target", async () => {
    const wc = makeWc({ executeJavaScript: vi.fn(async () => "not found: #nope") });
    const result = await executeDomAction(wc as never, {
      operation: "click",
      target: "#nope",
      value: null,
    });
    expect(result).toBe("not found: #nope");
  });
});

describe("scroll", () => {
  it("scrolls by pixels when a numeric value is given", async () => {
    const wc = makeWc({ executeJavaScript: vi.fn(async () => "scrolled 400") });
    const result = await executeDomAction(wc as never, scroll);
    expect(result).toBe("scrolled 400");
    const [script] = wc.executeJavaScript.mock.calls[0];
    expect(script).toContain("window.scrollBy");
    expect(script).toContain("400");
  });

  it("scrolls a target into view when no value is given", async () => {
    const wc = makeWc({ executeJavaScript: vi.fn(async () => "scrolled to #footer") });
    const result = await executeDomAction(wc as never, {
      operation: "scroll",
      target: "#footer",
      value: null,
    });
    expect(result).toBe("scrolled to #footer");
    const [script] = wc.executeJavaScript.mock.calls[0];
    expect(script).toContain("scrollIntoView");
    expect(script).toContain("#footer");
  });
});

describe("set_value", () => {
  it("uses the NATIVE value setter + bubbling input event (React/Vue silent-noop guard)", async () => {
    const wc = makeWc({ executeJavaScript: vi.fn(async () => "set #search = pasta") });
    const result = await executeDomAction(wc as never, setValue);
    expect(result).toBe("set #search = pasta");
    const [script] = wc.executeJavaScript.mock.calls[0];
    expect(script).toContain("Object.getOwnPropertyDescriptor");
    expect(script).toContain("HTMLInputElement.prototype");
    expect(script).toContain("HTMLTextAreaElement.prototype");
    expect(script).toContain('.set.call(el, "pasta")');
    expect(script).toContain('new Event("input", { bubbles: true })');
    expect(script).toContain("dispatchEvent");
  });

  it("returns an honest not-an-input result for non-input targets", async () => {
    const wc = makeWc({
      executeJavaScript: vi.fn(async () => "not an input: #box"),
    });
    const result = await executeDomAction(wc as never, {
      operation: "set_value",
      target: "#box",
      value: "x",
    });
    expect(result).toBe("not an input: #box");
    const [script] = wc.executeJavaScript.mock.calls[0];
    expect(script).toContain("not an input");
  });
});

describe("query", () => {
  it("reads the whole page as bounded innerText with an in-page truncation marker", async () => {
    const wc = makeWc({ executeJavaScript: vi.fn(async () => "page text") });
    const result = await executeDomAction(wc as never, query);
    expect(result).toBe("page text");
    const [script] = wc.executeJavaScript.mock.calls[0];
    expect(script).toContain("innerText");
    expect(script).toContain(`slice(0, ${DOM_QUERY_CAP})`);
    expect(script).toContain("[text truncated at 8000 chars]");
  });

  it("targets a specific element's textContent when a target is given", async () => {
    const wc = makeWc({ executeJavaScript: vi.fn(async () => "article body") });
    const result = await executeDomAction(wc as never, {
      operation: "query",
      target: "article",
      value: null,
    });
    expect(result).toBe("article body");
    const [script] = wc.executeJavaScript.mock.calls[0];
    expect(script).toContain('document.querySelector("article")');
    expect(script).toContain("textContent");
  });

  it("re-truncates main-side: a page can never push unbounded text back (cap + marker)", async () => {
    const huge = "x".repeat(20000);
    const wc = makeWc({ executeJavaScript: vi.fn(async () => huge) });
    const result = await executeDomAction(wc as never, query);
    expect(result.length).toBe(DOM_QUERY_CAP + DOM_TRUNCATION_MARKER.length);
    expect(result.endsWith(DOM_TRUNCATION_MARKER)).toBe(true);
    expect(result.startsWith("x".repeat(DOM_QUERY_CAP))).toBe(true);
  });

  it("does not mark a result that fits within the cap", async () => {
    const wc = makeWc({ executeJavaScript: vi.fn(async () => "short") });
    const result = await executeDomAction(wc as never, query);
    expect(result).toBe("short");
  });
});

describe("no-page guard + failures (honest results, never throws)", () => {
  it("returns 'no page' for a destroyed webContents and never executes JS", async () => {
    const wc = makeWc({ isDestroyed: () => true });
    const result = await executeDomAction(wc as never, click);
    expect(result).toBe(NO_PAGE_RESULT);
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
  });

  it("returns 'no page' when the view has no loaded URL", async () => {
    const wc = makeWc({ getURL: () => "" });
    const result = await executeDomAction(wc as never, click);
    expect(result).toBe(NO_PAGE_RESULT);
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
  });

  it("returns an honest error result when executeJavaScript rejects", async () => {
    const wc = makeWc({
      executeJavaScript: vi.fn(async () => {
        throw new Error("renderer gone");
      }),
    });
    const result = await executeDomAction(wc as never, query);
    expect(result).toBe("error: renderer gone");
  });

  it("rejects invalid operations honestly", async () => {
    const wc = makeWc();
    const result = await executeDomAction(wc as never, {
      operation: "hover" as never,
      target: "a",
      value: null,
    });
    expect(result).toContain("invalid operation");
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
  });
});
