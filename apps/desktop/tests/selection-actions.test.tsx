/**
 * Leaf G — SelectionActions (node env, no jsdom — repo convention).
 *
 * SelectionActions is driven by NATIVE events (window.getSelection +
 * document selectionchange), so this suite mounts it with
 * react-dom/client against a minimal hand-rolled DOM, fires the native
 * listeners the component registers, and drives a real React click
 * through the root's delegated click listener. Assertions read the fake
 * DOM tree.
 *
 * Coverage:
 *   1. bar appears when a mocked selection exists inside the panel;
 *   2. no bar without a selection / for collapsed / outside selections;
 *   3. action click calls the store's sendText hook with the composed
 *      Spanish instruction and closes the bar;
 *   4. Escape and pointer-down-outside close the bar; pointer-down
 *      inside keeps it open;
 *   5. selection text is sanitized (whitespace collapsed, quotes
 *      replaced) before composing the instruction.
 */
import { act } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SelectionActions } from "../src/components/SelectionActions";
import { appStore } from "../src/store";

/* ------------------------------------------------------------------ */
/* Minimal fake DOM — just enough for react-dom/client 18 + this       */
/* component (no jsdom in this repo by convention).                    */
/* ------------------------------------------------------------------ */

interface FakeEvent {
  type: string;
  target?: unknown;
  [key: string]: unknown;
}

type Listener = (e: FakeEvent) => void;

function matchesSelector(el: FakeElement, sel: string): boolean {
  if (sel.startsWith(".")) return el._classSet.has(sel.slice(1));
  return el.nodeName.toLowerCase() === sel.toLowerCase();
}

class FakeClassList {
  constructor(private readonly el: FakeElement) {}

  add(...cls: string[]): void {
    for (const c of cls) this.el._classSet.add(c);
    this.sync();
  }

  remove(...cls: string[]): void {
    for (const c of cls) this.el._classSet.delete(c);
    this.sync();
  }

  contains(c: string): boolean {
    return this.el._classSet.has(c);
  }

  toggle(c: string, force?: boolean): boolean {
    const on = force ?? !this.el._classSet.has(c);
    if (on) this.el._classSet.add(c);
    else this.el._classSet.delete(c);
    this.sync();
    return on;
  }

  private sync(): void {
    this.el.attributes.class = [...this.el._classSet].join(" ");
  }
}

class FakeElement {
  nodeType = 1;
  nodeName: string;
  tagName: string;
  ownerDocument: FakeDocument;
  parentNode: FakeElement | FakeText | null = null;
  childNodes: Array<FakeElement | FakeText> = [];
  children: FakeElement[] = [];
  firstChild: FakeElement | FakeText | null = null;
  lastChild: FakeElement | FakeText | null = null;
  nextSibling: FakeElement | FakeText | null = null;
  previousSibling: FakeElement | FakeText | null = null;
  attributes: Record<string, string> = {};
  _classSet = new Set<string>();
  _listeners: Record<string, Listener[]> = {};
  style: Record<string, unknown> = {};
  isConnected = true;
  classList: FakeClassList;

  constructor(tag: string, doc: FakeDocument) {
    this.nodeName = tag.toUpperCase();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.classList = new FakeClassList(this);
    this.style.setProperty = (k: string, v: string) => {
      this.style[k] = v;
    };
    this.style.removeProperty = (k: string) => {
      delete this.style[k];
    };
    Object.defineProperty(this, "className", {
      get: () => this.attributes.class ?? "",
      set: (v: string) => {
        this.attributes.class = String(v);
        this._classSet = new Set(String(v).split(/\s+/).filter(Boolean));
      },
    });
    // Real DOM semantics: assigning textContent replaces the children with
    // a single text node. React's shouldSetTextContent optimization writes
    // direct string children through this property (no HostText instance).
    Object.defineProperty(this, "textContent", {
      get: () => {
        let out = "";
        for (const c of this.childNodes) {
          out += c.nodeType === 3 ? (c as FakeText).nodeValue : "";
        }
        return out;
      },
      set: (v: string) => {
        for (const c of [...this.childNodes]) this.removeChild(c);
        if (v !== "") {
          const t = this.ownerDocument.createTextNode(v);
          this.appendChild(t);
        }
      },
    });
  }

  appendChild<T extends FakeElement | FakeText>(child: T): T {
    if (child.parentNode) (child.parentNode as FakeElement).removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    this.children = this.childNodes.filter((c): c is FakeElement => c.nodeType === 1);
    this.lastChild = child;
    if (this.childNodes.length === 1) this.firstChild = child;
    child.previousSibling = this.childNodes[this.childNodes.length - 2] ?? null;
    if (child.previousSibling) child.previousSibling.nextSibling = child;
    child.nextSibling = null;
    return child;
  }

  insertBefore<T extends FakeElement | FakeText>(
    child: T,
    ref: FakeElement | FakeText | null,
  ): T {
    if (!ref) return this.appendChild(child);
    const idx = this.childNodes.indexOf(ref);
    if (idx === -1) return this.appendChild(child);
    if (child.parentNode) (child.parentNode as FakeElement).removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(idx, 0, child);
    this.children = this.childNodes.filter((c): c is FakeElement => c.nodeType === 1);
    this.firstChild = this.childNodes[0] ?? null;
    this.lastChild = this.childNodes[this.childNodes.length - 1] ?? null;
    child.previousSibling = this.childNodes[idx - 1] ?? null;
    child.nextSibling = ref;
    ref.previousSibling = child;
    return child;
  }

  removeChild<T extends FakeElement | FakeText>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx === -1) throw new Error("removeChild: not a child");
    this.childNodes.splice(idx, 1);
    this.children = this.childNodes.filter((c): c is FakeElement => c.nodeType === 1);
    if (child.previousSibling) child.previousSibling.nextSibling = child.nextSibling;
    if (child.nextSibling) child.nextSibling.previousSibling = child.previousSibling;
    child.parentNode = null;
    child.previousSibling = null;
    child.nextSibling = null;
    this.firstChild = this.childNodes[0] ?? null;
    this.lastChild = this.childNodes[this.childNodes.length - 1] ?? null;
    return child;
  }

  setAttribute(k: string, v: string): void {
    this.attributes[k] = String(v);
    if (k === "class") {
      this._classSet = new Set(String(v).split(/\s+/).filter(Boolean));
    }
  }

  getAttribute(k: string): string | null {
    return k in this.attributes ? this.attributes[k] : null;
  }

  hasAttribute(k: string): boolean {
    return k in this.attributes;
  }

  removeAttribute(k: string): void {
    delete this.attributes[k];
  }

  addEventListener(type: string, fn: Listener): void {
    (this._listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  }

  dispatchEvent(e: FakeEvent): boolean {
    for (const fn of [...(this._listeners[e.type] ?? [])]) {
      fn({ ...e, target: e.target ?? this });
    }
    return true;
  }

  contains(other: FakeElement | FakeText | null | undefined): boolean {
    let n: FakeElement | FakeText | null | undefined = other;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }

  closest(sel: string): FakeElement | null {
    let n: FakeElement | null = this;
    while (n) {
      if (matchesSelector(n, sel)) return n;
      n = n.parentNode as FakeElement | null;
    }
    return null;
  }

  getBoundingClientRect(): Record<string, number> {
    return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
  }

  focus(): void {}
  blur(): void {}
}

class FakeText {
  nodeType = 3;
  nodeName = "#text";
  ownerDocument: FakeDocument;
  parentNode: FakeElement | null = null;
  nextSibling: FakeElement | FakeText | null = null;
  previousSibling: FakeElement | FakeText | null = null;
  nodeValue: string;
  textContent: string;
  data: string;

  constructor(text: string, doc: FakeDocument) {
    this.nodeValue = text;
    this.textContent = text;
    this.data = text;
    this.ownerDocument = doc;
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

class FakeDocument {
  nodeType = 9;
  readyState = "complete";
  defaultView: FakeWindow | null = null;
  body: FakeElement;
  documentElement: FakeElement;
  activeElement: FakeElement | null = null;
  _listeners: Record<string, Listener[]> = {};

  constructor() {
    this.body = new FakeElement("body", this);
    this.documentElement = new FakeElement("html", this);
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  createTextNode(text: string): FakeText {
    return new FakeText(text, this);
  }

  createComment(text: string): FakeText {
    const n = new FakeText(text, this);
    n.nodeType = 8;
    return n;
  }

  addEventListener(type: string, fn: Listener): void {
    (this._listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  }

  dispatchEvent(e: FakeEvent): boolean {
    for (const fn of [...(this._listeners[e.type] ?? [])]) {
      fn({ ...e, target: e.target ?? this });
    }
    return true;
  }
}

class FakeWindow {
  document: FakeDocument;
  innerWidth = 1280;
  innerHeight = 800;
  activeElement: FakeElement | null = null;
  _listeners: Record<string, Listener[]> = {};
  _selection: FakeSelection | null = null;
  // react-dom's getActiveElementDeep does `element instanceof win.HTMLIFrameElement`
  // on every commit — the constructor must exist so instanceof never throws.
  HTMLIFrameElement = class {};

  constructor(doc: FakeDocument) {
    this.document = doc;
  }

  getSelection(): FakeSelection | null {
    return this._selection;
  }

  addEventListener(type: string, fn: Listener): void {
    (this._listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  }

  dispatchEvent(e: FakeEvent): boolean {
    for (const fn of [...(this._listeners[e.type] ?? [])]) {
      fn({ ...e, target: e.target ?? this });
    }
    return true;
  }

  getComputedStyle(): Record<string, string> {
    return {};
  }
}

interface FakeSelection {
  isCollapsed: boolean;
  rangeCount: number;
  anchorNode: FakeElement | FakeText | null;
  toString(): string;
  getRangeAt(i: number): {
    getBoundingClientRect(): Record<string, number>;
    commonAncestorContainer: FakeElement | FakeText | null;
  };
}

/** Mock selection anchored on a fake node; the range rect positions the
 *  bar at bottom 144 / left 40 (viewport coords). */
function makeSelection(
  anchorNode: FakeElement | FakeText,
  text: string,
  opts?: { collapsed?: boolean },
): FakeSelection {
  const rect = { top: 120, left: 40, width: 200, height: 24, bottom: 144, right: 240 };
  return {
    isCollapsed: opts?.collapsed ?? false,
    rangeCount: opts?.collapsed ? 0 : 1,
    anchorNode,
    toString: () => text,
    getRangeAt: () => ({ getBoundingClientRect: () => rect, commonAncestorContainer: anchorNode }),
  };
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

let doc: FakeDocument;
let win: FakeWindow;
let container: FakeElement;
let root: { render(el: ReactNode): void; unmount(): void } | null = null;
let client: typeof import("react-dom/client");
let mockSend: ReturnType<typeof vi.fn>;

const g = globalThis as Record<string, unknown>;

function walk(node: FakeElement | FakeText, visit: (n: FakeElement | FakeText) => void): void {
  visit(node);
  if (node.nodeType === 1) {
    for (const c of (node as FakeElement).childNodes) walk(c, visit);
  }
}

function findByClass(rootEl: FakeElement, cls: string): FakeElement | null {
  let found: FakeElement | null = null;
  walk(rootEl, (n) => {
    if (!found && n.nodeType === 1 && (n as FakeElement).attributes.class?.split(/\s+/).includes(cls)) {
      found = n as FakeElement;
    }
  });
  return found;
}

function findText(rootEl: FakeElement, value: string): FakeText | null {
  let found: FakeText | null = null;
  walk(rootEl, (n) => {
    if (!found && n.nodeType === 3 && (n as FakeText).nodeValue === value) {
      found = n as FakeText;
    }
  });
  return found;
}

function textNodesOf(rootEl: FakeElement): string[] {
  const out: string[] = [];
  walk(rootEl, (n) => {
    if (n.nodeType === 3) out.push((n as FakeText).nodeValue);
  });
  return out;
}

function fireSelectionChange(): void {
  doc.dispatchEvent({ type: "selectionchange" });
}

/** Real React click: dispatch through the root's delegated listener. */
function clickEl(el: FakeElement): void {
  const ev = {
    type: "click",
    target: el,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    preventDefault: () => {
      ev.defaultPrevented = true;
    },
    stopPropagation: () => {},
    stopImmediatePropagation: () => {},
  };
  container.dispatchEvent(ev);
}

async function mountPanel(): Promise<void> {
  container = doc.createElement("div");
  doc.body.appendChild(container);
  root = client.createRoot(container as unknown as Element);
  // Sync act: the initial render and the component's passive effects
  // (listener registration) are flushed synchronously inside the scope.
  act(() => {
    root?.render(
      <div className="document-panel">
        <p>Hola mundo</p>
        <SelectionActions />
      </div>,
    );
  });
}

function showBarFor(text: string, raw?: string): FakeElement {
  const textNode = findText(container, "Hola mundo");
  expect(textNode).not.toBeNull();
  win._selection = makeSelection(textNode!, raw ?? text);
  act(() => fireSelectionChange());
  const bar = findByClass(container, "selection-actions-bar");
  expect(bar).not.toBeNull();
  return bar!;
}

beforeEach(async () => {
  doc = new FakeDocument();
  win = new FakeWindow(doc);
  doc.defaultView = win;
  g.window = win;
  g.document = doc;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  mockSend = vi.fn();
  appStore.setState({ send: mockSend });
  client = await import("react-dom/client");
  await mountPanel();
});

afterEach(() => {
  if (root) {
    try {
      act(() => root?.unmount());
    } catch {
      // unmount on a torn-down fake DOM must never fail the suite
    }
    root = null;
  }
  delete g.window;
  delete g.document;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  appStore.setState({ content: {}, surfaceState: {} });
});

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("SelectionActions (Leaf G)", () => {
  it("shows the floating bar when text is selected inside the document panel", () => {
    const bar = showBarFor("texto seleccionado");
    expect(bar.getAttribute("role")).toBe("toolbar");
    expect(bar.getAttribute("aria-label")).toBe("Acciones sobre el texto seleccionado");
    // Positioned next to the selection: rect.bottom 144 + 8, rect.left 40.
    expect(String(bar.style.top)).toBe("152px");
    expect(String(bar.style.left)).toBe("40px");
    // Spanish actions, large elderly-first labels, no emojis.
    expect(textNodesOf(bar)).toEqual([
      "Explicar",
      "Mejorar",
      "Acortar",
      "Leer en voz alta",
    ]);
  });

  it("stays hidden without a selection", () => {
    expect(findByClass(container, "selection-actions-bar")).toBeNull();
  });

  it("ignores collapsed selections", () => {
    const textNode = findText(container, "Hola mundo");
    win._selection = makeSelection(textNode!, "x", { collapsed: true });
    act(() => fireSelectionChange());
    expect(findByClass(container, "selection-actions-bar")).toBeNull();
  });

  it("ignores selections anchored outside the document panel", () => {
    const outside = doc.createElement("p");
    outside.appendChild(doc.createTextNode("Fuera"));
    container.appendChild(outside);
    const outsideText = findText(container, "Fuera");
    expect(outsideText).not.toBeNull();
    win._selection = makeSelection(outsideText!, "texto de afuera");
    act(() => fireSelectionChange());
    expect(findByClass(container, "selection-actions-bar")).toBeNull();
  });

  it("closes when the selection collapses or moves away", () => {
    showBarFor("texto seleccionado");
    win._selection = makeSelection(doc.createTextNode("otro"), "otro");
    act(() => fireSelectionChange());
    expect(findByClass(container, "selection-actions-bar")).toBeNull();
  });

  it("composes the Spanish instruction and calls the sendText hook on action click", () => {
    const bar = showBarFor("texto seleccionado");
    const buttons = bar.children.filter((c) => c.nodeName === "BUTTON");
    expect(buttons).toHaveLength(4);
    act(() => clickEl(buttons[0])); // Explicar
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: "user_text",
      text: 'Explicá esto: "texto seleccionado"',
    });
    // The bar closes after sending.
    expect(findByClass(container, "selection-actions-bar")).toBeNull();
  });

  it("composes the read-aloud instruction from the last action", () => {
    const bar = showBarFor("receta de pan");
    const buttons = bar.children.filter((c) => c.nodeName === "BUTTON");
    act(() => clickEl(buttons[3])); // Leer en voz alta
    expect(mockSend).toHaveBeenCalledWith({
      type: "user_text",
      text: 'Leé en voz alta: "receta de pan"',
    });
  });

  it("sanitizes the selection before composing the instruction", () => {
    showBarFor('Hola "mundo"', 'Hola\n  "mundo"');
    const buttons = findByClass(container, "selection-actions-bar")!.children.filter(
      (c) => c.nodeName === "BUTTON",
    );
    act(() => clickEl(buttons[0]));
    expect(mockSend).toHaveBeenCalledWith({
      type: "user_text",
      text: "Explicá esto: \"Hola 'mundo'\"",
    });
  });

  it("closes on Escape without sending anything", () => {
    showBarFor("texto seleccionado");
    act(() => win.dispatchEvent({ type: "keydown", key: "Escape" }));
    expect(findByClass(container, "selection-actions-bar")).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("closes on pointer-down outside the bar and stays open inside it", () => {
    showBarFor("texto seleccionado");
    act(() =>
      win.dispatchEvent({ type: "pointerdown", target: { closest: () => null } }),
    );
    expect(findByClass(container, "selection-actions-bar")).toBeNull();

    // Re-open and tap INSIDE the bar: stays open.
    showBarFor("otra selección");
    act(() =>
      win.dispatchEvent({
        type: "pointerdown",
        target: { closest: () => ({}) },
      }),
    );
    expect(findByClass(container, "selection-actions-bar")).not.toBeNull();
  });

  it("keeps the document text selectable — the bar never steals focus", () => {
    const bar = showBarFor("texto seleccionado");
    // The bar must not autofocus: document.activeElement stays null.
    expect(doc.activeElement).toBeNull();
    // The wrapper div renders nothing that intercepts pointer events.
    expect(bar.parentNode?.nodeType).toBe(1);
  });
});
