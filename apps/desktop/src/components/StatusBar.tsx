import { useStore } from "zustand";

import type { AdaptiveTemplate } from "../adaptive/contracts";
import { ALL_TEMPLATES } from "../adaptive/fixtures";
import { appStore } from "../store";
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

/** Spanish demo labels for the five frozen templates (shell demo toggle). */
export const TEMPLATE_DEMO_LABELS: Record<AdaptiveTemplate, string> = {
  focus: "Enfoque",
  sidecar: "Lateral",
  stack: "Pila",
  split: "Dividido",
  triple: "Triple",
};

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
  const speaking = useStore(appStore, (s) => s.speakTexts.length > 0);

  // While audio is playing, show Speaking even if the server has already
  // returned to listening (the turn finished before playback ended).
  // data-state keeps the stable English key for CSS; the visible label is
  // the Spanish user-facing string.
  const stateKey = speaking ? "speaking" : voiceState;
  const label = VOICE_LABELS[stateKey] ?? stateKey;

  return (
    <div className="status-bar app-topbar" role="status">
      <span className="status-brand">
        ARS<em>·</em>VOX
      </span>
      <span className={`status-pill ${connected ? "on" : "off"}`} data-state={stateKey}>
        <span className={`status-dot ${connected ? "connected" : "disconnected"}`} />
        <span className="status-voice">{label}</span>
      </span>
      {activity ? <span className="status-activity">{activity}</span> : null}
      <StopButton />
      <span className="status-spacer" />
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
      <span className="status-conn">
        <span className={`conn-dot ${connected ? "on" : "off"}`} />
        {connected ? "agente conectado" : "agente sin conexión"}
      </span>
    </div>
  );
}
