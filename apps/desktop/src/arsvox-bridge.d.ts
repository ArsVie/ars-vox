/**
 * Electron preload bridge surface (see electron/preload.ts). Exposed via
 * contextBridge only — GATE-3.5 A2 (R14): the renderer NEVER receives the
 * per-launch auth token. Auth flows through main-proxied calls:
 *
 *  - fetch(): main attaches the Bearer header and validates the URL
 *    against the agent base URL;
 *  - ws*(): the WebSocket lives in the main process (Electron's renderer
 *    WebSocket cannot set headers, and a token-in-URL would be
 *    renderer-readable). Outbound frames sent before the first connect
 *    are queued in main and delivered exactly once (R11).
 *  - serviceStatus()/onServiceEvent(): startup lifecycle (R12 — visible
 *    failure instead of a silent disconnected state).
 */

export type ServiceState = "starting" | "ready" | "failed" | "stopped";

export interface ServiceStatus {
  state: ServiceState;
  detail?: string;
}

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

export interface ArsvoxBridge {
  serviceStatus(): Promise<ServiceStatus>;
  onServiceEvent(callback: (status: ServiceStatus) => void): () => void;
  fetch(request: BridgeFetchRequest): Promise<BridgeFetchResponse>;
  wsConnect(): void;
  wsClose(): void;
  wsSend(message: string): void;
  onWsMessage(callback: (event: unknown) => void): () => void;
  onWsStatus(callback: (connected: boolean) => void): () => void;
}

declare global {
  interface Window {
    arsvox?: ArsvoxBridge;
  }
}
