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
 *  - browserNavigate()/browserBack()/browserForward()/browserRefresh()/
 *    browserSetBounds()/onBrowserState() — W2-VIEW (ADR 0007): the
 *    integrated browser is MAIN-owned; the renderer drives the hardened
 *    WebContentsView through these and receives its REAL navigation
 *    state (url/title/can_go_back/can_go_forward/loading).
 */

// Bridge surface types: ONE declaration site — electron/bridge-types.ts.
// Re-exported here so the renderer program sees the exact same types the
// preload bridge uses (no duplicate declarations to drift apart).
import type {
  BridgeBrowserBounds,
  BridgeBrowserState,
  BridgeDomActionRequest,
  BridgeFetchRequest,
  BridgeFetchResponse,
} from "../electron/bridge-types";

export type {
  BridgeBrowserBounds,
  BridgeBrowserState,
  BridgeDomActionRequest,
  BridgeFetchRequest,
  BridgeFetchResponse,
};

export type ServiceState = "starting" | "ready" | "failed" | "stopped";

export interface ServiceStatus {
  state: ServiceState;
  detail?: string;
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
  browserNavigate(url: string): Promise<{ ok: boolean; reason: string }>;
  browserBack(): void;
  browserForward(): void;
  browserRefresh(): void;
  browserSetBounds(bounds: BridgeBrowserBounds): void;
  onBrowserState(callback: (state: BridgeBrowserState) => void): () => void;
  /** W2-DRIVE: ask main to apply a DOM action to the browser view (returns the real result). */
  browserDomAction(request: BridgeDomActionRequest): Promise<string>;
}

declare global {
  interface Window {
    arsvox?: ArsvoxBridge;
  }
}
