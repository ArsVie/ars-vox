/**
 * Shared microphone controller — one MicCapture instance for the whole
 * app, so the composer MicButton and the empty-state mic hero stay in
 * sync. Phase/error live in a vanilla zustand store (node-testable).
 */

import { createStore } from "zustand/vanilla";

import { appStore } from "../store";
import { MicCapture, type MicPhase } from "./mic";

export interface MicHubState {
  phase: MicPhase;
  error: string | null;
}

export const micHubStore = createStore<MicHubState>(() => ({
  phase: "idle",
  error: null,
}));

let capture: MicCapture | null = null;

function getCapture(): MicCapture {
  if (!capture) {
    capture = new MicCapture({
      onPhase: (phase, detail) => {
        micHubStore.setState({
          phase,
          error: phase === "error" ? (detail ?? "mic error") : null,
        });
      },
      onTranscript: (text) => appStore.getState().sendText(text),
    });
  }
  return capture;
}

export const micHub = {
  get phase(): MicPhase {
    return micHubStore.getState().phase;
  },
  async start(): Promise<void> {
    micHubStore.setState({ error: null });
    try {
      await getCapture().start();
    } catch {
      // onPhase already reported the error
    }
  },
  stop(): void {
    getCapture().stop();
  },
  abort(): void {
    void getCapture().abort();
  },
  /** Start if idle, stop if recording (tap-to-talk toggle). */
  toggle(): void {
    const { phase } = micHubStore.getState();
    if (phase === "recording") getCapture().stop();
    else void micHub.start();
  },
};
