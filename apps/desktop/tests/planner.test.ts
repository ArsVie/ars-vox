/**
 * UI-301 — Agent layout planner: unit + store-integration tests.
 *
 * Covers the frozen acceptance criteria:
 *  - invalid model output can NEVER corrupt layout state (rejections, no
 *    throws, adaptive.spec untouched);
 *  - planner output always validates through the deterministic gates
 *    (validateLayoutSpec + computeAdaptiveGeometry);
 *  - same valid LayoutSpec → same geometry (determinism);
 *  - the planner respects the UI-207 spatial-inertia policy (agent-initiated
 *    changes stay damped; the store keeps the guard active).
 *  - wire reuse: ui_command/layout.apply (H1) flows through the planner.
 */
import { describe, expect, it } from "vitest";

import {
  LEGACY_TEMPLATE_MAP,
  planLayout,
  type LayoutIntent,
  type PlannerInput,
  type WireLayoutIntent,
} from "../src/adaptive/planner";
import { computeAdaptiveGeometry } from "../src/layout/adaptiveEngine";
import { createSurfaceRegistry } from "../src/roles/registry";
import { createAppStore } from "../src/store";
import { registerProductSurfaces } from "../src/adaptive/surfaces";

const registry = createSurfaceRegistry([
  { surfaceId: "browser", roles: ["primary", "companion", "support"] },
  { surfaceId: "conversation", roles: ["primary", "companion", "support"] },
  { surfaceId: "document_editor", roles: ["primary", "companion", "support"] },
  { surfaceId: "media", roles: ["primary", "companion", "persistent"] },
  { surfaceId: "tasks", roles: ["primary", "companion", "support"] },
]);

const VIEWPORT = { width: 1280, height: 800 };

const sidecarIntent: LayoutIntent = {
  template: "sidecar",
  assignments: [
    { surfaceId: "document_editor", role: "primary", slot: "main" },
    { surfaceId: "conversation", role: "companion", slot: "side" },
  ],
  proportion: "balanced",
};

const focusIntent: LayoutIntent = {
  template: "focus",
  assignments: [{ surfaceId: "document_editor", role: "primary", slot: "main" }],
};

/** Legacy wire payload as ui_command/layout.apply would carry it (H1). */
const wireSplit: WireLayoutIntent = {
  template: "split",
  primary_panel: "document_editor",
  secondary_panel: "conversation",
  preserve: true,
};

const wireReadingWithDock: WireLayoutIntent = {
  template: "reading",
  primary_panel: "document_editor",
  secondary_panel: "conversation",
  slots: { main: "document_editor", side: "conversation", dock: "media" },
  preserve: true,
};

describe("planLayout — intent → LayoutSpec mapping", () => {
  it("maps an adaptive-native intent to the identical spec", () => {
    const result = planLayout(sidecarIntent, registry, { viewport: VIEWPORT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec).toEqual({
      template: "sidecar",
      assignments: [
        { surfaceId: "document_editor", role: "primary", slot: "main" },
        { surfaceId: "conversation", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    });
    expect(result.notes).toEqual([]);
  });

  it("maps the legacy wire layout.apply vocabulary (slots win over primary/secondary)", () => {
    const result = planLayout(wireReadingWithDock, registry, {
      viewport: VIEWPORT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // reading → sidecar; dock has no adaptive slot → dropped with a note
    expect(result.spec.template).toBe("sidecar");
    expect(result.spec.assignments).toEqual([
      { surfaceId: "document_editor", role: "primary", slot: "main" },
      { surfaceId: "conversation", role: "companion", slot: "side" },
    ]);
    expect(result.notes.join(" ")).toContain("dock");
    expect(result.notes.join(" ")).toContain("media");
  });

  it("maps primary/secondary wire fields when slots are absent", () => {
    const result = planLayout(wireSplit, registry, { viewport: VIEWPORT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.template).toBe("split");
    expect(result.spec.assignments).toEqual([
      { surfaceId: "document_editor", role: "primary", slot: "main" },
      { surfaceId: "conversation", role: "companion", slot: "side" },
    ]);
  });

  it("maps every legacy wire template id deterministically", () => {
    expect(LEGACY_TEMPLATE_MAP).toEqual({
      focus: "focus",
      split: "split",
      reading: "sidecar",
      dashboard: "triple",
      reference: "sidecar",
      background_media: "triple",
    });
  });

  it("defaults proportion to null (geometry engine applies balanced)", () => {
    const result = planLayout(focusIntent, registry, { viewport: VIEWPORT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.proportion).toBeNull();
  });
});

describe("planLayout — rejection reasons (invalid output never corrupts state)", () => {
  it("rejects an unknown template id", () => {
    const result = planLayout(
      { template: "hologram" as never, assignments: [{ surfaceId: "browser", role: "primary", slot: "main" }] },
      registry,
      { viewport: VIEWPORT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("invalid_template");
    expect(result.rejection.reason).toContain("hologram");
  });

  it("rejects a persistent role assignment (shell-owned)", () => {
    const result = planLayout(
      {
        template: "sidecar",
        assignments: [
          { surfaceId: "document_editor", role: "primary", slot: "main" },
          { surfaceId: "media", role: "persistent", slot: "side" },
        ],
      },
      registry,
      { viewport: VIEWPORT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("invalid_role");
    expect(result.rejection.reason).toContain("shell-owned");
  });

  it("rejects an unknown role string", () => {
    const result = planLayout(
      {
        template: "focus",
        assignments: [
          { surfaceId: "browser", role: "hero" as LayoutIntent["assignments"][number]["role"], slot: "main" },
        ],
      },
      registry,
      { viewport: VIEWPORT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("invalid_role");
  });

  it("rejects a role the surface cannot render (no ladder fallback)", () => {
    const strict = createSurfaceRegistry([
      { surfaceId: "primary-only", roles: ["primary"] },
    ]);
    const result = planLayout(
      {
        template: "focus",
        assignments: [{ surfaceId: "primary-only", role: "support", slot: "main" }],
      },
      strict,
      { viewport: VIEWPORT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("invalid_role");
    expect(result.rejection.reason).toContain("primary-only");
  });

  it("rejects a slot the template does not offer", () => {
    const result = planLayout(
      {
        template: "focus",
        assignments: [
          { surfaceId: "document_editor", role: "primary", slot: "main" },
          { surfaceId: "conversation", role: "companion", slot: "side" },
        ],
      },
      registry,
      { viewport: VIEWPORT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("invalid_slot");
    expect(result.rejection.reason).toContain("side");
  });

  it("rejects an unregistered surface", () => {
    const result = planLayout(
      {
        template: "focus",
        assignments: [{ surfaceId: "ghost", role: "primary", slot: "main" }],
      },
      registry,
      { viewport: VIEWPORT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("unregistered_surface");
  });

  it("rejects a duplicated surface in one layout", () => {
    const result = planLayout(
      {
        template: "sidecar",
        assignments: [
          { surfaceId: "document_editor", role: "primary", slot: "main" },
          { surfaceId: "document_editor", role: "companion", slot: "side" },
        ],
      },
      registry,
      { viewport: VIEWPORT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("invalid_assignment");
  });

  it("rejects a missing primary (exactly one, except split's equal pair)", () => {
    const noPrimary = planLayout(
      {
        template: "sidecar",
        assignments: [
          { surfaceId: "conversation", role: "companion", slot: "main" },
          { surfaceId: "document_editor", role: "companion", slot: "side" },
        ],
      },
      registry,
      { viewport: VIEWPORT },
    );
    expect(noPrimary.ok).toBe(false);
    if (noPrimary.ok) return;
    expect(noPrimary.rejection.code).toBe("invalid_primary");

    const twoPrimaries = planLayout(
      {
        template: "sidecar",
        assignments: [
          { surfaceId: "document_editor", role: "primary", slot: "main" },
          { surfaceId: "conversation", role: "primary", slot: "side" },
        ],
      },
      registry,
      { viewport: VIEWPORT },
    );
    expect(twoPrimaries.ok).toBe(false);
    if (twoPrimaries.ok) return;
    expect(twoPrimaries.rejection.code).toBe("invalid_primary");
  });

  it("rejects an unknown proportion", () => {
    const result = planLayout(
      { ...focusIntent, proportion: "huge" as LayoutIntent["proportion"] },
      registry,
      { viewport: VIEWPORT },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("invalid_proportion");
  });

  it("rejects a template that cannot fit the stage px floors (geometry gate)", () => {
    const tiny = { width: 200, height: 200 };
    const result = planLayout(
      { template: "triple", assignments: [
        { surfaceId: "document_editor", role: "primary", slot: "main" },
        { surfaceId: "conversation", role: "companion", slot: "side" },
        { surfaceId: "tasks", role: "support", slot: "rail" },
      ] },
      registry,
      { viewport: tiny },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("geometry");
  });

  it("never throws on malformed input — returns a rejection instead", () => {
    const malformed = [
      null,
      "sidecar",
      {},
      { template: 42 },
      { template: "focus", assignments: "nope" },
      { template: "focus", assignments: [{}] },
      { template: "focus", assignments: [{ surfaceId: "browser" }] },
    ];
    for (const input of malformed) {
      const result = planLayout(input as unknown as PlannerInput, registry, {
        viewport: VIEWPORT,
      });
      expect(result.ok).toBe(false);
    }
  });
});

describe("planLayout — determinism", () => {
  it("identical inputs produce deep-equal results", () => {
    const a = planLayout(sidecarIntent, registry, { viewport: VIEWPORT });
    const b = planLayout(sidecarIntent, registry, { viewport: VIEWPORT });
    expect(a).toEqual(b);
  });

  it("same valid LayoutSpec always produces the same geometry", () => {
    const planned = planLayout(sidecarIntent, registry, { viewport: VIEWPORT });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const g1 = computeAdaptiveGeometry(planned.spec, VIEWPORT, registry.registeredIds());
    const g2 = computeAdaptiveGeometry(planned.spec, VIEWPORT, registry.registeredIds());
    expect(g1).toEqual(g2);
    // and the planned spec is itself the frozen fixture shape
    expect(planned.spec.template).toBe("sidecar");
  });
});

/* ------------------------------------------------------------- store */

const ts = (): string => new Date().toISOString();

describe("store applyLayoutIntent — UI-301 routing (inertia guard active)", () => {
  it("applies a valid agent intent through the planner", () => {
    registerProductSurfaces(); // product ids must be in the shared registry
    const store = createAppStore(() => {});
    const rejection = store.getState().applyLayoutIntent(sidecarIntent);
    expect(rejection).toBeNull();
    const { adaptive } = store.getState();
    expect(adaptive.spec).toEqual(sidecarIntent);
    expect(adaptive.lastRejection).toBeNull();
    expect(adaptive.assignments.map((a) => a.surfaceId)).toEqual([
      "document_editor",
      "conversation",
    ]);
  });

  it("rejects an invalid intent and records the reason — state never corrupts", () => {
    const store = createAppStore(() => {});
    store.getState().applyLayoutIntent(sidecarIntent);
    const before = store.getState().adaptive;

    const rejection = store.getState().applyLayoutIntent({
      template: "hologram" as LayoutIntent["template"],
      assignments: [
        { surfaceId: "document_editor", role: "primary", slot: "main" },
      ],
    });
    expect(rejection?.code).toBe("invalid_template");
    // layout state untouched — only the rejection trace changed
    expect(store.getState().adaptive.spec).toEqual(before.spec);
    expect(store.getState().adaptive.assignments).toEqual(before.assignments);
    expect(store.getState().adaptive.lastRejection?.code).toBe(
      "invalid_template",
    );
  });

  it("respects the spatial-inertia guard: identical re-send is kept (zero churn)", () => {
    registerProductSurfaces();
    const store = createAppStore(() => {});
    store.getState().applyLayoutIntent(sidecarIntent);
    const specAfterFirst = store.getState().adaptive.spec;
    expect(specAfterFirst).not.toBeNull();

    const rejection = store.getState().applyLayoutIntent(sidecarIntent);
    expect(rejection).toBeNull();
    // kept: same spec object identity (no churn), no rejection recorded
    expect(store.getState().adaptive.spec).toBe(specAfterFirst);
    expect(store.getState().adaptive.lastRejection).toBeNull();
  });

  it("respects the inertia guard: unjustified template change is damped", () => {
    registerProductSurfaces();
    const store = createAppStore(() => {});
    store.getState().applyLayoutIntent(sidecarIntent);
    const kept = store.getState().adaptive.spec;

    // same primary activity, template churn, no user signal → keep
    const tripleIntent: LayoutIntent = {
      template: "triple",
      assignments: [
        { surfaceId: "document_editor", role: "primary", slot: "main" },
        { surfaceId: "conversation", role: "companion", slot: "side" },
        { surfaceId: "tasks", role: "support", slot: "rail" },
      ],
      proportion: "wide",
    };
    store.getState().applyLayoutIntent(tripleIntent);
    expect(store.getState().adaptive.spec).toBe(kept);
  });

  it("applies a justified re-focus (primary activity change)", () => {
    registerProductSurfaces();
    const store = createAppStore(() => {});
    store.getState().applyLayoutIntent(sidecarIntent);

    const refocus: LayoutIntent = {
      template: "sidecar",
      assignments: [
        { surfaceId: "conversation", role: "primary", slot: "main" },
        { surfaceId: "document_editor", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    store.getState().applyLayoutIntent(refocus);
    const { adaptive } = store.getState();
    expect(adaptive.spec?.assignments[0]).toEqual({
      surfaceId: "conversation",
      role: "primary",
      slot: "main",
    });
    expect(adaptive.lastRejection).toBeNull();
  });
});

describe("store wire routing — ui_command/layout.apply flows through the planner", () => {
  it("routes the H1 wire command into the adaptive layer when valid", () => {
    registerProductSurfaces(); // idempotent; registers the real surface ids
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
    // reading → sidecar; dock dropped; adaptive layer now holds the spec
    expect(adaptive.spec?.template).toBe("sidecar");
    expect(adaptive.lastRejection).toBeNull();
    // the legacy engine path still worked (unchanged behavior)
    expect(store.getState().layout.template).toBe("reading");
  });

  it("rejects an invalid wire command without corrupting either layout layer", () => {
    registerProductSurfaces();
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
    const before = store.getState().adaptive;

    // unknown template on the wire → planner rejection, legacy degrade kept
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
    expect(store.getState().adaptive.spec).toEqual(before.spec);
    expect(store.getState().adaptive.lastRejection?.code).toBe(
      "invalid_template",
    );
  });

  it("wire commands with unregistered surfaces are rejected, not thrown", () => {
    // fresh module registry is placeholder-only in this test file's scope;
    // a wire command referencing an unknown id must be a clean rejection.
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "telegram_preview" as never,
        secondary_panel: null,
        preserve: true,
      },
      created_at: ts(),
    });
    expect(store.getState().adaptive.lastRejection?.code).toBe(
      "unregistered_surface",
    );
    expect(store.getState().adaptive.spec).toBeNull();
  });

  it("identical wire re-sends stay inertia-damped (adaptive spec untouched)", () => {
    registerProductSurfaces();
    const store = createAppStore(() => {});
    const command = {
      action: "layout.apply" as const,
      template: "split" as const,
      primary_panel: "document_editor" as const,
      secondary_panel: "conversation" as const,
      preserve: true,
    };
    store.getState().applyEvent({
      type: "ui_command",
      command,
      created_at: ts(),
    });
    const specAfterFirst = store.getState().adaptive.spec;
    expect(specAfterFirst).not.toBeNull();

    store.getState().applyEvent({
      type: "ui_command",
      command,
      created_at: ts(),
    });
    expect(store.getState().adaptive.spec).toBe(specAfterFirst);
    expect(store.getState().adaptive.lastRejection).toBeNull();
  });
});
