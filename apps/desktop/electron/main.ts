/**
 * Electron main process: one window, loads the built renderer (or the
 * vite dev server when VITE_DEV_SERVER_URL is set). The Python agent
 * service is started externally (scripts/run_service.*); this shell only
 * talks to it over WebSocket.
 *
 * Security (GATE-2.5 H4):
 *  - Per-launch bearer token: read from ARSVOX_AUTH_TOKEN (set by the
 *    launcher for both the service and Electron) or generated fresh; the
 *    renderer receives it ONLY through the preload bridge (contextBridge
 *    + synchronous IPC), never through the page.
 *  - The defaultSession media permission grant is scoped to the app's own
 *    WebContents (the one window we create).
 *  - A8 (GATE-3.5): the hardened remote-content foundation lives in
 *    ./hardened-view.ts + ./security-policy.ts (R40-R42): isolated
 *    persistent partition, deny-by-default permissions, navigation
 *    filter, window-open denial, custom local-doc protocol, IPC sender
 *    validation. Not wired to any UI yet (Wave 2 browser milestone).
 */

import { app, BrowserWindow, ipcMain, session, type WebContents } from "electron";
import * as crypto from "crypto";
import * as path from "path";
// ==== A8 integration patch (GATE-3.5 wave 1, R40-R42) — browser/security module ====
import {
  createRemoteContentSession,
  installGlobalWebContentsGuard,
  isTrustedIpcSender,
  registerLocalDocProtocol,
} from "./hardened-view";
import { DEFAULT_REMOTE_ALLOWLIST } from "./security-policy";
// ==== end A8 integration patch ====

// The assistant speaks without any user click (voice-first product):
// Chrome's autoplay policy must not block TTS playback.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const AUTH_TOKEN_ENV = "ARSVOX_AUTH_TOKEN";

/**
 * Per-launch token shared with the agent service. The launcher should
 * export ARSVOX_AUTH_TOKEN to both processes; if it is unset here we
 * generate a fresh one so the shell is still self-consistent (the
 * service would need the same env to accept it).
 */
function resolveAuthToken(): string {
  const fromEnv = process.env[AUTH_TOKEN_ENV];
  if (fromEnv) return fromEnv;
  const generated = crypto.randomBytes(32).toString("base64url");
  console.warn(
    `[auth] ${AUTH_TOKEN_ENV} not set — generated per-launch token; ` +
      "start the agent service with the same env var to accept it.",
  );
  return generated;
}

const AUTH_TOKEN = resolveAuthToken();

// WebContents we own (the app window) — the media grant applies only to
// these; anything else is denied by default.
const appWebContents = new WeakSet<WebContents>();

function isAppWebContents(wc: WebContents): boolean {
  return appWebContents.has(wc);
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// ==== A8 integration patch (GATE-3.5 wave 1, R40) — local-doc roots ====
// ARSVOX_DOC_ROOTS: path.delimiter-separated absolute dirs. Alias "docs"
// for the first, "docsN" for the rest. Empty by default -> the
// arsvox-doc: protocol is registered but serves 403 until Wave 2 wires
// real roots.
function localDocRoots(): Record<string, string> {
  const raw = process.env.ARSVOX_DOC_ROOTS;
  if (!raw) return {};
  const roots: Record<string, string> = {};
  raw
    .split(path.delimiter)
    .filter((dir) => dir.trim().length > 0)
    .forEach((dir, i) => {
      roots[i === 0 ? "docs" : `docs${i}`] = dir.trim();
    });
  return roots;
}
// ==== end A8 integration patch ====

/** The app's own page may only navigate within its own origin. */
function isAllowedAppNavigation(url: string): boolean {
  if (url.startsWith("file:")) return true;
  if (DEV_URL) {
    try {
      return new URL(url).origin === new URL(DEV_URL).origin;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Mirrors configs/app.yaml browser.allowlist (Electron does not read
 * app.yaml). A8: moved to security-policy.ts as DEFAULT_REMOTE_ALLOWLIST
 * — the single copy now lives with the browser/security module.
 */

/**
 * Deny-by-default partition for future remote content (WebContentsView,
 * wave 3+): no permissions, no window.open, navigation only to the
 * browser allowlist. A8: implemented in ./hardened-view.ts.
 */

app.whenReady().then(() => {
  // Voice-first product: the mic must be usable without fiddling with
  // site permissions — but ONLY in our own window. Any other WebContents
  // (future remote content) is denied.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === "media" && isAppWebContents(wc));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return permission === "media" && (wc ? isAppWebContents(wc) : false);
  });

  // ==== A8 integration patch (GATE-3.5 wave 1, R40/R41) ====
  // Local-document protocol: inert until Wave 2 supplies roots
  // (ARSVOX_DOC_ROOTS = path.delimiter-separated absolute dirs; alias
  // "docs" for the first, "docsN" for the rest).
  registerLocalDocProtocol({ roots: localDocRoots() });
  // Defense in depth: any WebContents that is not the app window gets the
  // remote guards (navigation filter + window-open denial).
  installGlobalWebContentsGuard({ allowlist: DEFAULT_REMOTE_ALLOWLIST, isAppWebContents });
  // Eagerly create the hardened remote-content partition so the Wave 2
  // WebContentsView wiring only has to attach to it.
  const remoteSession = createRemoteContentSession({ allowlist: DEFAULT_REMOTE_ALLOWLIST });
  void remoteSession; // consumed by the future WebContentsView
  // ==== end A8 integration patch ====

  // R41 (A8): no unvalidated IPC senders. The token is only handed to the
  // main frame of the app window (A2 owns the token flow; this is the
  // sender-validation half only).
  ipcMain.on("arsvox:get-token", (event) => {
    if (!isTrustedIpcSender(event, (wc) => isAppWebContents(wc))) {
      console.warn("[ipc] arsvox:get-token rejected: untrusted sender");
      event.returnValue = "";
      return;
    }
    event.returnValue = AUTH_TOKEN;
  });
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    title: "Ars-Vox",
    backgroundColor: "#101418",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.setMenuBarVisibility(false);
  appWebContents.add(win.webContents);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppNavigation(url)) event.preventDefault();
  });

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
