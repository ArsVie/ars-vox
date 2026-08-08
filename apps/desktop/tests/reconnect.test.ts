/**
 * H5 — reconnect recovery (desktop side):
 *  - state_snapshot application on WS connect: pending confirmation card,
 *    layout panels, media and voice state restored from the canonical
 *    server snapshot (tests/reconnect.test.ts per the H5 brief).
 *  - outbound buffering: messages sent while the socket is in a
 *    known-disconnected state are queued and flushed in order on the
 *    next connect (the transport's send() silently drops non-OPEN
 *    frames; the store-level buffer closes that loss window).
 */

import { describe, expect, it } from "vitest";

import type { StateSnapshotEvent } from "../src/contracts";
import { createAppStore, type PanelMeta } from "../src/store";

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
    created_at: ts(),
    ...overrides,
  };
}

describe("H5 state_snapshot application on connect", () => {
  it("restores the pending confirmation card, layout panels, media and voice", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(
      snapshot({
        voice_state: "waiting_for_confirmation",
        pending_confirmation: {
          pending_id: "p1",
          tool: "telegram.send_pending",
          title: "Enviar",
          detail: "hola",
          expires_in_s: 30,
          expires_at: "2026-01-01T00:00:00+00:00",
        },
        layout: {
          panels: [
            { panel_type: "document_editor", title: "Doc", content_reference: "doc-1" },
          ],
        },
        media: {
          type: "media.state",
          state: "playing",
          source: "youtube",
          kind: "video",
          title: "Título",
          video_id: "abc123",
          url: "https://example.com/embed/abc123",
          position_s: 10,
          duration_s: 100,
          volume: 0.8,
          created_at: ts(),
        },
      }),
    );

    const state = store.getState();
    expect(state.pending).toEqual({
      pendingId: "p1",
      tool: "telegram.send_pending",
      title: "Enviar",
      detail: "hola",
      expiresInS: 30,
    });
    expect(state.voiceState).toBe("waiting_for_confirmation");
    expect(state.panelMeta.document_editor).toEqual({
      title: "Doc",
      contentReference: "doc-1",
    });
    // layout recomputed: the restored panel is visible in the engine
    const panel = state.layout.panels.find((p) => p.panel === "document_editor");
    expect(panel).toBeDefined();
    expect(panel!.visible).toBe(true);
    expect(state.content.media?.videoId).toBe("abc123");
    expect(state.content.media?.state).toBe("playing");
  });

  it("clears the pending card when the snapshot carries none", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "confirmation_requested",
      pending_id: "old",
      tool: "notes.add",
      title: "Nota",
      detail: "x",
      expires_in_s: 30,
      created_at: ts(),
    });
    expect(store.getState().pending).not.toBeNull();

    store.getState().applyEvent(snapshot({ voice_state: "listening", pending_confirmation: null }));
    expect(store.getState().pending).toBeNull();
  });

  it("replaces stale panels and ignores non-layout panel types", () => {
    const store = createAppStore(() => {});
    // stale panel from before the disconnect
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.open", panel_type: "browser" },
      created_at: ts(),
    });
    expect(store.getState().panelMeta.browser).toBeDefined();

    store.getState().applyEvent(
      snapshot({
        layout: {
          panels: [
            { panel_type: "confirmation" }, // overlay — not a layout panel
            { panel_type: "document_editor", content_reference: "doc-2" },
          ],
        },
      }),
    );
    expect(store.getState().panelMeta.browser).toBeUndefined();
    expect(
      (store.getState().panelMeta as Record<string, PanelMeta | undefined>)
        .confirmation,
    ).toBeUndefined();
    expect(store.getState().panelMeta.document_editor).toEqual({
      contentReference: "doc-2",
    });
  });

  it("leaves the media player untouched when the snapshot has no media", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "media.state",
      state: "paused",
      source: "youtube",
      kind: "video",
      title: "T",
      video_id: "vid",
      url: null,
      position_s: 5,
      duration_s: 60,
      volume: 1,
      created_at: ts(),
    });
    store.getState().applyEvent(snapshot({ media: null }));
    expect(store.getState().content.media?.videoId).toBe("vid");
    expect(store.getState().content.media?.state).toBe("paused");
  });
});

describe("H5 outbound buffering across reconnect", () => {
  it("buffers sends while disconnected and flushes them in order on reconnect", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));

    store.getState().setConnected(true);
    store.getState().setConnected(false); // socket dropped
    store.getState().sendText("uno");
    store.getState().stop();
    expect(sent).toEqual([]); // nothing leaked to the dead socket

    store.getState().setConnected(true); // reconnected
    expect(sent).toEqual([
      { type: "user_text", text: "uno" },
      { type: "stop" },
    ]);
  });

  it("passes sends straight through before the first connection", () => {
    // Legacy startup behavior: no known-disconnected state yet, so the
    // buffer does not engage (documented in store.ts).
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().sendText("hola");
    expect(sent).toEqual([{ type: "user_text", text: "hola" }]);
  });

  it("does not re-buffer flushed messages and keeps live ordering", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));

    store.getState().setConnected(true);
    store.getState().setConnected(false);
    store.getState().sendText("buffered");
    store.getState().setConnected(true); // flush
    store.getState().sendText("live"); // socket open again

    expect(sent).toEqual([
      { type: "user_text", text: "buffered" },
      { type: "user_text", text: "live" },
    ]);
  });

  it("buffers confirm/cancel while disconnected too (single choke point)", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));

    store.getState().setConnected(true);
    store.getState().setConnected(false);
    store.getState().applyEvent({
      type: "confirmation_requested",
      pending_id: "p9",
      tool: "notes.add",
      title: "Nota",
      detail: "x",
      expires_in_s: 30,
      created_at: ts(),
    });
    store.getState().confirm(true);
    expect(sent).toEqual([]);

    store.getState().setConnected(true);
    expect(sent).toEqual([{ type: "confirm", pending_id: "p9" }]);
  });
});
