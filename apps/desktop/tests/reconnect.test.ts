/**
 * H5 + GATE-3.5 A6 — reconnect recovery (desktop side):
 *  - state_snapshot application on WS connect: pending confirmation card,
 *    layout panels, media and voice state restored from the canonical
 *    server snapshot (tests/reconnect.test.ts per the H5 brief).
 *  - A6 authoritative semantics: media=null clears the stale player (R30),
 *    history=[]/notifications=[] clear stale chat/notification state (R31),
 *    adaptive composition reconstructs the workspace (R33), restored
 *    notifications are rendered state (R34), and bus sequence gaps force a
 *    reconnect resync (R29).
 *  - outbound buffering: messages sent while the socket is in a
 *    known-disconnected state are queued and flushed in order on the
 *    next connect (the transport's send() silently drops non-OPEN
 *    frames; the store-level buffer closes that loss window).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerEvent, StateSnapshotEvent } from "../src/contracts";
import { bindResync, createAppStore, type PanelMeta } from "../src/store";
import { WsClient } from "../src/ws/client";

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
    adaptive: { template: null, assignments: [], proportion: null, overrides: {} },
    created_at: ts(),
    ...overrides,
  };
}

/** Tag an event with a bus sequence number (the wire does this server-side). */
function withSeq<T extends object>(event: T, sequence: number): ServerEvent {
  return { ...event, sequence } as unknown as ServerEvent;
}

let resyncCalls = 0;
let lastResyncEvent: ServerEvent | null = null;

afterEach(() => {
  bindResync(() => {});
  resyncCalls = 0;
  lastResyncEvent = null;
});

describe("H5 state_snapshot application on connect", () => {
  it("restores pending card, media and voice but NOT panels (mic-hero default)", () => {
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
    // user directive 2026-08-08: snapshot panels are NOT restored — a
    // fresh load starts at the central-mic hero; the agent's own commands
    // re-populate the desk.
    expect(state.panelMeta.document_editor).toBeUndefined();
    expect(
      state.layout.panels.find((p) => p.panel === "document_editor"),
    ).toBeUndefined();
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

  it("keeps in-memory panels across a reconnect and ignores snapshot panels", () => {
    const store = createAppStore(() => {});
    // panel opened before the disconnect stays (same-tab reconnect keeps
    // its desk — like media, the snapshot cannot fabricate one)
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
    // the in-memory desk survives; the snapshot's panels are ignored
    expect(store.getState().panelMeta.browser).toBeDefined();
    expect(
      (store.getState().panelMeta as Record<string, PanelMeta | undefined>)
        .confirmation,
    ).toBeUndefined();
    expect(store.getState().panelMeta.document_editor).toBeUndefined();
  });

  it("R30: clears the stale media player when the snapshot carries media=null", () => {
    // Contract inversion (C2): media=null is AUTHORITATIVE ABSENCE — the
    // stale player must be cleared, never preserved.
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
    expect(store.getState().content.media?.videoId).toBeNull();
    expect(store.getState().content.media?.state).toBe("stopped");
    expect(store.getState().content.media?.title).toBe("");
  });

  it("restores conversation history from the snapshot (reload does not blank the chat)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(
      snapshot({
        history: [
          { id: 1, role: "user", text: "Abre un documento", created_at: ts() },
          { id: 2, role: "assistant", text: "Listo, abrí el documento.", created_at: ts() },
        ],
      }),
    );
    const msgs = store.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ id: "h1", role: "user", text: "Abre un documento" });
    expect(msgs[1]).toEqual({ id: "h2", role: "assistant", text: "Listo, abrí el documento." });
  });

  it("R31: wipes in-memory messages when the snapshot history is empty (authoritative clear)", () => {
    // Contract inversion: history=[] means NO conversation — stale chat
    // must never resurrect.
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "user_message",
      id: "u1",
      text: "hola",
      created_at: ts(),
    });
    expect(store.getState().messages).toHaveLength(1);
    store.getState().applyEvent(snapshot({ history: [] }));
    expect(store.getState().messages).toEqual([]);
  });

  it("R34: restores notifications from the snapshot as renderable state", () => {
    const store = createAppStore(() => {});
    const due = ts();
    store.getState().applyEvent(
      snapshot({
        notifications: [
          {
            notification_id: "n1",
            kind: "reminder",
            title: "Alarma",
            text: "Reunión en 10 minutos",
            due_at: due,
          },
        ],
      }),
    );
    expect(store.getState().notifications).toEqual([
      {
        notificationId: "n1",
        kind: "reminder",
        title: "Alarma",
        text: "Reunión en 10 minutos",
        dueAt: due,
      },
    ]);
  });

  it("R31/R34: an empty snapshot notification list clears stale notifications", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "notification",
      notification_id: "n9",
      kind: "alarm",
      title: "Alarma",
      text: "x",
      due_at: null,
      created_at: ts(),
    });
    expect(store.getState().notifications).toHaveLength(1);
    store.getState().applyEvent(snapshot({ notifications: [] }));
    expect(store.getState().notifications).toEqual([]);
  });

  it("R33: reconstructs the adaptive workspace from the snapshot composition", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(
      snapshot({
        adaptive: {
          template: "sidecar",
          assignments: [
            { surface_id: "placeholder.primary", role: "primary", slot: "main" },
            { surface_id: "placeholder.companion", role: "companion", slot: "side" },
          ],
          proportion: "wide",
          overrides: {},
        },
      }),
    );
    const adaptive = store.getState().adaptive;
    expect(adaptive.spec).not.toBeNull();
    expect(adaptive.spec?.template).toBe("sidecar");
    expect(adaptive.spec?.assignments).toEqual([
      { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
      { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
    ]);
    expect(adaptive.spec?.proportion).toBe("wide");
  });

  it("R33: restores snapshot user constraints (overrides) onto the adaptive state", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(
      snapshot({
        adaptive: {
          template: "focus",
          assignments: [
            { surface_id: "placeholder.primary", role: "primary", slot: "main" },
          ],
          proportion: null,
          overrides: { "placeholder.primary": { pin: true } },
        },
      }),
    );
    expect(store.getState().adaptive.overrides.bySurface).toEqual({
      "placeholder.primary": { pin: true },
    });
  });

  it("does not crash on an invalid adaptive composition in the snapshot", () => {
    const store = createAppStore(() => {});
    expect(() =>
      store.getState().applyEvent(
        snapshot({
          adaptive: {
            template: "focus",
            assignments: [{ surface_id: "ghost.surface", role: "primary", slot: "main" }],
            proportion: null,
            overrides: {},
          },
        }),
      ),
    ).not.toThrow();
    // the invalid composition never became layout state
    expect(store.getState().adaptive.spec).toBeNull();
  });
});

describe("GATE-3.5 A6: bus sequence authority (R29)", () => {
  it("forces a resync when an event skips a sequence number (gap)", () => {
    bindResync(() => {
      resyncCalls += 1;
    });
    const store = createAppStore(() => {});
    store.getState().applyEvent(snapshot({ sequence: 42 }));
    store.getState().applyEvent(
      withSeq({ type: "user_message", id: "u1", text: "hola", created_at: ts() }, 44),
    );
    expect(resyncCalls).toBe(1);
    // the post-gap event still applies (the resync snapshot will be
    // authoritative afterwards)
    expect(store.getState().messages).toHaveLength(1);
  });

  it("does not resync on a continuous sequence", () => {
    bindResync(() => {
      resyncCalls += 1;
    });
    const store = createAppStore(() => {});
    store.getState().applyEvent(snapshot({ sequence: 42 }));
    store.getState().applyEvent(
      withSeq({ type: "user_message", id: "u1", text: "uno", created_at: ts() }, 43),
    );
    store.getState().applyEvent(
      withSeq({ type: "user_message", id: "u2", text: "dos", created_at: ts() }, 44),
    );
    expect(resyncCalls).toBe(0);
    expect(store.getState().messages).toHaveLength(2);
  });

  it("drops stale pre-snapshot events (sequence <= snapshot baseline)", () => {
    bindResync(() => {
      resyncCalls += 1;
    });
    const store = createAppStore(() => {});
    store.getState().applyEvent(snapshot({ sequence: 42 }));
    // a bus leftover published BEFORE the snapshot was built must not
    // re-apply old state over the authoritative snapshot
    store.getState().applyEvent(
      withSeq({ type: "media.state", state: "paused", source: "youtube", kind: "video", title: "stale", video_id: "old", url: null, position_s: 1, duration_s: 9, volume: 1, created_at: ts() }, 41),
    );
    expect(resyncCalls).toBe(0);
    expect(store.getState().content.media?.videoId).toBeNull();
  });

  it("resets the baseline on a fresh snapshot (service restart) without a false gap", () => {
    bindResync(() => {
      resyncCalls += 1;
    });
    const store = createAppStore(() => {});
    store.getState().applyEvent(snapshot({ sequence: 100 }));
    store.getState().applyEvent(
      withSeq({ type: "user_message", id: "u1", text: "antes", created_at: ts() }, 101),
    );
    // the service restarted: the new snapshot's sequence is lower — it is
    // the sync point, not a gap
    store.getState().applyEvent(snapshot({ sequence: 5 }));
    store.getState().applyEvent(
      withSeq({ type: "user_message", id: "u2", text: "después", created_at: ts() }, 6),
    );
    expect(resyncCalls).toBe(0);
    expect(store.getState().messages.map((m) => m.text)).toEqual(["después"]);
  });

  it("resyncs at most once per gap episode (throttled until the next snapshot)", () => {
    bindResync(() => {
      resyncCalls += 1;
    });
    const store = createAppStore(() => {});
    store.getState().applyEvent(snapshot({ sequence: 42 }));
    store.getState().applyEvent(
      withSeq({ type: "user_message", id: "u1", text: "a", created_at: ts() }, 44),
    );
    store.getState().applyEvent(
      withSeq({ type: "user_message", id: "u2", text: "b", created_at: ts() }, 45),
    );
    expect(resyncCalls).toBe(1);
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

  it("R11: buffers sends BEFORE the first connection and flushes them on the first connect", () => {
    // R11 inverts the legacy startup behavior: early user_text spoken or
    // clicked during service startup must not be lost (no message-loss
    // window), so the buffer engages from the very first send.
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().sendText("hola");
    expect(sent).toEqual([]); // queued, not leaked

    store.getState().setConnected(true); // first connect
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

describe("GATE-3.5 A6: bridge-mode forceReconnect (R29 resync, packaged build)", () => {
  /**
   * Stub the Electron preload bridge exactly like tests/endpoints-auth.test.ts
   * (globalThis.window with window.arsvox so hasBridge() flips true). The
   * no-op timers keep the OLD buggy code from actually spinning a real
   * reconnect loop when this test runs against it.
   */
  function installBridge() {
    const unsubMessage = vi.fn();
    const unsubStatus = vi.fn();
    const bridge = {
      wsConnect: vi.fn(),
      wsClose: vi.fn(),
      wsSend: vi.fn(),
      onWsMessage: vi.fn(() => unsubMessage),
      onWsStatus: vi.fn(() => unsubStatus),
    };
    (globalThis as Record<string, unknown>).window = {
      arsvox: bridge,
      setTimeout: (() => 0) as unknown as typeof setTimeout,
      clearTimeout: (() => {}) as unknown as typeof clearTimeout,
    };
    return { bridge, unsubMessage, unsubStatus };
  }

  function removeBridgeStub(): void {
    delete (globalThis as Record<string, unknown>).window;
  }

  it("re-subscribes and re-issues wsConnect() WITHOUT constructing a WebSocket", () => {
    const { bridge, unsubMessage, unsubStatus } = installBridge();
    // The renderer WebSocket must be untouchable in bridge mode: client.ts
    // sets url="" there, and new WebSocket("") throws -> scheduleReconnect()
    // -> spin loop every 2s forever in the packaged Electron build.
    const wsCtor = vi.fn(() => {
      throw new Error("bridge-mode forceReconnect must never construct a WebSocket");
    });
    const realWs = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = wsCtor;
    try {
      const client = new WsClient({ onEvent: () => {} });

      client.connect();
      expect(bridge.onWsMessage).toHaveBeenCalledTimes(1);
      expect(bridge.onWsStatus).toHaveBeenCalledTimes(1);
      expect(bridge.wsConnect).toHaveBeenCalledTimes(1);

      client.forceReconnect();

      // R29 resync stays on the IPC path — no direct-mode socket.
      expect(wsCtor).not.toHaveBeenCalled();
      // stale subscriptions are torn down...
      expect(unsubMessage).toHaveBeenCalledTimes(1);
      expect(unsubStatus).toHaveBeenCalledTimes(1);
      // ...and re-established with a fresh wsConnect (the server replies
      // with a fresh state_snapshot on connect = the resync mechanism).
      expect(bridge.onWsMessage).toHaveBeenCalledTimes(2);
      expect(bridge.onWsStatus).toHaveBeenCalledTimes(2);
      expect(bridge.wsConnect).toHaveBeenCalledTimes(2);
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = realWs;
      removeBridgeStub();
    }
  });
});
