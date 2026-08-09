/**
 * Shared microphone controller — one MicCapture instance for the whole
 * app, so the composer MicButton and the empty-state mic hero stay in
 * sync. Phase/error live in a vanilla zustand store (node-testable).
 *
 * The singleton registers its abort hook with the app store (one-way
 * dependency: store -> micHub would be a cycle) so store.stop() can run
 * the LOCAL cancellation boundary (capture + in-flight STT) before the
 * stop message reaches the service.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import { appStore, registerCaptureAbort } from "../store";
import { MicCapture, type MicPhase } from "./mic";

export interface MicHubState {
  phase: MicPhase;
  error: string | null;
}

export interface MicHub {
  phase: MicPhase;
  store: StoreApi<MicHubState>;
  start: () => Promise<void>;
  stop: () => void;
  abort: () => void;
  /** Start if idle, stop if recording (tap-to-talk toggle). */
  toggle: () => void;
}

export function createMicHub(onTranscript: (text: string) => void): MicHub {
  const hubStore = createStore<MicHubState>(() => ({
    phase: "idle",
    error: null,
  }));
  let capture: MicCapture | null = null;

  const getCapture = (): MicCapture => {
    if (!capture) {
      capture = new MicCapture({
        onPhase: (phase, detail) => {
          hubStore.setState({
            phase,
            error: phase === "error" ? (detail ?? "mic error") : null,
          });
        },
        onTranscript,
      });
    }
    return capture;
  };

  return {
    store: hubStore,
    get phase(): MicPhase {
      return hubStore.getState().phase;
    },
    async start(): Promise<void> {
      hubStore.setState({ error: null });
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
    toggle(): void {
      const { phase } = hubStore.getState();
      if (phase === "recording") getCapture().stop();
      else void this.start();
    },
  };
}

export const micHub = createMicHub((text) => {
  const store = appStore.getState();
  // R21 (GATE-3.5): deterministic spoken overrides FIRST — a matched
  // layout phrase ("haz esto más grande", "quítalo", ...) becomes an
  // OverrideIntent through the one layout choke and is consumed here;
  // it never reaches the model as a vague suggestion. Everything else
  // follows the normal user_text path.
  if (!store.handleSpokenText(text)) store.sendText(text);
});
export const micHubStore = micHub.store;

// The app store's stop() aborts capture/STT locally before notifying the
// service — STOP stays authoritative even with the socket down.
registerCaptureAbort(() => micHub.abort());
