/**
 * Agent-service endpoints — single source of truth for every UI↔service
 * URL. All WS/REST URLs derive from AGENT_BASE_URL.
 *
 * Tuneable at build/dev time with VITE_AGENT_URL (e.g. when the agent
 * service runs on another host/port than the default). Keep the default
 * in sync with configs/app.yaml server.host / server.port.
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
