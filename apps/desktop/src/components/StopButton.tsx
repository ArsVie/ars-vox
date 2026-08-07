import { useStore } from "zustand";

import { appStore } from "../store";
import { StopIcon } from "./icons";

/**
 * Always-visible local stop control, docked in the status bar so it never
 * overlaps panel content at any layout size. Sends the protocol stop.
 */
export function StopButton() {
  const stop = useStore(appStore, (s) => s.stop);
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const active = voiceState === "thinking" || voiceState === "speaking";

  return (
    <button
      type="button"
      className={`stop-button ${active ? "active" : ""}`}
      onClick={() => stop()}
      aria-label="Stop"
      title="Stop"
    >
      <StopIcon size={13} />
      <span className="btn-label">DETENER</span>
    </button>
  );
}
