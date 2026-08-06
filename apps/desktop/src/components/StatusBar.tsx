import { useStore } from "zustand";

import { appStore } from "../store";

const VOICE_LABELS: Record<string, string> = {
  sleeping: "Sleeping",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  waiting_for_confirmation: "Waiting for confirmation",
  stopping: "Stopping",
  error: "Error",
};

export function StatusBar() {
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const connected = useStore(appStore, (s) => s.connected);
  const activity = useStore(appStore, (s) => s.activity);
  const speaking = useStore(appStore, (s) => s.speakTexts.length > 0);

  // While audio is playing, show Speaking even if the server has already
  // returned to listening (the turn finished before playback ended).
  const label = speaking ? "Speaking" : VOICE_LABELS[voiceState] ?? voiceState;

  return (
    <div className="status-bar" role="status">
      <span className={`status-dot ${connected ? "connected" : "disconnected"}`} />
      <span className="status-voice">{label}</span>
      {activity ? <span className="status-activity">{activity}</span> : null}
      <span className="status-spacer" />
      <span className="status-conn">{connected ? "agent connected" : "agent offline"}</span>
    </div>
  );
}
