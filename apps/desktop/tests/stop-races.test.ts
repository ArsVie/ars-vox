/**
 * STOP race coverage — GATE-2.5 H3 (P0).
 *
 * The STOP contract is locally authoritative: the renderer cancels
 * capture/STT itself, then notifies the service. These tests pin the
 * races the audit found:
 *
 *  1. STOP while recording            -> no STT fetch, no transcript
 *  2. STOP before the final dataavailable/onstop pair (the browser
 *     delivers them asynchronously AFTER recorder.stop()) -> a trailing
 *     event must not repopulate chunks or ship a recording to STT
 *  3. STOP while the STT fetch is pending -> fetch is aborted, the
 *     AbortError becomes a silent no-op (never an error phase)
 *  4. STT resolves after STOP (response body still parsing when abort
 *     lands) -> the generation guard drops the stale transcript
 *  5. Socket disconnected + STOP -> the local cancellation boundary
 *     still runs even though the stop message can never be delivered
 *
 * MicCapture is exercised against fake browser APIs (node test env):
 * MediaRecorder's trailing events are QUEUED and delivered by the test
 * via flush(), mirroring the browser's async event delivery.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppStore, registerCaptureAbort } from "../src/store";
import { MicCapture } from "../src/voice/mic";
import { createMicHub } from "../src/voice/micHub";

// ---------------------------------------------------------------- fakes

interface FakeStream {
  getTracks: () => { stop: () => void }[];
}

/** MediaRecorder stand-in: stop() QUEUES the spec's trailing events and
 * the test delivers them with flush() — the browser fires them on the
 * task queue, and that async gap is exactly where the races live. */
class FakeMediaRecorder {
  static last: FakeMediaRecorder | null = null;
  static isTypeSupported(): boolean {
    return true;
  }

  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  private pending: (() => void)[] = [];

  constructor(public stream: FakeStream) {
    FakeMediaRecorder.last = this;
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.pending.push(() =>
      this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) }),
    );
    this.pending.push(() => this.onstop?.());
  }

  flush(): void {
    const events = this.pending.splice(0);
    for (const fire of events) fire();
  }
}

class FakeAudioContext {
  state = "running";
  async resume(): Promise<void> {}
  createAnalyser(): { fftSize: number; getFloatTimeDomainData: () => void } {
    return { fftSize: 1024, getFloatTimeDomainData: () => {} };
  }
  createMediaStreamSource(): { connect: () => void } {
    return { connect: () => {} };
  }
  async close(): Promise<void> {}
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const sttResponse = (text: string): Response =>
  ({ ok: true, json: async () => ({ text }) }) as unknown as Response;

// ---------------------------------------------------------------- rig

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    },
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeMediaRecorder.last = null;
});

function makeCapture(): {
  capture: MicCapture;
  phases: string[];
  transcripts: string[];
} {
  const phases: string[] = [];
  const transcripts: string[] = [];
  const capture = new MicCapture({
    onPhase: (phase, detail) => {
      phases.push(phase === "error" ? `error:${detail}` : phase);
    },
    onTranscript: (text) => transcripts.push(text),
  });
  return { capture, phases, transcripts };
}

// ------------------------------------------------------------ the races

describe("STOP while recording", () => {
  it("aborts capture locally: no STT fetch, no transcript, idle", async () => {
    fetchMock.mockResolvedValueOnce(sttResponse("hola"));
    const { capture, phases, transcripts } = makeCapture();

    await capture.start();
    expect(phases.at(-1)).toBe("recording");

    await capture.abort();
    // The browser delivers the trailing dataavailable + onstop AFTER
    // abort — they must not repopulate chunks or ship a recording.
    FakeMediaRecorder.last!.flush();
    await tick();
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(transcripts).toEqual([]);
    expect(phases.at(-1)).toBe("idle");
  });
});

describe("STOP before the final dataavailable", () => {
  it("a trailing dataavailable after abort cannot ship a recording", async () => {
    fetchMock.mockResolvedValueOnce(sttResponse("hola"));
    const { capture, phases, transcripts } = makeCapture();

    await capture.start();
    capture.stop(); // tap-to-talk release: recorder.stop() queued...
    await capture.abort(); // ...but STOP lands before the trailing events
    FakeMediaRecorder.last!.flush(); // browser delivers them now
    await tick();
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(transcripts).toEqual([]);
    expect(phases).toEqual(["recording", "idle"]);
  });
});

describe("STOP while the STT fetch is pending", () => {
  it("aborts the fetch; AbortError is a silent no-op, never an error phase", async () => {
    let rejectFetch!: (err: unknown) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const { capture, phases, transcripts } = makeCapture();

    await capture.start();
    capture.stop();
    FakeMediaRecorder.last!.flush();
    await tick();
    expect(phases.at(-1)).toBe("transcribing");

    await capture.abort();
    // The fetch's signal must actually be aborted by the local boundary.
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    rejectFetch(new DOMException("Aborted", "AbortError"));
    await tick();
    await tick();

    expect(transcripts).toEqual([]);
    expect(phases).not.toContain(expect.stringContaining("error"));
    expect(phases.at(-1)).toBe("idle");
  });
});

describe("STT resolves after STOP", () => {
  it("the generation guard drops the stale transcript", async () => {
    let resolveJson!: (v: { text: string }) => void;
    const jsonPromise = new Promise<{ text: string }>((resolve) => {
      resolveJson = resolve;
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => jsonPromise,
    } as unknown as Response);
    const { capture, phases, transcripts } = makeCapture();

    await capture.start();
    capture.stop();
    FakeMediaRecorder.last!.flush();
    await tick();
    await tick(); // finalize parked on res.json()
    expect(phases.at(-1)).toBe("transcribing");

    await capture.abort(); // STOP lands while the body is still parsing
    resolveJson({ text: "hola" }); // ...then STT resolves
    await tick();
    await tick();

    expect(transcripts).toEqual([]);
    expect(phases).not.toContain(expect.stringContaining("error"));
    expect(phases.at(-1)).toBe("idle");
  });
});

describe("micHub: the store's local boundary", () => {
  it("hub.abort() during transcription drops the transcript (what store.stop() calls)", async () => {
    let rejectFetch!: (err: unknown) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const transcripts: string[] = [];
    const hub = createMicHub((text) => transcripts.push(text));

    await hub.start();
    expect(hub.phase).toBe("recording");
    hub.stop();
    FakeMediaRecorder.last!.flush();
    await tick();
    expect(hub.phase).toBe("transcribing");

    hub.abort();
    rejectFetch(new DOMException("Aborted", "AbortError"));
    await tick();
    await tick();

    expect(transcripts).toEqual([]);
    expect(hub.phase).toBe("idle");
  });
});

describe("normal path (control)", () => {
  it("a plain stop still transcribes and delivers the turn", async () => {
    fetchMock.mockResolvedValueOnce(sttResponse("hola"));
    const { capture, phases, transcripts } = makeCapture();

    await capture.start();
    capture.stop();
    FakeMediaRecorder.last!.flush();
    await tick();
    await tick();
    await tick();

    expect(transcripts).toEqual(["hola"]);
    expect(phases).toEqual(["recording", "transcribing", "idle"]);
  });
});

describe("socket disconnected + STOP", () => {
  it("the local cancellation boundary still runs when send throws", () => {
    const sent: unknown[] = [];
    const store = createAppStore((message) => {
      sent.push(message);
      throw new Error("socket down");
    });
    store.getState().enqueueTts("hola");
    expect(store.getState().speakTexts).toEqual(["hola"]);

    let aborts = 0;
    registerCaptureAbort(() => {
      aborts += 1;
    });
    try {
      expect(() => store.getState().stop()).toThrow("socket down");
    } finally {
      registerCaptureAbort(() => {}); // test isolation: reset the hook
    }

    // Local boundary ran BEFORE the failed send: mic aborted, TTS queue
    // cleared, and the stop message was still attempted.
    expect(aborts).toBe(1);
    expect(store.getState().speakTexts).toEqual([]);
    expect(sent).toEqual([{ type: "stop" }]);
  });
});
