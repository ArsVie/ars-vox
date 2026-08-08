/**
 * Microphone capture controller — blob-per-utterance framing.
 *
 * Records from getUserMedia via MediaRecorder, watches RMS energy with
 * the EnergyVad, and when an utterance ends (silence or manual stop)
 * POSTs the blob to the agent service /api/stt. The resulting text is
 * delivered to onTranscript; the caller sends it as user_text.
 *
 * Design decision (framing): blob per utterance, not chunked stream.
 * The STT endpoint already exists (file upload -> faster-whisper), so
 * the renderer produces one blob per utterance and the service stays
 * unchanged. VAD + silence detection run here, in the renderer.
 */

import { authHeaders, STT_URL } from "../endpoints";
import { EnergyVad, type VadConfig } from "./vad";

export type MicPhase = "idle" | "recording" | "transcribing" | "error";

export interface MicCallbacks {
  onPhase: (phase: MicPhase, detail?: string) => void;
  onTranscript: (text: string) => void;
}

/**
 * VAD thresholds are deliberate renderer constants (they are tuned to
 * the single user's mic, not exposed via config); the framing contract
 * (blob per utterance) lives in services/voice/arsvox_voice.
 */
const DEFAULT_VAD: VadConfig = {
  speechThreshold: 0.015,
  silenceMs: 900,
  minSpeechMs: 250,
  maxDurationMs: 30000,
};

function rmsOf(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private chunks: Blob[] = [];
  private vad = new EnergyVad(DEFAULT_VAD);
  private stoppedByUser = false;

  constructor(private readonly callbacks: MicCallbacks) {}

  get phase(): MicPhase {
    if (this.recorder && this.recorder.state === "recording") return "recording";
    if (this.recorder && this.recorder.state === "inactive" && this.chunks.length > 0) {
      return "transcribing";
    }
    return "idle";
  }

  /** Start capturing. Resolves once the mic is live and recording. */
  async start(): Promise<void> {
    this.stoppedByUser = false;
    this.vad.reset();
    this.chunks = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      this.callbacks.onPhase("error", String(err));
      throw err;
    }
    this.stream = stream;

    const mime = ["audio/webm;codecs=opus", "audio/webm", ""].find((m) =>
      m ? MediaRecorder.isTypeSupported(m) : true,
    );
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.onstop = () => this.finalize();

    // Energy analysis loop.
    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume(); // user gesture present
    this.audioCtx = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    this.analyser = analyser;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!this.analyser || !this.recorder || this.recorder.state !== "recording") return;
      this.analyser.getFloatTimeDomainData(buffer);
      const rms = rmsOf(buffer);
      const now = performance.now();
      const event = this.vad.feed(rms, now);
      if (event === "utterance_end" && !this.stoppedByUser) {
        this.stop();
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };

    recorder.start(250);
    this.callbacks.onPhase("recording");
    this.rafId = requestAnimationFrame(tick);
  }

  /** Manual stop: finalize the current utterance and transcribe it. */
  stop(): void {
    this.stoppedByUser = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.recorder && this.recorder.state === "recording") this.recorder.stop();
    else if (this.recorder) this.finalize();
  }

  /** Abort without transcribing (e.g. app stop). */
  async abort(): Promise<void> {
    this.stoppedByUser = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.chunks = [];
    if (this.recorder && this.recorder.state === "recording") {
      try {
        this.recorder.stop();
      } catch {
        // already stopped
      }
    }
    this.teardown();
    this.callbacks.onPhase("idle");
  }

  private async finalize(): Promise<void> {
    const blob = new Blob(this.chunks, { type: this.recorder?.mimeType ?? "audio/webm" });
    const hadAudio = blob.size > 0;
    this.teardown();
    if (!hadAudio) {
      this.callbacks.onPhase("idle");
      return;
    }
    this.callbacks.onPhase("transcribing");
    try {
      const form = new FormData();
      form.append("file", blob, "utterance.webm");
      const res = await fetch(STT_URL, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) throw new Error(`stt ${res.status}`);
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? "").trim();
      if (text) this.callbacks.onTranscript(text);
      this.callbacks.onPhase("idle");
    } catch (err) {
      this.callbacks.onPhase("error", String(err));
    }
  }

  private teardown(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.analyser = null;
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
  }
}
