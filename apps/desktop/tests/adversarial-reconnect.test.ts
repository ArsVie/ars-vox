/**
 * GATE-3.5 A10 — adversarial renderer tests for the reconnect/snapshot
 * family (R29/R30/R34/R46/R47) plus the R25 no-fake-success guard and
 * the R17 wire-path rejection guard.
 *
 * EXPECTED-FAIL markers name the owner: A6 (Reconnect state) for the
 * snapshot family; A5 (Media authority) for R25's server side (the
 * renderer guard below passes today).
 */

import { describe, expect, it } from "vitest";

import type { ServerEvent, StateSnapshotEvent } from "../src/contracts";
import { createAppStore } from "../src/store";

function ts(): string {
  return new Date().toISOString();
}

function snapshot(overrides: Partial<StateSnapshotEvent> = {}): StateSnapshotEvent {
  return {
    type: "state_snapshot",
    sequence: 42,
    voice_state: "listening",
    config: {},
    layout: { panels: [] },
    pending_confirmation: null,
    media: null,
    notifications: [],
    content_keys: [],
    history: [],
    created_at: ts(),
    ...overrides,
  };
}

function mediaEvent(videoId: string, state = "playing") {
  return {
    type: "media.state",
    state,
    source: "youtube",
    kind: "video",
    title: "Título",
    video_id: videoId,
    url: `https://example.com/embed/${videoId}`,
    position_s: 10,
    duration_s: 100,
    volume: 0.8,
    created_at: ts(),
  } as unknown as ServerEvent;
}

describe("R46/R32 — no spurious LISTENING on fresh connect", () => {
  it("a fresh store starts sleeping (never listening)", () => {
    const store = createAppStore(() => {});
    expect(store.getState().voiceState).toBe("sleeping");
  });

  it("applies the snapshot voice state verbatim", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(snapshot({ voice_state: "sleeping" }));
    expect(store.getState().voiceState).toBe("sleeping");
  });
});

describe("R30 — media=null is authoritative absence (clears the player)", () => {
  it("clears a stale player when the snapshot carries media=null", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(mediaEvent("abc123"));
    expect(store.getState().content.media?.videoId).toBe("abc123");

    // A service restart with no media is authoritative: the stale player
    // must be cleared, not preserved.
    // EXPECTED-FAIL until A6 lands (C2) — today the store preserves the
    // player (store.ts only writes media when snap.media is truthy; the
    // old preservation behavior is asserted in reconnect.test.ts).
    store.getState().applyEvent(snapshot({ media: null }));
    expect(store.getState().content.media).toBeUndefined();
  });
});

describe("R34/R47 — snapshot notifications render", () => {
  it("renders the snapshot's active notifications", () => {
    const store = createAppStore(() => {});
    // EXPECTED-FAIL until A6 lands — the snapshot carries notifications
    // but the store ignores them (no render channel exists today; only
    // live `notification` events become system messages).
    store.getState().applyEvent(
      snapshot({
        notifications: [
          {
            notification_id: "1",
            kind: "reminder",
            title: "Recordatorio",
            text: "Toma la pastilla",
            due_at: null,
          },
        ],
      }),
    );
    const texts = store.getState().messages.map((m) => m.text).join(" ");
    expect(texts).toContain("Toma la pastilla");
  });
});

describe("R29 — client-side sequence gap detection", () => {
  it("requests a resync when an event sequence jumps the snapshot's", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().applyEvent(snapshot({ sequence: 100 }));

    // An event 3 past the snapshot's sequence means the client missed
    // bus events (QueueFull drop) — it must resync instead of silently
    // continuing with a gap.
    // EXPECTED-FAIL until A6 lands (STATUS gap 5: sequence numbers are
    // never checked client-side; the store ignores the sequence field).
    store.getState().applyEvent({
      ...mediaEvent("abc123"),
      sequence: 103,
    } as unknown as ServerEvent);

    const resync = sent.some(
      (m) =>
        (m as { type?: string }).type === "resync" ||
        (m as { type?: string }).type === "reconnect" ||
        (m as { type?: string }).type === "sync",
    );
    expect(resync).toBe(true);
  });
});

describe("R25 — no fake seek success in the renderer", () => {
  it("does not claim a position when nothing is loaded", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().dispatchCommand({
      action: "media.seek",
      position_s: 30,
    } as never);
    // no media -> no optimistic position state, the command is still sent
    expect(store.getState().content.media).toBeUndefined();
    expect(
      (sent[0] as { command?: { action?: string } }).command?.action,
    ).toBe("media.seek");
  });
});

describe("R17 — invalid specs never reach adaptive state (wire path)", () => {
  it("rejects a legacy layout.apply with a duplicated surface", () => {
    const store = createAppStore(() => {});
    // The same panel in main AND side is a duplicate assignment — the
    // planner must reject it deterministically (structured reason), and
    // the adaptive layer must stay untouched.
    store.getState().applyUiCommand({
      action: "layout.apply",
      template: "split",
      primary_panel: "browser",
      slots: { main: "browser", side: "browser" },
    } as never);

    expect(store.getState().adaptive.spec).toBeNull();
    expect(store.getState().adaptive.lastRejection).not.toBeNull();
    expect(store.getState().adaptive.lastRejection?.code).toBeDefined();
  });
});
