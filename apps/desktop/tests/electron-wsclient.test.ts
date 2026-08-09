/**
 * GATE-3.5 A2 — main-process WebSocket client unit tests
 * (electron/wsclient.ts) against a minimal RFC 6455 server over node:net:
 * upgrade + Sec-WebSocket-Accept, masked client frame parsing, unmasked
 * server frames, fragmentation, ping/pong, close handshake, reconnects.
 *
 * R11 coverage: messages sent before the first connect are queued and
 * delivered exactly once after the handshake (echo-verified).
 * R10 coverage: the Authorization header carries the token (server-side
 * assertion); a rejected upgrade surfaces as onClose.
 */

import * as crypto from "node:crypto";
import * as net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { WsClient } from "../electron/wsclient";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Server->client frame (unmasked). */
function serverFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([(fin ? 0x80 : 0) | opcode, len]);
  } else if (len < 65_536) {
    header = Buffer.alloc(4);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

interface MockWsServerOptions {
  /** Text frame sent right after the handshake. */
  greet?: string;
  /** Reply with a non-101 status (rejected upgrade). */
  rejectUpgrade?: boolean;
  /** Destroy the socket right after the handshake (abrupt close). */
  closeAfterHandshake?: boolean;
  /** Send a ping right after the handshake. */
  pingAfterHandshake?: boolean;
  /** Send a fragmented text message after the handshake. */
  fragmentedGreet?: string;
}

class MockWsServer {
  receivedAuth: string | null = null;
  receivedMessages: string[] = [];
  receivedPongs = 0;
  receivedCloseFrames = 0;
  handshakes = 0;
  closedByClient = 0;

  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly buffers = new Map<net.Socket, Buffer>();
  private readonly handshakeDone = new Set<net.Socket>();

  constructor(private readonly options: MockWsServerOptions = {}) {
    this.server = net.createServer((socket) => this.handle(socket));
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        resolve((this.server.address() as { port: number }).port);
      });
    });
  }

  close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(socket: net.Socket): void {
    this.sockets.add(socket);
    this.buffers.set(socket, Buffer.alloc(0));
    socket.setNoDelay(true);
    socket.on("close", () => {
      this.sockets.delete(socket);
      this.buffers.delete(socket);
      this.handshakeDone.delete(socket);
    });
    socket.on("data", (chunk: Buffer) => {
      const buffered = Buffer.concat([this.buffers.get(socket) ?? Buffer.alloc(0), chunk]);
      if (!this.handshakeDone.has(socket)) {
        const idx = buffered.indexOf(Buffer.from("\r\n\r\n"));
        if (idx === -1) {
          this.buffers.set(socket, buffered);
          return;
        }
        const head = buffered.subarray(0, idx).toString("latin1");
        this.buffers.set(socket, buffered.subarray(idx + 4));
        this.completeHandshake(socket, head);
        return;
      }
      this.buffers.set(socket, this.parseClientFrames(socket, buffered));
    });
  }

  private completeHandshake(socket: net.Socket, head: string): void {
    this.handshakes += 1;
    const lines = head.split("\r\n");
    const key = lines
      .find((l) => l.toLowerCase().startsWith("sec-websocket-key:"))
      ?.split(":")[1]
      ?.trim();
    this.receivedAuth =
      lines
        .find((l) => l.toLowerCase().startsWith("authorization:"))
        ?.split(":")
        .slice(1)
        .join(":")
        .trim() ?? null;

    if (this.options.rejectUpgrade) {
      socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    this.handshakeDone.add(socket);

    if (this.options.greet !== undefined) {
      socket.write(serverFrame(OP_TEXT, Buffer.from(this.options.greet, "utf8")));
    }
    if (this.options.fragmentedGreet !== undefined) {
      const text = Buffer.from(this.options.fragmentedGreet, "utf8");
      const half = Math.floor(text.length / 2);
      socket.write(serverFrame(OP_TEXT, text.subarray(0, half), false));
      socket.write(serverFrame(0x0, text.subarray(half), true));
    }
    if (this.options.pingAfterHandshake) {
      socket.write(serverFrame(OP_PING, Buffer.from("ping", "utf8")));
    }
    if (this.options.closeAfterHandshake) {
      setTimeout(() => socket.destroy(), 50);
    }
  }

  private parseClientFrames(socket: net.Socket, buffer: Buffer): Buffer {
    let buf = buffer;
    for (;;) {
      if (buf.length < 2) return buf;
      const b0 = buf[0];
      const b1 = buf[1];
      const opcode = b0 & 0x0f;
      const fin = (b0 & 0x80) !== 0;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return buf;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return buf;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      if (!masked) throw new Error("client frame not masked");
      if (buf.length < offset + 4 + len) return buf;
      const mask = buf.subarray(offset, offset + 4);
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i += 1) payload[i] = buf[offset + 4 + i] ^ mask[i % 4];
      buf = buf.subarray(offset + 4 + len);
      this.onClientFrame(socket, fin, opcode, payload);
    }
  }

  private onClientFrame(socket: net.Socket, fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === OP_TEXT) {
      this.receivedMessages.push(payload.toString("utf8"));
    } else if (opcode === OP_PONG) {
      this.receivedPongs += 1;
    } else if (opcode === OP_CLOSE) {
      this.receivedCloseFrames += 1;
      socket.write(serverFrame(OP_CLOSE, Buffer.from([0x03, 0xe8])));
      socket.end();
    }
    void fin;
  }
}

function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 4000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (predicate()) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for ${description}`));
      }
    }, 10);
  });
}

const servers: MockWsServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

describe("WsClient (main process, RFC 6455 over net)", () => {
  it("upgrades with the Authorization header and receives the greeting", async () => {
    const server = new MockWsServer({ greet: "hola" });
    servers.push(server);
    const port = await server.listen();

    const messages: string[] = [];
    let opened = 0;
    const client = new WsClient({
      url: `ws://127.0.0.1:${port}/ws`,
      headers: { Authorization: "Bearer super-secret" },
      onOpen: () => {
        opened += 1;
      },
      onMessage: (text) => messages.push(text),
    });
    client.connect();

    await waitFor(() => messages.includes("hola"), "greeting");
    expect(server.receivedAuth).toBe("Bearer super-secret");
    expect(opened).toBe(1);
    client.close();
  });

  it("R11: messages sent before the first connect are queued and delivered exactly once after the handshake", async () => {
    const server = new MockWsServer();
    servers.push(server);
    const port = await server.listen();

    const client = new WsClient({
      url: `ws://127.0.0.1:${port}/ws`,
      headers: { Authorization: "Bearer tok" },
      onOpen: () => undefined,
      onMessage: () => undefined,
    });
    // Send BEFORE connect(): the outbox must hold these and flush them
    // in order once the handshake completes.
    client.send("early-uno");
    client.send("early-dos");
    client.connect();

    await waitFor(
      () => server.receivedMessages.length >= 2,
      "early messages to arrive",
    );
    expect(server.receivedMessages).toEqual(["early-uno", "early-dos"]);
    // No duplicates after a settle window.
    await new Promise((r) => setTimeout(r, 150));
    expect(server.receivedMessages).toEqual(["early-uno", "early-dos"]);
    client.close();
  });

  it("responds to server pings with pongs", async () => {
    const server = new MockWsServer({ pingAfterHandshake: true });
    servers.push(server);
    const port = await server.listen();

    const client = new WsClient({
      url: `ws://127.0.0.1:${port}/ws`,
      onOpen: () => undefined,
      onMessage: () => undefined,
    });
    client.connect();
    await waitFor(() => server.receivedPongs >= 1, "pong");
    client.close();
  });

  it("delivers fragmented text messages as one message", async () => {
    const server = new MockWsServer({ fragmentedGreet: "mensaje partido en dos" });
    servers.push(server);
    const port = await server.listen();

    const messages: string[] = [];
    const client = new WsClient({
      url: `ws://127.0.0.1:${port}/ws`,
      onOpen: () => undefined,
      onMessage: (text) => messages.push(text),
    });
    client.connect();
    await waitFor(() => messages.length === 1, "fragmented message");
    expect(messages[0]).toBe("mensaje partido en dos");
    client.close();
  });

  it("reconnects after an abrupt server close", async () => {
    const server = new MockWsServer({ closeAfterHandshake: true });
    servers.push(server);
    const port = await server.listen();

    let opens = 0;
    const client = new WsClient({
      url: `ws://127.0.0.1:${port}/ws`,
      reconnectMs: 100,
      onOpen: () => {
        opens += 1;
      },
      onMessage: () => undefined,
    });
    client.connect();

    // The first connection is destroyed 50ms after the handshake; the
    // client must reconnect and complete a second handshake.
    await waitFor(() => server.handshakes >= 2, "second handshake");
    expect(opens).toBeGreaterThanOrEqual(2);
    client.close();
  });

  it("close() performs the close handshake and stops reconnecting", async () => {
    const server = new MockWsServer();
    servers.push(server);
    const port = await server.listen();

    let opens = 0;
    let closes = 0;
    const client = new WsClient({
      url: `ws://127.0.0.1:${port}/ws`,
      reconnectMs: 60,
      onOpen: () => {
        opens += 1;
      },
      onClose: () => {
        closes += 1;
      },
      onMessage: () => undefined,
    });
    client.connect();
    await waitFor(() => opens === 1, "open");
    client.close();

    await waitFor(() => server.receivedCloseFrames >= 1, "close frame");
    await new Promise((r) => setTimeout(r, 200));
    expect(server.handshakes).toBe(1); // no reconnect after close()
    expect(closes).toBeGreaterThanOrEqual(1);
  });

  it("a rejected upgrade surfaces as onClose", async () => {
    const server = new MockWsServer({ rejectUpgrade: true });
    servers.push(server);
    const port = await server.listen();

    let closes = 0;
    const client = new WsClient({
      url: `ws://127.0.0.1:${port}/ws`,
      reconnectMs: 1000, // slow retry: we only assert the first failure
      onOpen: () => undefined,
      onClose: () => {
        closes += 1;
      },
      onMessage: () => undefined,
    });
    client.connect();
    await waitFor(() => closes >= 1, "close on rejected upgrade");
    client.close();
  });
});
