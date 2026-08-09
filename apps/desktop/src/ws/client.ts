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
 * GATE-3.5 W3-TRANSPORT: the transport owns the ONE outbox. In direct
 * mode this client queues frames while the socket is not OPEN (flushed
 * in order on open — R11 exactly-once); in bridge mode the main-process
 * queue (electron/wsclient.ts) backs sends. The reconnect backoff policy
 * is the shared module electron/backoff.ts, imported by both transports.
 *
 * Events are dispatched to the app store; outbound messages go through
 * the injected send function.
 */

import type { ServerEvent } from "../contracts";
import { hasBridge, WS_URL, wsUrl } from "../endpoints";
import { ReconnectBackoff, RECONNECT_BASE_MS } from "../../electron/backoff";
import { isServerEventShape } from "./validate";

const OUTBOX_CAP = 200;

export interface WsClientOptions {
  url?: string;
  reconnectMs?: number;
  onEvent: (event: ServerEvent) => void;
  onStatus?: (connected: boolean) => void;
}

export class WsClient {
  private readonly url: string;
  private readonly onEvent: (event: ServerEvent) => void;
  private readonly onStatus?: (connected: boolean) => void;
  private readonly backoff: ReconnectBackoff;

  private ws: WebSocket | null = null;
  private closedByUser = false;
  private readonly bridgeMode: boolean;
  private unsubscribe: (() => void)[] = [];
  /** W3-TRANSPORT: the single outbox (direct mode) — see send(). */
  private outbox: string[] = [];

  constructor(options: WsClientOptions) {
    this.bridgeMode = hasBridge();
    this.url = options.url ?? (this.bridgeMode ? "" : wsUrl());
    this.onEvent = options.onEvent;
    this.onStatus = options.onStatus;
    this.backoff = new ReconnectBackoff(
      {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id as number),
      },
      options.reconnectMs ?? RECONNECT_BASE_MS,
    );
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
      // The main-process queue (electron/wsclient.ts) is the outbox here.
      window.arsvox?.wsSend(JSON.stringify(message));
      return;
    }
    const text = JSON.stringify(message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text);
      return;
    }
    // W3-TRANSPORT: queue while the socket is not OPEN so pre-connect and
    // reconnect sends are never dropped (R11); flushed in order on open.
    // ONE buffer — the store no longer double-buffers (W3 carve-out).
    this.outbox.push(text);
    if (this.outbox.length > OUTBOX_CAP) this.outbox.shift();
  }

  close(): void {
    this.closedByUser = true;
    if (this.bridgeMode) {
      for (const unsubscribe of this.unsubscribe) unsubscribe();
      this.unsubscribe = [];
      window.arsvox?.wsClose();
      return;
    }
    this.backoff.cancel();
    this.outbox = [];
    this.ws?.close();
    this.ws = null;
  }

  // ------------------------------------------------------- bridge mode #

  private connectBridge(): void {
    const bridge = window.arsvox;
    if (!bridge) return;
    this.unsubscribe = [
      bridge.onWsMessage((event) => {
        // W3-TRANSPORT: validate the wire shape before the cast — a
        // malformed frame is dropped with a warning, never trusted.
        if (!isServerEventShape(event)) {
          console.warn("[ws] dropping malformed inbound frame (bridge):", event);
          return;
        }
        try {
          this.onEvent(event);
        } catch {
          // handler error: keep the socket alive
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
      // A successful connection restarts the shared backoff curve and
      // flushes anything queued while the socket was down (R11).
      this.backoff.reset();
      this.flushOutbox();
      this.onStatus?.(true);
    };
    ws.onmessage = (raw) => {
      let event: unknown;
      try {
        event = JSON.parse(String(raw.data));
      } catch {
        // W3-TRANSPORT: unparsable frame — drop with a warning, never
        // trust it.
        console.warn("[ws] dropping malformed inbound frame (unparsable):", raw.data);
        return;
      }
      // W3-TRANSPORT: discriminator check on the wire shape before the
      // cast (ws/client.ts:125 bare cast removed).
      if (!isServerEventShape(event)) {
        console.warn("[ws] dropping malformed inbound frame (bad shape):", event);
        return;
      }
      try {
        this.onEvent(event);
      } catch {
        // handler error: keep the socket alive
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

  /**
   * GATE-3.5 (A6/R29): force a resync by reconnecting NOW — the server
   * sends a fresh state_snapshot on every connect, which is the sync
   * mechanism. Bypasses the backoff timer; safe to call repeatedly (no-op
   * when already reconnecting / user-closed). Called by the store when a
   * bus sequence gap is detected.
   */
  forceReconnect(): void {
    if (this.closedByUser) return;
    if (this.bridgeMode) {
      // Bridge mode: the socket lives in the MAIN process — there is no
      // renderer WebSocket to reopen (url is "" here; new WebSocket("")
      // throws and would spin scheduleReconnect() every 2s forever in the
      // packaged build). Resync = tear down the IPC subscriptions and
      // re-issue wsConnect() — the server sends a fresh state_snapshot on
      // every connect, which is the R29 resync mechanism.
      for (const unsubscribe of this.unsubscribe) unsubscribe();
      this.unsubscribe = [];
      this.connectBridge();
      return;
    }
    this.backoff.cancel();
    const current = this.ws;
    if (current) {
      // Closing fires onclose, which would schedule a backoff reconnect —
      // suppress it (the immediate reopen below replaces it).
      current.onclose = null;
      try {
        current.close();
      } catch {
        // already closing/closed — fine
      }
    }
    this.ws = null;
    this.open();
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    // Single-flight scheduling + shared exponential policy (W3-TRANSPORT).
    this.backoff.schedule(() => this.open());
  }

  private flushOutbox(): void {
    const pending = this.outbox.splice(0);
    for (const text of pending) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
    }
  }
}
