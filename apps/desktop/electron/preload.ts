/**
 * Preload bridge (GATE-3.5 A2, R14): the renderer NEVER sees the
 * per-launch auth token. The surface is:
 *
 *  - serviceStatus()/onServiceEvent() — startup lifecycle (starting /
 *    ready / failed / stopped), so the UI can show a CLEAR error instead
 *    of a silent disconnected state (R12);
 *  - fetch() — main-proxied HTTP: the main process attaches the Bearer
 *    header and validates the URL against the agent base URL, so TTS /
 *    STT / config calls stay authenticated without the token entering
 *    renderer JS;
 *  - wsConnect()/wsSend()/wsClose()/onWsMessage()/onWsStatus() — the
 *    WebSocket lives in the MAIN process (Electron 33's renderer WebSocket
 *    cannot set headers and a token-in-URL would be renderer-readable).
 *    Outbound frames sent before the first connect are queued in main and
 *    delivered exactly once (R11).
 *  - browserNavigate()/browserBack()/browserForward()/browserRefresh()/
 *    browserSetBounds()/onBrowserState() — W2-VIEW (ADR 0007): the
 *    integrated browser is MAIN-owned. The renderer asks main to drive
 *    the hardened WebContentsView (navigate/back/forward/refresh) and
 *    reports the measured panel bounds; main publishes the view's REAL
 *    navigation state (url/title/can_go_back/can_go_forward/loading)
 *    back to the renderer. Remote pages never see any of this surface
 *    (the view has no preload).
 *
 * The previous getAuthToken() bridge (P2) is gone.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { ServiceStatus } from "./service";
// Bridge surface types live in ./bridge-types.ts — the SINGLE declaration
// site shared with the renderer contract (src/arsvox-bridge.d.ts imports
// and re-exports them). They are imported here (not re-exported) so there
// is exactly one exporter of each name in the repo.
import type {
  BridgeBrowserBounds,
  BridgeBrowserState,
  BridgeFetchRequest,
  BridgeFetchResponse,
} from "./bridge-types";

function subscribe(
  channel: string,
  callback: (payload: unknown) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("arsvox", {
  serviceStatus: (): Promise<ServiceStatus> =>
    ipcRenderer.invoke("arsvox:service-status") as Promise<ServiceStatus>,
  onServiceEvent: (callback: (status: ServiceStatus) => void): (() => void) =>
    subscribe("arsvox:service-event", callback as (payload: unknown) => void),
  fetch: (request: BridgeFetchRequest): Promise<BridgeFetchResponse> =>
    ipcRenderer.invoke("arsvox:fetch", request) as Promise<BridgeFetchResponse>,
  wsConnect: (): void => {
    ipcRenderer.send("arsvox:ws-connect");
  },
  wsClose: (): void => {
    ipcRenderer.send("arsvox:ws-close");
  },
  wsSend: (message: string): void => {
    ipcRenderer.send("arsvox:ws-send", message);
  },
  onWsMessage: (callback: (event: unknown) => void): (() => void) =>
    subscribe("arsvox:ws-message", callback),
  onWsStatus: (callback: (connected: boolean) => void): (() => void) =>
    subscribe("arsvox:ws-status", callback as (payload: unknown) => void),
  // ---- W2-VIEW (ADR 0007): integrated browser (main-owned) ----
  browserNavigate: (url: string): Promise<{ ok: boolean; reason: string }> =>
    ipcRenderer.invoke("arsvox:browser-navigate", { url }) as Promise<{
      ok: boolean;
      reason: string;
    }>,
  browserBack: (): void => {
    ipcRenderer.send("arsvox:browser-back");
  },
  browserForward: (): void => {
    ipcRenderer.send("arsvox:browser-forward");
  },
  browserRefresh: (): void => {
    ipcRenderer.send("arsvox:browser-refresh");
  },
  browserSetBounds: (bounds: BridgeBrowserBounds): void => {
    ipcRenderer.send("arsvox:browser-set-bounds", bounds);
  },
  onBrowserState: (callback: (state: BridgeBrowserState) => void): (() => void) =>
    subscribe("arsvox:browser-state", callback as (payload: unknown) => void),
});
