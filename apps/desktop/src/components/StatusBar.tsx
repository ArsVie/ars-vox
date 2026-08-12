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
 * W0-DIRECTIVE (GATE-5) — the shell chrome is no longer a full-width
 * status/header bar. It is a minimal floating cluster:
 *
 *   [ ARS·VOX (home) ] [ voice-state pill ] [ STOP ]
 *
 * - The ARS·VOX wordmark is the persistent home affordance: it returns
 *   to the central mic-hero view through the frozen C1 human-initiated
 *   layout seam (layout.restore clears every persistent constraint —
 *   fullscreen/close/left; panel.open guarantees conversation is in the
 *   composition; panel.set_primary makes it the central primary). Each
 *   command is user-initiated at the choke; the service re-emits the
 *   UiCommand and the UI reconciles against the authoritative event.
 * - The voice-state pill is the MINIMAL state presentation: icon + label
 *   only (no activity line, no connection text), placed where the eyes
 *   land (floating at the top-center of the stage) instead of a header
 *   bar. role="status" stays on the pill and contains no controls.
 * - STOP remains the always-reachable safety control.
 */
export function StatusBar() {
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const connected = useStore(appStore, (s) => s.connected);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);

  // GATE-3.5 (R08): the canonical voice state IS physical playback —
  // the service only reaches SPEAKING on a tts.started ack and only
  // leaves it (to LISTENING) on tts.finished, so no local override is
  // needed (and one would mask a regression where the server settles
  // while the speaker still talks). data-state keeps the stable English
  // key for CSS; the visible label is the Spanish user-facing string.
  const stateKey = voiceState;
  const label = VOICE_LABELS[stateKey] ?? stateKey;

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
      {/* R43: the live region is the status pill ONLY — interactive controls
          (STOP, home) must never sit inside role="status". */}
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
      {TURN_ACTIVE_VOICE_STATES.includes(voiceState) ? <TurnTimer /> : null}
      <StopButton />
    </div>
  );
}
