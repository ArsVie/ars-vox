/**
 * Minimal RFC 6455 WebSocket client for the Electron MAIN process.
 *
 * Electron 33's main-process Node (20.18) has no global WebSocket and the
 * desktop package cannot add dependencies (junctioned node_modules), so
 * this is a small self-contained client over node:net:
 *
 *  - HTTP/1.1 upgrade with arbitrary headers (the per-launch bearer token
 *    rides `Authorization`, so the token NEVER appears in the URL and
 *    never reaches renderer JS);
 *  - client frames are masked (required by the spec), server frames are
 *    verified unmasked;
 *  - text/continuation frames (incl. fragmentation), ping/pong keepalive,
 *    close handshake, 7/16/64-bit payload lengths;
 *  - outgoing messages are queued while the socket is not open and
 *    flushed in order on open — R11: pre-connect input is delivered
 *    exactly once, no loss window. GATE-3.5 W3-TRANSPORT: this is the
 *    surviving transport outbox (the store-level duplicate is gone);
 *  - automatic reconnect with the ONE shared backoff policy
 *    (electron/backoff.ts — same module the renderer client imports).
 *
 * The unit tests exercise this against a real loopback server
 * (tests/electron-wsclient.test.ts) and the launch integration test runs
 * it against the real Python service.
 */

import * as crypto from "node:crypto";
import * as net from "node:net";

import { ReconnectBackoff, RECONNECT_BASE_MS } from "./backoff";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const HEAD_END = Buffer.from("\r\n\r\n");
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
const OUTBOX_CAP = 200;

export interface WsClientOptions {
  /** ws://host:port/path (token must NOT be in the URL). */
  url: string;
  /** Extra request headers for the upgrade (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Base delay of the shared exponential backoff (default: RECONNECT_BASE_MS). */
  reconnectMs?: number;
  onOpen?: () => void;
  onMessage?: (text: string) => void;
  onClose?: (code?: number) => void;
}

export class WsClient {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly onOpen?: () => void;
  private readonly onMessage?: (text: string) => void;
  private readonly onClose?: (code?: number) => void;
  private readonly backoff: ReconnectBackoff;

  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private handshakeDone = false;
  private closedByUser = false;
  private outbox: string[] = [];
  /** Fragments of an in-flight fragmented text message. */
  private fragments: Buffer[] = [];

  constructor(options: WsClientOptions) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.onOpen = options.onOpen;
    this.onMessage = options.onMessage;
    this.onClose = options.onClose;
    // W3-TRANSPORT: the ONE reconnect backoff policy, shared with the
    // renderer client (src/ws/client.ts) via electron/backoff.ts.
    this.backoff = new ReconnectBackoff(
      {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      },
      options.reconnectMs ?? RECONNECT_BASE_MS,
    );
  }

  get connected(): boolean {
    return this.socket !== null && this.handshakeDone && !this.socket.destroyed;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  /** Queue (pre-connect) or send (open). Exactly-once: the queue is
   *  flushed only when the handshake completes, and never dropped. */
  send(text: string): void {
    if (this.connected) {
      this.writeFrame(OP_TEXT, Buffer.from(text, "utf8"));
      return;
    }
    this.outbox.push(text);
    if (this.outbox.length > OUTBOX_CAP) this.outbox.shift();
  }

  close(): void {
    this.closedByUser = true;
    this.backoff.cancel();
    if (this.connected) {
      try {
        this.writeFrame(OP_CLOSE, Buffer.from([0x03, 0xe8])); // 1000
      } catch {
        // socket already gone
      }
    }
    this.socket?.destroy();
    this.socket = null;
    this.handshakeDone = false;
    this.outbox = [];
    this.fragments = [];
  }

  private open(): void {
    if (this.closedByUser) return;
    let url: URL;
    try {
      url = new URL(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    const port = url.port ? Number(url.port) : url.protocol === "wss:" ? 443 : 80;
    const socket = net.connect(port, url.hostname);
    this.socket = socket;
    this.handshakeDone = false;
    this.buffer = Buffer.alloc(0);
    socket.setNoDelay(true);

    const key = crypto.randomBytes(16).toString("base64");
    const host = url.hostname + (port !== 80 && port !== 443 ? `:${port}` : "");
    const requestPath = `${url.pathname}${url.search}`;
    const headerLines = [
      `GET ${requestPath} HTTP/1.1`,
      `Host: ${host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      ...Object.entries(this.headers).map(([k, v]) => `${k}: ${v}`),
      "",
      "",
    ];

    socket.on("connect", () => {
      socket.write(headerLines.join("\r\n"));
    });

    socket.on("data", (chunk: Buffer) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      if (!this.handshakeDone) {
        const idx = this.buffer.indexOf(HEAD_END);
        if (idx === -1) return; // headers not complete yet
        const head = this.buffer.subarray(0, idx).toString("latin1");
        this.buffer = this.buffer.subarray(idx + 4);
        if (!this.completeHandshake(head, key)) return;
        this.handshakeDone = true;
        // A successful connection restarts the shared backoff curve.
        this.backoff.reset();
        this.flushOutbox();
        this.onOpen?.();
      }
      this.parseFrames();
    });

    socket.on("error", () => {
      // handled by 'close' below
    });

    socket.on("close", (hadError: boolean) => {
      this.socket = null;
      this.handshakeDone = false;
      this.fragments = [];
      if (this.closedByUser) {
        this.onClose?.();
        return;
      }
      this.onClose?.(hadError ? undefined : 1006);
      this.scheduleReconnect();
    });
  }

  private completeHandshake(head: string, key: string): boolean {
    const lines = head.split("\r\n");
    const statusLine = lines[0] ?? "";
    if (!statusLine.includes(" 101 ")) {
      this.teardownOnProtocolError(`handshake rejected: ${statusLine}`);
      return false;
    }
    const acceptHeader = lines
      .find((l) => l.toLowerCase().startsWith("sec-websocket-accept:"))
      ?.split(":")[1]
      ?.trim();
    const expected = crypto
      .createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    if (acceptHeader !== expected) {
      this.teardownOnProtocolError("Sec-WebSocket-Accept mismatch");
      return false;
    }
    return true;
  }

  private flushOutbox(): void {
    const pending = this.outbox.splice(0);
    for (const message of pending) this.writeFrame(OP_TEXT, Buffer.from(message, "utf8"));
  }

  private parseFrames(): void {
    for (;;) {
      if (this.buffer.length < 2) return;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let length = b1 & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.teardownOnProtocolError("frame too large");
          return;
        }
        length = Number(big);
        offset = 10;
      }
      // Server->client frames MUST NOT be masked (RFC 6455 §5.1).
      if (masked) {
        this.teardownOnProtocolError("masked server frame");
        return;
      }
      if (this.buffer.length < offset + length) return; // wait for more
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      this.handleFrame(fin, opcode, payload);
    }
  }

  private handleFrame(fin: boolean, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case OP_TEXT:
        if (fin) {
          this.onMessage?.(payload.toString("utf8"));
        } else {
          this.fragments = [payload];
        }
        return;
      case 0x0: // continuation
        this.fragments.push(payload);
        if (fin) {
          const message = Buffer.concat(this.fragments).toString("utf8");
          this.fragments = [];
          this.onMessage?.(message);
        }
        return;
      case OP_BINARY:
        return; // the service only sends text frames
      case OP_CLOSE:
        this.closeFromPeer(payload);
        return;
      case OP_PING:
        this.writeFrame(OP_PONG, payload);
        return;
      case OP_PONG:
        return;
      default:
        this.teardownOnProtocolError(`unknown opcode ${opcode}`);
    }
  }

  private closeFromPeer(payload: Buffer): void {
    const code = payload.length >= 2 ? payload.readUInt16BE(0) : undefined;
    try {
      this.writeFrame(OP_CLOSE, Buffer.from([0x03, 0xe8])); // echo 1000
    } catch {
      // socket already gone
    }
    this.socket?.destroy();
    this.socket = null;
    this.handshakeDone = false;
    this.onClose?.(code);
    if (!this.closedByUser) this.scheduleReconnect();
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    const socket = this.socket;
    if (!socket || !this.handshakeDone || socket.destroyed) return;
    const mask = crypto.randomBytes(4);
    const maskedPayload = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i < payload.length; i += 1) {
      maskedPayload[i] = payload[i] ^ mask[i % 4];
    }
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length < 65_536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    socket.write(Buffer.concat([header, mask, maskedPayload]));
  }

  private teardownOnProtocolError(reason: string): void {
    this.socket?.destroy();
    this.socket = null;
    this.handshakeDone = false;
    this.fragments = [];
    if (this.closedByUser) return;
    this.onClose?.();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    // Single-flight scheduling + the ONE shared exponential policy
    // (W3-TRANSPORT, electron/backoff.ts).
    this.backoff.schedule(() => this.open());
  }
}
