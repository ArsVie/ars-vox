/**
 * GATE-3.5 W0-TTS regression — the authenticated TTS transport.
 *
 * The A1/A2 merge (3d74afb) dropped the A2 authenticatedFetch fix
 * (5d7007d), so the packaged Electron build POSTed TTS through a RAW
 * fetch() — no launch token -> 401 -> the catch acked tts.finished and
 * returned -> the assistant was SILENTLY MUTE.
 *
 * tests/tts-player-acks.test.ts stubs global fetch and passes either way
 * (it never exercises the bridge) — that is exactly why this defect
 * shipped. These tests pin the TRANSPORT, not the acks:
 *
 *   - with window.arsvox present (Electron bridge mode), the TTS POST
 *     must go through the bridge (authenticatedFetch ->
 *     window.arsvox.fetch, where the MAIN process attaches the token) and
 *     never through a raw global fetch;
 *   - a non-OK response must surface an error (setError via onError)
 *     BEFORE acking tts.finished — an ack-only 401 renders as silence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhrasePlayer } from "../src/components/TtsPlayer";
import { TTS_URL } from "../src/endpoints";
import type { TtsAckMessage } from "../src/contracts";

// ---------------------------------------------------------------- fakes

class FakeAudio {
  static last: FakeAudio | null = null;

  playbackRate = 1;
  muted = false;
  src = "";
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();
  readonly play = vi.fn(async () => {
    this.emit("playing");
  });
  readonly pause = vi.fn();

  constructor() {
    FakeAudio.last = this;
  }

  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  emit(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
    if (type === "ended") this.onended?.();
    if (type === "error") this.onerror?.();
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A window.arsvox.fetch response shape (BridgeFetchResponse). */
function bridgeResponse(status: number, contentType: string): Record<string, unknown> {
  return {
    ok: status >= 200 && status < 300,
    status,
    contentType,
    body: new TextEncoder().encode(`{"status":${status}}`).buffer as ArrayBuffer,
  };
}

function setBridge(bridge: { fetch: ReturnType<typeof vi.fn> } | null): void {
  const w = globalThis as Record<string, unknown> & { window?: unknown };
  if (bridge) {
    w.window = { arsvox: bridge };
  } else {
    delete (w.window as { arsvox?: unknown } | undefined)?.arsvox;
  }
}

let acks: TtsAckMessage[];
let doneCount: number;

function makePlayer(opts: Partial<ConstructorParameters<typeof PhrasePlayer>[0]> = {}) {
  return new PhrasePlayer({
    text: "Hola",
    ttsSpeed: 1,
    send: (ack) => acks.push(ack),
    onDone: () => {
      doneCount += 1;
    },
    ...opts,
  });
}

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
  setBridge(null);
  acks = [];
  doneCount = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudio.last = null;
  setBridge(null);
});

// ---------------------------------------------------------------- bridge transport

describe("TTS transport: bridge mode (W0 regression)", () => {
  it("routes the TTS POST through window.arsvox.fetch — never a raw global fetch", async () => {
    const bridgeFetch = vi.fn().mockResolvedValue(bridgeResponse(200, "audio/webm"));
    const globalFetch = vi.fn().mockResolvedValue(
      ({ ok: true, blob: async () => new Blob(["audio"], { type: "audio/webm" }) }) as unknown as Response,
    );
    vi.stubGlobal("fetch", globalFetch);
    setBridge({ fetch: bridgeFetch });

    const player = makePlayer();
    void player.start();
    await tick();
    await tick();

    // The token-carrying bridge is the ONLY transport the renderer may use.
    expect(bridgeFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
    const request = bridgeFetch.mock.calls[0][0] as Record<string, unknown>;
    expect(request.url).toBe(TTS_URL);
    expect(request.method).toBe("POST");
    expect(request.body).toBe(JSON.stringify({ text: "Hola" }));
    expect(request.contentType).toBe("application/json");
    // ...and playback proceeds normally through the bridge response.
    expect(acks).toEqual([{ type: "tts.started" }]);
    expect(player.audio.play).toHaveBeenCalled();
  });

  it("non-OK bridge response surfaces the error BEFORE acking tts.finished (no silent mute)", async () => {
    const bridgeFetch = vi.fn().mockResolvedValue(bridgeResponse(401, "application/json"));
    setBridge({ fetch: bridgeFetch });

    const order: string[] = [];
    const errors: string[] = [];
    const player = makePlayer({
      send: (ack) => {
        order.push(`ack:${ack.type}`);
        acks.push(ack);
      },
      onError: (message) => {
        order.push("error");
        errors.push(message);
      },
    });
    void player.start();
    await tick();
    await tick();

    // The 401 must be LOUD — an error surfaced before the settle ack, so
    // the user sees a diagnostic instead of a mute assistant.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("401");
    expect(order).toEqual(["error", "ack:tts.finished"]);
    expect(doneCount).toBe(1); // queue still advances — never stuck
    expect(acks).not.toContainEqual({ type: "tts.started" });
  });
});
