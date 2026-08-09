/**
 * Store coverage: the vertical slice event path (user text -> tool call ->
 * policy -> ui_command -> layout change -> agent response), confirmation
 * handling, error surfacing, and layout restoration.
 */

import { describe, expect, it } from "vitest";

import type { ServerEvent } from "../src/contracts";
import { registerProductSurfaces } from "../src/adaptive/surfaces";
import { createAppStore } from "../src/store";

// GATE-3.5: layout commands now route through the adaptive choke, which
// validates against the surface registry — register the real product
// surfaces (idempotent, same call App.tsx makes at startup).
registerProductSurfaces();

function ts(): string {
  return new Date().toISOString();
}

const listening = (): ServerEvent => ({
  type: "state_update",
  voice_state: "listening",
  activity: null,
  created_at: ts(),
});

describe("vertical slice: open a document", () => {
  it("user text -> ui_command -> split layout -> agent response", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));

    store.getState().sendText("Open a document.");
    expect(sent).toEqual([{ type: "user_text", text: "Open a document." }]);
    // no optimistic append: the server echo is the single source of truth
    expect(store.getState().messages).toHaveLength(0);

    // server turn, mirroring the mock scripted model
    store.getState().applyEvent({
      type: "state_update",
      voice_state: "thinking",
      activity: "Open a document.",
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "user_message",
      id: "u1",
      text: "Open a document.",
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "tool_call",
      run_id: "r1",
      tool: "ui.apply_layout",
      args: { template: "split", primary_panel: "document_editor" },
      status: "running",
      result: null,
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "tool_call",
      run_id: "r1",
      tool: "ui.apply_layout",
      args: { template: "split", primary_panel: "document_editor" },
      status: "done",
      result: "Disposición split aplicada.",
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "agent_message",
      text: "Listo. Apliqué la disposición dividida con el documento como panel principal.",
      delta: false,
      created_at: ts(),
    });
    store.getState().applyEvent(listening());

    const state = store.getState();
    expect(state.voiceState).toBe("listening");
    // GATE-3.5 (R22): the agent layout lands in the adaptive layer — the
    // single layout authority. The legacy engine (state.layout) is no
    // longer written by layout commands.
    expect(state.adaptive.spec?.template).toBe("split");
    const doc = state.adaptive.spec?.assignments.find(
      (a) => a.surfaceId === "document_editor",
    );
    const conv = state.adaptive.spec?.assignments.find(
      (a) => a.surfaceId === "conversation",
    );
    expect(doc).toBeDefined();
    expect(conv).toBeDefined();
    expect(doc!.role).toBe("primary");
    expect(doc!.slot).toBe("main");
    expect(conv!.role).toBe("companion");
    expect(conv!.slot).toBe("side");

    const texts = state.messages.map((m) => m.text);
    expect(texts.some((t) => t.includes("Open a document."))).toBe(true);
    expect(texts.some((t) => t.includes("documento"))).toBe(true);
  });
});

describe("agent message deltas", () => {
  it("appends delta text to the last assistant message", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "agent_message",
      text: "Hola, ",
      delta: true,
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "agent_message",
      text: "¿qué necesitas?",
      delta: true,
      created_at: ts(),
    });
    const messages = store.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Hola, ¿qué necesitas?");
  });
});

describe("confirmation flow", () => {
  it("shows a pending card and sends confirm/cancel over the transport", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().applyEvent({
      type: "confirmation_requested",
      pending_id: "p1",
      tool: "telegram.send_pending",
      title: "Enviar mensaje por Telegram",
      detail: "Se enviará a la persona aprobada:\nHola",
      expires_in_s: 120,
      created_at: ts(),
    });
    expect(store.getState().pending?.pendingId).toBe("p1");

    store.getState().confirm(true);
    expect(sent).toEqual([{ type: "confirm", pending_id: "p1" }]);
    expect(store.getState().pending).toBeNull();
  });

  it("resolves pending state on confirmation_resolved", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "confirmation_requested",
      pending_id: "p1",
      tool: "telegram.send_pending",
      title: "Enviar",
      detail: "Detalle",
      expires_in_s: 120,
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "confirmation_resolved",
      pending_id: "p1",
      status: "approved",
      message: "Mensaje enviado",
      created_at: ts(),
    });
    expect(store.getState().pending).toBeNull();
    expect(
      store.getState().messages.some((m) => m.text.includes("approved")),
    ).toBe(true);
  });
});

describe("error surfacing", () => {
  it("stores error events and clears on dismiss", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "error",
      message: "No pude conectar con el modelo",
      recoverable: true,
      created_at: ts(),
    });
    expect(store.getState().error?.message).toContain("modelo");
    store.getState().dismissError();
    expect(store.getState().error).toBeNull();
  });
});

describe("layout restoration", () => {
  it("layout.restore clears the user constraint set through the one choke", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });
    expect(store.getState().adaptive.spec?.template).toBe("split");

    // the user closes the primary — a persistent constraint
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.close", panel_type: "document_editor" },
      created_at: ts(),
    });
    expect(
      store.getState().adaptive.overrides.bySurface["document_editor"],
    ).toMatchObject({ remove: true });

    // layout.restore == the frozen restore intent: constraints cleared
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "layout.restore" },
      created_at: ts(),
    });
    const state = store.getState();
    expect(state.adaptive.overrides.bySurface).toEqual({});

    // the agent may propose the surface again — nothing blocks it now
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });
    const ids =
      store.getState().adaptive.spec?.assignments.map((a) => a.surfaceId) ?? [];
    expect(ids).toContain("document_editor");
    expect(ids).toContain("conversation");
  });
});

describe("tts speak queue", () => {
  it("enqueues tts.speak commands and drains via ttsDone", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "tts.speak", text: "Hola" },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "tts.speak", text: "mundo" },
      created_at: ts(),
    });
    expect(store.getState().speakTexts).toEqual(["Hola", "mundo"]);
    store.getState().ttsDone();
    expect(store.getState().speakTexts).toEqual(["mundo"]);
  });

  it("stop clears the speak queue before sending the stop message", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().enqueueTts("Hola");
    store.getState().enqueueTts("mundo");
    store.getState().stop();
    expect(store.getState().speakTexts).toEqual([]);
    expect(sent).toEqual([{ type: "stop" }]);
  });
});

describe("panel close", () => {
  it("closing the primary panel degrades deterministically (user close constraint)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "panel.open",
        panel_type: "document_editor",
        title: "Lista de la compra",
      },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });
    const before = store.getState().adaptive.spec;
    expect(
      before?.assignments.find((a) => a.surfaceId === "document_editor")?.role,
    ).toBe("primary");

    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.close", panel_type: "document_editor" },
      created_at: ts(),
    });
    const state = store.getState();
    // R19/R20: a user close is a PERSISTENT constraint through the one
    // choke — the surface leaves the composition and stays out.
    expect(state.adaptive.overrides.bySurface["document_editor"]).toMatchObject(
      { remove: true },
    );
    const ids = state.adaptive.spec?.assignments.map((a) => a.surfaceId) ?? [];
    expect(ids).not.toContain("document_editor");
    // the conversation anchor remains the composition's primary
    expect(
      state.adaptive.spec?.assignments.find((a) => a.surfaceId === "conversation")
        ?.role,
    ).toBe("primary");
  });
});

describe("local panel fullscreen toggle", () => {
  it("toggles a panel into and out of fullscreen without sending transport", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "panel.open",
        panel_type: "document_editor",
        title: "Contrato",
      },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });

    expect(store.getState().fullscreenPanel).toBeNull();
    // R19: the manual fullscreen source enters the ONE choke — the
    // composition becomes focus{target} and the legacy field mirrors it.
    store.getState().toggleFullscreen("document_editor");
    expect(store.getState().adaptive.spec?.template).toBe("focus");
    expect(
      store.getState().adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).toEqual(["document_editor"]);
    expect(store.getState().adaptive.preFullscreen?.template).toBe("split");
    expect(store.getState().fullscreenPanel).toBe("document_editor");
    // local UI action: nothing sent to the server
    expect(sent).toHaveLength(0);

    // toggle OFF restores the pre-fullscreen composition and clears the
    // constraint (the constraint model has no memory — preFullscreen is it)
    store.getState().toggleFullscreen("document_editor");
    const state = store.getState();
    expect(state.adaptive.spec?.template).toBe("split");
    expect(
      state.adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).toEqual(["document_editor", "conversation"]);
    expect(state.adaptive.overrides.bySurface).toEqual({});
    expect(state.fullscreenPanel).toBeNull();

    // a different panel's toggle while one is fullscreen switches target
    store.getState().toggleFullscreen("document_editor");
    store.getState().toggleFullscreen("conversation");
    expect(store.getState().adaptive.spec?.assignments).toEqual([
      { surfaceId: "conversation", role: "primary", slot: "main" },
    ]);
    expect(store.getState().fullscreenPanel).toBe("conversation");
  });

  it("keeps the legacy overlay behavior before the first composition", () => {
    const store = createAppStore(() => {});
    expect(store.getState().adaptive.spec).toBeNull();
    store.getState().toggleFullscreen("conversation");
    expect(store.getState().fullscreenPanel).toBe("conversation");
    store.getState().toggleFullscreen("conversation");
    expect(store.getState().fullscreenPanel).toBeNull();
    // no composition was created by the boot-path toggle
    expect(store.getState().adaptive.spec).toBeNull();
  });
});

describe("multi-zone layout via slots (A8)", () => {
  it("slots-bearing layout.apply maps to the adaptive composition (dock → shell-owned)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "reading",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        slots: { main: "document_editor", side: "conversation", dock: "media" },
        preserve: true,
      },
      created_at: ts(),
    });
    const { adaptive } = store.getState();
    // reading → sidecar (planner's frozen wire map); dock is dropped —
    // persistent surfaces are shell-owned (the media bar renders instead).
    expect(adaptive.spec?.template).toBe("sidecar");
    expect(adaptive.spec?.assignments).toEqual([
      { surfaceId: "document_editor", role: "primary", slot: "main" },
      { surfaceId: "conversation", role: "companion", slot: "side" },
    ]);
    expect(adaptive.lastRejection).toBeNull();
  });

  it("treats slots.main as the source of truth over primary_panel", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "reading",
        primary_panel: "conversation", // frozen invariant: slots wins
        secondary_panel: null,
        slots: { main: "document_editor", side: "conversation" },
        preserve: true,
      },
      created_at: ts(),
    });
    const { adaptive } = store.getState();
    const main = adaptive.spec?.assignments.find((a) => a.slot === "main");
    expect(main?.surfaceId).toBe("document_editor");
    const side = adaptive.spec?.assignments.find((a) => a.slot === "side");
    expect(side?.surfaceId).toBe("conversation");
  });

  it("legacy layout.apply without slots keeps working (mapped through the planner)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });
    const { adaptive } = store.getState();
    expect(adaptive.spec?.template).toBe("split");
    expect(
      adaptive.spec?.assignments.find((a) => a.surfaceId === "document_editor")
        ?.slot,
    ).toBe("main");
    expect(
      adaptive.spec?.assignments.find((a) => a.surfaceId === "conversation")
        ?.slot,
    ).toBe("side");
  });

  it("viewport changes never rewrite the adaptive composition (geometry is render-time)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "dashboard",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });
    // dashboard → triple (adaptive map); px-floor degrade is the geometry
    // engine's render-time concern (adaptive-geometry tests), not state.
    expect(store.getState().adaptive.spec?.template).toBe("triple");

    store.getState().setViewport({ width: 700, height: 800 });
    expect(store.getState().adaptive.spec?.template).toBe("triple");
  });

  it("closing a slot panel adds the user close constraint (surface already out)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "reading",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        slots: { main: "document_editor", side: "conversation", dock: "media" },
        preserve: true,
      },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.close", panel_type: "media" },
      created_at: ts(),
    });
    const { adaptive } = store.getState();
    // media never entered the adaptive composition (dock is shell-owned) —
    // the close still becomes a persistent constraint (R20 seam).
    expect(adaptive.overrides.bySurface["media"]).toMatchObject({ remove: true });
    expect(
      adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).not.toContain("media");
  });
});

describe("config-driven UI state (config_update)", () => {
  const configEvent = (overrides: Record<string, unknown>): ServerEvent => ({
    type: "config_update",
    config: {
      app: { name: "Ars-Vox", locale: "es" },
      server: { host: "127.0.0.1", port: 8765 },
      agent: { mock: true, model: { name: "deepseek-v4-flash", max_steps: 8 } },
      tts: { provider: "edge", auto_speak: false, es_voice: null, speed: 1.15, queue_max: 20 },
      ui: {
        templates: ["focus", "split", "reading", "dashboard"],
        reduced_motion: true,
        large_text: true,
        high_contrast: true,
        default_template: "split",
        default_primary: "news",
      },
      ...overrides,
    },
    created_at: ts(),
  });

  it("applies accessibility flags and TTS knobs from the config", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(configEvent({}));
    const state = store.getState();
    expect(state.reducedMotion).toBe(true);
    expect(state.largeText).toBe(true);
    expect(state.highContrast).toBe(true);
    expect(state.ttsSpeed).toBe(1.15);
    expect(state.ttsQueueMax).toBe(20);
  });

  it("applies the config default layout only before any layout command (via the one choke)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(configEvent({}));
    let state = store.getState();
    // R19 (migration source): the config default enters the ONE choke.
    // "split" maps through the planner's wire map; "news" is NOT a
    // registered surface → the fallback anchor (conversation) is used.
    expect(state.adaptive.spec?.template).toBe("split");
    expect(state.adaptive.spec?.assignments[0].surfaceId).toBe("conversation");

    // a server layout command takes over; a later reconnect config_update
    // must NOT clobber it back to the default
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "focus",
        primary_panel: "browser",
        secondary_panel: null,
        preserve: true,
      },
      created_at: ts(),
    });
    store.getState().applyEvent(configEvent({}));
    state = store.getState();
    expect(state.adaptive.spec?.template).toBe("focus");
    expect(state.adaptive.spec?.assignments[0].surfaceId).toBe("browser");
  });

  it("honors the config TTS queue cap in the speak path", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(configEvent({ tts: { speed: 1, queue_max: 2 } }));
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "tts.speak", text: "uno" },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "tts.speak", text: "dos" },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "tts.speak", text: "tres" },
      created_at: ts(),
    });
    const texts = store.getState().speakTexts;
    expect(texts).toEqual(["dos", "tres"]);
  });

  it("ignores overlay panels (confirmation/notification) in the registry", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.open", panel_type: "notification", title: "X" },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.set_primary", panel_type: "confirmation" },
      created_at: ts(),
    });
    const state = store.getState();
    expect(Object.keys(state.panelMeta)).toEqual([]);
    expect(state.spec.primaryPanel).toBe("conversation");
    expect(state.fullscreenPanel).toBeNull();
  });
});

describe("panel content events (content channel)", () => {
  it("youtube.search event fills the youtube panel content", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "youtube.search",
      query: "gatos",
      results: [
        {
          id: "v1",
          title: "Gatos jugando",
          channel: "Canal Mascotas",
          duration_s: 95,
          published: "2026-01-01",
          thumbnail_url: null,
        },
      ],
      created_at: ts(),
    });
    expect(store.getState().content.youtube).toEqual({
      query: "gatos",
      loading: false,
      results: [
        {
          id: "v1",
          title: "Gatos jugando",
          channel: "Canal Mascotas",
          duration_s: 95,
          published: "2026-01-01",
          thumbnail_url: null,
        },
      ],
    });
  });

  it("browser.navigate event fills the browser content (snake_case -> camelCase)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "browser.navigate",
      url: "https://example.com",
      title: "Example",
      can_go_back: true,
      can_go_forward: false,
      loading: false,
      created_at: ts(),
    });
    expect(store.getState().content.browser).toEqual({
      url: "https://example.com",
      title: "Example",
      canGoBack: true,
      canGoForward: false,
      loading: false,
    });
  });

  it("document.load event fills the document editor panel content", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "document.load",
      title: "Cuento",
      kind: "md",
      path: "/docs/cuento.md",
      content: "# Cuento\nHabía una vez...",
      chapters: [{ title: "Capítulo 1", content: "Había una vez..." }],
      created_at: ts(),
    });
    expect(store.getState().content.document_editor).toEqual({
      title: "Cuento",
      kind: "md",
      path: "/docs/cuento.md",
      url: null,
      content: "# Cuento\nHabía una vez...",
      chapters: [{ title: "Capítulo 1", content: "Había una vez..." }],
    });
  });

  it("tasks.update event fills the tasks panel content", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "tasks.update",
      todos: [
        { id: "t1", title: "Comprar pan", done: false, priority: "normal", due: null },
      ],
      reminders: [
        { id: "r1", title: "Reunión", cadence: "Cada día 9:00", next_fire: "2026-08-08T09:00:00Z" },
      ],
      created_at: ts(),
    });
    expect(store.getState().content.tasks).toEqual({
      todos: [
        { id: "t1", title: "Comprar pan", done: false, priority: "normal", due: null },
      ],
      reminders: [
        { id: "r1", title: "Reunión", cadence: "Cada día 9:00", next_fire: "2026-08-08T09:00:00Z" },
      ],
    });
  });

  it("media.state event fills the media content (snake_case -> camelCase)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "media.state",
      state: "playing",
      source: "youtube",
      kind: "video",
      title: "Gatos",
      video_id: "abc123",
      url: "https://www.youtube.com/embed/abc123",
      position_s: 12.5,
      duration_s: 300,
      volume: 0.8,
      created_at: ts(),
    });
    expect(store.getState().content.media).toEqual({
      state: "playing",
      source: "youtube",
      kind: "video",
      title: "Gatos",
      videoId: "abc123",
      url: "https://www.youtube.com/embed/abc123",
      positionS: 12.5,
      durationS: 300,
      volume: 0.8,
    });
  });

  it("dispatchCommand youtube.search marks loading and sends the ui_command", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().dispatchCommand({ action: "youtube.search", query: "gatos" });
    expect(store.getState().content.youtube).toEqual({
      query: "gatos",
      loading: true,
      results: [],
    });
    expect(sent).toEqual([
      expect.objectContaining({
        type: "ui_command",
        command: { action: "youtube.search", query: "gatos" },
        created_at: expect.any(String),
      }),
    ]);
  });

  it("dispatchCommand youtube.play optimistically plays the video and sends", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    // a prior media.state sets volume; play must preserve it
    store.getState().applyEvent({
      type: "media.state",
      state: "stopped",
      source: "local",
      kind: "audio",
      title: "",
      video_id: null,
      url: null,
      position_s: 0,
      duration_s: 0,
      volume: 0.5,
      created_at: ts(),
    });
    store.getState().dispatchCommand({
      action: "youtube.play",
      video_id: "abc123",
      title: "Gatos jugando",
    });
    expect(store.getState().content.media).toEqual({
      state: "playing",
      source: "youtube",
      kind: "video",
      title: "Gatos jugando",
      videoId: "abc123",
      url: "https://www.youtube.com/embed/abc123",
      positionS: 0,
      durationS: 0,
      volume: 0.5,
    });
    expect(sent).toEqual([
      expect.objectContaining({
        type: "ui_command",
        command: {
          action: "youtube.play",
          video_id: "abc123",
          title: "Gatos jugando",
        },
        created_at: expect.any(String),
      }),
    ]);
  });

  it("dispatchCommand tasks.toggle flips done on the matching todo and sends", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().applyEvent({
      type: "tasks.update",
      todos: [
        { id: "t1", title: "Comprar pan", done: false, priority: "normal", due: null },
        { id: "t2", title: "Regar plantas", done: true, priority: "low", due: null },
      ],
      reminders: [],
      created_at: ts(),
    });
    store.getState().dispatchCommand({ action: "tasks.toggle", task_id: "t1" });
    let todos = store.getState().content.tasks!.todos;
    expect(todos.find((t) => t.id === "t1")?.done).toBe(true);
    expect(todos.find((t) => t.id === "t2")?.done).toBe(true); // untouched
    store.getState().dispatchCommand({ action: "tasks.toggle", task_id: "t2" });
    todos = store.getState().content.tasks!.todos;
    expect(todos.find((t) => t.id === "t2")?.done).toBe(false);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(
      expect.objectContaining({
        type: "ui_command",
        command: { action: "tasks.toggle", task_id: "t1" },
      }),
    );
    expect(sent[1]).toEqual(
      expect.objectContaining({
        command: { action: "tasks.toggle", task_id: "t2" },
      }),
    );
  });

  it("dispatchCommand tasks.toggle without tasks content still forwards the command", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().dispatchCommand({ action: "tasks.toggle", task_id: "ghost" });
    expect(store.getState().content.tasks).toBeUndefined();
    expect(sent).toEqual([
      expect.objectContaining({
        type: "ui_command",
        command: { action: "tasks.toggle", task_id: "ghost" },
        created_at: expect.any(String),
      }),
    ]);
  });

  it("dispatchCommand media.play_pause toggles playing<->paused and sends", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().applyEvent({
      type: "media.state",
      state: "playing",
      source: "local",
      kind: "audio",
      title: "Canción",
      video_id: null,
      url: null,
      position_s: 10,
      duration_s: 180,
      volume: 1,
      created_at: ts(),
    });
    store.getState().dispatchCommand({ action: "media.play_pause" });
    expect(store.getState().content.media!.state).toBe("paused");
    store.getState().dispatchCommand({ action: "media.play_pause" });
    expect(store.getState().content.media!.state).toBe("playing");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(
      expect.objectContaining({
        type: "ui_command",
        command: { action: "media.play_pause" },
      }),
    );
    expect(sent[1]).toEqual(
      expect.objectContaining({
        command: { action: "media.play_pause" },
      }),
    );
  });

  it("dispatchCommand media.play_pause does not change a stopped player (still sends)", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().applyEvent({
      type: "media.state",
      state: "stopped",
      source: "local",
      kind: "audio",
      title: "",
      video_id: null,
      url: null,
      position_s: 0,
      duration_s: 0,
      volume: 1,
      created_at: ts(),
    });
    store.getState().dispatchCommand({ action: "media.play_pause" });
    expect(store.getState().content.media!.state).toBe("stopped");
    expect(sent).toEqual([
      expect.objectContaining({
        type: "ui_command",
        command: { action: "media.play_pause" },
        created_at: expect.any(String),
      }),
    ]);
  });

  it("dispatchCommand media.seek updates positionS and sends", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().applyEvent({
      type: "media.state",
      state: "playing",
      source: "local",
      kind: "audio",
      title: "Canción",
      video_id: null,
      url: null,
      position_s: 10,
      duration_s: 180,
      volume: 1,
      created_at: ts(),
    });
    store.getState().dispatchCommand({ action: "media.seek", position_s: 42 });
    expect(store.getState().content.media!.positionS).toBe(42);
    expect(store.getState().content.media!.durationS).toBe(180); // rest untouched
    expect(sent).toEqual([
      expect.objectContaining({
        type: "ui_command",
        command: { action: "media.seek", position_s: 42 },
        created_at: expect.any(String),
      }),
    ]);
  });
});
