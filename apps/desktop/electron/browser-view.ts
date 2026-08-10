/**
 * W2-VIEW (GATE-5, ADR 0007) — the integrated browser surface: a
 * hardened WebContentsView owned by the Electron main process.
 *
 * This module WIRES the reinstated foundation (hardened-view.ts +
 * security-policy.ts) for real — the 8d1fb3f failure mode ("governed
 * nothing, remote partition created and discarded") is exactly what
 * this class prevents: the view it governs IS the browser surface.
 *
 * Responsibilities:
 *  - create the hardened view bound to the isolated remote partition;
 *  - attach it to the window's contentView (bounds come from the
 *    renderer via arsvox:browser-set-bounds);
 *  - MAIN-owned navigation: navigate/back/forward/refresh, every
 *    navigate pre-checked against the allowlist policy BEFORE loadURL;
 *  - publish REAL navigation state (url/title/can_go_back/can_go_forward/
 *    loading) on every did-* event, so main.ts can forward it to the
 *    renderer (IPC) and the agent service (authenticated HTTP) —
 *    actions.py emits real values instead of hardcoded False.
 *
 * Electron 42 drift (migration note): view.webContents is undefined
 * inside a destroyed handler — the WebContents reference is cached at
 * construction and never re-read from the view.
 */

import { WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from "electron";
import { createHardenedRemoteView } from "./hardened-view";
import { DEFAULT_REMOTE_ALLOWLIST, decideRemoteNavigation } from "./security-policy";
import { executeDomAction, type DomActionRequest } from "./dom-driver";

/** Real navigation state of the view (frozen wire shape — BrowserNavigateEvent fields). */
export interface BrowserViewState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface BrowserViewOptions {
  /** Domain allowlist; default DEFAULT_REMOTE_ALLOWLIST (app.yaml mirror). */
  allowlist?: readonly string[];
  /** Called on every navigation-state change (did-* events). */
  onStateChange?: (state: BrowserViewState) => void;
}

export interface NavigateResult {
  ok: boolean;
  reason: string;
}

/**
 * FROZEN service wire shape — the snake_case BrowserNavigateEvent field
 * set the Electron main process PUTs to /api/browser-state (do NOT
 * rename fields). Single-sourced here so the mapping is testable and
 * cannot drift from the view state.
 */
export interface BrowserServiceState {
  url: string;
  title: string;
  can_go_back: boolean;
  can_go_forward: boolean;
  loading: boolean;
}

/** Map the view's real state onto the frozen snake_case service wire. */
export function toServicePayload(state: BrowserViewState): BrowserServiceState {
  return {
    url: state.url,
    title: state.title,
    can_go_back: state.canGoBack,
    can_go_forward: state.canGoForward,
    loading: state.loading,
  };
}

export class BrowserView {
  private readonly view: WebContentsView;
  /** CACHED at construction — never read view.webContents later (v41 drift). */
  private readonly wc: WebContents;
  private readonly allowlist: readonly string[];
  private readonly onStateChange?: (state: BrowserViewState) => void;

  private constructor(view: WebContentsView, options: BrowserViewOptions) {
    this.view = view;
    this.wc = view.webContents;
    this.allowlist = options.allowlist ?? DEFAULT_REMOTE_ALLOWLIST;
    this.onStateChange = options.onStateChange;
    this.wireStateEvents();
  }

  static create(options: BrowserViewOptions = {}): BrowserView {
    return new BrowserView(
      createHardenedRemoteView({ allowlist: options.allowlist }),
      options,
    );
  }

  /** Push the current state after every event that can change it. */
  private wireStateEvents(): void {
    const push = (): void => this.onStateChange?.(this.getState());
    this.wc.on("did-navigate", push);
    this.wc.on("did-navigate-in-page", push);
    this.wc.on("page-title-updated", push);
    this.wc.on("did-start-loading", push);
    this.wc.on("did-stop-loading", push);
    this.wc.on("did-fail-load", push);
  }

  /** Current real state of the view. */
  getState(): BrowserViewState {
    return {
      url: this.wc.getURL() || "",
      title: this.wc.getTitle() || "",
      canGoBack: this.wc.navigationHistory.canGoBack(),
      canGoForward: this.wc.navigationHistory.canGoForward(),
      loading: this.wc.isLoading(),
    };
  }

  /**
   * MAIN-owned navigation. The allowlist policy is enforced BEFORE any
   * load (decideRemoteNavigation — scheme/local/private/allowlist); the
   * session webRequest layer and the will-navigate guards are the
   * belt-and-braces behind it.
   *
   * Dedupe: the service echoes a browser.navigate event back to the
   * renderer after the user's own command, which would re-trigger this
   * call. Loading the URL already displayed is a no-op reload; the
   * explicit refresh affordance covers reloads.
   */
  navigate(url: string): NavigateResult {
    const decision = decideRemoteNavigation(url, this.allowlist);
    if (!decision.allowed) {
      return { ok: false, reason: decision.reason };
    }
    if (url === this.wc.getURL() && !this.wc.isLoading()) {
      return { ok: true, reason: "already-loaded" };
    }
    this.wc.loadURL(url).catch(() => {
      // load failures surface via did-fail-load → state push
    });
    return { ok: true, reason: "ok" };
  }

  back(): void {
    if (this.wc.navigationHistory.canGoBack()) this.wc.navigationHistory.goBack();
  }

  forward(): void {
    if (this.wc.navigationHistory.canGoForward()) this.wc.navigationHistory.goForward();
  }

  refresh(): void {
    this.wc.reload();
  }

  /**
   * W2-DRIVE (GATE-5): apply a DOM action (click/scroll/set_value/
   * query) to THIS view's webContents. The driver module
   * (./dom-driver.ts) owns the semantics; this is the ONLY path to the
   * view's webContents, so the executor can never target the app
   * window's page or any other WebContents (one browser state, one
   * authority). Returns the honest result string ("no page" when the
   * view has no loaded page).
   */
  domAction(action: DomActionRequest): Promise<string> {
    return executeDomAction(this.wc, action);
  }

  /** The view lives inside the app window's contentView (above the page). */
  attach(win: BrowserWindow): void {
    win.contentView.addChildView(this.view);
  }

  /** Bounds come from the renderer's measured browser viewport (IPC). */
  setBounds(bounds: Rectangle): void {
    this.view.setBounds({
      x: Math.max(0, Math.floor(bounds.x)),
      y: Math.max(0, Math.floor(bounds.y)),
      width: Math.max(0, Math.floor(bounds.width)),
      height: Math.max(0, Math.floor(bounds.height)),
    });
  }
}
