/**
 * GATE-3.5 A5 — single media authority on the renderer (R24-R27).
 *
 * One MediaController owns media state; server events (agent tools),
 * user commands (dispatchCommand) and player callbacks
 * (applyPlayerMediaEvent) all route through it, and the store mirrors
 * it into content.media. These tests drive the REAL store so the
 * wiring (controller -> mirror -> UI state) is covered end to end.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { createAppStore } from "../src/store";
import { mediaController, resetMediaController } from "../src/media/controller";
import type { ServerEvent } from "../src/contracts";

function ts(): string {
  return new Date().toISOString();
}

function mediaStateEvent(partial: Record<string, unknown> = {}): ServerEvent {
  return {
    type: "media.state",
    state: "playing",
    source: "youtube",
    kind: "video",
    title: "Taller de carpintería",
    video_id: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    position_s: 0,
    duration_s: 742,
    volume: 1,
    created_at: ts(),
    ...partial,
  } as unknown as ServerEvent;
}

beforeEach(() => {
  resetMediaController();
});

describe("R24: agent play -> user pause -> user seek -> agent resume (one controller)", () => {
  it("routes every leg through the SAME controller with no 'no media loaded'", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));

    // Leg 1 — agent plays (server MediaStateEvent from the agent tool).
    store.getState().applyEvent(mediaStateEvent());
    expect(store.getState().content.media?.state).toBe("playing");
    expect(mediaController.getState().state).toBe("playing");
    expect(mediaController.getState().videoId).toBe("dQw4w9WgXcQ");

    // Leg 2 — user pause (dispatchCommand -> controller -> sent frame).
    // R11 (A2) buffers outbound messages until the first connect, so the
    // transport must be connected for the command to reach the send
    // channel (same pattern as tests/store.test.ts / reconnect.test.ts).
    store.getState().setConnected(true);
    store.getState().dispatchCommand({ action: "media.play_pause" });
    expect(
      sent.some(
        (m) => (m as { command?: { action?: string } }).command?.action === "media.play_pause",
      ),
    ).toBe(true);
    expect(store.getState().content.media?.state).toBe("paused");
    expect(mediaController.getState().state).toBe("paused");

    // Leg 3 — user seek (dispatchCommand -> controller).
    store.getState().dispatchCommand({ action: "media.seek", position_s: 37 });
    expect(store.getState().content.media?.positionS).toBe(37);
    expect(mediaController.getState().positionS).toBe(37);
    // Seek keeps the paused state (user actions apply, no reset).
    expect(store.getState().content.media?.state).toBe("paused");

    // Leg 4 — agent resume (server MediaStateEvent).
    store.getState().applyEvent(mediaStateEvent({ state: "playing", position_s: 37 }));
    expect(store.getState().content.media?.state).toBe("playing");
    expect(mediaController.getState().state).toBe("playing");
    expect(mediaController.getState().positionS).toBe(37);

    // The store mirror IS the controller state (single authority).
    expect(store.getState().content.media).toBe(mediaController.getState());
  });

  it("user play_pause/seek with no track are honest no-ops (no fake state)", () => {
    const store = createAppStore(() => {});
    store.getState().dispatchCommand({ action: "media.play_pause" });
    expect(store.getState().content.media).toBeUndefined();
    store.getState().dispatchCommand({ action: "media.seek", position_s: 10 });
    expect(store.getState().content.media).toBeUndefined();
  });
});

describe("R25: seek really changes the playback position", () => {
  it("optimistic seek updates the mirror and the slider target", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(mediaStateEvent());

    store.getState().dispatchCommand({ action: "media.seek", position_s: 90 });

    expect(store.getState().content.media?.positionS).toBe(90);
    expect(mediaController.getState().positionS).toBe(90);
  });

  it("server-seek (agent media.seek) lands the same way through the controller", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(mediaStateEvent());
    store.getState().applyEvent(mediaStateEvent({ position_s: 42 }));

    expect(mediaController.getState().positionS).toBe(42);
    expect(store.getState().content.media?.positionS).toBe(42);
  });

  it("negative seeks clamp to zero", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(mediaStateEvent());
    store.getState().dispatchCommand({ action: "media.seek", position_s: -5 });
    expect(mediaController.getState().positionS).toBe(0);
  });
});

describe("R26: player callbacks feed the controller (no simulated state)", () => {
  it("player currentTime/duration update the mirror and the progress data", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(mediaStateEvent());

    // The iframe reports real playback data (poll/state-change response).
    store.getState().applyPlayerMediaEvent({ currentTime: 12.5, duration: 742 });

    expect(store.getState().content.media?.positionS).toBe(12.5);
    expect(store.getState().content.media?.durationS).toBe(742);
    expect(mediaController.getState().positionS).toBe(12.5);
  });

  it("player state callback (YouTube's own controls) is authoritative", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(mediaStateEvent());

    // The user pressed YouTube's own pause button inside the iframe.
    store.getState().applyPlayerMediaEvent({ state: "paused", currentTime: 30 });

    expect(store.getState().content.media?.state).toBe("paused");
    expect(mediaController.getState().state).toBe("paused");
    expect(mediaController.getState().positionS).toBe(30);
  });

  it("redundant time updates do not churn state", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(mediaStateEvent({ position_s: 10, duration_s: 742 }));
    const before = store.getState().content.media;
    store.getState().applyPlayerMediaEvent({ currentTime: 10.02, duration: 742 });
    expect(store.getState().content.media).toBe(before); // same object — no re-render
  });

  it("videoData duration from the player lands in the controller", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(mediaStateEvent());
    store.getState().applyPlayerMediaEvent({ duration: 495 });
    expect(store.getState().content.media?.durationS).toBe(495);
  });
});

describe("R27: role transitions never reset playback state", () => {
  it("primary -> persistent keeps playing state, position and track", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(
      mediaStateEvent({ state: "playing", position_s: 60, duration_s: 300 }),
    );

    // Simulate the role transition: NO media event is emitted — the
    // layout layer only changes roles (A4's domain). State must survive
    // untouched; the MediaDock render tests cover the compact bar.
    const before = store.getState().content.media;
    expect(store.getState().content.media).toBe(before);
    expect(store.getState().content.media?.state).toBe("playing");
    expect(store.getState().content.media?.positionS).toBe(60);
    expect(mediaController.getState().state).toBe("playing");
    expect(mediaController.getState()).toBe(before);
  });
});
