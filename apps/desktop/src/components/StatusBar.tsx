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

  return (
    <div className="status-bar" role="status">
      <span className={`status-dot ${connected ? "connected" : "disconnected"}`} />
      <span className="status-voice">{VOICE_LABELS[voiceState] ?? voiceState}</span>
      {activity ? <span className="status-activity">{activity}</span> : null}
      <span className="status-spacer" />
      <span className="status-conn">{connected ? "agent connected" : "agent offline"}</span>
    </div>
  );
}
