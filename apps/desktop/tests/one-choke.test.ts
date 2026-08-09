/**
 * R19/R22 (GATE-3.5) — ONE layout choke + legacy authority retired.
 *
 * R19: every layout source — agent (wire layout.apply), manual UI
 * (panel.open/close/set_primary/fullscreen, layout.restore, the local
 * fullscreen toggle), spoken override (handleSpokenText), reconnect
 * (state_snapshot adaptive_composition), migration (config default) —
 * enters the ONE applyAdaptiveSpec choke (adaptive.spec is the only
 * layout state that changes).
 *
 * R22: the legacy engine (state.spec / state.layout) is NON-AUTHORITATIVE
 * — no layout command writes it; invalid model output can never corrupt
 * layout state through it.
 */
import { describe, expect, it } from "vitest";

import type { ServerEvent } from "../src/contracts";
import { TEMPLATE_FIXTURES } from "../src/adaptive/fixtures";
import { registerProductSurfaces } from "../src/adaptive/surfaces";
import { createAppStore } from "../src/store";

registerProductSurfaces();

function ts(): string {
  return new Date().toISOString();
}

function layoutApply(store: ReturnType<typeof createAppStore>): void {
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
}

/** The legacy boot composition — the only legacy state a fresh store has. */
function legacyBootTemplate(store: ReturnType<typeof createAppStore>): string {
  return store.getState().layout.template;
}

describe("R19 — every layout source enters the ONE applyAdaptiveSpec choke", () => {
  it("agent source: wire layout.apply lands in adaptive.spec", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    expect(store.getState().adaptive.spec?.template).toBe("split");
  });

  it("manual source: panel.close becomes a constraint through the choke", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.close", panel_type: "conversation" },
      created_at: ts(),
    });
    expect(store.getState().adaptive.overrides.bySurface["conversation"]).toMatchObject(
      { remove: true },
    );
  });

  it("manual source: panel.set_primary routes through the choke", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.set_primary", panel_type: "browser" },
      created_at: ts(),
    });
    const spec = store.getState().adaptive.spec!;
    expect(
      spec.assignments.find((a) => a.surfaceId === "browser")?.role,
    ).toBe("primary");
    // the position constraint persists (later agent proposals cannot
    // undo the user's "make this the primary")
    expect(store.getState().adaptive.overrides.bySurface["browser"]).toMatchObject(
      { position: "left" },
    );
  });

  it("manual source: panel.fullscreen routes through the choke", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.fullscreen", panel_type: "conversation" },
      created_at: ts(),
    });
    expect(store.getState().adaptive.spec?.template).toBe("focus");
    expect(
      store.getState().adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).toEqual(["conversation"]);
  });

  it("manual source: the local fullscreen toggle routes through the choke", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    store.getState().toggleFullscreen("document_editor");
    expect(store.getState().adaptive.spec?.template).toBe("focus");
  });

  it("manual source: panel.open adds the surface through the choke", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    // split{document_editor, conversation} → opening tasks lands it in the
    // side… no: side is occupied — the template steps up to triple.
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.open", panel_type: "tasks", title: "Tareas" },
      created_at: ts(),
    });
    const spec = store.getState().adaptive.spec!;
    expect(spec.template).toBe("triple");
    expect(spec.assignments.map((a) => a.surfaceId)).toContain("tasks");
  });

  it("spoken source: handleSpokenText applies through the choke", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    expect(store.getState().handleSpokenText("pantalla completa")).toBe(true);
    expect(store.getState().adaptive.spec?.template).toBe("focus");
  });

  it("migration source: the config default enters the choke", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "config_update",
      config: {
        app: { name: "Ars-Vox", locale: "es" },
        server: { host: "127.0.0.1", port: 8765 },
        agent: { mock: true, model: { name: "m", max_steps: 8 } },
        tts: {},
        ui: { default_template: "reading", default_primary: "browser" },
      },
      created_at: ts(),
    });
    const { adaptive } = store.getState();
    // reading → sidecar; the config primary (browser) is registered
    expect(adaptive.spec?.template).toBe("sidecar");
    expect(adaptive.spec?.assignments[0].surfaceId).toBe("browser");
  });

  it("reconnect source: a snapshot adaptive_composition restores through the choke", () => {
    const store = createAppStore(() => {});
    const composition = {
      spec: TEMPLATE_FIXTURES.sidecar,
      overrides: {
        bySurface: {
          "placeholder.companion": {
            surfaceId: "placeholder.companion",
            remove: true,
          },
        },
      },
    };
    store.getState().applyEvent({
      type: "state_snapshot",
      sequence: 1,
      voice_state: "sleeping",
      config: {} as never,
      layout: { panels: [] },
      pending_confirmation: null,
      media: null,
      notifications: [],
      content_keys: [],
      history: [],
      adaptive_composition: composition,
      created_at: ts(),
    } as unknown as ServerEvent);
    const { adaptive } = store.getState();
    // the composition restored AND the snapshot's constraint set applied
    // through the choke (the closed companion stays out)
    expect(adaptive.spec?.template).toBe("sidecar");
    expect(
      adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).not.toContain("placeholder.companion");
    expect(adaptive.overrides.bySurface["placeholder.companion"]).toMatchObject({
      remove: true,
    });
  });

  it("reconnect source: a malformed snapshot composition is skipped, never thrown", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "state_snapshot",
      sequence: 1,
      voice_state: "sleeping",
      config: {} as never,
      layout: { panels: [] },
      pending_confirmation: null,
      media: null,
      notifications: [],
      content_keys: [],
      history: [],
      adaptive_composition: {
        spec: {
          template: "focus",
          assignments: [
            { surfaceId: "ghost.surface", role: "primary", slot: "main" },
          ],
        },
      },
      created_at: ts(),
    } as unknown as ServerEvent);
    expect(store.getState().adaptive.spec).toBeNull();
  });
});

describe("R22 — the legacy layout authority is retired (non-authoritative)", () => {
  it("wire layout.apply writes ONLY adaptive state, never legacy state", () => {
    const store = createAppStore(() => {});
    const boot = legacyBootTemplate(store);
    layoutApply(store);
    expect(store.getState().adaptive.spec?.template).toBe("split");
    // legacy state untouched (still the boot focus composition)
    expect(store.getState().layout.template).toBe(boot);
    expect(store.getState().spec.template).toBe(boot);
  });

  it("manual layout commands write ONLY adaptive state", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.close", panel_type: "document_editor" },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.fullscreen", panel_type: "conversation" },
      created_at: ts(),
    });
    store.getState().toggleFullscreen("conversation");
    expect(store.getState().layout.template).toBe("focus");
    expect(store.getState().spec.primaryPanel).toBe("conversation");
  });

  it("an invalid agent intent leaves BOTH layers untouched", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    const beforeSpec = store.getState().adaptive.spec;
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "hologram" as never,
        primary_panel: "document_editor",
        secondary_panel: null,
        preserve: true,
      },
      created_at: ts(),
    });
    expect(store.getState().adaptive.spec).toEqual(beforeSpec);
    expect(store.getState().adaptive.lastRejection?.code).toBe("invalid_template");
    expect(store.getState().layout.template).toBe("focus");
  });
});
