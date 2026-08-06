import { useStore } from "zustand";

import { appStore } from "../store";

/** Always-visible local stop control. Sends the protocol stop message. */
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
      STOP
    </button>
  );
}
