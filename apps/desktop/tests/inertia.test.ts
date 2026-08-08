/**
 * UI-207 — spatial inertia policy: pure unit tests.
 *
 * Covers determinism (identical inputs -> identical verdicts), the policy
 * priority cost ordering (resize < add/remove < move < template change),
 * zero churn for repeated identical agent requests, stable placement across
 * a multi-step workflow, equivalent layouts preferring less movement,
 * template change allowed only with material user activity change, and
 * user-initiated changes always applying (policy never builds a wall).
 */
import { describe, expect, it } from "vitest";

import type { LayoutSpec } from "../src/adaptive/contracts";
import { TEMPLATE_FIXTURES } from "../src/adaptive/fixtures";
import {
  INERTIA_COSTS,
  isSatisfactory,
  scoreChange,
} from "../src/layout/inertia";

const sidecar = TEMPLATE_FIXTURES.sidecar;
const focus = TEMPLATE_FIXTURES.focus;
const stack = TEMPLATE_FIXTURES.stack;
const split = TEMPLATE_FIXTURES.split;
const triple = TEMPLATE_FIXTURES.triple;

/** sidecar with the primary/companion swapped (same template, both move). */
const sidecarSwapped: LayoutSpec = {
  template: "sidecar",
  proportion: "balanced",
  assignments: [
    { surfaceId: "placeholder.companion", role: "primary", slot: "main" },
    { surfaceId: "placeholder.primary", role: "companion", slot: "side" },
  ],
};

/** sidecar with the companion removed (supporting region removed). */
const sidecarMainOnly: LayoutSpec = {
  template: "sidecar",
  proportion: "balanced",
  assignments: [
    { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
  ],
};

/** sidecar with a wider primary (pure resize, policy step 2). */
const sidecarWide: LayoutSpec = {
  ...sidecar,
  proportion: "wide",
};

describe("scoreChange — policy priority cost ordering", () => {
  it("resize costs less than add/remove costs less than move costs less than template change", () => {
    const resize = scoreChange(sidecar, sidecarWide).cost; // ~1
    const addRemove = scoreChange(sidecar, sidecarMainOnly).cost; // 25
    const move = scoreChange(sidecar, sidecarSwapped).cost; // 2 surfaces x 50
    const templateChange = scoreChange(sidecar, triple).cost; // 100 + 25 + delta

    expect(resize).toBeGreaterThan(0);
    expect(resize).toBeLessThan(INERTIA_COSTS.addRemove);
    expect(addRemove).toBe(INERTIA_COSTS.addRemove);
    expect(addRemove).toBeLessThan(INERTIA_COSTS.move);
    expect(move).toBe(2 * INERTIA_COSTS.move);
    expect(move).toBeLessThan(templateChange);
    expect(templateChange).toBeGreaterThanOrEqual(INERTIA_COSTS.templateChange);
  });

  it("a template change always costs the most, even with zero movement", () => {
    // sidecar -> split with one primary is geometrically identical (same
    // proportion rects) yet still counts as a template change: the most
    // expensive step, so pointless template churn is damped.
    const splitOnePrimary: LayoutSpec = {
      template: "split",
      proportion: "balanced",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
      ],
    };
    expect(scoreChange(sidecar, splitOnePrimary).cost).toBe(
      INERTIA_COSTS.templateChange,
    );
    expect(scoreChange(sidecar, splitOnePrimary).cost).toBeGreaterThan(
      scoreChange(sidecar, sidecarWide).cost,
    );
  });
});

describe("scoreChange — determinism", () => {
  it("identical inputs produce identical verdicts", () => {
    const a = scoreChange(sidecar, triple);
    const b = scoreChange(sidecar, triple);
    expect(a).toEqual(b);
  });

  it("no current layout always applies (initial placement)", () => {
    const verdict = scoreChange(null, sidecar);
    expect(verdict.decision).toBe("apply");
    expect(verdict.cost).toBe(0);
  });
});

describe("scoreChange — zero churn for repeated agent requests", () => {
  it("an identical request after the first is kept (cost 0)", () => {
    const first = scoreChange(null, sidecar);
    expect(first.decision).toBe("apply");
    const repeat = scoreChange(sidecar, sidecar);
    expect(repeat.decision).toBe("keep");
    expect(repeat.cost).toBe(0);
  });

  it("repeated identical requests never churn, regardless of count", () => {
    let current: LayoutSpec | null = null;
    const decisions: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const verdict = scoreChange(current, sidecar);
      decisions.push(verdict.decision);
      if (verdict.decision !== "keep") current = sidecar;
    }
    expect(decisions).toEqual(["apply", "keep", "keep", "keep", "keep"]);
  });

  it("equivalent layouts prefer the one with less movement", () => {
    // Both candidates give the primary more room, but one is a cheap
    // resize (step 2) and the other a full template change (step 5).
    const cheap = scoreChange(sidecar, sidecarWide);
    const expensive = scoreChange(sidecar, split);
    expect(cheap.cost).toBeLessThan(expensive.cost);
    expect(cheap.decision).toBe("resize");
    expect(expensive.decision).toBe("keep");
  });
});

describe("scoreChange — stable placement across multi-step workflows", () => {
  it("a realistic agent workflow stays stable", () => {
    // 1. initial placement
    expect(scoreChange(null, focus).decision).toBe("apply");
    // 2. agent proposes adding a companion -> needs a TEMPLATE change
    //    (focus has no side slot; policy step 5 is last resort) -> damped
    const step2 = scoreChange(focus, sidecar);
    expect(step2.decision).toBe("keep");
    expect(step2.reason).toMatch(/agent response alone/);
    // 2b. with a material user activity change the same step is allowed
    expect(
      scoreChange(focus, sidecar, { materialActivityChange: true }).decision,
    ).toBe("apply");
    // 3. agent re-sends the same spec -> zero churn
    expect(scoreChange(sidecar, sidecar).decision).toBe("keep");
    // 4. agent tweaks proportion -> resize step, allowed
    expect(scoreChange(sidecar, sidecarWide).decision).toBe("resize");
    // 5. agent re-sends the same spec again -> zero churn
    expect(scoreChange(sidecarWide, sidecarWide).decision).toBe("keep");
    // 6. agent proposes another template change with no user signal -> damped
    const step6 = scoreChange(sidecarWide, triple);
    expect(step6.decision).toBe("keep");
    expect(step6.reason).toMatch(/agent response alone/);
    // 7. the user's activity genuinely changed -> template change allowed
    const step7 = scoreChange(sidecarWide, triple, {
      materialActivityChange: true,
    });
    expect(step7.decision).toBe("apply");
  });
});

describe("scoreChange — justified movement", () => {
  it("template change with material user activity change is allowed", () => {
    const verdict = scoreChange(sidecar, triple, {
      materialActivityChange: true,
    });
    expect(verdict.decision).toBe("apply");
    expect(verdict.cost).toBeGreaterThanOrEqual(INERTIA_COSTS.templateChange);
  });

  it("a primary re-focus (agent legitimately changing the main activity) applies", () => {
    const verdict = scoreChange(sidecar, sidecarSwapped);
    expect(verdict.decision).toBe("apply");
    expect(verdict.cost).toBe(2 * INERTIA_COSTS.move);
  });

  it("user-initiated changes always apply — policy never builds a wall", () => {
    expect(
      scoreChange(sidecar, stack, { userInitiated: true }).decision,
    ).toBe("apply");
    expect(
      scoreChange(sidecar, stack, {
        userInitiated: true,
        materialActivityChange: false,
      }).decision,
    ).toBe("apply");
  });

  it("an unjustified template change with a satisfactory current layout is kept", () => {
    const verdict = scoreChange(sidecar, stack);
    expect(verdict.decision).toBe("keep");
    expect(verdict.reason).toMatch(/not sufficient reason/);
  });
});

describe("scoreChange — decision bands", () => {
  it("pure resize changes decide 'resize'", () => {
    const verdict = scoreChange(sidecar, sidecarWide);
    expect(verdict.decision).toBe("resize");
    expect(verdict.reason).toMatch(/resize existing region/);
  });

  it("add/remove of a supporting surface decides 'adjust'", () => {
    const verdict = scoreChange(sidecar, sidecarMainOnly);
    expect(verdict.decision).toBe("adjust");
    expect(verdict.reason).toMatch(/add\/remove supporting region/);
  });
});

describe("isSatisfactory — deterministic definition", () => {
  it("true when the requested spec keeps the same primary set", () => {
    expect(isSatisfactory(sidecar, sidecarWide)).toBe(true);
    expect(isSatisfactory(sidecar, stack)).toBe(true);
  });

  it("false when the primary set changes or there is no current layout", () => {
    expect(isSatisfactory(sidecar, sidecarSwapped)).toBe(false);
    expect(isSatisfactory(null, sidecar)).toBe(false);
  });

  it("split's equal two-primaries are order-insensitive", () => {
    const splitAB: LayoutSpec = {
      template: "split",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "primary", slot: "side" },
      ],
    };
    const splitBA: LayoutSpec = {
      template: "split",
      assignments: [
        { surfaceId: "placeholder.companion", role: "primary", slot: "side" },
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
      ],
    };
    expect(isSatisfactory(splitAB, splitBA)).toBe(true);
    expect(isSatisfactory(splitAB, sidecar)).toBe(false);
  });
});
