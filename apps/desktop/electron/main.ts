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
 *  - Groundwork for the future remote-content WebContentsView (Electron
 *    major upgrade is a separate ticket): a dedicated deny-by-default
 *    partition plus navigation/window-open guards. Not wired to any UI
 *    yet.
 */

import { app, BrowserWindow, ipcMain, session, type Session, type WebContents } from "electron";
import * as crypto from "crypto";
import * as path from "path";

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

/** Mirrors configs/app.yaml browser.allowlist (Electron does not read app.yaml). */
const REMOTE_ALLOWLIST = [
  "youtube.com",
  "*.youtube.com",
  "wikipedia.org",
  "openstreetmap.org",
];

function hostMatchesAllowlist(url: string, allowlist: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    if (entry.startsWith("*.")) return host.endsWith(entry.slice(1));
    return host === entry || host.endsWith(`.${entry}`);
  });
}

/**
 * Deny-by-default partition for future remote content (WebContentsView,
 * wave 3+): no permissions, no window.open, navigation only to the
 * browser allowlist.
 */
function createRemoteContentSession(): Session {
  const ses = session.fromPartition("remote-content", { cache: false });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  return ses;
}

/** Navigation + window.open guards for any WebContents showing remote content. */
function attachNavigationGuard(wc: WebContents, allowlist: string[]): void {
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (event, url) => {
    if (!hostMatchesAllowlist(url, allowlist)) event.preventDefault();
  });
}

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

  // Groundwork: create the hardened remote-content partition eagerly so
  // the wave-3 WebContentsView wiring only has to attach to it.
  const remoteSession = createRemoteContentSession();
  void remoteSession; // consumed by the future WebContentsView

  ipcMain.on("arsvox:get-token", (event) => {
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
