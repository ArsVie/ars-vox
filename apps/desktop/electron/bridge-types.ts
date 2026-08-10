/**
 * W2-VIEW (GATE-5, ADR 0007) — single source of truth for the bridge
 * surface types shared between the preload bridge (electron/preload.ts)
 * and the renderer contract (src/arsvox-bridge.d.ts).
 *
 * WHY THIS FILE: the duplicate-export hazard — preload.ts and
 * arsvox-bridge.d.ts previously each declared and exported their own
 * BridgeFetchRequest/BridgeFetchResponse/BridgeBrowserState/
 * BridgeBrowserBounds. The two compile programs (tsconfig.json vs
 * tsconfig.electron.json) are disjoint, so the duplication compiled —
 * but it was a drift trap: two independent declarations of the same
 * wire types. This module is the ONE declaration site; both sides
 * import from it.
 *
 * This file is PURE TYPES (no electron/node imports) so it can be
 * pulled into the renderer program via the d.ts without dragging
 * electron runtime types along.
 */
export interface BridgeFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** ArrayBuffer for binary bodies (STT upload), string for JSON. */
  body?: ArrayBuffer | string;
  contentType?: string;
  /** When set, the body is sent as multipart/form-data (UploadFile). */
  filename?: string;
}

export interface BridgeFetchResponse {
  ok: boolean;
  status: number;
  contentType: string;
  body: ArrayBuffer;
}

/** W2-VIEW: real navigation state published by main (frozen field set). */
export interface BridgeBrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

/**
 * W2-DRIVE: a DOM action for main to apply to the BROWSER VIEW's
 * webContents (frozen operation set — BrowserDomActionEvent fields).
 * createdAt is the browser.dom_action wire event's created_at, echoed
 * back to the service so the awaiting tool matches its own request.
 */
export interface BridgeDomActionRequest {
  operation: "click" | "scroll" | "set_value" | "query";
  target: string;
  value: string | null;
  createdAt: string;
}

export interface BridgeBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
