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
