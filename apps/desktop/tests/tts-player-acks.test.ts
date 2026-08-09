/**
 * GATE-3.5 A1 — physical TTS playback acks + STOP renderer half (R01-R08).
 *
 * The renderer is the PHYSICAL playback authority: TtsPlayer reports
 * tts.started / tts.finished / tts.cancelled so the canonical voice
 * state machine only reaches LISTENING after speech ends. These tests
 * pin the ack contract (node env, no jsdom — the ack logic lives in
 * PhrasePlayer, exercised like MicCapture in stop-races.test.ts) plus
 * the store's spoken-STOP behavior:
 *
 *   R01  spoken stop surfaces as state_update STOPPING -> the store
 *        clears the TTS queue so TtsPlayer interrupts physical playback
 *   R05  started only when playback physically begins; finished only on
 *        natural end / failure — never an optimistic ack
 *   R07  a playing phrase interrupted by a queue clear acks
 *        tts.cancelled exactly once
 *   R04  a stale started ack after dispose is dropped (generation guard)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhrasePlayer } from "../src/components/TtsPlayer";
import { createAppStore } from "../src/store";
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
const audioResponse = (): Response =>
  ({ ok: true, blob: async () => new Blob(["audio"], { type: "audio/webm" }) }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;
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
  fetchMock = vi.fn().mockResolvedValue(audioResponse());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  });
  acks = [];
  doneCount = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudio.last = null;
});

// ---------------------------------------------------------------- R05/R08

describe("PhrasePlayer acks (R05/R08)", () => {
  it("sends tts.started when playback physically begins", async () => {
    const player = makePlayer();
    void player.start();
    await tick();
    await tick();
    expect(acks).toEqual([{ type: "tts.started" }]);
    expect(player.audio.play).toHaveBeenCalled();
  });

  it("sends tts.finished on natural end, then advances the queue", async () => {
    const player = makePlayer();
    void player.start();
    await tick();
    await tick();
    expect(acks).toEqual([{ type: "tts.started" }]);

    FakeAudio.last!.emit("ended");
    expect(acks).toEqual([
      { type: "tts.started" },
      { type: "tts.finished" },
    ]);
    expect(doneCount).toBe(1);
  });

  it("sends tts.finished when the fetch fails before anything played", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const player = makePlayer();
    void player.start();
    await tick();
    await tick();
    expect(acks).toEqual([{ type: "tts.finished" }]);
    expect(doneCount).toBe(1);
    expect(acks).not.toContainEqual({ type: "tts.started" });
  });

  it("a phrase that never started does not ack cancelled on dispose", async () => {
    let rejectFetch!: (err: unknown) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const player = makePlayer();
    void player.start();
    player.dispose(); // queue cleared while the fetch is in flight
    rejectFetch(new Error("tts 503"));
    await tick();
    await tick();
    expect(acks).toEqual([]);
    expect(doneCount).toBe(0);
  });
});

// ---------------------------------------------------------------- R07/R04

describe("PhrasePlayer cancellation (R07/R04)", () => {
  it("dispose while playing sends tts.cancelled exactly once", async () => {
    const player = makePlayer();
    void player.start();
    await tick();
    await tick();
    expect(acks).toEqual([{ type: "tts.started" }]);

    player.dispose(); // queue cleared by STOP
    expect(acks).toEqual([
      { type: "tts.started" },
      { type: "tts.cancelled" },
    ]);
    expect(player.audio.pause).toHaveBeenCalled();
  });

  it("natural end then dispose (queue advance) does NOT send cancelled", async () => {
    const player = makePlayer();
    void player.start();
    await tick();
    await tick();
    FakeAudio.last!.emit("ended");
    expect(acks).toEqual([
      { type: "tts.started" },
      { type: "tts.finished" },
    ]);

    player.dispose(); // effect cleanup when the next phrase mounts
    expect(acks).toEqual([
      { type: "tts.started" },
      { type: "tts.finished" },
    ]);
  });

  it("a stale started ack after dispose is dropped (generation guard)", async () => {
    let resolvePlay!: () => void;
    const player = makePlayer();
    (player.audio.play as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePlay = resolve;
      }),
    );
    void player.start();
    await tick(); // fetch resolved, play() parked

    player.dispose(); // STOP lands while play() is still pending
    resolvePlay(); // ...then playback "begins"
    FakeAudio.last!.emit("playing");
    await tick();

    expect(acks).toEqual([]); // no stale started after dispose
  });
});

// ---------------------------------------------------------------- R01

describe("store: spoken STOP clears the TTS queue (R01 renderer half)", () => {
  function ts(): string {
    return new Date().toISOString();
  }

  it("state_update stopping clears speakTexts so TtsPlayer interrupts playback", () => {
    const store = createAppStore(() => {});
    store.getState().enqueueTts("Hola");
    store.getState().enqueueTts("mundo");
    expect(store.getState().speakTexts).toEqual(["Hola", "mundo"]);

    store.getState().applyEvent({
      type: "state_update",
      voice_state: "stopping",
      activity: null,
      created_at: ts(),
    });
    expect(store.getState().speakTexts).toEqual([]);
    expect(store.getState().voiceState).toBe("stopping");
  });

  it("other state transitions leave the queue untouched", () => {
    const store = createAppStore(() => {});
    store.getState().enqueueTts("Hola");
    store.getState().applyEvent({
      type: "state_update",
      voice_state: "thinking",
      activity: "algo",
      created_at: ts(),
    });
    expect(store.getState().speakTexts).toEqual(["Hola"]);
  });

  it("button stop still clears the queue BEFORE sending the stop message", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().enqueueTts("Hola");
    store.getState().stop();
    expect(store.getState().speakTexts).toEqual([]);
    expect(sent).toEqual([{ type: "stop" }]);
  });
});
