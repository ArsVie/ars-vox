/**
 * WebSocket client for the agent service (/ws endpoint).
 * Events are dispatched to the app store; outbound messages go through
 * the injected send function. Auto-reconnects with backoff.
 */

import type { ServerEvent } from "../contracts";
import { WS_URL } from "../endpoints";

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

  constructor(options: WsClientOptions) {
    this.url = options.url ?? WS_URL;
    this.reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
    this.onEvent = options.onEvent;
    this.onStatus = options.onStatus;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  send(message: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

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
