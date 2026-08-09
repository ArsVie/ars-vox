/**
 * UI-302 — user layout overrides: store wiring tests.
 *
 * Covers the applyAdaptiveSpec pipeline: the user-initiated signal
 * bypassing the UI-207 inertia damping wall, agent-initiated (planner)
 * changes staying damped, override resolution applied AFTER planner output
 * (explicit user constraints beat planner preferences), constraint
 * persistence across planner rounds, constraint removal ("restore layout"),
 * and invalid user arrangements degrading to the nearest valid composition
 * without throwing.
 */
import { describe, expect, it } from "vitest";

import type { LayoutSpec } from "../src/adaptive/contracts";
import { TEMPLATE_FIXTURES } from "../src/adaptive/fixtures";
import { isOverridesEmpty } from "../src/adaptive/overrides";
import { createAppStore } from "../src/store";

const sidecar = TEMPLATE_FIXTURES.sidecar;
const focus = TEMPLATE_FIXTURES.focus;
const triple = TEMPLATE_FIXTURES.triple;

/** TEMPLATE_FIXTURES.sidecar with a wider primary region. */
const sidecarWide: LayoutSpec = { ...sidecar, proportion: "wide" };

describe("applyAdaptiveSpec — user-initiated vs agent-initiated (UI-207 hook)", () => {
  it("agent-initiated template changes stay damped by inertia", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    store.getState().applyAdaptiveSpec(triple); // agent-only, no signal
    expect(store.getState().adaptive.spec).toEqual(sidecar);
  });

  it("a user-initiated change bypasses the damping wall and always applies", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    store.getState().applyAdaptiveSpec(triple, { userInitiated: true });
    expect(store.getState().adaptive.spec).toEqual(triple);
  });

  it("an override intent counts as user-commanded and bypasses the wall", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    store.getState().applyAdaptiveSpec(sidecar, {
      overrideIntent: { kind: "fullscreen", surfaceId: "placeholder.companion" },
    });
    expect(store.getState().adaptive.spec?.template).toBe("focus");
  });
});

describe("applyAdaptiveSpec — overrides apply AFTER planner output", () => {
  it("a user size constraint beats the planner's proportion preference", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    // "make the primary bigger" — the constraint persists in the set.
    store.getState().applyAdaptiveSpec(sidecar, {
      overrideIntent: { kind: "bigger", surfaceId: "placeholder.primary" },
    });
    expect(store.getState().adaptive.spec?.proportion).toBe("wide");
    // The planner re-proposes the balanced sidecar — the constraint wins.
    store.getState().applyAdaptiveSpec(sidecar);
    expect(store.getState().adaptive.spec?.proportion).toBe("wide");
  });

  it("a pinned surface survives a planner proposal that drops it", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    // "keep the companion here" (pin + stick).
    store.getState().applyAdaptiveSpec(sidecar, {
      overrideIntent: { kind: "keep", surfaceId: "placeholder.companion" },
    });
    expect(
      store.getState().adaptive.overrides.bySurface["placeholder.companion"],
    ).toMatchObject({ pin: true, stick: "side" });
    // The agent proposes focus, which drops the companion. The constraint
    // layer re-adds it — the applied spec is NOT the planner's focus.
    store.getState().applyAdaptiveSpec(focus);
    const { adaptive } = store.getState();
    expect(adaptive.spec?.template).not.toBe("focus");
    expect(
      adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).toContain("placeholder.companion");
    // The constraint survived the planner round.
    expect(
      store.getState().adaptive.overrides.bySurface["placeholder.companion"],
    ).toBeDefined();
  });

  it("the constrained spec (not the raw planner spec) becomes layout state", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    store.getState().applyAdaptiveSpec(sidecarWide);
    expect(store.getState().adaptive.spec?.proportion).toBe("wide");
  });
});

describe("applyAdaptiveSpec — constraint removal", () => {
  it("\"restore layout\" clears the constraint set and applies the unconstrained planner spec", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    store.getState().applyAdaptiveSpec(sidecar, {
      overrideIntent: { kind: "keep", surfaceId: "placeholder.companion" },
    });
    expect(isOverridesEmpty(store.getState().adaptive.overrides)).toBe(false);
    // Restore: user-commanded, so the unconstrained focus applies at once.
    store.getState().applyAdaptiveSpec(focus, {
      overrideIntent: { kind: "restore" },
    });
    expect(isOverridesEmpty(store.getState().adaptive.overrides)).toBe(true);
    expect(store.getState().adaptive.spec).toEqual(focus);
    // The planner's later template change is damped again (no constraints).
    store.getState().applyAdaptiveSpec(sidecar);
    expect(store.getState().adaptive.spec).toEqual(focus);
  });

  it("a later granular intent replaces a stale close constraint (brings the surface back)", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    store.getState().applyAdaptiveSpec(sidecar, {
      overrideIntent: { kind: "close", surfaceId: "placeholder.companion" },
    });
    expect(
      store.getState().adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).toEqual(["placeholder.primary"]);
    store.getState().applyAdaptiveSpec(sidecar, {
      overrideIntent: { kind: "keep", surfaceId: "placeholder.companion" },
    });
    expect(
      store.getState().adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).toEqual(["placeholder.primary", "placeholder.companion"]);
  });
});

describe("applyAdaptiveSpec — invalid user arrangements degrade to the nearest valid", () => {
  it("closing the primary promotes the remaining surface (never throws)", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    store.getState().applyAdaptiveSpec(sidecar, {
      overrideIntent: { kind: "close", surfaceId: "placeholder.primary" },
    });
    expect(store.getState().adaptive.spec?.assignments).toEqual([
      { surfaceId: "placeholder.companion", role: "primary", slot: "main" },
    ]);
  });

  it("closing the only surface degrades to the planner composition (no throw, nothing lost)", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(focus);
    store.getState().applyAdaptiveSpec(focus, {
      overrideIntent: { kind: "close", surfaceId: "placeholder.primary" },
    });
    expect(
      store.getState().adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).toEqual(["placeholder.primary"]);
  });
});

describe("GATE-3.5 — cross-feature: persistent override vs later agent composition", () => {
  it("a user-closed surface stays closed after an agent layout intent proposes it", () => {
    const store = createAppStore(() => {});
    const baseline: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    store.getState().applyAdaptiveSpec(baseline);
    // User closes the companion surface — the constraint persists.
    store.getState().applyAdaptiveSpec(baseline, {
      overrideIntent: { kind: "close", surfaceId: "placeholder.companion" },
    });
    expect(
      store.getState().adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).not.toContain("placeholder.companion");

    // Later the agent (planner path) proposes sidecar WITH the companion.
    store.getState().applyLayoutIntent({
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    });
    const ids =
      store.getState().adaptive.spec?.assignments.map((a) => a.surfaceId) ?? [];
    // The explicit user constraint outranks the agent composition.
    expect(ids).not.toContain("placeholder.companion");
    expect(ids).toContain("placeholder.primary");
  });

  it("a pinned (keep) surface survives an agent composition that drops it", () => {
    const store = createAppStore(() => {});
    const baseline: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
      ],
    };
    store.getState().applyAdaptiveSpec(baseline);
    // "déjalo ahí" — pin + stick the companion.
    store.getState().applyAdaptiveSpec(baseline, {
      overrideIntent: { kind: "keep", surfaceId: "placeholder.companion" },
    });
    // The agent proposes focus (drops the companion).
    store.getState().applyLayoutIntent({
      template: "focus",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
      ],
    });
    const { adaptive } = store.getState();
    // The explicit constraint wins: the agent's focus proposal is
    // neutralized — the pinned companion is still in the composition and
    // the constraint set survived the planner round.
    expect(adaptive.spec?.template).not.toBe("focus");
    expect(
      adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).toContain("placeholder.companion");
    expect(
      adaptive.overrides.bySurface["placeholder.companion"],
    ).toBeDefined();
  });

  it("a 'put it on the right' constraint beats a later agent composition", () => {
    const store = createAppStore(() => {});
    const baseline: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
      ],
    };
    store.getState().applyAdaptiveSpec(baseline);
    // "ponlo a la derecha" — the primary must live in the side region.
    store.getState().applyAdaptiveSpec(baseline, {
      overrideIntent: { kind: "right", surfaceId: "placeholder.primary" },
    });
    expect(
      store.getState().adaptive.spec?.assignments.find(
        (a) => a.surfaceId === "placeholder.primary",
      )?.slot,
    ).toBe("side");
    // The agent later proposes the primary back in main.
    store.getState().applyLayoutIntent(baseline);
    const spec = store.getState().adaptive.spec!;
    // The explicit user constraint still wins.
    expect(
      spec.assignments.find((a) => a.surfaceId === "placeholder.primary")?.slot,
    ).toBe("side");
    expect(
      spec.assignments.find((a) => a.surfaceId === "placeholder.companion")
        ?.role,
    ).toBe("primary");
  });

  it("a fullscreen constraint survives a later agent composition", () => {
    const store = createAppStore(() => {});
    const baseline: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
      ],
    };
    store.getState().applyAdaptiveSpec(baseline);
    // "pantalla completa" — the companion alone in focus.
    store.getState().applyAdaptiveSpec(baseline, {
      overrideIntent: { kind: "fullscreen", surfaceId: "placeholder.companion" },
    });
    expect(store.getState().adaptive.spec?.template).toBe("focus");
    // The agent later proposes the sidecar again.
    store.getState().applyLayoutIntent(baseline);
    const { adaptive } = store.getState();
    // The explicit user constraint still wins — the agent cannot break
    // the fullscreen.
    expect(adaptive.spec?.template).toBe("focus");
    expect(
      adaptive.spec?.assignments.map((a) => a.surfaceId),
    ).toEqual(["placeholder.companion"]);
  });

  it("a showBoth constraint survives a later agent composition", () => {
    const store = createAppStore(() => {});
    const baseline: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
      ],
    };
    store.getState().applyAdaptiveSpec(baseline);
    // "muéstrame los dos" — an equal two-primary split.
    store.getState().applyAdaptiveSpec(baseline, {
      overrideIntent: { kind: "showBoth", surfaceId: "placeholder.primary" },
    });
    expect(store.getState().adaptive.spec?.template).toBe("split");
    // The agent later proposes the sidecar (one primary).
    store.getState().applyLayoutIntent(baseline);
    const { adaptive } = store.getState();
    // The explicit user constraint still wins — still the equal split.
    expect(adaptive.spec?.template).toBe("split");
    const primaries = adaptive.spec?.assignments.filter(
      (a) => a.role === "primary",
    );
    expect(primaries?.length).toBe(2);
  });
});
