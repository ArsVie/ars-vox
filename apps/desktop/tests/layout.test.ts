/**
 * GATE-3.5 (W2-STORE): post-deletion layout tests. The legacy engine
 * (layout/engine.ts computeLayout + px floors + affinity) is DELETED —
 * these cover the layout modules that remain: the adaptive geometry
 * engine (layout/adaptiveEngine.ts, UI-102) and the spatial inertia
 * policy (layout/inertia.ts, UI-207), the geometry the app actually
 * produces and the guard that decides whether a change reaches it.
 */

import { describe, expect, it } from "vitest";

import type { LayoutSpec } from "../src/adaptive/contracts";
import {
  computeAdaptiveGeometry,
  computeTemplateRects,
  PROPORTION_PRIMARY_RATIO,
  SPLIT_EQUAL_FRACTION,
} from "../src/layout/adaptiveEngine";
import { isSatisfactory, scoreChange } from "../src/layout/inertia";

const VIEWPORT = { width: 1280, height: 800 };
const REGISTERED = new Set([
  "conversation",
  "document_editor",
  "browser",
  "media",
]);

function spec(overrides: Partial<LayoutSpec>): LayoutSpec {
  return {
    template: "sidecar",
    proportion: "balanced",
    assignments: [
      { surfaceId: "conversation", role: "primary", slot: "main" },
    ],
    ...overrides,
  };
}

describe("frozen proportion table (UI-102)", () => {
  it("uses the frozen design-system ratios — not the harness stub's", () => {
    // Regression guard: the expired harness stub shipped .4/.55/.7; the
    // real engine's frozen table is .62/.72/.82 (GATE-3.5 W2-STORE).
    expect(PROPORTION_PRIMARY_RATIO).toEqual({
      narrow: 0.62,
      balanced: 0.72,
      wide: 0.82,
    });
  });

  it("sidecar main width follows the proportion on the dominant axis", () => {
    const narrow = computeTemplateRects("sidecar", "narrow");
    const wide = computeTemplateRects("sidecar", "wide");
    expect(narrow.main.width).toBeCloseTo(0.62, 12);
    expect(wide.main.width).toBeCloseTo(0.82, 12);
    // side tiles the remainder edge-to-edge (x == main width)
    expect(narrow.side.x).toBeCloseTo(narrow.main.width, 12);
    expect(narrow.main.width + narrow.side.width).toBeCloseTo(1, 12);
  });
});

describe("split equalSplit branch (the harness stub lacked it)", () => {
  it("two primaries freeze the 50/50 split regardless of proportion", () => {
    const equal = computeTemplateRects("split", "wide", { equalSplit: true });
    expect(equal.main.width).toBeCloseTo(SPLIT_EQUAL_FRACTION, 12);
    expect(equal.side.width).toBeCloseTo(SPLIT_EQUAL_FRACTION, 12);
    // one primary keeps the proportion-governed split
    const normal = computeTemplateRects("split", "wide");
    expect(normal.main.width).toBeCloseTo(0.82, 12);
  });
});

describe("computeAdaptiveGeometry (UI-102)", () => {
  it("produces slot geometry keyed by surfaceId in template slot order", () => {
    const g = computeAdaptiveGeometry(
      spec({
        template: "split",
        assignments: [
          { surfaceId: "document_editor", role: "primary", slot: "main" },
          { surfaceId: "conversation", role: "companion", slot: "side" },
        ],
      }),
      VIEWPORT,
      REGISTERED,
    );
    expect(g.template).toBe("split");
    expect(g.slots.map((s) => s.surfaceId)).toEqual([
      "document_editor",
      "conversation",
    ]);
    expect(g.slots[0].role).toBe("primary");
    expect(g.slots[1].role).toBe("companion");
    // geometry tiles the stage edge-to-edge: no gaps, no overlap
    expect(g.slots[0].x).toBe(0);
    expect(g.slots[0].width + g.slots[1].width).toBeCloseTo(1, 12);
  });

  it("rejects unrenderable specs deterministically (the GATE-1 guard's engine)", () => {
    // duplicate slot assignment — passes the frozen validator (one
    // primary), fails geometry-level validation
    expect(() =>
      computeAdaptiveGeometry(
        spec({
          assignments: [
            { surfaceId: "document_editor", role: "primary", slot: "main" },
            { surfaceId: "browser", role: "companion", slot: "main" },
          ],
        }),
        VIEWPORT,
        REGISTERED,
      ),
    ).toThrow(/assigned more than once/);
    // unregistered surface never renders
    expect(() =>
      computeAdaptiveGeometry(
        spec({
          assignments: [
            { surfaceId: "ghost", role: "primary", slot: "main" },
          ],
        }),
        VIEWPORT,
        REGISTERED,
      ),
    ).toThrow();
  });

  it("template cannot fit the stage fails deterministically", () => {
    // sidecar's side column needs >= 180px; a 500px-wide stage cannot
    // host it (0.28 × 500 = 140px)
    expect(() =>
      computeAdaptiveGeometry(
        spec({
          assignments: [
            { surfaceId: "document_editor", role: "primary", slot: "main" },
            { surfaceId: "conversation", role: "companion", slot: "side" },
          ],
        }),
        { width: 500, height: 800 },
        REGISTERED,
      ),
    ).toThrow(/cannot fit slot/);
  });
});

describe("spatial inertia (UI-207)", () => {
  const current = spec({
    template: "split",
    assignments: [
      { surfaceId: "document_editor", role: "primary", slot: "main" },
      { surfaceId: "conversation", role: "companion", slot: "side" },
    ],
  });

  it("damps agent chatter that keeps the same primary activity", () => {
    // split -> sidecar at the same proportion: zero movement, zero churn
    const equivalent = spec({
      template: "sidecar",
      assignments: [
        { surfaceId: "document_editor", role: "primary", slot: "main" },
        { surfaceId: "conversation", role: "companion", slot: "side" },
      ],
    });
    expect(scoreChange(current, equivalent).decision).toBe("keep");
  });

  it("applies user-initiated changes unconditionally", () => {
    expect(
      scoreChange(current, current, { userInitiated: true }).decision,
    ).toBe("apply");
  });

  it("applies a primary re-focus (agent legitimately changing activity)", () => {
    const refocus = spec({
      template: "focus",
      assignments: [
        { surfaceId: "conversation", role: "primary", slot: "main" },
      ],
    });
    expect(scoreChange(current, refocus).decision).toBe("apply");
  });

  it("isSatisfactory compares the primary set only (order-insensitive)", () => {
    const samePrimary = spec({
      template: "stack",
      assignments: [
        { surfaceId: "document_editor", role: "primary", slot: "main" },
        { surfaceId: "conversation", role: "companion", slot: "side" },
      ],
    });
    expect(isSatisfactory(current, samePrimary)).toBe(true);
    const differentPrimary = spec({
      template: "focus",
      assignments: [
        { surfaceId: "conversation", role: "primary", slot: "main" },
      ],
    });
    expect(isSatisfactory(current, differentPrimary)).toBe(false);
  });
});
