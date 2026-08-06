/**
 * EnergyVad coverage: threshold gating, silence-terminated utterances,
 * blip rejection, and the max-duration cap.
 */

import { describe, expect, it } from "vitest";

import { EnergyVad, type VadConfig } from "../src/voice/vad";

const cfg: VadConfig = {
  speechThreshold: 0.1,
  silenceMs: 1000,
  minSpeechMs: 250,
  maxDurationMs: 10000,
};

function vad(): EnergyVad {
  return new EnergyVad(cfg);
}

describe("EnergyVad", () => {
  it("emits speech_start on the first frame above threshold", () => {
    const v = vad();
    expect(v.feed(0.02, 0)).toBeNull();
    expect(v.feed(0.5, 100)).toBe("speech_start");
  });

  it("stays silent below threshold", () => {
    const v = vad();
    expect(v.feed(0.01, 0)).toBeNull();
    expect(v.feed(0.09, 500)).toBeNull();
  });

  it("ends the utterance after silenceMs of trailing silence", () => {
    const v = vad();
    v.feed(0.5, 0);
    expect(v.feed(0.4, 100)).toBeNull();
    // still speaking at 300
    expect(v.feed(0.5, 300)).toBeNull();
    // silence starts at 300; ends at 300 + 1000
    expect(v.feed(0.01, 400)).toBeNull();
    expect(v.feed(0.01, 1301)).toBe("utterance_end");
  });

  it("ignores blips shorter than minSpeechMs", () => {
    const v = vad();
    v.feed(0.5, 0);
    // speech ends at 100 (duration 100 < minSpeechMs 250)
    expect(v.feed(0.01, 100)).toBeNull();
    // long silence afterwards must NOT emit utterance_end (blip dropped)
    expect(v.feed(0.01, 2000)).toBeNull();
  });

  it("keeps a valid utterance alive through intermittent speech", () => {
    const v = vad();
    v.feed(0.5, 0);
    v.feed(0.5, 100);
    v.feed(0.5, 200); // 200ms of speech so far — past minSpeechMs
    v.feed(0.01, 300); // silence gap, < silenceMs
    v.feed(0.5, 500); // speaks again — resets the silence window
    v.feed(0.01, 501); // silence from 501
    expect(v.feed(0.01, 1400)).toBeNull(); // 899ms since last speech
    expect(v.feed(0.01, 1501)).toBe("utterance_end"); // 1000ms since 501
  });

  it("forces utterance_end at maxDurationMs even while speaking", () => {
    const v = vad();
    v.feed(0.5, 0);
    expect(v.feed(0.5, 10000)).toBe("utterance_end"); // 10s cap hit
  });

  it("returns to idle after utterance_end and can start a new one", () => {
    const v = vad();
    v.feed(0.5, 0);
    v.feed(0.5, 100); // last speech at 100
    v.feed(0.01, 300); // silence from 300
    expect(v.feed(0.01, 1300)).toBe("utterance_end"); // 1000ms since 100
    expect(v.feed(0.5, 2000)).toBe("speech_start");
  });

  it("reset clears state", () => {
    const v = vad();
    v.feed(0.5, 0);
    v.reset();
    expect(v.feed(0.01, 5000)).toBeNull();
  });
});
