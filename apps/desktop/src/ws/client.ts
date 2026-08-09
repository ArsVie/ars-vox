/**
 * WebSocket client for the agent service (/ws endpoint).
 *
 * Two transports behind the same interface:
 *
 *  - Electron mode (window.arsvox bridge present, GATE-3.5 A2/R14): the
 *    socket lives in the MAIN process (the only place that may hold the
 *    per-launch token — a renderer WebSocket cannot set headers and a
 *    token-in-URL would be renderer-readable). Outbound frames sent
 *    before the first connect are queued in main and delivered exactly
 *    once (R11). Events/status arrive as push events over IPC.
 *  - Plain-vite dev: direct browser WebSocket with the VITE token on the
 *    URL query (or none when the mock has auth disabled). Auto-reconnects
 *    with backoff.
 *
 * Events are dispatched to the app store; outbound messages go through
 * the injected send function.
 */

import type { ServerEvent } from "../contracts";
import { hasBridge, WS_URL, wsUrl } from "../endpoints";

const DEFAULT_RECONNECT_MS = 2000;

export interface WsClientOptions {
  url?: string;
  reconnectMs?: number;
  onEvent: (event: ServerEvent) => void;
  onStatus?: (connected: boolean) => void;
}

export class WsClient {
  private readonly url: string;
  private readonly reconnectMs: number;
  private readonly onEvent: (event: ServerEvent) => void;
  private readonly onStatus?: (connected: boolean) => void;

  private ws: WebSocket | null = null;
  private timer: number | null = null;
  private closedByUser = false;
  private readonly bridgeMode: boolean;
  private unsubscribe: (() => void)[] = [];

  constructor(options: WsClientOptions) {
    this.bridgeMode = hasBridge();
    this.url = options.url ?? (this.bridgeMode ? "" : wsUrl());
    this.reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
    this.onEvent = options.onEvent;
    this.onStatus = options.onStatus;
  }

  connect(): void {
    this.closedByUser = false;
    if (this.bridgeMode) {
      this.connectBridge();
      return;
    }
    this.open();
  }

  send(message: unknown): void {
    if (this.bridgeMode) {
      window.arsvox?.wsSend(JSON.stringify(message));
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.bridgeMode) {
      for (const unsubscribe of this.unsubscribe) unsubscribe();
      this.unsubscribe = [];
      window.arsvox?.wsClose();
      return;
    }
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  // ------------------------------------------------------- bridge mode #

  private connectBridge(): void {
    const bridge = window.arsvox;
    if (!bridge) return;
    this.unsubscribe = [
      bridge.onWsMessage((event) => {
        try {
          this.onEvent(event as ServerEvent);
        } catch {
          // malformed frame: ignore, keep the socket alive
        }
      }),
      bridge.onWsStatus((connected) => {
        this.onStatus?.(connected);
      }),
    ];
    bridge.wsConnect();
  }

  // ------------------------------------------------------- direct mode #

  private open(): void {
    if (this.closedByUser) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.onStatus?.(true);
    };
    ws.onmessage = (raw) => {
      try {
        const event = JSON.parse(String(raw.data)) as ServerEvent;
        this.onEvent(event);
      } catch {
        // malformed frame: ignore, keep the socket alive
      }
    };
    ws.onclose = () => {
      this.onStatus?.(false);
      this.ws = null;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows; reconnection is handled there.
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.open();
    }, this.reconnectMs);
  }
}
