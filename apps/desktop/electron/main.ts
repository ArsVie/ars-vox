/**
 * Electron main process: one window, loads the built renderer (or the
 * vite dev server when VITE_DEV_SERVER_URL is set). The Python agent
 * service is SPAWNED here (GATE-3.5 A2, R09): one per-launch token is
 * generated in this process, the service inherits it via ARSVOX_AUTH_TOKEN,
 * and startup completes only after an authenticated health handshake.
 *
 * Security (GATE-2.5 H4 + GATE-3.5 A2):
 *  - The per-launch token lives ONLY in this process. The renderer never
 *    holds it (R14): REST calls are main-proxied (arsvox:fetch attaches
 *    the Bearer header) and the WebSocket is main-owned (R11 buffering).
 *  - arsvox:fetch only forwards URLs under the agent base URL, so the
 *    renderer cannot turn main into an open proxy.
 *  - Startup failures are reported to the renderer as service events
 *    (R12) and desktop quit terminates the child process tree (R13).
 *  - The defaultSession media permission grant is scoped to the app's own
 *    WebContents (the one window we create).
 *  - A8 (GATE-3.5): the hardened remote-content foundation lives in
 *    ./hardened-view.ts + ./security-policy.ts (R40-R42): isolated
 *    persistent partition, deny-by-default permissions, navigation
 *    filter, window-open denial, custom local-doc protocol, IPC sender
 *    validation. Not wired to any UI yet (Wave 2 browser milestone).
 *
 * Dev notes (A2, GATE-3.5):
 *  - ARSVOX_SERVICE_MODE=external skips spawning (assume a service is
 *    already running, e.g. the mock started by hand; the token then comes
 *    from ARSVOX_AUTH_TOKEN so both processes agree).
 *  - ARSVOX_PYTHON overrides the interpreter; ARSVOX_AGENT_URL overrides
 *    the service base URL (default http://127.0.0.1:8765).
 */

import { app, BrowserWindow, ipcMain, session, type Session, type WebContents } from "electron";
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

import {
  generateAuthToken,
  launchService,
  type ServiceHandle,
  type ServiceStatus,
} from "./service";
import { WsClient } from "./wsclient";

// The assistant speaks without any user click (voice-first product):
// Chrome's autoplay policy must not block TTS playback.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Per-launch token: generated HERE (R09). An env override remains for the
// dev/manual-coordination path (external service mode).
const AUTH_TOKEN = process.env.ARSVOX_AUTH_TOKEN ?? generateAuthToken();

const AGENT_BASE_URL = (process.env.ARSVOX_AGENT_URL ?? "http://127.0.0.1:8765").replace(
  /\/+$/,
  "",
);
const WS_ENDPOINT = `${AGENT_BASE_URL.replace(/^http/, "ws")}/ws`;
const SERVICE_MODE = process.env.ARSVOX_SERVICE_MODE === "external" ? "external" : "auto";

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

// ------------------------------------------------------------- service #

let mainWindow: BrowserWindow | null = null;
let serviceStatus: ServiceStatus = { state: "starting" };

/**
 * Main-owned WebSocket to the agent service (R14: the renderer cannot
 * authenticate a browser WebSocket without holding the token). Incoming
 * frames are forwarded as structured events; outbound frames arrive via
 * IPC and are queued here until the socket is open (R11 exactly-once).
 */
class ServiceWsBridge {
  private readonly client: WsClient;
  private wsOpen = false;
  private connectRequested = false;
  private closedByUser = false;

  constructor() {
    this.client = new WsClient({
      url: WS_ENDPOINT,
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      onOpen: () => {
        this.wsOpen = true;
        this.forward("arsvox:ws-status", true);
      },
      onMessage: (text) => {
        try {
          this.forward("arsvox:ws-message", JSON.parse(text) as unknown);
        } catch {
          // malformed frame: drop, keep the socket alive
        }
      },
      onClose: () => {
        const wasOpen = this.wsOpen;
        this.wsOpen = false;
        if (wasOpen) this.forward("arsvox:ws-status", false);
      },
    });
  }

  connect(): void {
    this.connectRequested = true;
    if (serviceStatus.state === "ready") this.client.connect();
  }

  close(): void {
    this.closedByUser = true;
    this.client.close();
    if (this.wsOpen) {
      this.wsOpen = false;
      this.forward("arsvox:ws-status", false);
    }
  }

  send(message: string): void {
    this.client.send(message);
  }

  private forward(channel: string, payload: unknown): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  }
}

const wsBridge = new ServiceWsBridge();

// ------------------------------------------------------------------ ipc #

/** Only our own window may use the privileged channels. */
function isTrustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return isAppWebContents(event.sender);
}

function setupIpc(): void {
  ipcMain.handle("arsvox:service-status", (event) => {
    if (!isTrustedSender(event)) throw new Error("unauthorized");
    return serviceStatus;
  });

  ipcMain.handle(
    "arsvox:fetch",
    async (event, request: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown; contentType?: unknown; filename?: unknown }) => {
      if (!isTrustedSender(event)) throw new Error("unauthorized");
      const url = typeof request?.url === "string" ? request.url : "";
      // The renderer may only reach the agent service itself — never an
      // arbitrary host (no open proxy).
      if (!url.startsWith(`${AGENT_BASE_URL}/`)) {
        throw new Error(`refused: url outside agent base ${AGENT_BASE_URL}`);
      }
      const method = typeof request?.method === "string" ? request.method : "GET";
      const headers: Record<string, string> = {
        Authorization: `Bearer ${AUTH_TOKEN}`,
      };
      if (typeof request?.contentType === "string" && request.contentType) {
        headers["content-type"] = request.contentType;
      }
      // Merge caller headers (never allowing a caller-supplied
      // Authorization to override ours).
      if (request?.headers && typeof request.headers === "object") {
        for (const [key, value] of Object.entries(request.headers as Record<string, string>)) {
          if (key.toLowerCase() === "authorization") continue;
          if (typeof value === "string") headers[key] = value;
        }
      }

      let body: BodyInit | undefined;
      if (typeof request?.filename === "string" && request.filename) {
        // STT upload: FastAPI expects multipart/form-data for UploadFile.
        const form = new FormData();
        const bytes =
          request.body instanceof ArrayBuffer
            ? Buffer.from(request.body)
            : typeof request.body === "string"
              ? Buffer.from(request.body, "utf8")
              : Buffer.alloc(0);
        form.append(
          "file",
          new Blob([bytes], {
            type: typeof request?.contentType === "string" ? request.contentType : "audio/webm",
          }),
          request.filename,
        );
        body = form;
      } else if (request?.body instanceof ArrayBuffer) {
        body = Buffer.from(request.body);
      } else if (typeof request?.body === "string") {
        body = request.body;
      }

      const res = await fetch(url, { method, headers, body });
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      };
    },
  );

  ipcMain.on("arsvox:ws-connect", (event) => {
    if (!isTrustedSender(event)) return;
    wsBridge.connect();
  });

  ipcMain.on("arsvox:ws-close", (event) => {
    if (!isTrustedSender(event)) return;
    wsBridge.close();
  });

  ipcMain.on("arsvox:ws-send", (event, message: unknown) => {
    if (!isTrustedSender(event)) return;
    if (typeof message !== "string") return;
    wsBridge.send(message);
  });
}

// --------------------------------------------------------------- app #

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

  setupIpc();
  createWindow();

  // R09 (A2): spawn the service and complete the authenticated handshake.
  // The WS bridge connects once the service reports ready. The handle is
  // registered on the module-level variable so before-quit can terminate
  // the child (R13).
  serviceHandle = launchService({
    token: AUTH_TOKEN,
    agentBaseUrl: AGENT_BASE_URL,
    serviceMode: SERVICE_MODE,
    onStatus: (status) => {
      serviceStatus = status;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("arsvox:service-event", status);
      if (status.state === "ready") {
        wsBridge.connect();
      } else if (status.state === "failed" || status.state === "stopped") {
        wsBridge.close();
      }
    },
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
  mainWindow = win;
  appWebContents.add(win.webContents);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppNavigation(url)) event.preventDefault();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

// R13: desktop exit terminates the child service process tree. The quit
// is deferred until the child is confirmed gone.
let serviceHandle: ServiceHandle | null = null;
let quitting = false;

app.on("before-quit", (event) => {
  if (quitting || !serviceHandle) return;
  event.preventDefault();
  quitting = true;
  void serviceHandle.terminate().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
