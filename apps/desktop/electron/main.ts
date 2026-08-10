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
 *  - Browser story (GATE-5 W2-VIEW, ADR 0007): the integrated browser
 *    is a hardened WebContentsView OWNED by this process (./browser-view.ts
 *    + ./hardened-view.ts + ./security-policy.ts) — isolated persistent
 *    partition, deny-by-default permissions, CSP injection, allowlist +
 *    local/private blocking enforced at the session webRequest layer and
 *    on every navigate, NO privileged preload in the view. Navigation is
 *    main-owned (renderer asks via arsvox:browser-* IPC); real
 *    can_go_back/can_go_forward/url/title/loading are published to the
 *    renderer (arsvox:browser-state) and to the agent service
 *    (PUT /api/browser-state), so actions.py emits real values. The
 *    renderer iframe path is REMOVED — the WebContentsView IS the
 *    browser surface. R41 sender validation applies to every handler
 *    (./ipc-guard.ts).
 *
 * Dev notes (A2, GATE-3.5):
 *  - ARSVOX_SERVICE_MODE=external skips spawning (assume a service is
 *    already running, e.g. the mock started by hand; the token then comes
 *    from ARSVOX_AUTH_TOKEN so both processes agree).
 *  - ARSVOX_PYTHON overrides the interpreter; ARSVOX_AGENT_URL overrides
 *    the service base URL (default http://127.0.0.1:8765).
 */

import { app, BrowserWindow, ipcMain, session, type WebContents } from "electron";
import * as crypto from "crypto";
import * as path from "path";
import { isTrustedIpcSender } from "./ipc-guard";
import { BrowserView, toServicePayload, type BrowserViewState } from "./browser-view";
import {
  installGlobalWebContentsGuard,
  registerLocalDocProtocol,
} from "./hardened-view";
import { DEFAULT_REMOTE_ALLOWLIST } from "./security-policy";

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

// ==== W2-VIEW (ADR 0007) — local-doc roots ====
// ARSVOX_DOC_ROOTS: path.delimiter-separated absolute dirs. Alias "docs"
// for the first, "docsN" for the rest. Empty by default -> the
// arsvox-doc: protocol is registered but serves 403 until a future lane
// wires real roots.
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

// ------------------------------------------------------------- service #

let mainWindow: BrowserWindow | null = null;
let serviceStatus: ServiceStatus = { state: "starting" };
let browserView: BrowserView | null = null;

// -------------------------------------------------------- browser view #

/**
 * W2-VIEW (ADR 0007): publish the view's REAL navigation state —
 * (a) to the renderer (arsvox:browser-state IPC, immediate UI truth)
 * and (b) to the agent service (authenticated PUT /api/browser-state),
 * so actions.py emits real can_go_back/can_go_forward/url/title instead
 * of hardcoded False. The wire shape is the frozen BrowserNavigateEvent
 * field set (snake_case on the service payload).
 */
function pushBrowserState(state: BrowserViewState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("arsvox:browser-state", state);
  }
  if (serviceStatus.state !== "ready") return;
  const payload = toServicePayload(state);
  void fetch(`${AGENT_BASE_URL}/api/browser-state`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch((err: unknown) => {
    console.warn("[main] browser-state POST failed", err);
  });
}

/**
 * W2-DRIVE (GATE-5): push a dom_action EXECUTION RESULT back to the
 * agent service (pushBrowserState-like path: main owns the token, the
 * renderer never holds it). The service's browser.dom_action tool
 * awaits this round-trip keyed by the request's created_at, so the
 * agent sees the REAL page result (query text, click verdict, ...) —
 * never a fake "done".
 */
function pushDomActionResult(createdAt: string, result: string): void {
  if (serviceStatus.state !== "ready") return;
  void fetch(`${AGENT_BASE_URL}/api/browser-dom-result`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ created_at: createdAt, result }),
  }).catch((err: unknown) => {
    console.warn("[main] browser-dom-result PUT failed", err);
  });
}

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

/**
 * R41 sender validation is applied in EVERY handler below: the sender
 * must be a live WebContents we created AND the main frame of it
 * (isTrustedIpcSender in ./ipc-guard.ts). The local isTrustedSender
 * that only checked isAppWebContents is gone — it omitted the
 * isDestroyed() and mainFrame checks (a subframe of the app window
 * would have passed).
 */
function setupIpc(): void {
  ipcMain.handle("arsvox:service-status", (event) => {
    if (!isTrustedIpcSender(event, isAppWebContents)) throw new Error("unauthorized");
    return serviceStatus;
  });

  ipcMain.handle(
    "arsvox:fetch",
    async (event, request: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown; contentType?: unknown; filename?: unknown }) => {
      if (!isTrustedIpcSender(event, isAppWebContents)) throw new Error("unauthorized");
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
    if (!isTrustedIpcSender(event, isAppWebContents)) return;
    wsBridge.connect();
  });

  ipcMain.on("arsvox:ws-close", (event) => {
    if (!isTrustedIpcSender(event, isAppWebContents)) return;
    wsBridge.close();
  });

  ipcMain.on("arsvox:ws-send", (event, message: unknown) => {
    if (!isTrustedIpcSender(event, isAppWebContents)) return;
    if (typeof message !== "string") return;
    wsBridge.send(message);
  });

  // ---- W2-VIEW (ADR 0007): the integrated browser (main-owned) ----
  ipcMain.handle("arsvox:browser-navigate", (event, request: { url?: unknown }) => {
    if (!isTrustedIpcSender(event, isAppWebContents)) throw new Error("unauthorized");
    if (!browserView) return { ok: false, reason: "no-view" };
    const url = typeof request?.url === "string" ? request.url : "";
    if (!url) return { ok: false, reason: "no-url" };
    return browserView.navigate(url);
  });

  ipcMain.on("arsvox:browser-back", (event) => {
    if (!isTrustedIpcSender(event, isAppWebContents)) return;
    browserView?.back();
  });

  ipcMain.on("arsvox:browser-forward", (event) => {
    if (!isTrustedIpcSender(event, isAppWebContents)) return;
    browserView?.forward();
  });

  ipcMain.on("arsvox:browser-refresh", (event) => {
    if (!isTrustedIpcSender(event, isAppWebContents)) return;
    browserView?.refresh();
  });

  // ---- W2-DRIVE (GATE-5): the agent DOM bridge (main executes) ----
  // The renderer forwards browser.dom_action wire events here; main
  // applies the action to the BROWSER VIEW's webContents (never the app
  // window's) and pushes the real result back to the service
  // (pushDomActionResult -> the awaiting browser.dom_action tool).
  ipcMain.handle("arsvox:browser-dom-action", async (event, request: unknown) => {
    if (!isTrustedIpcSender(event, isAppWebContents)) throw new Error("unauthorized");
    if (!browserView) return "no view";
    const r = request as {
      operation?: unknown;
      target?: unknown;
      value?: unknown;
      createdAt?: unknown;
    };
    const operation = r?.operation;
    if (
      operation !== "click" &&
      operation !== "scroll" &&
      operation !== "set_value" &&
      operation !== "query"
    ) {
      return `invalid operation: ${String(operation)}`;
    }
    const target = typeof r?.target === "string" ? r.target : "";
    const value = typeof r?.value === "string" ? r.value : null;
    const createdAt =
      typeof r?.createdAt === "string" && r.createdAt
        ? r.createdAt
        : new Date().toISOString();
    const result = await browserView.domAction({ operation, target, value });
    pushDomActionResult(createdAt, result);
    return result;
  });

  ipcMain.on("arsvox:browser-set-bounds", (event, bounds: unknown) => {
    if (!isTrustedIpcSender(event, isAppWebContents)) return;
    if (!browserView || typeof bounds !== "object" || bounds === null) return;
    const b = bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    browserView.setBounds({
      x: num(b.x),
      y: num(b.y),
      width: num(b.width),
      height: num(b.height),
    });
  });
}

// --------------------------------------------------------------- app #

// R40: registerLocalDocProtocol must run BEFORE app.whenReady() —
// registerSchemesAsPrivileged is pre-ready only; calling it inside
// whenReady rejects and ABORTS window creation. The protocol handler
// itself is deferred to whenReady inside hardened-view.ts. Roots stay
// empty (inert 403) until a future lane wires real directories.
registerLocalDocProtocol({ roots: localDocRoots() });

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

  // W2-VIEW (ADR 0007): defense in depth — any WebContents that is not
  // the app window gets the remote navigation guards + window-open deny.
  installGlobalWebContentsGuard({
    allowlist: DEFAULT_REMOTE_ALLOWLIST,
    isAppWebContents,
  });

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
  // W2-VIEW (ADR 0007): the integrated browser surface — a hardened
  // WebContentsView sized by the renderer's reported panel bounds
  // (arsvox:browser-set-bounds); hidden (0x0) until the panel mounts.
  browserView = BrowserView.create({
    allowlist: DEFAULT_REMOTE_ALLOWLIST,
    onStateChange: pushBrowserState,
  });
  browserView.attach(win);
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
