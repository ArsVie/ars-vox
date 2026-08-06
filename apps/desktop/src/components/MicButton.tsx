import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { appStore } from "../store";
import { MicCapture, type MicPhase } from "../voice/mic";

/**
 * Tap-to-talk mic control. Records until silence (VAD) or a second tap,
 * transcribes via the service /api/stt, then sends the text as a normal
 * user_text message. The app stop control aborts an in-flight recording.
 */
export function MicButton() {
  const sendText = useStore(appStore, (s) => s.sendText);
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const micRef = useRef<MicCapture | null>(null);
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  if (!micRef.current) {
    micRef.current = new MicCapture({
      onPhase: (p, detail) => {
        setPhase(p);
        if (p === "error") setError(detail ?? "mic error");
        else if (p !== "recording") setError(null);
      },
      onTranscript: (text) => sendText(text),
    });
  }
  const mic = micRef.current;

  // Abort the recording when the user hits STOP (barge-in: stop() clears
  // the speak queue; an in-flight utterance must not be sent afterwards).
  const stopping = voiceState === "stopping" || voiceState === "sleeping";
  const wasStopping = useRef(false);
  useEffect(() => {
    if (stopping && !wasStopping.current && phase === "recording") {
      void mic.abort();
    }
    wasStopping.current = stopping;
  }, [stopping, phase, mic]);

  const toggle = async () => {
    if (phase === "recording") {
      mic.stop();
      return;
    }
    if (phase === "transcribing") return;
    setError(null);
    try {
      await mic.start();
    } catch {
      // onPhase already reported the error
    }
  };

  const label =
    phase === "recording" ? "Listening..." : phase === "transcribing" ? "..." : "MIC";
  const busy = phase === "transcribing";

  return (
    <button
      type="button"
      className={`mic-button ${phase === "recording" ? "recording" : ""} ${busy ? "busy" : ""}`}
      onClick={() => void toggle()}
      disabled={busy}
      aria-label={phase === "recording" ? "Stop recording" : "Record a message"}
      title={phase === "recording" ? "Stop recording" : "Record a message"}
    >
      {label}
      {error ? <span className="mic-error" title={error} /> : null}
    </button>
  );
}
