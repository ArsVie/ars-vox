import { useStore } from "zustand";

import { micHub, micHubStore } from "../voice/micHub";
import { MicIcon, WaveformIcon } from "./icons";

/**
 * Big glowing mic orb — the empty-state hero. Tapping it starts the same
 * recording session as the composer MicButton (shared micHub). While
 * recording it pulses with an animated listening ring.
 */
export function MicHero() {
  const phase = useStore(micHubStore, (s) => s.phase);
  const recording = phase === "recording";
  const busy = phase === "transcribing";

  return (
    <button
      type="button"
      className={`mic-hero ${recording ? "recording" : ""} ${busy ? "busy" : ""}`}
      onClick={() => micHub.toggle()}
      disabled={busy}
      aria-label={recording ? "Detener grabación" : "Grabar un mensaje"}
      title={recording ? "Detener grabación" : "Grabar un mensaje"}
    >
      <span className="mic-hero-ring" aria-hidden="true" />
      <span className="mic-hero-ring mic-hero-ring-2" aria-hidden="true" />
      {recording ? <WaveformIcon size={34} /> : <MicIcon size={34} />}
      <span className="mic-hero-label">
        {recording ? "Escuchando..." : "Toca para hablar"}
      </span>
    </button>
  );
}
