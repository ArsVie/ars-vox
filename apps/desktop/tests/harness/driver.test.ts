/**
 * UI-105 acceptance (a)+(b): tests drive LayoutSpec directly (no LLM) and
 * every application identifies the expected primary activity.
 *
 * The driver takes a plain LayoutSpec literal, validates it through the
 * frozen contract validator, and returns primary ids + stub geometry.
 */

import { describe, expect, it } from "vitest";

import { TEMPLATE_SLOTS } from "../../src/adaptive/contracts";
import type { LayoutSpec } from "../../src/adaptive/contracts";
import { PLACEHOLDER_REGISTERED_IDS } from "../../src/adaptive/fixtures";
import { STUB_CANVAS } from "./geometry";
import { applyLayoutForTest, primaryInvariantViolation } from "../../src/adaptive/harness/driver";
import { ALL_TEMPLATES, LAYOUT_FIXTURES } from "../../src/adaptive/harness/fixtures";

describe("applyLayoutForTest drives LayoutSpec directly (acceptance a)", () => {
  it("applies a hand-written LayoutSpec without any LLM in the loop", () => {
    const spec: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    const applied = applyLayoutForTest(spec, PLACEHOLDER_REGISTERED_IDS);
    expect(applied.spec).toBe(spec);
    expect(applied.persistent).toEqual([]); // persistent is shell-owned, never in a spec
    expect(applied.geometry).toBeDefined();
  });

  it("accepts every template fixture and returns complete stub geometry", () => {
    for (const template of ALL_TEMPLATES) {
      const applied = applyLayoutForTest(LAYOUT_FIXTURES[template], PLACEHOLDER_REGISTERED_IDS);
      for (const slot of TEMPLATE_SLOTS[template]) {
        const rect = applied.geometry[slot];
        expect(rect, `${template}/${slot} must have geometry`).toBeDefined();
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
        expect(Number.isInteger(rect.x)).toBe(true);
        expect(Number.isInteger(rect.y)).toBe(true);
      }
    }
  });

  it("stub geometry tiles the virtual canvas without gaps or overlap", () => {
    const sidecar = applyLayoutForTest(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS).geometry;
    expect(sidecar.main.x).toBe(0);
    expect(sidecar.main.x + sidecar.main.width).toBe(sidecar.side.x);
    expect(sidecar.side.x + sidecar.side.width).toBe(STUB_CANVAS.width);

    const triple = applyLayoutForTest(LAYOUT_FIXTURES.triple, PLACEHOLDER_REGISTERED_IDS).geometry;
    expect(triple.main.x + triple.main.width).toBe(triple.side.x);
    expect(triple.side.x + triple.side.width).toBe(triple.rail.x);
    expect(triple.rail.x + triple.rail.width).toBe(STUB_CANVAS.width);

    const split = applyLayoutForTest(LAYOUT_FIXTURES.split, PLACEHOLDER_REGISTERED_IDS).geometry;
    expect(split.main.width).toBe(split.side.width); // equal split

    const stack = applyLayoutForTest(LAYOUT_FIXTURES.stack, PLACEHOLDER_REGISTERED_IDS).geometry;
    expect(stack.main.y + stack.main.height).toBe(stack.side.y); // companion stacked below
  });

  it("rejects invalid specs deterministically — invalid layouts never reach state", () => {
    expect(() =>
      applyLayoutForTest(
        { template: "focus", assignments: [] },
        PLACEHOLDER_REGISTERED_IDS,
      ),
    ).toThrow(/at least one assignment/);

    expect(() =>
      applyLayoutForTest(
        {
          template: "sidecar",
          assignments: [
            { surfaceId: "placeholder.primary", role: "companion", slot: "main" },
          ],
        },
        PLACEHOLDER_REGISTERED_IDS,
      ),
    ).toThrow(/exactly one primary/);

    expect(() =>
      applyLayoutForTest(
        {
          template: "focus",
          assignments: [
            { surfaceId: "not-registered", role: "primary", slot: "main" },
          ],
        },
        PLACEHOLDER_REGISTERED_IDS,
      ),
    ).toThrow(/unregistered/);

    expect(() =>
      applyLayoutForTest(
        {
          template: "focus",
          assignments: [
            { surfaceId: "placeholder.primary", role: "primary", slot: "side" },
          ],
        },
        PLACEHOLDER_REGISTERED_IDS,
      ),
    ).toThrow(/not offered/);
  });
});

describe("primary activity identification (acceptance b)", () => {
  it("returns exactly the surfaceIds assigned the primary role", () => {
    const spec: LayoutSpec = {
      template: "triple",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
        { surfaceId: "placeholder.support", role: "support", slot: "rail" },
      ],
    };
    expect(applyLayoutForTest(spec, PLACEHOLDER_REGISTERED_IDS).primary).toEqual([
      "placeholder.primary",
    ]);
  });

  it("every template fixture yields a non-empty primary set", () => {
    for (const template of ALL_TEMPLATES) {
      const primary = applyLayoutForTest(
        LAYOUT_FIXTURES[template],
        PLACEHOLDER_REGISTERED_IDS,
      ).primary;
      expect(primary.length).toBeGreaterThan(0);
      expect(primary.every((id) => id.length > 0)).toBe(true);
    }
  });

  it("primaryInvariantViolation enforces exactly-one-primary (split allows 1-2)", () => {
    expect(
      primaryInvariantViolation({
        template: "sidecar",
        assignments: [
          { surfaceId: "a", role: "companion", slot: "main" },
          { surfaceId: "b", role: "companion", slot: "side" },
        ],
      }),
    ).toMatch(/exactly one primary/);

    expect(
      primaryInvariantViolation({
        template: "split",
        assignments: [
          { surfaceId: "a", role: "primary", slot: "main" },
          { surfaceId: "b", role: "primary", slot: "side" },
        ],
      }),
    ).toBeNull();

    expect(
      primaryInvariantViolation({
        template: "split",
        assignments: [
          { surfaceId: "a", role: "companion", slot: "main" },
          { surfaceId: "b", role: "companion", slot: "side" },
        ],
      }),
    ).toMatch(/split requires one or two primaries/);
  });
});
