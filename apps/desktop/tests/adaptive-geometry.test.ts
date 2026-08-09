/**
 * UI-102 — adaptive geometry engine: pure-function tests.
 *
 * Covers determinism (same spec → same geometry, assignment-order
 * invariant), the frozen proportion table, exact stage tiling (no gaps /
 * no overflow), template compositions at the target desktop resolution,
 * deterministic failures (unknown template/slot/proportion, duplicate slot,
 * unregistered surface, stage too small), and surface mobility between
 * slots (identity = surfaceId, never instance).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, beforeEach } from "vitest";

import {
  ALL_TEMPLATES,
  PLACEHOLDER_REGISTERED_IDS,
  TEMPLATE_FIXTURES,
} from "../src/adaptive/fixtures";
import { registerProductSurfaces } from "../src/adaptive/surfaces";
import type { AdaptiveTemplate, LayoutSpec, Proportion } from "../src/adaptive/contracts";
import {
  AdaptiveGeometryError,
  DEFAULT_PROPORTION,
  MIN_SLOT_PX,
  PROPORTION_PRIMARY_RATIO,
  SPLIT_EQUAL_FRACTION,
  STACK_SIDE_MIN_FRACTION,
  TRIPLE_RAIL_FRACTION,
  computeAdaptiveGeometry,
  computeTemplateRects,
  type AdaptiveGeometry,
} from "../src/layout/adaptiveEngine";
import { surfaceRegistry } from "../src/roles/registry";
import { appStore, EMPTY_ADAPTIVE } from "../src/store";

/** Target desktop resolution (frozen acceptance baseline). */
const DESKTOP: { width: number; height: number } = { width: 1280, height: 800 };
/** Small-laptop window used for responsive checks. */
const SMALL: { width: number; height: number } = { width: 1024, height: 640 };

const ALL_PROPORTIONS: Proportion[] = ["narrow", "balanced", "wide"];

function geometryOf(
  spec: LayoutSpec,
  viewport: { width: number; height: number } = DESKTOP,
): AdaptiveGeometry {
  return computeAdaptiveGeometry(spec, viewport, PLACEHOLDER_REGISTERED_IDS);
}

function slotOf(geometry: AdaptiveGeometry, slot: string) {
  const found = geometry.slots.find((s) => s.slot === slot);
  if (!found) throw new Error(`slot ${slot} missing`);
  return found;
}

describe("proportion mapping (frozen constants)", () => {
  it("narrow/balanced/wide map to fixed design-system ratios", () => {
    expect(PROPORTION_PRIMARY_RATIO).toEqual({
      narrow: 0.62,
      balanced: 0.72,
      wide: 0.82,
    });
  });

  it("omitted proportion resolves to balanced (frozen default)", () => {
    const spec = { ...TEMPLATE_FIXTURES.sidecar, proportion: undefined };
    expect(geometryOf(spec).proportion).toBe("balanced");
    expect(geometryOf(spec).proportion).toBe(DEFAULT_PROPORTION);
  });
});

describe("template compositions (deterministic geometry math)", () => {
  it("focus: single main slot consumes the full stage", () => {
    const g = geometryOf(TEMPLATE_FIXTURES.focus);
    expect(g.template).toBe("focus");
    expect(g.slots).toHaveLength(1);
    expect(slotOf(g, "main")).toMatchObject({
      surfaceId: "placeholder.primary",
      role: "primary",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      zIndex: 30,
    });
  });

  it("sidecar: main width follows the proportion table", () => {
    for (const proportion of ALL_PROPORTIONS) {
      const g = geometryOf({
        ...TEMPLATE_FIXTURES.sidecar,
        proportion,
      });
      const main = slotOf(g, "main");
      const side = slotOf(g, "side");
      expect(main.width).toBeCloseTo(PROPORTION_PRIMARY_RATIO[proportion], 12);
      expect(side.width).toBeCloseTo(1 - PROPORTION_PRIMARY_RATIO[proportion], 12);
      expect(main.height).toBe(1);
      expect(side.height).toBe(1);
    }
  });

  it("stack: primary band on top, full-width companion band below", () => {
    for (const proportion of ALL_PROPORTIONS) {
      const g = geometryOf({ ...TEMPLATE_FIXTURES.stack, proportion });
      const main = slotOf(g, "main");
      const side = slotOf(g, "side");
      expect(main.width).toBe(1);
      expect(side.width).toBe(1);
      // Companion band = max(1-p, frozen 25% floor); main takes the rest.
      const sideH = Math.max(
        1 - PROPORTION_PRIMARY_RATIO[proportion],
        STACK_SIDE_MIN_FRACTION,
      );
      expect(side.height).toBeCloseTo(sideH, 12);
      expect(main.height).toBeCloseTo(1 - sideH, 12);
      expect(side.y).toBeCloseTo(1 - sideH, 12);
      expect(main.y).toBe(0);
    }
  });

  it("stack wide never crushes the companion band below the frozen floor", () => {
    const g = geometryOf({ ...TEMPLATE_FIXTURES.stack, proportion: "wide" });
    expect(slotOf(g, "side").height).toBeCloseTo(STACK_SIDE_MIN_FRACTION, 12);
    // 200px usable strip at the 800px target.
    expect(slotOf(g, "side").pxHeight).toBeCloseTo(200, 9);
  });

  it("split with one primary: proportion governs like sidecar", () => {
    const g = geometryOf({ ...TEMPLATE_FIXTURES.split, proportion: "narrow" });
    expect(slotOf(g, "main").width).toBeCloseTo(0.62, 12);
    expect(slotOf(g, "side").width).toBeCloseTo(0.38, 12);
  });

  it("split with two primaries: frozen equal 50/50, proportion ignored", () => {
    const twoPrimarySpec: LayoutSpec = {
      template: "split",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "primary", slot: "side" },
      ],
      proportion: "wide",
    };
    const g = geometryOf(twoPrimarySpec);
    expect(slotOf(g, "main").width).toBeCloseTo(SPLIT_EQUAL_FRACTION, 12);
    expect(slotOf(g, "side").width).toBeCloseTo(SPLIT_EQUAL_FRACTION, 12);
    expect(slotOf(g, "main").role).toBe("primary");
    expect(slotOf(g, "side").role).toBe("primary");
  });

  it("triple: rail reserves a frozen 16% column, main/side share 84%", () => {
    for (const proportion of ALL_PROPORTIONS) {
      const g = geometryOf({ ...TEMPLATE_FIXTURES.triple, proportion });
      const rail = slotOf(g, "rail");
      const main = slotOf(g, "main");
      const side = slotOf(g, "side");
      expect(rail.width).toBeCloseTo(TRIPLE_RAIL_FRACTION, 12);
      expect(rail.x).toBeCloseTo(1 - TRIPLE_RAIL_FRACTION, 12);
      expect(main.width).toBeCloseTo(
        PROPORTION_PRIMARY_RATIO[proportion] * (1 - TRIPLE_RAIL_FRACTION),
        12,
      );
      expect(side.width).toBeCloseTo(
        (1 - PROPORTION_PRIMARY_RATIO[proportion]) * (1 - TRIPLE_RAIL_FRACTION),
        12,
      );
    }
  });

  it("pixel sizes are derived: fraction × viewport, nothing else", () => {
    const g = geometryOf({ ...TEMPLATE_FIXTURES.sidecar, proportion: "balanced" });
    const main = slotOf(g, "main");
    expect(main.pxWidth).toBeCloseTo(0.72 * 1280, 9);
    expect(main.pxHeight).toBeCloseTo(800, 9);
    // Same spec at another viewport: fractions identical, px scale linearly.
    const small = geometryOf({ ...TEMPLATE_FIXTURES.sidecar, proportion: "balanced" }, SMALL);
    expect(slotOf(small, "main").width).toBe(main.width);
    expect(slotOf(small, "main").pxWidth).toBeCloseTo(0.72 * 1024, 9);
  });
});

describe("stage tiling — no gaps, no overflow", () => {
  function assertExactTiling(g: AdaptiveGeometry): void {
    expect(g.slots.length).toBeGreaterThan(0);
    // Every rect inside the stage.
    for (const s of g.slots) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(s.y + s.height).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Occupied slots tile the stage exactly: no overlap, no gaps.
    const totalArea = g.slots.reduce(
      (sum, s) => sum + s.width * s.height,
      0,
    );
    expect(totalArea).toBeCloseTo(1, 9);
    for (let i = 0; i < g.slots.length; i += 1) {
      for (let j = i + 1; j < g.slots.length; j += 1) {
        const a = g.slots[i];
        const b = g.slots[j];
        const overlapW =
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapH =
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        // Shared edges are allowed (adjacent tiling); interior overlap is not.
        expect(Math.max(overlapW, 0) * Math.max(overlapH, 0)).toBeCloseTo(0, 9);
      }
    }
  }

  it("all five templates × three proportions tile exactly at 1280×800", () => {
    for (const template of ALL_TEMPLATES) {
      for (const proportion of ALL_PROPORTIONS) {
        const spec: LayoutSpec = { ...TEMPLATE_FIXTURES[template], proportion };
        const g = geometryOf(spec);
        assertExactTiling(g);
      }
    }
  });

  it("tiles exactly at a smaller laptop window where templates fit", () => {
    // Combos whose frozen floors still fit at 1024×640.
    const specs: LayoutSpec[] = [
      TEMPLATE_FIXTURES.focus,
      { ...TEMPLATE_FIXTURES.sidecar, proportion: "narrow" },
      { ...TEMPLATE_FIXTURES.stack, proportion: "narrow" },
      TEMPLATE_FIXTURES.split,
      { ...TEMPLATE_FIXTURES.triple, proportion: "balanced" },
    ];
    for (const spec of specs) {
      assertExactTiling(geometryOf(spec, SMALL));
    }
  });
});

describe("determinism", () => {
  it("identical LayoutSpec → deep-equal geometry (pure function)", () => {
    for (const template of ALL_TEMPLATES) {
      const a = geometryOf(TEMPLATE_FIXTURES[template]);
      const b = geometryOf(TEMPLATE_FIXTURES[template]);
      expect(b).toEqual(a);
    }
  });

  it("assignment array order does not affect geometry", () => {
    const original = geometryOf(TEMPLATE_FIXTURES.triple);
    const shuffled: LayoutSpec = {
      ...TEMPLATE_FIXTURES.triple,
      assignments: [...TEMPLATE_FIXTURES.triple.assignments].reverse(),
    };
    expect(geometryOf(shuffled)).toEqual(original);
  });

  it("slots are emitted in canonical template order (main, side, rail)", () => {
    const g = geometryOf(TEMPLATE_FIXTURES.triple);
    expect(g.slots.map((s) => s.slot)).toEqual(["main", "side", "rail"]);
    const reversed: LayoutSpec = {
      ...TEMPLATE_FIXTURES.triple,
      assignments: [...TEMPLATE_FIXTURES.triple.assignments].reverse(),
    };
    expect(geometryOf(reversed).slots.map((s) => s.slot)).toEqual([
      "main",
      "side",
      "rail",
    ]);
  });

  it("no random / date / instance input exists in the pipeline", () => {
    // Geometry is a pure function of (spec, viewport): repeated evaluation
    // across a resized viewport preserves fraction identity.
    const a = geometryOf(TEMPLATE_FIXTURES.sidecar, DESKTOP);
    const b = geometryOf(TEMPLATE_FIXTURES.sidecar, { width: 1920, height: 1080 });
    expect(a.slots.map((s) => [s.x, s.y, s.width, s.height])).toEqual(
      b.slots.map((s) => [s.x, s.y, s.width, s.height]),
    );
  });
});

describe("surface mobility (identity = surfaceId)", () => {
  it("a surface moves between slots without a new instance or id", () => {
    // Same two surfaceIds, roles swapped: the geometry must follow the
    // surfaceId into its new slot, and nothing else changes identity.
    const before = geometryOf(TEMPLATE_FIXTURES.sidecar);
    const moved: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.companion", role: "primary", slot: "main" },
        { surfaceId: "placeholder.primary", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    const after = geometryOf(moved);
    expect(after.slots.map((s) => s.surfaceId).sort()).toEqual(
      before.slots.map((s) => s.surfaceId).sort(),
    );
    expect(slotOf(after, "main").surfaceId).toBe("placeholder.companion");
    expect(slotOf(after, "side").surfaceId).toBe("placeholder.primary");
    expect(slotOf(after, "main").role).toBe("primary");
    expect(slotOf(after, "side").role).toBe("companion");
  });

  it("geometry never references instances — only surfaceIds", () => {
    const g = geometryOf(TEMPLATE_FIXTURES.triple);
    for (const s of g.slots) {
      expect(typeof s.surfaceId).toBe("string");
      expect(s.surfaceId.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(g)).not.toMatch(/instance|ref|key\(/i);
  });
});

describe("deterministic failures", () => {
  function expectFail(
    spec: LayoutSpec,
    pattern: RegExp,
    viewport: { width: number; height: number } = DESKTOP,
  ): void {
    let message = "did not throw";
    try {
      computeAdaptiveGeometry(spec, viewport, PLACEHOLDER_REGISTERED_IDS);
    } catch (error) {
      expect(error).toBeInstanceOf(AdaptiveGeometryError);
      message = (error as Error).message;
    }
    expect(message).toMatch(pattern);
  }

  it("unknown template fails deterministically", () => {
    expectFail(
      {
        template: "matrix" as AdaptiveTemplate,
        assignments: [
          { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        ],
      },
      /unknown template "matrix"/,
    );
  });

  it("unknown proportion fails deterministically", () => {
    expectFail(
      { ...TEMPLATE_FIXTURES.sidecar, proportion: "huge" as Proportion },
      /unknown proportion "huge"/,
    );
  });

  it("unknown slot fails deterministically (contract rule)", () => {
    expectFail(
      {
        template: "focus",
        assignments: [
          { surfaceId: "placeholder.primary", role: "primary", slot: "side" },
        ],
      },
      /not offered/,
    );
  });

  it("unregistered surface fails deterministically (contract rule)", () => {
    expectFail(
      {
        template: "focus",
        assignments: [{ surfaceId: "nope", role: "primary", slot: "main" }],
      },
      /unregistered/,
    );
  });

  it("duplicate slot assignment fails deterministically (geometry rule)", () => {
    expectFail(
      {
        template: "sidecar",
        assignments: [
          { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
          { surfaceId: "placeholder.companion", role: "companion", slot: "main" },
        ],
      },
      /slot "main" is assigned more than once/,
    );
  });

  it("template cannot fit the stage fails deterministically with px numbers", () => {
    // 400×300 stage: focus needs main ≥360×300 → width fails.
    expectFail(TEMPLATE_FIXTURES.focus, /cannot fit slot "main"/, {
      width: 350,
      height: 300,
    });
    // triple narrow at 800×400: main 416.6 ✓, side 255.4 ✓, rail 128px < 160.
    expectFail(
      { ...TEMPLATE_FIXTURES.triple, proportion: "narrow" },
      /cannot fit slot "rail"/,
      { width: 800, height: 400 },
    );
    // sidecar balanced at 550×400: main 396 ✓, side 154px < 180 floor.
    expectFail(TEMPLATE_FIXTURES.sidecar, /cannot fit slot "side"/, {
      width: 550,
      height: 400,
    });
  });

  it("below-target windows fail deterministically instead of squashing", () => {
    // 1024×640 is below the 1280×800 target: some wide compositions cannot
    // fit their floors and must fail loudly, never squash. (sidecar wide
    // still fits — side = 184px ≥ 180 floor.)
    expectFail({ ...TEMPLATE_FIXTURES.triple, proportion: "wide" }, /cannot fit slot "side"/, SMALL);
    expectFail({ ...TEMPLATE_FIXTURES.stack, proportion: "balanced" }, /cannot fit slot "side"/, SMALL);
  });

  it("all five fixtures pass the fit check at target desktop resolution", () => {
    for (const template of ALL_TEMPLATES) {
      expect(() => geometryOf(TEMPLATE_FIXTURES[template])).not.toThrow();
    }
  });

  it("frozen floors are the documented constants", () => {
    expect(MIN_SLOT_PX).toEqual({
      main: { width: 360, height: 300 },
      side: { width: 180, height: 200 },
      rail: { width: 160, height: 200 },
    });
  });

  it("unassigned slots are simply not rendered (partial layouts allowed)", () => {
    const spec: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
      ],
    };
    const g = geometryOf(spec);
    expect(g.slots.map((s) => s.slot)).toEqual(["main"]);
  });

  it("layout with no assignments fails deterministically", () => {
    expectFail(
      { template: "focus", assignments: [] },
      /at least one assignment/,
    );
  });
});

describe("computeTemplateRects (exported math)", () => {
  it("produces identical rects for equal specs", () => {
    const a = computeTemplateRects("triple", "wide");
    const b = computeTemplateRects("triple", "wide");
    expect(b).toEqual(a);
  });

  it("split equalSplit flag toggles the 50/50 geometry", () => {
    const normal = computeTemplateRects("split", "narrow");
    const equal = computeTemplateRects("split", "narrow", { equalSplit: true });
    expect(normal.main.width).toBeCloseTo(0.62, 12);
    expect(equal.main.width).toBeCloseTo(0.5, 12);
    expect(equal.side.width).toBeCloseTo(0.5, 12);
  });
});

describe("W0 viewport ownership — adaptive geometry follows the shell (regression)", () => {
  beforeEach(() => {
    registerProductSurfaces();
    appStore.setState({ adaptive: EMPTY_ADAPTIVE });
  });

  it("the viewport writer lives in the app shell, not PanelHost", () => {
    const appSource = readFileSync(
      new URL("../src/App.tsx", import.meta.url),
      "utf8",
    );
    const panelHostSource = readFileSync(
      new URL("../src/components/PanelHost.tsx", import.meta.url),
      "utf8",
    );
    // The adaptive path mounts AdaptiveStage and UNMOUNTS PanelHost the
    // moment a composition lands (App.tsx branch). A setViewport writer
    // inside PanelHost therefore freezes the viewport at boot size and
    // geometry stops following window resizes. The shell must own it.
    expect(appSource).toContain("ResizeObserver");
    expect(appSource).toContain("setViewport");
    expect(panelHostSource).not.toContain("ResizeObserver");
    expect(panelHostSource).not.toContain("setViewport");
  });

  it("resizing in the adaptive path changes geometry", () => {
    // Seed a real adaptive composition through the store choke (same
    // pattern as adaptive-resolved.test.tsx).
    const spec: LayoutSpec = {
      template: "sidecar",
      proportion: "balanced",
      assignments: [
        { surfaceId: "conversation", role: "primary", slot: "main" },
        { surfaceId: "browser", role: "companion", slot: "side" },
      ],
    };
    appStore.getState().applyAdaptiveSpec(spec);
    expect(appStore.getState().adaptive.spec).not.toBeNull();

    const ids = surfaceRegistry.registeredIds();
    const boot = computeAdaptiveGeometry(spec, appStore.getState().viewport, ids);
    // The shell ResizeObserver's report(): store the new rect.
    appStore.getState().setViewport({ width: 1920, height: 1080 });
    const resized = computeAdaptiveGeometry(
      spec,
      appStore.getState().viewport,
      ids,
    );

    expect(resized).not.toEqual(boot);
    expect(slotOf(resized, "main").pxWidth).toBeGreaterThan(
      slotOf(boot, "main").pxWidth,
    );
  });
});
