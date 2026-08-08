/**
 * UI-105 — typed layout fixtures: every template fixture, proportion
 * variant, and transition sequence validates and stays driveable.
 */

import { describe, expect, it } from "vitest";

import type { AdaptiveTemplate, Proportion } from "../../src/adaptive/contracts";
import { PLACEHOLDER_REGISTERED_IDS } from "../../src/adaptive/fixtures";
import { applyLayoutForTest } from "../../src/adaptive/harness/driver";
import {
  ALL_PROPORTIONS,
  LAYOUT_FIXTURES,
  PROPORTION_VARIANTS,
  ROLE_SWAP_SEQUENCE,
  TRANSITION_SEQUENCES,
  assertFixturesValid,
} from "../../src/adaptive/harness/fixtures";
import { ALL_TEMPLATES } from "../../src/adaptive/harness/fixtures";

describe("typed layout fixtures", () => {
  it("exposes all five templates under an AdaptiveTemplate key", () => {
    expect(Object.keys(LAYOUT_FIXTURES).sort()).toEqual([...ALL_TEMPLATES].sort());
    for (const template of ALL_TEMPLATES) {
      expect(LAYOUT_FIXTURES[template].template).toBe(template);
    }
  });

  it("every proportion variant validates against the placeholder registry", () => {
    for (const template of ALL_TEMPLATES) {
      for (const proportion of ALL_PROPORTIONS) {
        const spec = PROPORTION_VARIANTS[template][proportion];
        expect(spec.proportion, `${template}/${proportion}`).toBe(proportion);
        const applied = applyLayoutForTest(spec, PLACEHOLDER_REGISTERED_IDS);
        expect(applied.primary.length).toBeGreaterThan(0);
      }
    }
  });

  it("proportion variants never mutate the frozen TEMPLATE_FIXTURES objects", () => {
    // TEMPLATE_FIXTURES.focus has no proportion; the variant must be a copy.
    expect(LAYOUT_FIXTURES.focus.proportion).toBeUndefined();
    expect(PROPORTION_VARIANTS.focus.wide.proportion).toBe("wide");
    expect(LAYOUT_FIXTURES.focus.proportion).toBeUndefined();
  });

  it("every transition sequence validates and reuses stable placeholder ids", () => {
    const sequences = Object.values(TRANSITION_SEQUENCES);
    expect(sequences.length).toBeGreaterThanOrEqual(6);
    for (const sequence of sequences) {
      expect(sequence.length).toBeGreaterThanOrEqual(2);
      for (const spec of sequence) {
        applyLayoutForTest(spec, PLACEHOLDER_REGISTERED_IDS); // throws on violation
      }
    }
  });

  it("templateCycle visits all five templates and returns to focus", () => {
    const cycle = TRANSITION_SEQUENCES.templateCycle;
    expect(cycle.map((s) => s.template)).toEqual([
      "focus",
      "sidecar",
      "stack",
      "split",
      "triple",
      "focus",
    ]);
  });

  it("role-swap sequence moves primary -> companion -> primary on SAME surfaceIds", () => {
    expect(ROLE_SWAP_SEQUENCE).toHaveLength(3);
    const ids = (spec: { assignments: { surfaceId: string }[] }) =>
      spec.assignments.map((a) => a.surfaceId).sort();
    for (const spec of ROLE_SWAP_SEQUENCE) {
      applyLayoutForTest(spec, PLACEHOLDER_REGISTERED_IDS);
      expect(ids(spec)).toEqual(["placeholder.companion", "placeholder.primary"]);
    }
    // primary history: placeholder.primary -> placeholder.companion -> placeholder.primary
    const primaryHistory = ROLE_SWAP_SEQUENCE.map(
      (spec) => spec.assignments.find((a) => a.role === "primary")!.surfaceId,
    );
    expect(primaryHistory).toEqual([
      "placeholder.primary",
      "placeholder.companion",
      "placeholder.primary",
    ]);
  });

  it("assertFixturesValid() covers every fixture and sequence", () => {
    expect(() => assertFixturesValid()).not.toThrow();
  });
});

// Type-level sanity: the fixture records are fully typed (compile-time).
const _proportionCheck: Record<AdaptiveTemplate, Record<Proportion, unknown>> =
  PROPORTION_VARIANTS;
void _proportionCheck;
