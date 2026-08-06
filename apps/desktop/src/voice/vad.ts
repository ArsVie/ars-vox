/**
 * Energy-based voice activity detector (pure, clock-injected — no DOM).
 *
 * Feeds RMS samples; emits "speech_start" when the signal rises above
 * the threshold and "utterance_end" when speech is followed by enough
 * silence (or the hard duration cap is hit). Sub-threshold blips shorter
 * than minSpeechMs are ignored.
 */

export interface VadConfig {
  /** RMS >= this counts as speech (normalized 0..1). */
  speechThreshold: number;
  /** Trailing silence (ms) after speech that ends the utterance. */
  silenceMs: number;
  /** Speech bursts shorter than this are treated as noise. */
  minSpeechMs: number;
  /** Hard cap (ms); force utterance_end even if still speaking. */
  maxDurationMs: number;
}

export type VadEvent = "speech_start" | "utterance_end";

export class EnergyVad {
  private state: "idle" | "speech" = "idle";
  private speechStart = 0;
  private lastSpeechAt = 0;

  constructor(private readonly cfg: VadConfig) {}

  /** Feed one RMS sample with its timestamp (ms). Returns events. */
  feed(rms: number, now: number): VadEvent | null {
    const { speechThreshold, silenceMs, minSpeechMs, maxDurationMs } = this.cfg;
    const isSpeech = rms >= speechThreshold;

    if (this.state === "idle") {
      if (isSpeech) {
        this.state = "speech";
        this.speechStart = now;
        this.lastSpeechAt = now;
        return "speech_start";
      }
      return null;
    }

    // In speech.
    if (now - this.speechStart >= maxDurationMs) {
      this.state = "idle";
      return "utterance_end";
    }
    if (isSpeech) {
      this.lastSpeechAt = now;
      return null;
    }

    // Silence while in speech.
    if (now - this.speechStart < minSpeechMs) {
      // Blip: too short to be a real utterance — drop it silently.
      this.state = "idle";
      return null;
    }
    if (now - this.lastSpeechAt >= silenceMs || now - this.speechStart >= maxDurationMs) {
      this.state = "idle";
      return "utterance_end";
    }
    return null;
  }

  reset(): void {
    this.state = "idle";
  }
}
