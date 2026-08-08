/**
 * UI-105 — Typed layout fixtures + transition sequences.
 *
 * Re-exports the frozen TEMPLATE_FIXTURES (UI-000) under an
 * AdaptiveTemplate-keyed type, adds proportion variants, and defines
 * named transition sequences between templates — the raw material for
 * workflow tests and the screenshot scenario matrix.
 *
 * No LayoutSpec is invented here beyond what the frozen contract allows;
 * every fixture below validates against PLACEHOLDER_REGISTERED_IDS.
 */

import type { AdaptiveTemplate, LayoutSpec, Proportion } from "../contracts";
import { TEMPLATE_FIXTURES, PLACEHOLDER_REGISTERED_IDS } from "../fixtures";
import { applyLayoutForTest } from "./driver";

/** All three frozen proportions. */
export const ALL_PROPORTIONS: readonly Proportion[] = [
  "narrow",
  "balanced",
  "wide",
];

/** Typed view of the frozen per-template fixtures. */
export const LAYOUT_FIXTURES: Record<AdaptiveTemplate, LayoutSpec> = {
  focus: TEMPLATE_FIXTURES.focus,
  sidecar: TEMPLATE_FIXTURES.sidecar,
  stack: TEMPLATE_FIXTURES.stack,
  split: TEMPLATE_FIXTURES.split,
  triple: TEMPLATE_FIXTURES.triple,
};

/** Every template × every proportion (proportion defaulted where absent). */
export const PROPORTION_VARIANTS: Record<
  AdaptiveTemplate,
  Record<Proportion, LayoutSpec>
> = {
  focus: {
    narrow: { ...TEMPLATE_FIXTURES.focus, proportion: "narrow" },
    balanced: { ...TEMPLATE_FIXTURES.focus, proportion: "balanced" },
    wide: { ...TEMPLATE_FIXTURES.focus, proportion: "wide" },
  },
  sidecar: {
    narrow: { ...TEMPLATE_FIXTURES.sidecar, proportion: "narrow" },
    balanced: { ...TEMPLATE_FIXTURES.sidecar, proportion: "balanced" },
    wide: { ...TEMPLATE_FIXTURES.sidecar, proportion: "wide" },
  },
  stack: {
    narrow: { ...TEMPLATE_FIXTURES.stack, proportion: "narrow" },
    balanced: { ...TEMPLATE_FIXTURES.stack, proportion: "balanced" },
    wide: { ...TEMPLATE_FIXTURES.stack, proportion: "wide" },
  },
  split: {
    narrow: { ...TEMPLATE_FIXTURES.split, proportion: "narrow" },
    balanced: { ...TEMPLATE_FIXTURES.split, proportion: "balanced" },
    wide: { ...TEMPLATE_FIXTURES.split, proportion: "wide" },
  },
  triple: {
    narrow: { ...TEMPLATE_FIXTURES.triple, proportion: "narrow" },
    balanced: { ...TEMPLATE_FIXTURES.triple, proportion: "balanced" },
    wide: { ...TEMPLATE_FIXTURES.triple, proportion: "wide" },
  },
};

/**
 * Named transition sequences between template fixtures. Each entry is a
 * driveable LayoutSpec list; tests apply them step-by-step through the
 * harness driver (no LLM).
 */
export const TRANSITION_SEQUENCES: Record<string, readonly LayoutSpec[]> = {
  /** focus -> sidecar: a second activity joins the primary. */
  focusToSidecar: [LAYOUT_FIXTURES.focus, LAYOUT_FIXTURES.sidecar],
  /** sidecar -> stack: companion moves from beside to below. */
  sidecarToStack: [LAYOUT_FIXTURES.sidecar, LAYOUT_FIXTURES.stack],
  /** stack -> split: companion promoted to an equal primary. */
  stackToSplit: [
    LAYOUT_FIXTURES.stack,
    {
      template: "split",
      assignments: [
        { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
        { surfaceId: "placeholder.companion", role: "primary", slot: "side" },
      ],
      proportion: "balanced",
    },
  ],
  /** split -> triple: a support rail joins the two primaries. */
  splitToTriple: [LAYOUT_FIXTURES.split, LAYOUT_FIXTURES.triple],
  /** triple -> focus: back to a single primary activity. */
  tripleToFocus: [LAYOUT_FIXTURES.triple, LAYOUT_FIXTURES.focus],
  /** The full template cycle (five transitions, all five templates). */
  templateCycle: [
    LAYOUT_FIXTURES.focus,
    LAYOUT_FIXTURES.sidecar,
    LAYOUT_FIXTURES.stack,
    LAYOUT_FIXTURES.split,
    LAYOUT_FIXTURES.triple,
    LAYOUT_FIXTURES.focus,
  ],
};

/**
 * Role swap on the SAME surfaceIds — the frozen identity-survival case:
 * a surface can move primary -> companion -> primary without a new
 * instance, and its state must survive.
 */
export const ROLE_SWAP_SEQUENCE: readonly LayoutSpec[] = [
  LAYOUT_FIXTURES.sidecar,
  {
    template: "sidecar",
    assignments: [
      { surfaceId: "placeholder.companion", role: "primary", slot: "main" },
      { surfaceId: "placeholder.primary", role: "companion", slot: "side" },
    ],
    proportion: "balanced",
  },
  {
    template: "sidecar",
    assignments: [
      { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
      { surfaceId: "placeholder.companion", role: "companion", slot: "side" },
    ],
    proportion: "balanced",
  },
];

/** Prove-at-import: every fixture and sequence validates against the registry. */
export function assertFixturesValid(): void {
  for (const fixture of Object.values(LAYOUT_FIXTURES)) {
    applyLayoutForTest(fixture, PLACEHOLDER_REGISTERED_IDS);
  }
  for (const template of Object.keys(PROPORTION_VARIANTS) as AdaptiveTemplate[]) {
    for (const proportion of ALL_PROPORTIONS) {
      applyLayoutForTest(PROPORTION_VARIANTS[template][proportion], PLACEHOLDER_REGISTERED_IDS);
    }
  }
  for (const sequence of Object.values(TRANSITION_SEQUENCES)) {
    for (const spec of sequence) {
      applyLayoutForTest(spec, PLACEHOLDER_REGISTERED_IDS);
    }
  }
  for (const spec of ROLE_SWAP_SEQUENCE) {
    applyLayoutForTest(spec, PLACEHOLDER_REGISTERED_IDS);
  }
}

/** Re-exports for convenience. */
export { ALL_TEMPLATES, PLACEHOLDER_REGISTERED_IDS, TEMPLATE_FIXTURES } from "../fixtures";
