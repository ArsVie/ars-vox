import { useStore } from "zustand";

import { appStore } from "../store";
import { StopButton } from "./StopButton";

const VOICE_LABELS: Record<string, string> = {
  sleeping: "Inactivo",
  listening: "Escuchando",
  thinking: "Pensando",
  speaking: "Hablando",
  waiting_for_confirmation: "Esperando confirmación",
  stopping: "Deteniendo",
  error: "Error",
};

export function StatusBar() {
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
    <div className="status-bar" role="status">
      <span className="status-brand">
        ARS<em>·</em>VOX
      </span>
      <span className={`status-pill ${connected ? "on" : "off"}`} data-state={stateKey}>
        <span className={`status-dot ${connected ? "connected" : "disconnected"}`} />
        <span className="status-voice">{label}</span>
      </span>
      {activity ? <span className="status-activity">{activity}</span> : null}
      <span className="status-spacer" />
      <span className="status-conn">
        <span className={`conn-dot ${connected ? "on" : "off"}`} />
        {connected ? "agente conectado" : "agente sin conexión"}
      </span>
      <StopButton />
    </div>
  );
}
