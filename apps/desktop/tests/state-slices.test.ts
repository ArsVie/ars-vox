/**
 * GATE-5 (W0-SLICE) — focused state-slice tests.
 *
 * Owned by W0-SLICE: the ONE content registration seam, the four product
 * surface slices, the conversation/notification/config/snapshot helpers,
 * and the store-level guarantees the slice decomposition must keep:
 *  - content events/commands still land through the store chokes (now
 *    routed via the registry);
 *  - snapshot history is NEVER auto-restored (fresh start = central-mic
 *    hero) and in-memory messages survive a same-tab reconnect.
 */

import { describe, expect, it } from "vitest";

import type {
  ClientCommand,
  ServerEvent,
  StateSnapshotEvent,
} from "../src/contracts";
import { registerProductSurfaces } from "../src/adaptive/surfaces";
import { createAppStore } from "../src/store";
import {
  browserSlice,
  contentRegistry,
  createContentRegistry,
  documentSlice,
  tasksSlice,
  youtubeSlice,
  type SurfaceSlice,
} from "../src/state";
import {
  appendAgentMessage,
  appendUserMessage,
  systemMessage,
} from "../src/state/conversation";
import {
  dismissNotification,
  NOTIFICATIONS_CAP,
  pushNotification,
  restoreNotifications,
} from "../src/state/notifications";
import { applyConfigToState } from "../src/state/config";
import { restoreAdaptiveFromSnapshot } from "../src/state/snapshotRestore";
import type { PanelContent } from "../src/state/types";

registerProductSurfaces();

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

/* ------------------------------------------------------------- registry */

describe("content registry (ONE registration seam)", () => {
  it("routes events and commands to the owning slice by type/action", () => {
    const registry = createContentRegistry();
    registry.register(youtubeSlice);
    registry.register(browserSlice);
    registry.register(documentSlice);
    registry.register(tasksSlice);

    const content: PanelContent = {};
    const afterEvent = registry.applyEvent(content, {
      type: "youtube.search",
      query: "guitarra",
      results: [],
      created_at: ts(),
    });
    expect(afterEvent.youtube).toEqual({
      query: "guitarra",
      loading: false,
      results: [],
    });
    expect(afterEvent.browser).toBeUndefined();

    const afterCommand = registry.applyCommand(afterEvent, {
      action: "tasks.toggle",
      task_id: "t1",
    });
    // no tasks bag yet -> pass-through, same reference
    expect(afterCommand).toBe(afterEvent);
  });

  it("routes media.search_results to the youtube slice (GATE-5 wire member)", () => {
    const registry = createContentRegistry();
    registry.register(youtubeSlice);
    const content: PanelContent = {};
    const after = registry.applyEvent(content, {
      type: "media.search_results",
      query: "guitarra",
      results: [],
      created_at: ts(),
    });
    expect(after.youtube).toEqual({
      query: "guitarra",
      loading: false,
      results: [],
    });
  });

  it("passes unowned events/commands through with the SAME content reference", () => {
    const registry = createContentRegistry();
    registry.register(youtubeSlice);
    const content: PanelContent = { youtube: { query: "q", loading: false, results: [] } };
    expect(
      registry.applyEvent(content, {
        type: "state_update",
        voice_state: "sleeping",
        activity: null,
        created_at: ts(),
      }),
    ).toBe(content);
    expect(
      registry.applyCommand(content, { action: "layout.restore" }),
    ).toBe(content);
  });

  it("throws on event/command ownership collisions (loud at registration)", () => {
    const registry = createContentRegistry();
    registry.register(youtubeSlice);
    const impostor: SurfaceSlice = {
      panelId: "browser",
      eventTypes: ["youtube.search"],
      commandActions: [],
      applyEvent: (bag) => bag,
      applyCommand: (bag) => bag,
    };
    expect(() => registry.register(impostor)).toThrow(/collision/);
  });

  it("re-registering the same slice instance is a no-op", () => {
    const registry = createContentRegistry();
    registry.register(youtubeSlice);
    expect(() => registry.register(youtubeSlice)).not.toThrow();
    expect(registry.registered()).toHaveLength(1);
  });

  it("the singleton is seeded with the five product slices", () => {
    const ids = contentRegistry.registered().map((s) => s.panelId);
    expect(ids).toEqual([
      "youtube",
      "browser",
      "document_editor",
      "tasks",
      // GATE-5 (routing-parity): memory slice added — memory.search_results
      // now has an honest consumer (content.memory) instead of being dead.
      "memory",
    ]);
  });
});

/* --------------------------------------------------------------- slices */

describe("surface slices", () => {
  it("youtube: server results land; optimistic command keeps prior results", () => {
    const bag = youtubeSlice.applyEvent(undefined, {
      type: "youtube.search",
      query: "clásica",
      results: [
        {
          id: "v1",
          title: "T",
          channel: "C",
          duration_s: 10,
          published: "2026",
          thumbnail_url: null,
        },
      ],
      created_at: ts(),
    });
    expect(bag?.loading).toBe(false);
    expect(bag?.results).toHaveLength(1);

    const optimistic = youtubeSlice.applyCommand(bag, {
      action: "youtube.search",
      query: "otra",
    });
    expect(optimistic?.loading).toBe(true);
    expect(optimistic?.query).toBe("otra");
    expect(optimistic?.results).toHaveLength(1); // preserved
    // unrelated events/commands are pure pass-throughs
    expect(
      youtubeSlice.applyEvent(bag, {
        type: "state_update",
        voice_state: "sleeping",
        activity: null,
        created_at: ts(),
      }),
    ).toBe(bag);
  });

  it("youtube: media.search_results (GATE-5 wire) lands the unified cards as-is", () => {
    const bag = youtubeSlice.applyEvent(undefined, {
      type: "media.search_results",
      query: "guitarra",
      results: [
        {
          id: "v1",
          title: "Clases de guitarra",
          source: "youtube",
          kind: "video",
          channel: "Marta",
          duration_s: 600,
          published: "hace 2 días",
          thumbnail_url: null,
          local_path: null,
        },
      ],
      created_at: ts(),
    });
    expect(bag).toEqual({
      query: "guitarra",
      loading: false,
      results: [
        {
          id: "v1",
          title: "Clases de guitarra",
          source: "youtube",
          kind: "video",
          channel: "Marta",
          duration_s: 600,
          published: "hace 2 días",
          thumbnail_url: null,
          local_path: null,
        },
      ],
    });
  });

  it("youtube: legacy youtube.search event converts to the unified card shape (expiring compat)", () => {
    const bag = youtubeSlice.applyEvent(undefined, {
      type: "youtube.search",
      query: "clásica",
      results: [
        {
          id: "v1",
          title: "T",
          channel: "C",
          duration_s: 10,
          published: "2026",
          thumbnail_url: null,
        },
      ],
      created_at: ts(),
    });
    expect(bag?.results[0]).toEqual({
      id: "v1",
      title: "T",
      source: "youtube",
      kind: "video",
      channel: "C",
      duration_s: 10,
      published: "2026",
      thumbnail_url: null,
      local_path: null,
    });
  });

  it("youtube: media.search_results with zero results is an honest empty bag", () => {
    const bag = youtubeSlice.applyEvent(undefined, {
      type: "media.search_results",
      query: "xyz no existe",
      results: [],
      created_at: ts(),
    });
    expect(bag).toEqual({ query: "xyz no existe", loading: false, results: [] });
  });

  it("browser: server navigate lands full state; nav commands only flip loading", () => {
    const bag = browserSlice.applyEvent(undefined, {
      type: "browser.navigate",
      url: "https://example.com",
      title: "Example",
      can_go_back: true,
      can_go_forward: false,
      loading: false,
      created_at: ts(),
    });
    expect(bag).toEqual({
      url: "https://example.com",
      title: "Example",
      canGoBack: true,
      canGoForward: false,
      loading: false,
    });
    const loading = browserSlice.applyCommand(bag, { action: "browser.back" });
    expect(loading?.loading).toBe(true);
    expect(loading?.canGoBack).toBe(true); // nav capability preserved
    // no bag yet: back/forward/refresh are no-ops
    expect(
      browserSlice.applyCommand(undefined, { action: "browser.refresh" }),
    ).toBeUndefined();
  });

  it("document: load lands the reader payload; save changes nothing", () => {
    const bag = documentSlice.applyEvent(undefined, {
      type: "document.load",
      title: "doc.txt",
      kind: "txt",
      path: "/tmp/doc.txt",
      url: null,
      content: "hola",
      chapters: [],
      created_at: ts(),
    });
    expect(bag).toEqual({
      title: "doc.txt",
      kind: "txt",
      path: "/tmp/doc.txt",
      url: null,
      content: "hola",
      chapters: [],
    });
    expect(
      documentSlice.applyCommand(bag, {
        action: "document.save",
        panel_type: "document_editor",
        content: "hola mundo",
      }),
    ).toBe(bag);
  });

  it("tasks: update lands the list; toggle flips only the matching todo", () => {
    const bag = tasksSlice.applyEvent(undefined, {
      type: "tasks.update",
      todos: [
        { id: "t1", title: "a", done: false, priority: "normal", due: null },
        { id: "t2", title: "b", done: true, priority: "high", due: null },
      ],
      reminders: [],
      created_at: ts(),
    });
    const toggled = tasksSlice.applyCommand(bag, { action: "tasks.toggle", task_id: "t1" });
    expect(toggled?.todos.map((t) => t.done)).toEqual([true, true]);
    // toggle without a bag is a no-op
    expect(tasksSlice.applyCommand(undefined, { action: "tasks.toggle", task_id: "x" })).toBeUndefined();
  });
});

/* ---------------------------------------------------- store-level gates */

describe("store-level slice delegation (GATE-5 W0-SLICE)", () => {
  it("content events still land through the store choke via the registry", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "youtube.search",
      query: "guitarra",
      results: [],
      created_at: ts(),
    });
    expect(store.getState().content.youtube).toEqual({
      query: "guitarra",
      loading: false,
      results: [],
    });
    store.getState().applyEvent({
      type: "tasks.update",
      todos: [],
      reminders: [],
      created_at: ts(),
    });
    expect(store.getState().content.tasks).toEqual({ todos: [], reminders: [] });
  });

  it("optimistic content commands still work through dispatchCommand", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().dispatchCommand({ action: "youtube.search", query: "q" });
    expect(store.getState().content.youtube?.loading).toBe(true);
    expect(sent).toEqual([
      {
        type: "ui_command",
        command: { action: "youtube.search", query: "q" },
        created_at: expect.any(String),
      },
    ]);
  });

  it("media.select_result is sent to the server (GATE-5 click path), no optimistic bag", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().dispatchCommand({
      action: "media.select_result",
      result_id: "dQw4w9WgXcQ",
      source: "youtube",
      kind: "video",
      title: "Taller de carpintería",
    });
    expect(sent).toEqual([
      {
        type: "ui_command",
        command: {
          action: "media.select_result",
          result_id: "dQw4w9WgXcQ",
          source: "youtube",
          kind: "video",
          title: "Taller de carpintería",
        },
        created_at: expect.any(String),
      },
    ]);
    // No optimistic content effect: the server's ONE media controller
    // owns the outcome.
    expect(store.getState().content.youtube).toBeUndefined();
  });

  it("GATE-5 directive: snapshot history is NEVER auto-restored", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(
      snapshot({
        history: [
          { id: 1, role: "user", text: "Abre un documento", created_at: ts() },
          { id: 2, role: "assistant", text: "Listo", created_at: ts() },
        ],
      }),
    );
    // Fresh start = central-mic hero: the chat stays empty.
    expect(store.getState().messages).toEqual([]);
  });

  it("in-memory messages survive a same-tab reconnect (snapshot never touches them)", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "user_message",
      id: "u1",
      text: "hola",
      created_at: ts(),
    });
    // Reconnect with history (and even with EMPTY history): the in-memory
    // chat is untouched — the R31 authoritative-clear is retired with the
    // auto-restore (GATE-5 directive, 2026-08-08).
    store.getState().applyEvent(snapshot({ history: [] }));
    expect(store.getState().messages).toEqual([
      { id: "u1", role: "user", text: "hola" },
    ]);
    store.getState().applyEvent(
      snapshot({
        history: [{ id: 9, role: "user", text: "otra sesión", created_at: ts() }],
      }),
    );
    expect(store.getState().messages).toEqual([
      { id: "u1", role: "user", text: "hola" },
    ]);
  });

  it("snapshot still restores notifications and clears media absence", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent(
      snapshot({
        notifications: [
          {
            notification_id: "n1",
            kind: "reminder",
            title: "Alarma",
            text: "Reunión",
            due_at: null,
          },
        ],
        media: {
          type: "media.state",
          state: "playing",
          source: "youtube",
          kind: "video",
          title: "T",
          video_id: "vid",
          url: null,
          position_s: 5,
          duration_s: 60,
          volume: 1,
          created_at: ts(),
        },
      }),
    );
    expect(store.getState().notifications).toEqual([
      {
        notificationId: "n1",
        kind: "reminder",
        title: "Alarma",
        text: "Reunión",
        dueAt: null,
      },
    ]);
    expect(store.getState().content.media?.videoId).toBe("vid");
  });
});

/* --------------------------------------------------------------- helpers */

describe("conversation helpers", () => {
  it("appends user echoes and merges agent deltas", () => {
    let messages = appendUserMessage([], {
      type: "user_message",
      id: "u1",
      text: "hola",
      created_at: ts(),
    });
    messages = appendAgentMessage(messages, {
      type: "agent_message",
      text: "Hola",
      delta: false,
      created_at: ts(),
    });
    messages = appendAgentMessage(messages, {
      type: "agent_message",
      text: ", ¿qué tal?",
      delta: true,
      created_at: ts(),
    });
    expect(messages.map((m) => m.text)).toEqual(["hola", "Hola, ¿qué tal?"]);
    expect(messages).toHaveLength(2);
    expect(systemMessage("n", "T: X").role).toBe("system");
  });
});

describe("notification helpers", () => {
  it("dedupes by id and caps the list", () => {
    let list: ReturnType<typeof pushNotification> = [];
    for (let i = 0; i < NOTIFICATIONS_CAP + 3; i += 1) {
      list = pushNotification(list, {
        notificationId: `n${i}`,
        kind: "reminder",
        title: "T",
        text: `X${i}`,
        dueAt: null,
      });
    }
    expect(list).toHaveLength(NOTIFICATIONS_CAP);
    expect(list[0].notificationId).toBe("n3");
    list = pushNotification(list, {
      notificationId: "n5",
      kind: "reminder",
      title: "T",
      text: "updated",
      dueAt: null,
    });
    expect(list.filter((n) => n.notificationId === "n5")).toHaveLength(1);
    expect(list.find((n) => n.notificationId === "n5")?.text).toBe("updated");
    expect(dismissNotification(list, "n5").some((n) => n.notificationId === "n5")).toBe(false);
  });

  it("restores the snapshot list (empty = authoritative clear)", () => {
    const snap = snapshot({
      notifications: [
        { notification_id: "a", kind: "k", title: "T", text: "X", due_at: null },
      ],
    });
    expect(restoreNotifications(snap)).toEqual([
      { notificationId: "a", kind: "k", title: "T", text: "X", dueAt: null },
    ]);
    expect(restoreNotifications(snapshot({ notifications: [] }))).toEqual([]);
  });
});

describe("config application helper", () => {
  it("maps ui/tts knobs and applies the default layout through the callback", () => {
    let applied: { template: string; primary: string } | null = null;
    const patch = applyConfigToState(
      {
        ui: {
          reduced_motion: true,
          large_text: true,
          high_contrast: true,
          default_template: "focus",
          default_primary: "conversation",
        },
        tts: { speed: 1.5, queue_max: 4 },
      },
      {
        canApplyDefault: true,
        applyDefault: (template, primary) => {
          applied = { template, primary };
        },
      },
    );
    expect(patch).toMatchObject({
      reducedMotion: true,
      largeText: true,
      highContrast: true,
      ttsSpeed: 1.5,
      ttsQueueMax: 4,
    });
    expect(applied).toEqual({ template: "focus", primary: "conversation" });
  });

  it("skips the default layout once a layout command applied", () => {
    let applied = false;
    applyConfigToState(
      { ui: { default_template: "focus" } },
      {
        canApplyDefault: false,
        applyDefault: () => {
          applied = true;
        },
      },
    );
    expect(applied).toBe(false);
  });
});

describe("snapshot adaptive restore helper", () => {
  it("reconstructs a valid composition through the choke callback", () => {
    const applied: unknown[] = [];
    const ok = restoreAdaptiveFromSnapshot(
      {
        template: "split",
        assignments: [
          { surface_id: "conversation", role: "primary", slot: "main" },
          { surface_id: "browser", role: "companion", slot: "side" },
        ],
        proportion: null,
        overrides: {},
      },
      (spec, options) => {
        applied.push({ spec, options });
      },
      () => {
        throw new Error("must not reject");
      },
    );
    expect(ok).toBe(true);
    expect(applied).toHaveLength(1);
  });

  it("returns false for empty/invalid compositions without calling the choke", () => {
    let calls = 0;
    const ok = restoreAdaptiveFromSnapshot(
      { template: null, assignments: [], proportion: null, overrides: {} },
      () => {
        calls += 1;
      },
      () => {},
    );
    expect(ok).toBe(false);
    expect(calls).toBe(0);
  });
});

/* ------------------------------------------------------------ wire types */

describe("store re-export compatibility (import sites unchanged)", () => {
  it("client commands used by the slices are real wire members", () => {
    const commands: ClientCommand[] = [
      { action: "youtube.search", query: "q" },
      { action: "browser.navigate", url: "https://x" },
      { action: "tasks.toggle", task_id: "t" },
      { action: "document.save", panel_type: "document_editor", content: "c" },
    ];
    expect(commands.map((c) => c.action)).toEqual([
      "youtube.search",
      "browser.navigate",
      "tasks.toggle",
      "document.save",
    ]);
  });

  it("server events used by the slices are real wire members", () => {
    const events: ServerEvent[] = [
      { type: "youtube.search", query: "q", results: [], created_at: ts() },
      {
        type: "browser.navigate",
        url: "https://x",
        title: "X",
        can_go_back: false,
        can_go_forward: false,
        loading: false,
        created_at: ts(),
      },
      {
        type: "document.load",
        title: "d",
        kind: "txt",
        path: "p",
        content: "c",
        chapters: [],
        created_at: ts(),
      },
      { type: "tasks.update", todos: [], reminders: [], created_at: ts() },
    ];
    expect(events).toHaveLength(4);
  });
});
