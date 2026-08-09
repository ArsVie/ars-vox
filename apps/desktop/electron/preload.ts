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
 *
 * The previous getAuthToken() bridge (P2) is gone.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { ServiceStatus } from "./service";

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
});
