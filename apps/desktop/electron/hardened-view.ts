/**
 * A8 (GATE-3.5 wave 1) / W2-VIEW (GATE-5, ADR 0007) — hardened
 * remote-content view glue (R40/R41).
 *
 * Electron side of the browser/security module. Pure policy lives in
 * ./security-policy.ts (unit-tested without electron); this file wires it
 * to Electron primitives:
 *
 *  - createRemoteContentSession(): isolated persistent partition with a
 *    deny-by-default permission handler, allowlist enforcement at the
 *    session webRequest layer BEFORE any remote load, and CSP injection
 *    for remote pages (migration note §3 — lands WITH the E33→42
 *    upgrade, R42).
 *  - createHardenedRemoteView(): an instantiable WebContentsView for
 *    remote content — isolated world (contextIsolation), sandboxed, NO
 *    privileged Ars-Vox preload, navigation filtered, window.open denied.
 *  - attachRemoteNavigationGuards(): per-WebContents navigation filter +
 *    window-open denial (main-frame navigations only).
 *  - registerLocalDocProtocol(): app-only scheme (arsvox-doc:) that serves
 *    files from explicit roots with traversal + symlink-escape checks —
 *    so local documents never need the permissive file: scheme.
 *  - isTrustedIpcSender(): R41 sender validation; use in EVERY ipcMain
 *    handler (now lives in ./ipc-guard.ts, re-exported here).
 *  - installGlobalWebContentsGuard(): belt-and-braces — any WebContents
 *    the app did not create as its own window gets the remote guards.
 *
 * W2-VIEW reversal note: 8d1fb3f deleted this module ("browser story =
 * renderer iframe"). ADR 0007 reinstates it — this time the view it
 * governs IS the real browser surface (wired in ./browser-view.ts +
 * main.ts), never a discarded remote partition.
 *
 * WebContentsView API is current in Electron 42; the v41 "webContents
 * undefined in destroyed handler" change means callers MUST cache the
 * WebContents reference at creation time and never read view.webContents
 * from a destroyed handler (browser-view.ts does this).
 */

import {
  app,
  net,
  protocol,
  session,
  WebContentsView,
  type Event as ElectronEvent,
  type IpcMainEvent,
  type Session,
  type WebContents,
  type WebContentsWillFrameNavigateEventParams,
  type WebContentsWillNavigateEventParams,
  type WebPreferences,
} from "electron";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  REMOTE_CSP,
  decideRemoteNavigation,
  LOCAL_DOC_SCHEME,
  REMOTE_CONTENT_PARTITION,
  resolveLocalDocPath,
} from "./security-policy";

export interface HardenedRemoteOptions {
  /** Session partition; default REMOTE_CONTENT_PARTITION (persistent). */
  partition?: string;
  /** Extra webPreferences; security-critical defaults cannot be weakened. */
  webPreferences?: Partial<WebPreferences>;
}

/**
 * R40 + R42 — isolated persistent session for remote content.
 * Deny-by-default: every permission request/check answers false,
 * including media. The navigation policy is enforced at the session
 * webRequest layer BEFORE any remote load (main-frame requests only),
 * and every response gets the remote CSP injected (migration note §3).
 */
export function createRemoteContentSession(options: HardenedRemoteOptions = {}): Session {
  const ses = session.fromPartition(options.partition ?? REMOTE_CONTENT_PARTITION, {
    cache: false,
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Only the MAIN frame is a navigation of the view; subresources
    // (CDNs, embeds) pass — the navigation guards + CSP still constrain.
    if (details.resourceType !== "mainFrame") {
      callback({});
      return;
    }
    const decision = decideRemoteNavigation(details.url);
    if (!decision.allowed) {
      console.warn(`[hardened-view] webRequest blocked main-frame load (${decision.reason}): ${details.url}`);
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers["Content-Security-Policy"] = [REMOTE_CSP];
    callback({ responseHeaders: headers });
  });
  return ses;
}

export interface RemoteGuardHandle {
  detach: () => void;
}

/**
 * R40 — navigation filter + window-open denial for a remote-content
 * WebContents. Blocks dangerous schemes and local/private destinations
 * at the MAIN frame; subframes are allowed to load cross-origin
 * resources (CDNs etc.) but a main-frame navigation anywhere outside
 * the policy is prevented. Any PUBLIC http(s) page is allowed — there
 * is no domain allowlist.
 */
export function attachRemoteNavigationGuards(
  wc: WebContents,
  options: HardenedRemoteOptions = {},
): RemoteGuardHandle {
  const onWillNavigate = (details: ElectronEvent<WebContentsWillNavigateEventParams>): void => {
    const decision = decideRemoteNavigation(details.url);
    if (!decision.allowed) {
      console.warn(`[hardened-view] blocked main-frame navigation (${decision.reason}): ${details.url}`);
      details.preventDefault();
    }
  };

  const onWillFrameNavigate = (
    details: ElectronEvent<WebContentsWillFrameNavigateEventParams>,
  ): void => {
    if (!details.isMainFrame) return; // subframe loads are not navigations of the document
    const decision = decideRemoteNavigation(details.url);
    if (!decision.allowed) {
      console.warn(`[hardened-view] blocked frame navigation (${decision.reason}): ${details.url}`);
      details.preventDefault();
    }
  };

  wc.on("will-navigate", onWillNavigate);
  wc.on("will-frame-navigate", onWillFrameNavigate);
  wc.setWindowOpenHandler(() => ({ action: "deny" }));

  return {
    detach: () => {
      wc.removeListener("will-navigate", onWillNavigate);
      wc.removeListener("will-frame-navigate", onWillFrameNavigate);
    },
  };
}

const HARDENED_WEB_PREFERENCES: Partial<WebPreferences> = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  // Deliberately NO preload: remote pages must never see the Ars-Vox
  // privileged API (no window.arsvox, no token, no IPC surface).
};

/**
 * R40 — instantiate a hardened remote-content view. The view is bound to
 * the isolated partition session and fully guarded; it is NOT attached to
 * any window here — the caller (browser-view.ts) decides layout.
 */
export function createHardenedRemoteView(options: HardenedRemoteOptions = {}): WebContentsView {
  const ses = createRemoteContentSession(options);
  const view = new WebContentsView({
    webPreferences: {
      ...HARDENED_WEB_PREFERENCES,
      session: ses,
      ...options.webPreferences,
    },
  });
  attachRemoteNavigationGuards(view.webContents, options);
  return view;
}

/* ------------------------------------------------------------------ */
/* Local document protocol (R40: custom protocol over permissive file:) */
/* ------------------------------------------------------------------ */

export interface LocalDocProtocolOptions {
  /** Scheme to register; default LOCAL_DOC_SCHEME. */
  scheme?: string;
  /** alias -> absolute root directory. Empty = protocol registered but inert (403). */
  roots: Readonly<Record<string, string>>;
}

let localDocProtocolRegistered = false;

/**
 * Test-only hook: forget prior scheme registrations so tests can exercise
 * the "registers exactly once" path repeatedly. Never call in production.
 */
export function __resetLocalDocProtocolRegistrationForTests(): void {
  localDocProtocolRegistered = false;
}

/**
 * Register the app-only local document scheme. MUST be called before
 * app.whenReady() (registerSchemesAsPrivileged is pre-ready only). The
 * handler resolves arsvox-doc://<alias>/<path> against the roots, rejects
 * ".." segments, and re-verifies realpath containment (symlink escape)
 * before serving via net.fetch. Remote content can never navigate to it
 * (blocked in security-policy.ts).
 */
export function registerLocalDocProtocol(options: LocalDocProtocolOptions): void {
  const scheme = options.scheme ?? LOCAL_DOC_SCHEME;
  if (!localDocProtocolRegistered) {
    protocol.registerSchemesAsPrivileged([
      { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    ]);
    localDocProtocolRegistered = true;
  }
  app.whenReady().then(() => {
    protocol.handle(scheme, (request) => {
      let u: URL;
      try {
        u = new URL(request.url);
      } catch {
        return new Response("bad request", { status: 400 });
      }
      const resolved = resolveLocalDocPath(u.hostname, u.pathname, options.roots);
      if (!resolved) return new Response("forbidden", { status: 403 });
      const filePath = path.join(resolved.root, resolved.relative);
      try {
        const real = fs.realpathSync(filePath);
        const rootReal = fs.realpathSync(resolved.root);
        if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
          return new Response("forbidden", { status: 403 });
        }
        return net.fetch(pathToFileURL(real).toString());
      } catch {
        return new Response("not found", { status: 404 });
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* IPC sender validation (R41)                                         */
/* ------------------------------------------------------------------ */

/**
 * R41 — sender validation. Lives in ./ipc-guard.ts; re-exported here so
 * consumers can import the guard from the browser/security module.
 */
export { isTrustedIpcSender } from "./ipc-guard";

/**
 * R40/R41 — defense in depth: every WebContents the app creates that is
 * NOT the app window (isAppWebContents === false) gets the remote guards,
 * so a stray window.open / helper process can never escape the policy.
 */
export function installGlobalWebContentsGuard(options: {
  isAppWebContents: (wc: WebContents) => boolean;
}): void {
  app.on("web-contents-created", (_event, wc) => {
    if (options.isAppWebContents(wc)) return;
    attachRemoteNavigationGuards(wc);
  });
}
