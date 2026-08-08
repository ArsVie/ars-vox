import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import { appStore } from "../store";
import { micHub, micHubStore } from "../voice/micHub";
import { MicIcon } from "./icons";

/**
 * Tap-to-talk mic control, driven by the shared micHub so the composer
 * button and the empty-state hero stay in sync. Records until silence
 * (VAD) or a second tap, transcribes via the service /api/stt, then
 * sends the text as a normal user_text message. The app stop control
 * aborts an in-flight recording.
 */
export function MicButton() {
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const phase = useStore(micHubStore, (s) => s.phase);
  const error = useStore(micHubStore, (s) => s.error);

  // Abort the recording when the user hits STOP (barge-in: stop() clears
  // the speak queue; an in-flight utterance must not be sent afterwards).
  // This covers BOTH phases — while recording AND while transcribing
  // (the STT fetch must be aborted so a post-STOP transcript cannot
  // become a new user turn). Primary coverage is store.stop()'s local
  // cancellation boundary; this effect is the fallback for stops that
  // arrive via the service (keyword stop, server-initiated).
  const stopping = voiceState === "stopping" || voiceState === "sleeping";
  const wasStopping = useRef(false);
  useEffect(() => {
    if (
      stopping &&
      !wasStopping.current &&
      (phase === "recording" || phase === "transcribing")
    ) {
      void micHub.abort();
    }
    wasStopping.current = stopping;
  }, [stopping, phase]);

  const label =
    phase === "recording" ? "Escuchando..." : phase === "transcribing" ? "..." : "Micrófono";
  const busy = phase === "transcribing";

  return (
    <button
      type="button"
      className={`mic-button ${phase === "recording" ? "recording" : ""} ${busy ? "busy" : ""}`}
      onClick={() => micHub.toggle()}
      disabled={busy}
      aria-label={phase === "recording" ? "Stop recording" : "Record a message"}
      title={phase === "recording" ? "Stop recording" : "Record a message"}
    >
      <MicIcon size={15} />
      <span className="btn-label">{label}</span>
      {error ? <span className="mic-error" title={error} /> : null}
    </button>
  );
}
