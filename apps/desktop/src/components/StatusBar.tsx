import type { ReactNode } from "react";

import { useStore } from "zustand";

import type { AdaptiveTemplate } from "../adaptive/contracts";
import { ALL_TEMPLATES } from "../adaptive/fixtures";
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

/** Spanish demo labels for the five frozen templates (shell demo toggle). */
export const TEMPLATE_DEMO_LABELS: Record<AdaptiveTemplate, string> = {
  focus: "Enfoque",
  sidecar: "Lateral",
  stack: "Pila",
  split: "Dividido",
  triple: "Triple",
};

/**
 * R43 — the template demo combobox is shell demo tooling (screenshot
 * workflow), NOT a production control. Module-level constant in foldable
 * form: Vite's define() replaces import.meta.env.DEV with `false` in
 * production builds, esbuild folds the constant, and the combobox is
 * dead-code-eliminated from the shipped bundle (verified: no
 * status-demo-select / "Plantilla" strings in dist assets).
 */
export const DEMO_TOGGLE_ENABLED = import.meta.env.DEV === true;

/**
 * Global application top bar (UI-101 shell chrome).
 *
 * Brand, assistant state, activity and the STOP control belong to Ars Vox,
 * not to any panel — this bar is a sibling of the activity stage and stays
 * visible in every template. The template select drives the shell's fixture
 * demo (placeholder children for the five frozen templates); it is shell
 * demo tooling, not agent layout selection.
 */
export function StatusBar({
  demoValue,
  onDemoChange,
}: {
  demoValue: AdaptiveTemplate | null;
  onDemoChange: (template: AdaptiveTemplate | null) => void;
}) {
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const connected = useStore(appStore, (s) => s.connected);
  const activity = useStore(appStore, (s) => s.activity);

  // GATE-3.5 (R08): the canonical voice state IS physical playback —
  // the service only reaches SPEAKING on a tts.started ack and only
  // leaves it (to LISTENING) on tts.finished, so no local override is
  // needed (and one would mask a regression where the server settles
  // while the speaker still talks). data-state keeps the stable English
  // key for CSS; the visible label is the Spanish user-facing string.
  const stateKey = voiceState;
  const label = VOICE_LABELS[stateKey] ?? stateKey;

  return (
    <div className="status-bar app-topbar">
      <span className="status-brand">
        ARS<em>·</em>VOX
      </span>
      {/* R43: the live region is the status pill ONLY — interactive controls
          (STOP, dev demo select) must never sit inside role="status". */}
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
      {activity ? <span className="status-activity">{activity}</span> : null}
      <StopButton />
      <span className="status-spacer" />
      {DEMO_TOGGLE_ENABLED ? (
        <label className="status-demo">
          <span className="status-demo-label">Plantilla</span>
          <select
            className="status-demo-select"
            value={demoValue ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              onDemoChange(
                (ALL_TEMPLATES as readonly string[]).includes(value)
                  ? (value as AdaptiveTemplate)
                  : null,
              );
            }}
            aria-label="Plantilla de demostración"
            title="Demo del shell: plantillas adaptativas con superficies de marcador"
          >
            <option value="">Automática</option>
            {ALL_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {TEMPLATE_DEMO_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
