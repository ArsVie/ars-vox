import type { ReactNode } from "react";

import { useStore } from "zustand";

import { appStore } from "../store";
import {
  ChatIcon,
  MicIcon,
  ShieldIcon,
  SparkleIcon,
  StopIcon,
  WarningIcon,
  WaveformIcon,
} from "./icons";
import { StopButton } from "./StopButton";
import { TURN_ACTIVE_VOICE_STATES, TurnTimer } from "./TurnTimer";

const VOICE_LABELS: Record<string, string> = {
  sleeping: "En espera",
  listening: "Escuchando",
  thinking: "Pensando",
  speaking: "Hablando",
  waiting_for_confirmation: "Esperando confirmación",
  stopping: "Deteniendo",
  error: "Error",
};

/**
 * R43 — one canonical status vocabulary: the assistant state labels below
 * are the ONLY place voice-state texts are defined. Mic controls use their
 * own phase labels (recording/transcribing) and never duplicate these.
 */
export const STATUS_VOCABULARY: Readonly<Record<string, string>> = VOICE_LABELS;

/**
 * UI-303 — assistant state is never communicated by color alone: every
 * voice state renders a recognizable icon alongside the Spanish label so
 * listening/thinking/speaking/waiting are semantically clear without
 * color perception (aria-hidden: the label text is the accessible name).
 */
const STATE_ICONS: Record<string, ReactNode> = {
  sleeping: <SparkleIcon size={13} />,
  listening: <MicIcon size={13} />,
  thinking: <ChatIcon size={13} />,
  speaking: <WaveformIcon size={13} />,
  waiting_for_confirmation: <ShieldIcon size={13} />,
  stopping: <StopIcon size={13} />,
  error: <WarningIcon size={13} />,
};

/**
 * UI-WAVE (2026-08-13) — the shell no longer carries a floating status
 * cluster at the top-center of the stage. Per the backlog directive the
 * assistant status is now a MINIMAL bar embedded directly above the
 * composer (like usual chat UIs). Two shell remnants stay global: the
 * ARS·VOX wordmark (home affordance, top-left) and a floating status
 * fallback for layouts without the conversation surface (so the voice
 * state + STOP remain reachable everywhere).
 */

/** The minimal status pill: dot + state icon + Spanish label. */
function StatusPill({ connected }: { connected: boolean }) {
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const stateKey = voiceState;
  const label = VOICE_LABELS[stateKey] ?? stateKey;

  return (
    <span
      className={`status-pill ${connected ? "on" : "off"}`}
      data-state={stateKey}
      role="status"
    >
      <span className={`status-dot ${connected ? "connected" : "disconnected"}`} />
      <span className="status-state-icon" aria-hidden="true">
        {STATE_ICONS[stateKey] ?? <SparkleIcon size={13} />}
      </span>
      <span className="status-voice">{label}</span>
    </span>
  );
}

/**
 * Persistent home affordance (top-left): the ARS·VOX wordmark returns to
 * the central mic-hero view through the frozen C1 human-initiated layout
 * seam (layout.restore clears every persistent constraint — fullscreen/
 * close/left; panel.open guarantees conversation is in the composition;
 * panel.set_primary makes it the central primary).
 */
export function HomeAffordance() {
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);

  const goHome = () => {
    dispatchCommand({ action: "layout.restore" });
    dispatchCommand({ action: "panel.open", panel_type: "conversation" });
    dispatchCommand({ action: "panel.set_primary", panel_type: "conversation" });
  };

  return (
    <div className="shell-chrome">
      <button
        type="button"
        className="home-button"
        onClick={goHome}
        aria-label="Inicio"
        title="Volver al inicio"
      >
        <span className="home-brand">
          ARS<em>·</em>VOX
        </span>
      </button>
    </div>
  );
}

/**
 * Minimal status bar embedded ABOVE the composer (backlog directive):
 * voice-state pill + turn timer left. The STOP control lives in the
 * composer row next to Micrófono/Enviar (backlog: "STOP next to the
 * input controls"), not in this row.
 */
export function ComposerStatus() {
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const connected = useStore(appStore, (s) => s.connected);

  return (
    <div className="composer-status">
      <StatusPill connected={connected} />
      {TURN_ACTIVE_VOICE_STATES.includes(voiceState) ? <TurnTimer /> : null}
    </div>
  );
}

/**
 * Floating fallback (top-right) for layouts where the conversation
 * surface is absent: voice state + STOP stay reachable without a
 * composer row to embed into.
 */
export function FloatingStatus() {
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const connected = useStore(appStore, (s) => s.connected);

  return (
    <div className="floating-status">
      <StatusPill connected={connected} />
      {TURN_ACTIVE_VOICE_STATES.includes(voiceState) ? <TurnTimer /> : null}
      <StopButton />
    </div>
  );
}
