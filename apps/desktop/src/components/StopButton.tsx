import { useStore } from "zustand";

import { appStore } from "../store";
import { StopIcon } from "./icons";

/**
 * Always-visible local stop control, docked in the status bar so it never
 * overlaps panel content at any layout size. Sends the protocol stop.
 *
 * UI-303: the control lights up (solid red) whenever there is something
 * to stop — thinking, speaking AND listening (recording) — so STOP is
 * immediately recognizable as the active escape hatch in every state.
 * The accessible name matches the visible label (Spanish-first).
 */
export function StopButton() {
  const stop = useStore(appStore, (s) => s.stop);
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const active =
    voiceState === "thinking" ||
    voiceState === "speaking" ||
    voiceState === "listening";

  return (
    <button
      type="button"
      className={`stop-button ${active ? "active" : ""}`}
      onClick={() => stop()}
      aria-label="Detener"
      title="Detener"
    >
      <StopIcon size={13} />
      <span className="btn-label">DETENER</span>
    </button>
  );
}
