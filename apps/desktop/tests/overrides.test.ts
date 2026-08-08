/**
 * UI-302 — user layout overrides: pure constraint-model tests.
 *
 * Covers the intent → constraint mapping (all eight frozen intents), the
 * constraint-set operations (merge / remove / restore), the application
 * pipeline (pin / stick / position / size / fullscreen / showBoth / close),
 * and the deterministic degrade-to-nearest-valid logic (invalid
 * arrangements never leave this module, and identical inputs always
 * produce identical outputs).
 */
import { describe, expect, it } from "vitest";

import type { LayoutSpec, SurfaceRole } from "../src/adaptive/contracts";
import { PLACEHOLDER_REGISTERED_IDS } from "../src/adaptive/fixtures";
import {
  applyOverrides,
  degradeToNearestValid,
  EMPTY_OVERRIDES,
  intentToConstraint,
  isOverridesEmpty,
  mergeOverrideIntent,
  removeSurfaceOverrides,
  type OverrideIntent,
  type OverrideSet,
  type SurfaceConstraint,
} from "../src/adaptive/overrides";

const registered = PLACEHOLDER_REGISTERED_IDS;

const sidecar: LayoutSpec = {
  template: "sidecar",
  proportion: "balanced",
  assignments: [
    { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
    { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
  ],
};

const focus: LayoutSpec = {
  template: "focus",
  assignments: [
    { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
  ],
};

const assignmentsOf = (spec: LayoutSpec): string[] =>
  spec.assignments.map((a) => a.surfaceId);
const rolesOf = (spec: LayoutSpec): SurfaceRole[] =>
  spec.assignments.map((a) => a.role);
const slotsOf = (spec: LayoutSpec): string[] =>
  spec.assignments.map((a) => a.slot);

/* ---------------------------------------------------- intent mapping */

describe("intentToConstraint — frozen intent mapping", () => {
  const base = sidecar;

  it("maps every supported intent to its constraint", () => {
    const cases: Array<[OverrideIntent, SurfaceConstraint | null]> = [
      [
        { kind: "bigger", surfaceId: "placeholder.primary" },
        { surfaceId: "placeholder.primary", size: "bigger" },
      ],
      [
        { kind: "smaller", surfaceId: "placeholder.primary" },
        { surfaceId: "placeholder.primary", size: "smaller" },
      ],
      [
        { kind: "right", surfaceId: "placeholder.companion" },
        { surfaceId: "placeholder.companion", position: "right" },
      ],
      [
        { kind: "left", surfaceId: "placeholder.companion" },
        { surfaceId: "placeholder.companion", position: "left" },
      ],
      [
        { kind: "showBoth", surfaceId: "placeholder.companion" },
        { surfaceId: "placeholder.companion", showBoth: true },
      ],
      [
        { kind: "close", surfaceId: "placeholder.companion" },
        { surfaceId: "placeholder.companion", remove: true },
      ],
      [
        { kind: "fullscreen", surfaceId: "placeholder.companion" },
        { surfaceId: "placeholder.companion", fullscreen: true },
      ],
    ];
    for (const [intent, expected] of cases) {
      expect(intentToConstraint(intent, base)).toEqual(expected);
    }
  });

  it("\"keep it here\" pins the surface to its current slot", () => {
    expect(
      intentToConstraint(
        { kind: "keep", surfaceId: "placeholder.companion" },
        base,
      ),
    ).toEqual({
      surfaceId: "placeholder.companion",
      pin: true,
      stick: "side",
    });
  });

  it("\"keep it here\" pins without a slot when the surface is absent", () => {
    expect(
      intentToConstraint(
        { kind: "keep", surfaceId: "placeholder.support" },
        base,
      ),
    ).toEqual({ surfaceId: "placeholder.support", pin: true });
  });

  it("\"restore layout\" maps to null (the store clears the whole set)", () => {
    expect(intentToConstraint({ kind: "restore" }, base)).toBeNull();
  });
});

/* ------------------------------------------------- constraint set ops */

describe("constraint set operations", () => {
  it("mergeOverrideIntent adds a constraint and persists granular fields", () => {
    let set = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "keep", surfaceId: "placeholder.companion" },
      sidecar,
    );
    set = mergeOverrideIntent(
      set,
      { kind: "bigger", surfaceId: "placeholder.companion" },
      sidecar,
    );
    expect(set.bySurface["placeholder.companion"]).toEqual({
      surfaceId: "placeholder.companion",
      pin: true,
      stick: "side",
      size: "bigger",
    });
  });

  it("a composition-level intent replaces the surface's previous constraint", () => {
    let set = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "close", surfaceId: "placeholder.companion" },
      sidecar,
    );
    // "keep it here" after "close this" brings the surface back.
    set = mergeOverrideIntent(
      set,
      { kind: "keep", surfaceId: "placeholder.companion" },
      sidecar,
    );
    expect(set.bySurface["placeholder.companion"]).toEqual({
      surfaceId: "placeholder.companion",
      pin: true,
      stick: "side",
    });
    expect(set.bySurface["placeholder.companion"]?.remove).toBeUndefined();
  });

  it("a granular intent clears a stale composition-level constraint", () => {
    let set = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "fullscreen", surfaceId: "placeholder.companion" },
      sidecar,
    );
    set = mergeOverrideIntent(
      set,
      { kind: "bigger", surfaceId: "placeholder.companion" },
      sidecar,
    );
    expect(set.bySurface["placeholder.companion"]).toEqual({
      surfaceId: "placeholder.companion",
      size: "bigger",
    });
  });

  it("restore clears the whole set", () => {
    const set = mergeOverrideIntent(
      mergeOverrideIntent(
        EMPTY_OVERRIDES,
        { kind: "keep", surfaceId: "placeholder.companion" },
        sidecar,
      ),
      { kind: "restore" },
      sidecar,
    );
    expect(isOverridesEmpty(set)).toBe(true);
  });

  it("removeSurfaceOverrides drops only the named surface", () => {
    const set = mergeOverrideIntent(
      mergeOverrideIntent(
        EMPTY_OVERRIDES,
        { kind: "keep", surfaceId: "placeholder.primary" },
        sidecar,
      ),
      { kind: "close", surfaceId: "placeholder.companion" },
      sidecar,
    );
    const reduced = removeSurfaceOverrides(set, "placeholder.companion");
    expect(reduced.bySurface["placeholder.companion"]).toBeUndefined();
    expect(reduced.bySurface["placeholder.primary"]).toBeDefined();
    // The input set is never mutated.
    expect(set.bySurface["placeholder.companion"]).toBeDefined();
  });

  it("removeSurfaceOverrides on an unconstrained surface is a no-op", () => {
    expect(removeSurfaceOverrides(EMPTY_OVERRIDES, "placeholder.primary")).toBe(
      EMPTY_OVERRIDES,
    );
  });
});

/* ------------------------------------------------ application pipeline */

describe("applyOverrides — explicit user constraints beat planner output", () => {
  it("no constraints: returns the planner spec unchanged (same reference)", () => {
    expect(applyOverrides(sidecar, EMPTY_OVERRIDES, registered)).toBe(sidecar);
  });

  it("pin: a focus proposal cannot drop the pinned companion (degrades to sidecar)", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "keep", surfaceId: "placeholder.companion" },
      focus,
    );
    const result = applyOverrides(focus, overrides, registered);
    expect(result.template).toBe("sidecar");
    expect(assignmentsOf(result)).toEqual([
      "placeholder.primary",
      "placeholder.companion",
    ]);
    expect(rolesOf(result)).toEqual(["primary", "companion"]);
  });

  it("position right: the primary moves to the side, the other surface takes main", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "right", surfaceId: "placeholder.primary" },
      sidecar,
    );
    const result = applyOverrides(sidecar, overrides, registered);
    expect(result.template).toBe("sidecar");
    expect(assignmentsOf(result)).toEqual([
      "placeholder.primary",
      "placeholder.companion",
    ]);
    expect(slotsOf(result)).toEqual(["side", "main"]);
    expect(rolesOf(result)).toEqual(["companion", "primary"]);
  });

  it("position right on the only surface is a no-op (nothing to fill main)", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "right", surfaceId: "placeholder.primary" },
      focus,
    );
    const result = applyOverrides(focus, overrides, registered);
    expect(result).toEqual(focus);
  });

  it("position left: the target becomes the main primary, the old primary becomes companion", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "left", surfaceId: "placeholder.companion" },
      sidecar,
    );
    const result = applyOverrides(sidecar, overrides, registered);
    expect(assignmentsOf(result)).toEqual([
      "placeholder.companion",
      "placeholder.primary",
    ]);
    expect(rolesOf(result)).toEqual(["primary", "companion"]);
    expect(slotsOf(result)).toEqual(["main", "side"]);
  });

  it("size bigger on the main occupant widens the primary region", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "bigger", surfaceId: "placeholder.primary" },
      sidecar,
    );
    expect(applyOverrides(sidecar, overrides, registered).proportion).toBe(
      "wide",
    );
  });

  it("size bigger on the side occupant narrows the primary region", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "bigger", surfaceId: "placeholder.companion" },
      sidecar,
    );
    expect(applyOverrides(sidecar, overrides, registered).proportion).toBe(
      "narrow",
    );
  });

  it("size smaller on the main occupant narrows the primary region", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "smaller", surfaceId: "placeholder.primary" },
      sidecar,
    );
    expect(applyOverrides(sidecar, overrides, registered).proportion).toBe(
      "narrow",
    );
  });

  it("fullscreen: the target alone in the focus template", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "fullscreen", surfaceId: "placeholder.companion" },
      sidecar,
    );
    const result = applyOverrides(sidecar, overrides, registered);
    expect(result.template).toBe("focus");
    expect(result.assignments).toEqual([
      { surfaceId: "placeholder.companion", role: "primary", slot: "main" },
    ]);
  });

  it("show both: split with the target and the current primary as co-primaries", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "showBoth", surfaceId: "placeholder.companion" },
      sidecar,
    );
    const result = applyOverrides(sidecar, overrides, registered);
    expect(result.template).toBe("split");
    expect(assignmentsOf(result)).toEqual([
      "placeholder.primary",
      "placeholder.companion",
    ]);
    expect(rolesOf(result)).toEqual(["primary", "primary"]);
  });
});

describe("applyOverrides — invalid arrangements degrade to the nearest valid", () => {
  it("closing the primary promotes the remaining surface into main", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "close", surfaceId: "placeholder.primary" },
      sidecar,
    );
    const result = applyOverrides(sidecar, overrides, registered);
    expect(result.assignments).toEqual([
      { surfaceId: "placeholder.companion", role: "primary", slot: "main" },
    ]);
  });

  it("closing the only surface degrades to the unconstrained planner composition", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "close", surfaceId: "placeholder.primary" },
      focus,
    );
    // The removal cannot be satisfied by ANY template (an empty arrangement
    // is not valid) — the nearest valid composition is the planner's.
    expect(applyOverrides(focus, overrides, registered)).toBe(focus);
  });

  it("closing the companion keeps the primary composition valid", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "close", surfaceId: "placeholder.companion" },
      sidecar,
    );
    const result = applyOverrides(sidecar, overrides, registered);
    expect(result.assignments).toEqual([
      { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
    ]);
  });

  it("stick to a slot the template lacks degrades to a template that offers it", () => {
    // keep = pin + stick(current slot). Force the stick to rail directly:
    const stuck: OverrideSet = {
      bySurface: {
        "placeholder.support": {
          surfaceId: "placeholder.support",
          pin: true,
          stick: "rail",
        },
      },
    };
    const result = applyOverrides(sidecar, stuck, registered);
    expect(result.template).toBe("triple");
    expect(result.assignments.map((a) => a.slot).sort()).toEqual([
      "main",
      "rail",
      "side",
    ]);
  });

  it("two surfaces stuck to the same slot: the first keeps it, the second takes the nearest free slot", () => {
    const stuck: OverrideSet = {
      bySurface: {
        "placeholder.primary": {
          surfaceId: "placeholder.primary",
          stick: "main",
        },
        "placeholder.companion": {
          surfaceId: "placeholder.companion",
          stick: "main",
        },
      },
    };
    const result = applyOverrides(sidecar, stuck, registered);
    expect(slotsOf(result).sort()).toEqual(["main", "side"]);
    expect(rolesOf(result)).toEqual(["primary", "companion"]);
  });

  it("degradation is deterministic — identical inputs produce identical outputs", () => {
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "close", surfaceId: "placeholder.primary" },
      sidecar,
    );
    expect(applyOverrides(sidecar, overrides, registered)).toEqual(
      applyOverrides(sidecar, overrides, registered),
    );
  });

  it("an invalid planner spec still throws (constraints never mask planner garbage)", () => {
    const invalid: LayoutSpec = {
      template: "focus",
      assignments: [{ surfaceId: "ghost", role: "primary", slot: "main" }],
    };
    const overrides = mergeOverrideIntent(
      EMPTY_OVERRIDES,
      { kind: "keep", surfaceId: "placeholder.companion" },
      focus,
    );
    expect(() => applyOverrides(invalid, overrides, registered)).toThrow(
      /unregistered/,
    );
  });
});

describe("degradeToNearestValid — direct", () => {
  it("a valid candidate passes through unchanged", () => {
    expect(degradeToNearestValid(sidecar, registered, focus, [])).toEqual(
      sidecar,
    );
  });

  it("an empty candidate degrades to the fallback", () => {
    const empty: LayoutSpec = { template: "focus", assignments: [] };
    expect(degradeToNearestValid(empty, registered, focus, [])).toBe(focus);
  });

  it("an unhostable candidate degrades to the fallback", () => {
    // Four surfaces all pinned into a three-slot template: every template
    // fails (a pinned surface may never be dropped), so the unconstrained
    // planner composition is the deterministic fallback.
    const overfull: LayoutSpec = {
      template: "triple",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
        { surfaceId: "placeholder.support", role: "support", slot: "rail" },
        {
          surfaceId: "placeholder.persistent",
          role: "support",
          slot: "rail",
        },
      ],
    };
    const constraints: SurfaceConstraint[] = [
      { surfaceId: "placeholder.primary", pin: true },
      { surfaceId: "placeholder.companion", pin: true },
      { surfaceId: "placeholder.support", pin: true },
      { surfaceId: "placeholder.persistent", pin: true },
    ];
    const result = degradeToNearestValid(overfull, registered, sidecar, constraints);
    expect(result).toBe(sidecar);
  });
});
