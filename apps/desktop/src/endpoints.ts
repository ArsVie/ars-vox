/**
 * Agent-service endpoints — single source of truth for every UI↔service
 * URL. All WS/REST URLs derive from AGENT_BASE_URL.
 *
 * Tuneable at build/dev time with VITE_AGENT_URL (e.g. when the agent
 * service runs on another host/port than the default). Keep the default
 * in sync with configs/app.yaml server.host / server.port.
 *
 * Auth (GATE-2.5 H4): the service requires a per-launch bearer token on
 * every endpoint except /health. The token comes from the Electron
 * preload bridge (window.arsvox.getAuthToken, set by the main process);
 * in plain-vite dev (no Electron) VITE_ARSVOX_TOKEN is the fallback, or
 * the mock config may disable auth entirely.
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

/** Per-launch bearer token (preload bridge first, VITE fallback for dev). */
export function getAuthToken(): string {
  const bridge =
    typeof window !== "undefined"
      ? (window as { arsvox?: { getAuthToken?: () => string } }).arsvox
      : undefined;
  const fromBridge = bridge?.getAuthToken?.();
  if (fromBridge) return fromBridge;
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

/** Authorization header for REST calls (empty when auth is off in dev). */
export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * WS URL with the token attached as a query param — browsers cannot set
 * headers on WebSocket handshakes, so the token rides the URL (the
 * service accepts both forms).
 */
export function wsUrl(): string {
  const token = getAuthToken();
  return token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
}
