/**
 * Agent-service endpoints — single source of truth for every UI↔service
 * URL. All WS/REST URLs derive from AGENT_BASE_URL.
 *
 * Tuneable at build/dev time with VITE_AGENT_URL (e.g. when the agent
 * service runs on another host/port than the default). Keep the default
 * in sync with configs/app.yaml server.host / server.port.
 *
 * Auth (GATE-2.5 H4 + GATE-3.5 A2/R14): the service requires a per-launch
 * bearer token on every endpoint except /health. The token lives ONLY in
 * the Electron main process — the renderer NEVER holds it:
 *
 *  - Electron mode: authenticatedFetch() goes through window.arsvox.fetch
 *    (main-proxied; main attaches the Bearer header), and the WebSocket
 *    is main-owned (see src/ws/client.ts). No VITE token needed.
 *  - Plain-vite dev (no Electron): VITE_ARSVOX_TOKEN is the dev fallback,
 *    or the mock config may disable auth entirely.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";

function resolveBaseUrl(): string {
  const envUrl = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_AGENT_URL;
  return (envUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export const AGENT_BASE_URL = resolveBaseUrl();
export const WS_URL = `${AGENT_BASE_URL.replace(/^http/, "ws")}/ws`;
export const TTS_URL = `${AGENT_BASE_URL}/tts`;
export const STT_URL = `${AGENT_BASE_URL}/api/stt`;
export const CONFIG_URL = `${AGENT_BASE_URL}/config`;

/** True when the Electron preload bridge is present (main-proxied auth). */
export function hasBridge(): boolean {
  return typeof window !== "undefined" && !!window.arsvox;
}

/**
 * Dev-only token fallback (plain-vite browser sessions against a
 * token-protected service). In Electron mode this MUST stay empty — the
 * token never crosses into renderer JS.
 */
function devToken(): string {
  const fromEnv = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_ARSVOX_TOKEN;
  if (fromEnv) return fromEnv;
  // vitest 2.x vi.stubEnv() stubs process.env only (not import.meta.env) —
  // read it as a final fallback so tests can drive the dev-token path.
  // In the browser this guard short-circuits (no process global).
  if (typeof process !== "undefined") {
    return process.env?.VITE_ARSVOX_TOKEN ?? "";
  }
  return "";
}

/** Authorization header for REST calls in plain-vite dev (empty in
 *  Electron mode — the main process attaches the real token). */
export function authHeaders(): Record<string, string> {
  const token = devToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * WS URL with the token attached as a query param — only used in
 * plain-vite dev (browsers cannot set headers on WebSocket handshakes;
 * the service accepts both forms). In Electron mode the WebSocket lives
 * in the main process and this is never called.
 */
export function wsUrl(): string {
  const token = devToken();
  return token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
}

export interface AuthenticatedFetchInit {
  method?: string;
  /** JSON string, Blob, or FormData (STT upload). */
  body?: string | Blob | FormData;
  contentType?: string;
  filename?: string;
  signal?: AbortSignal;
}

/**
 * Fetch the agent service with the per-launch token attached.
 *
 * Electron mode: proxied through main (window.arsvox.fetch) — the token
 * is attached there and never enters renderer JS. The main process
 * validates the URL stays under AGENT_BASE_URL.
 *
 * Plain-vite dev: direct fetch with the VITE_ARSVOX_TOKEN header
 * (or none when the mock has auth disabled).
 */
export async function authenticatedFetch(
  url: string,
  init: AuthenticatedFetchInit = {},
): Promise<Response> {
  const bridge = typeof window !== "undefined" ? window.arsvox : undefined;
  if (bridge) {
    return bridgeFetch(bridge, url, init);
  }
  return fetch(url, {
    method: init.method ?? "GET",
    headers: authHeaders(),
    body:
      init.body instanceof FormData || init.body instanceof Blob || typeof init.body === "string"
        ? (init.body as BodyInit)
        : undefined,
    signal: init.signal,
  });
}

async function bridgeFetch(
  bridge: NonNullable<Window["arsvox"]>,
  url: string,
  init: AuthenticatedFetchInit,
): Promise<Response> {
  let body: ArrayBuffer | string | undefined;
  let contentType = init.contentType;
  let filename = init.filename;
  if (init.body instanceof FormData) {
    // STT upload: single file under the "file" key.
    const file = init.body.get("file");
    if (file instanceof Blob) {
      body = await file.arrayBuffer();
      contentType = contentType ?? file.type;
      filename = filename ?? (typeof (file as File).name === "string" ? (file as File).name : "utterance.webm");
    }
  } else if (init.body instanceof Blob) {
    body = await init.body.arrayBuffer();
    contentType = contentType ?? init.body.type;
  } else if (typeof init.body === "string") {
    body = init.body;
    contentType = contentType ?? "application/json";
  }
  const res = await bridge.fetch({
    url,
    method: init.method ?? "GET",
    body,
    contentType,
    filename,
  });
  return new Response(res.body, {
    status: res.status,
    headers: res.contentType ? { "content-type": res.contentType } : {},
  });
}
