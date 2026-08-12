import { useStore } from "zustand";

import { appStore } from "../store";
import { StopIcon } from "./icons";

/**
 * Always-visible local stop control, docked in the shell chrome so it never
 * overlaps panel content at any layout size. Sends the protocol stop.
 *
 * Leaf H (chrome polish): STOP is a SYMBOL-ONLY control — a small (~18px)
 * red rounded square with a stop glyph inside. No visible text label, no
 * pill. The accessible name matches the Spanish label (aria-label/title);
 * the visually-hidden text node keeps the symbol-only button announceable
 * and copyable consistently.
 *
 * UI-303: the control lights up (solid red) whenever there is something
 * to stop — thinking, speaking AND listening (recording) — so STOP is
 * immediately recognizable as the active escape hatch in every state.
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
      <span className="stop-glyph" aria-hidden="true">
        <StopIcon size={12} />
      </span>
      <span className="visually-hidden">DETENER</span>
    </button>
  );
}
