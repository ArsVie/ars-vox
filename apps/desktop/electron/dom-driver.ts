/**
 * W2-DRIVE (GATE-5) — the main-process DOM executor for the integrated
 * browser.
 *
 * Applies a browser.dom_action (click | scroll | set_value | query) to
 * the browser view's OWN webContents. The only entry point takes the
 * WebContents explicitly, and the ONLY caller (BrowserView.domAction,
 * ./browser-view.ts) hands it the view's cached webContents — so the
 * executor can never target the app window's page or any other
 * WebContents by construction (one browser state, one authority: the
 * WebContentsView).
 *
 * Honesty rules (the brief's "bounded and honest"):
 *  - no page (empty URL) or destroyed webContents -> the literal
 *    "no page" result, executeJavaScript is never called;
 *  - every injected script is a self-contained IIFE that returns a
 *    string (Electron serializes it back);
 *  - query text is bounded BOTH in-page (slice to the cap with a
 *    truncation marker) and main-side (the returned string is
 *    re-truncated with the marker, so a hostile/buggy page can never
 *    push unbounded text into the agent's context);
 *  - targets resolve selector-first, then by aria label/role hint
 *    (getByRole-ish), then honestly "not found: <target>";
 *  - set_value uses the NATIVE VALUE SETTER + a bubbling input event
 *    (React/Vue apps ignore plain el.value assignment — the "typed
 *    text silently no-ops" failure mode);
 *  - executeJavaScript failures (page navigated away, renderer crash)
 *    surface as an honest "error: ..." result, never a throw.
 */

import type { WebContents } from "electron";

/** Frozen wire shape — BrowserDomActionEvent fields (do not rename). */
export interface DomActionRequest {
  operation: "click" | "scroll" | "set_value" | "query";
  target: string;
  value: string | null;
}

/** Cap for query text (the "sane cap" from the brief). */
export const DOM_QUERY_CAP = 8000;

/** Marker appended when query text was truncated. */
export const DOM_TRUNCATION_MARKER = "\n[text truncated at 8000 chars]";

export const NO_PAGE_RESULT = "no page";

const OPERATIONS = new Set(["click", "scroll", "set_value", "query"]);

/** The shared target resolver injected into every script that needs one. */
const RESOLVE_JS = `
function __resolve(t) {
  var el = null;
  try { el = document.querySelector(t); } catch (e) { el = null; }
  if (el) return el;
  try {
    el = document.querySelector('[aria-label="' + CSS.escape(t) + '"]');
    if (el) return el;
    el = document.querySelector('[role="' + CSS.escape(t) + '"]');
    if (el) return el;
  } catch (e) { /* escaping failed — give up honestly */ }
  return null;
}`;

function clickScript(target: string): string {
  return `(() => {
${RESOLVE_JS}
  var el = __resolve(${JSON.stringify(target)});
  if (!el) return "not found: " + ${JSON.stringify(target)};
  el.click();
  return "clicked " + ${JSON.stringify(target)};
})()`;
}

function scrollScript(target: string, value: string | null): string {
  // Numeric value wins (scroll by pixels); a target scrolls into view.
  if (value !== null && value.trim() !== "" && Number.isFinite(Number(value))) {
    return `(() => {
  window.scrollBy({ top: ${JSON.stringify(Number(value))}, behavior: "auto" });
  return "scrolled " + ${JSON.stringify(value)};
})()`;
  }
  return `(() => {
${RESOLVE_JS}
  var el = __resolve(${JSON.stringify(target)});
  if (!el) return "not found: " + ${JSON.stringify(target)};
  el.scrollIntoView({ behavior: "auto", block: "center" });
  return "scrolled to " + ${JSON.stringify(target)};
})()`;
}

function setValueScript(target: string, value: string): string {
  return `(() => {
${RESOLVE_JS}
  var el = __resolve(${JSON.stringify(target)});
  if (!el) return "not found: " + ${JSON.stringify(target)};
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    return "not an input: " + ${JSON.stringify(target)};
  }
  var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return "set " + ${JSON.stringify(target)} + " = " + ${JSON.stringify(value)};
})()`;
}

function queryScript(target: string): string {
  const cap = DOM_QUERY_CAP;
  if (target) {
    return `(() => {
  var el = null;
  try { el = document.querySelector(${JSON.stringify(target)}); } catch (e) { el = null; }
  if (!el) return "not found: " + ${JSON.stringify(target)};
  var text = (el.textContent || "").trim();
  return text.length > ${cap} ? text.slice(0, ${cap}) + ${JSON.stringify(DOM_TRUNCATION_MARKER)} : text;
})()`;
  }
  // Whole-page read (bounded in-page AND re-bounded main-side below).
  return `(() => {
  var text = (document.body && document.body.innerText || "").trim();
  return text.length > ${cap} ? text.slice(0, ${cap}) + ${JSON.stringify(DOM_TRUNCATION_MARKER)} : text;
})()`;
}

/**
 * Apply one DOM action to the given webContents and return the honest
 * result string (never throws). Only the browser view's webContents
 * should ever be passed here (BrowserView.domAction is the single path).
 */
export async function executeDomAction(
  wc: WebContents,
  action: DomActionRequest,
): Promise<string> {
  if (wc.isDestroyed() || !wc.getURL()) {
    return NO_PAGE_RESULT;
  }
  const operation = action.operation;
  if (!OPERATIONS.has(operation)) {
    return `invalid operation: ${String(operation)}`;
  }
  const target = typeof action.target === "string" ? action.target.trim() : "";
  const value = typeof action.value === "string" ? action.value : null;

  let script: string;
  if (operation === "click") script = clickScript(target);
  else if (operation === "scroll") script = scrollScript(target, value);
  else if (operation === "set_value") script = setValueScript(target, value ?? "");
  else script = queryScript(target);

  try {
    const raw = await wc.executeJavaScript(script, true);
    const text = typeof raw === "string" ? raw : String(raw ?? "");
    // Main-side bound: a page can never push unbounded text back.
    if (text.length > DOM_QUERY_CAP) {
      return `${text.slice(0, DOM_QUERY_CAP)}${DOM_TRUNCATION_MARKER}`;
    }
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `error: ${msg.slice(0, 200)}`;
  }
}
