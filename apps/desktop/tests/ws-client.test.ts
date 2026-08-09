/**
 * GATE-3.5 A6 (R29) — WsClient.forceReconnect: the resync trigger.
 *
 * When the store detects a bus sequence gap it calls the bound resync
 * hook, which main.tsx wires to WsClient.forceReconnect — a reconnect NOW
 * (bypassing the backoff timer) because every connect carries a fresh
 * state_snapshot, and the snapshot is the sync mechanism.
 *
 * Node env, fake WebSocket (no jsdom — repo convention).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WsClient } from "../src/ws/client";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(_message: unknown): void {}

  close(): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  /** Test helper: simulate the server accepting the connection. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void) => setTimeout(fn, 0),
    clearTimeout: (id: unknown) => clearTimeout(id as NodeJS.Timeout),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WsClient.forceReconnect (R29 resync trigger)", () => {
  it("reconnects immediately when a socket is open (no backoff wait)", () => {
    const onEvent = vi.fn();
    const onStatus = vi.fn();
    const client = new WsClient({ url: "ws://x", onEvent, onStatus });

    client.connect();
    const first = FakeWebSocket.instances[0];
    expect(first).toBeDefined();
    first.open();
    expect(onStatus).toHaveBeenCalledWith(true);

    client.forceReconnect();

    // the old socket is closed and a NEW one opens synchronously
    expect(first.closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].readyState).toBe(FakeWebSocket.CONNECTING);
  });

  it("opens a socket when called before the first connection", () => {
    const client = new WsClient({ url: "ws://x", onEvent: vi.fn() });
    client.forceReconnect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("is a no-op after the client was closed by the user", () => {
    const client = new WsClient({ url: "ws://x", onEvent: vi.fn() });
    client.connect();
    client.close();
    client.forceReconnect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
