/**
 * R19/R22 (GATE-3.5) — ONE layout choke + legacy authority retired.
 *
 * R19: every layout source — agent (wire layout.apply), manual UI
 * (panel.open/close/set_primary/fullscreen, layout.restore, the local
 * fullscreen toggle), spoken override (handleSpokenText), reconnect
 * (state_snapshot adaptive), migration (config default) —
 * enters the ONE applyAdaptiveSpec choke (adaptive.spec is the only
 * layout state that changes).
 *
 * R22: the legacy engine (state.spec / state.layout) is NON-AUTHORITATIVE
 * — no layout command writes it; invalid model output can never corrupt
 * layout state through it.
 */
import { describe, expect, it } from "vitest";

import type { ServerEvent } from "../src/contracts";
import { registerProductSurfaces } from "../src/adaptive/surfaces";
import { surfaceRegistry } from "../src/roles/registry";
import { computeAdaptiveGeometry } from "../src/layout/adaptiveEngine";
import { createAppStore } from "../src/store";

registerProductSurfaces();

function ts(): string {
  return new Date().toISOString();
}

function layoutApply(store: ReturnType<typeof createAppStore>): void {
  // B1 dependency spec (cordis-discipline): document_editor only composes
  // while an open document exists — the agent opens the document BEFORE
  // proposing a layout that hosts it. Load the document first so the wire
  // composition satisfies the placement requirement.
  store.getState().applyEvent({
    type: "document.load",
    title: "Lista de la compra.pdf",
    kind: "pdf",
    path: "C:\\docs\\lista.pdf",
    content: "tomates, pan, café",
    chapters: [],
    created_at: ts(),
  } as ServerEvent);
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

  it("manual source: panel.open on the boot focus steps to SIDECAR, not triple (R3: short-viewport regression)", () => {
    // Reviewer round 3 (2026-08-14): at 780×437 the boot default (focus,
    // conversation in main) + panel.open went straight to triple, whose
    // rail slot needs ≥160px (124.8px at 780px wide) — the geometry guard
    // rejected the whole composition and the panel silently never
    // appeared ("Listo, te puse la música" with no player on screen).
    // The step-up ladder must try sidecar before triple so the open
    // composes at short viewports.
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.open", panel_type: "media", title: "Música" },
      created_at: ts(),
    });
    const spec = store.getState().adaptive.spec!;
    expect(spec.template).toBe("sidecar");
    expect(spec.assignments.map((a) => a.surfaceId)).toEqual([
      "conversation",
      "media",
    ]);
    // And the sidecar composition must actually render at 780×437
    // (the reviewer's window): geometry must not throw.
    expect(() =>
      computeAdaptiveGeometry(
        spec,
        { width: 780, height: 437 },
        surfaceRegistry.registeredIds(),
      ),
    ).not.toThrow();
  });

  it("manual source: panel.open when the template is full DEMOTES a persistent-capable surface (R4 regression)", () => {
    // Reviewer round 4 (2026-08-14): media already in side + a second
    // panel.open used to step to triple, whose rail cannot fit short
    // viewports (124.8px < 160px at 780px) — the open was silently
    // dropped and the app claimed "listo, lo abrí" with nothing on
    // screen. Media is persistent-capable (the shell hosts the compact
    // dock), so the honest move is to demote media OUT of the
    // composition and give the newcomer its slot.
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.open", panel_type: "media", title: "Música" },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "panel.open",
        panel_type: "document_editor",
        title: "mis recetas",
      },
      created_at: ts(),
    });
    const spec = store.getState().adaptive.spec!;
    const ids = spec.assignments.map((a) => a.surfaceId);
    expect(ids).toContain("document_editor");
    expect(ids).not.toContain("media");
    expect(
      spec.assignments.find((a) => a.surfaceId === "document_editor")?.slot,
    ).toBe("side");
    // And the resulting sidecar must render at 780×437.
    expect(() =>
      computeAdaptiveGeometry(
        spec,
        { width: 780, height: 437 },
        surfaceRegistry.registeredIds(),
      ),
    ).not.toThrow();
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

  it("reconnect source: a snapshot adaptive composition restores through the choke", () => {
    const store = createAppStore(() => {});
    // A6 wire shape (contracts.ts AdaptiveSnapshot): template + flat
    // assignments (surface_id/role/slot) + proportion + overrides keyed by
    // surface id. The store wraps the wire overrides into the OverrideSet
    // { bySurface } shape and restores through the ONE choke (R33).
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
      adaptive: {
        template: "sidecar",
        assignments: [
          { surface_id: "conversation", role: "primary", slot: "main" },
          { surface_id: "browser", role: "companion", slot: "side" },
        ],
        proportion: "wide",
        // user constraint from the snapshot: conversation stays pinned
        overrides: { conversation: { pin: true } },
      },
      created_at: ts(),
    } as unknown as ServerEvent);
    const { adaptive } = store.getState();
    // the composition landed through the choke (adaptive.spec is the only
    // layout state the choke writes)
    expect(adaptive.spec?.template).toBe("sidecar");
    expect(adaptive.spec?.assignments).toEqual([
      { surfaceId: "conversation", role: "primary", slot: "main" },
      { surfaceId: "browser", role: "companion", slot: "side" },
    ]);
    expect(adaptive.spec?.proportion).toBe("wide");
    // the snapshot's user constraint set survived the restore — the choke
    // is the only writer of adaptive.overrides, so its presence proves the
    // restore did NOT bypass applyAdaptiveSpec
    expect(adaptive.overrides.bySurface["conversation"]).toMatchObject({
      pin: true,
    });
  });

  it("reconnect source: a composition that throws past the geometry gate is recorded, not swallowed", () => {
    const store = createAppStore(() => {});
    // The choke's geometry pre-check records its own rejection, but a throw
    // from the constraint/resolve stages (applyOverrides, resolveLayout)
    // lands in the restore's catch instead — the same path that
    // white-screened the packaged build. It must never crash the event path
    // and must never be silent either.
    //
    // "media" is registered for primary/companion/persistent — NOT support.
    // The rail slot is geometrically fine (triple offers it), so this clears
    // the geometry gate and dies in resolveLayout's fallback ladder.
    store.getState().applyEvent({
      type: "state_snapshot",
      sequence: 1,
      voice_state: "listening",
      config: {} as never,
      layout: { panels: [] },
      pending_confirmation: null,
      media: null,
      notifications: [],
      content_keys: [],
      history: [],
      adaptive: {
        template: "triple",
        assignments: [
          { surface_id: "conversation", role: "primary", slot: "main" },
          { surface_id: "browser", role: "companion", slot: "side" },
          { surface_id: "media", role: "support", slot: "rail" },
        ],
        proportion: null,
        overrides: {},
      },
      created_at: ts(),
    } as unknown as ServerEvent);

    // live desk kept (nothing half-applied)...
    expect(store.getState().adaptive.spec).toBeNull();
    // ...and the failure is observable, which the restore path claims
    expect(store.getState().adaptive.lastRejection).not.toBeNull();
    expect(store.getState().adaptive.lastRejection?.reason).toBeTruthy();
    // the rest of the snapshot still applied — the restore is not aborted
    expect(store.getState().voiceState).toBe("listening");
  });

  it("reconnect source: a malformed snapshot composition is skipped, never thrown", () => {
    const store = createAppStore(() => {});
    expect(() =>
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
        // well-shaped wire but the surface is not in the registry — the
        // choke rejects it and the restore is skipped (R33: no crash)
        adaptive: {
          template: "focus",
          assignments: [
            { surface_id: "ghost.surface", role: "primary", slot: "main" },
          ],
          proportion: null,
          overrides: {},
        },
        created_at: ts(),
      } as unknown as ServerEvent),
    ).not.toThrow();
    expect(store.getState().adaptive.spec).toBeNull();
  });
});

describe("R22 — the legacy layout authority is retired (non-authoritative)", () => {
  it("wire layout.apply writes ONLY adaptive state — the legacy mirror is gone", () => {
    const store = createAppStore(() => {});
    layoutApply(store);
    expect(store.getState().adaptive.spec?.template).toBe("split");
    // W2-STORE: state.layout / state.spec / state.panelMeta are DELETED —
    // adaptive is the only layout state, so there is no legacy mirror
    // left to drift from it.
    expect(store.getState()).not.toHaveProperty("layout");
    expect(store.getState()).not.toHaveProperty("spec");
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
    // every manual command landed in adaptive state — the fullscreen
    // toggle round-trips back to the pre-fullscreen split composition
    // (document_editor stays closed via its remove constraint). R19 pins
    // each command's exact outcome; this test pins the single-writer rule.
    const spec = store.getState().adaptive.spec!;
    expect(spec.template).toBe("split");
    expect(spec.assignments.map((a) => a.surfaceId)).toContain("conversation");
    expect(store.getState()).not.toHaveProperty("layout");
    expect(store.getState()).not.toHaveProperty("spec");
  });

  it("an invalid agent intent leaves the adaptive layer untouched", () => {
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
    expect(store.getState()).not.toHaveProperty("layout");
  });
});
