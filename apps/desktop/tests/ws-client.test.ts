/**
 * GATE-3.5 A6 (R29) — WsClient.forceReconnect: the resync trigger.
 *
 * When the store detects a bus sequence gap it calls the bound resync
 * hook, which main.tsx wires to WsClient.forceReconnect — a reconnect NOW
 * (bypassing the backoff timer) because every connect carries a fresh
 * state_snapshot, and the snapshot is the sync mechanism.
 *
 * GATE-3.5 W3-TRANSPORT — transport-layer regressions:
 *  - ONE outbox (direct mode): sends queue while the socket is not OPEN
 *    and flush exactly once, in order, on open — no double enqueue;
 *  - ONE shared backoff policy (electron/backoff.ts): exponential with
 *    jitter + cap, single-flight scheduling, cancel/reset semantics;
 *  - inbound frames are validated at the renderer boundary: malformed
 *    frames (unparsable, missing/empty discriminator) are dropped with a
 *    console.warn, never delivered to the store.
 *
 * Node env, fake WebSocket (no jsdom — repo convention).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WsClient } from "../src/ws/client";
import {
  BackoffScheduler,
  ReconnectBackoff,
  RECONNECT_BASE_MS,
  RECONNECT_CAP_MS,
  reconnectDelayMs,
} from "../electron/backoff";

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
  /** Frames the client actually put on the wire (asserted by tests). */
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(message: unknown): void {
    this.sentMessages.push(String(message));
  }

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
  vi.restoreAllMocks();
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

describe("W3-TRANSPORT: ONE outbox (direct mode, no double enqueue)", () => {
  it("queues sends while the socket is not OPEN and flushes them exactly once, in order, on open", () => {
    const onEvent = vi.fn();
    const client = new WsClient({ url: "ws://x", onEvent });
    client.connect();
    const ws = FakeWebSocket.instances[0];
    expect(ws.readyState).toBe(FakeWebSocket.CONNECTING);

    client.send({ type: "user_text", text: "uno" });
    client.send({ type: "stop" });
    expect(ws.sentMessages).toEqual([]); // nothing leaked to a non-OPEN socket

    ws.open();
    expect(ws.sentMessages).toEqual([
      JSON.stringify({ type: "user_text", text: "uno" }),
      JSON.stringify({ type: "stop" }),
    ]);
    // exactly once — a second flush would double-send
    expect(ws.sentMessages).toHaveLength(2);

    client.send({ type: "stop" }); // live send now that the socket is OPEN
    expect(ws.sentMessages).toHaveLength(3);
  });

  it("does not double-enqueue a message sent while a reconnect is pending", async () => {
    const onEvent = vi.fn();
    const client = new WsClient({ url: "ws://x", onEvent });
    client.connect();
    const first = FakeWebSocket.instances[0];
    first.open();

    first.onclose?.(); // socket dropped -> shared backoff schedules a reconnect
    client.send({ type: "stop" }); // mid-gap send -> queued ONCE
    await new Promise((r) => setTimeout(r, 5)); // let the 0ms reconnect fire

    const second = FakeWebSocket.instances[1];
    expect(second).toBeDefined();
    second.open();
    expect(second.sentMessages).toEqual([JSON.stringify({ type: "stop" })]);
    expect(second.sentMessages).toHaveLength(1);
  });

  it("clears the queued outbox on user close() so a stale queue never flushes", () => {
    const client = new WsClient({ url: "ws://x", onEvent: vi.fn() });
    client.connect();
    const first = FakeWebSocket.instances[0];
    client.send({ type: "stop" }); // queued while CONNECTING
    client.close();

    client.connect(); // fresh session
    const second = FakeWebSocket.instances[1];
    second.open();
    expect(second.sentMessages).toEqual([]); // stale queue never flushed
    expect(first.sentMessages).toEqual([]); // and never leaked either
  });
});

describe("W3-TRANSPORT: ONE shared backoff policy (electron/backoff.ts)", () => {
  it("grows exponentially from the base and caps at RECONNECT_CAP_MS", () => {
    // random()=0.5 -> jitter factor exactly 1.0 (0.8 + 0.5*0.4)
    const unitJitter = () => 0.5;
    expect(reconnectDelayMs(0, unitJitter)).toBe(RECONNECT_BASE_MS);
    expect(reconnectDelayMs(1, unitJitter)).toBe(RECONNECT_BASE_MS * 2);
    expect(reconnectDelayMs(2, unitJitter)).toBe(RECONNECT_BASE_MS * 4);
    expect(reconnectDelayMs(3, unitJitter)).toBe(RECONNECT_BASE_MS * 8);
    expect(reconnectDelayMs(4, unitJitter)).toBe(RECONNECT_CAP_MS); // 2000*16 -> capped
    expect(reconnectDelayMs(20, unitJitter)).toBe(RECONNECT_CAP_MS);
  });

  it("jitters within +/-20% of the exponential delay", () => {
    const lo = reconnectDelayMs(0, () => 0); // 0.8x
    const hi = reconnectDelayMs(0, () => 0.9999); // ~1.2x
    expect(lo).toBe(Math.round(RECONNECT_BASE_MS * 0.8));
    expect(hi).toBe(Math.round(RECONNECT_BASE_MS * 1.2));
  });

  it("is monotonic non-decreasing across attempts", () => {
    const unitJitter = () => 0.5;
    const delays = [0, 1, 2, 3, 4, 5, 10].map((attempt) =>
      reconnectDelayMs(attempt, unitJitter),
    );
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });

  it("ReconnectBackoff is single-flight: a schedule() while pending is ignored", () => {
    const fired: { fn: (() => void) | null } = { fn: null };
    const scheduled: number[] = [];
    const scheduler: BackoffScheduler = {
      setTimeout: (fn, ms) => {
        scheduled.push(ms);
        fired.fn = fn;
        return 1;
      },
      clearTimeout: () => {},
    };
    const backoff = new ReconnectBackoff(scheduler, 100);
    const first = vi.fn();
    const second = vi.fn();
    backoff.schedule(first);
    backoff.schedule(second); // pending — ignored
    expect(scheduled).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();

    fired.fn?.(); // the pending reconnect fires and frees the slot
    backoff.schedule(second);
    expect(scheduled).toHaveLength(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled(); // scheduled, not fired yet
  });

  it("ReconnectBackoff.cancel() clears a pending reconnect (idempotent)", () => {
    let cleared = 0;
    const scheduler: BackoffScheduler = {
      setTimeout: () => 1,
      clearTimeout: () => {
        cleared += 1;
      },
    };
    const backoff = new ReconnectBackoff(scheduler, 100);
    backoff.schedule(() => {});
    backoff.cancel();
    expect(cleared).toBe(1);
    backoff.cancel(); // no pending timer anymore
    expect(cleared).toBe(1);
  });

  it("ReconnectBackoff.reset() restarts the exponential curve", () => {
    const fired: { fn: (() => void) | null } = { fn: null };
    const scheduled: number[] = [];
    const scheduler: BackoffScheduler = {
      setTimeout: (fn, ms) => {
        scheduled.push(ms);
        fired.fn = fn;
        return 1;
      },
      clearTimeout: () => {},
    };
    const backoff = new ReconnectBackoff(scheduler, 100);
    backoff.schedule(() => {});
    fired.fn?.();
    backoff.schedule(() => {}); // attempt 1 -> ~2x base
    fired.fn?.();
    backoff.reset();
    backoff.schedule(() => {}); // curve restarted -> ~base again
    fired.fn?.();
    backoff.schedule(() => {}); // attempt 1 again -> ~2x base

    const inRange = (value: number, min: number, max: number) => {
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
    };
    inRange(scheduled[0], 80, 120); // base 100 * [0.8, 1.2)
    inRange(scheduled[1], 160, 240); // 2x
    inRange(scheduled[2], 80, 120); // after reset: back to base
    inRange(scheduled[3], 160, 240);
  });
});

describe("W3-TRANSPORT: inbound frames are validated at the renderer boundary", () => {
  it("drops malformed frames with a console.warn in direct mode and delivers valid ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onEvent = vi.fn();
    const client = new WsClient({ url: "ws://x", onEvent });
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    ws.onmessage?.({ data: "not json at all" });
    expect(onEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    ws.onmessage?.({ data: JSON.stringify({ hello: "world" }) }); // no discriminator
    expect(onEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);

    ws.onmessage?.({ data: JSON.stringify({ type: "" }) }); // empty discriminator
    expect(onEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);

    const valid = { type: "pong" };
    ws.onmessage?.({ data: JSON.stringify(valid) });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(valid);
    expect(warn).toHaveBeenCalledTimes(3); // valid frame: no warning
  });

  it("drops malformed frames arriving through the bridge (bridge mode)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onEvent = vi.fn();
    const bridge = {
      wsConnect: vi.fn(),
      wsClose: vi.fn(),
      wsSend: vi.fn(),
      onWsMessage: vi.fn((_cb: (event: unknown) => void) => () => {}),
      onWsStatus: vi.fn((_cb: (connected: boolean) => void) => () => {}),
    };
    vi.stubGlobal("window", {
      arsvox: bridge,
      setTimeout: (fn: () => void) => setTimeout(fn, 0),
      clearTimeout: (id: unknown) => clearTimeout(id as NodeJS.Timeout),
    });
    const client = new WsClient({ onEvent });
    client.connect();
    const handler = bridge.onWsMessage.mock.calls[0][0] as (event: unknown) => void;

    handler({ type: 42 }); // non-string discriminator
    expect(onEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    handler("garbage");
    expect(onEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);

    handler({ type: "state_snapshot" }); // well-shaped (partial) event passes
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
