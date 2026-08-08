/**
 * UI-105 — Screenshot scenario catalog + render hook.
 *
 * Data: every template × proportion combination plus the canonical-flow key
 * frames. Render hook: `renderScenario` validates the scenario's LayoutSpec
 * through the frozen contract and returns the stub slot geometry — the
 * exact input a real screenshot pipeline (GATE-2, with the shell) will
 * paint. No headless browser / dom-to-image is required at this wave; the
 * storyboard capture test emits a static HTML/JSON storyboard from these
 * renders (scripts/render-scenario-storyboard.mjs).
 */

import type { AdaptiveTemplate, LayoutSpec, Proportion } from "../contracts";
import { ALL_TEMPLATES } from "../fixtures";
import type { SlotRect, SlotGeometryMap } from "./geometry";
import { assertGeometryCoversTemplate, stubGeometry, stubPersistentBar } from "./geometry";
import type { AppliedLayout } from "./driver";
import { applyLayoutForTest } from "./driver";
import {
  ALL_PROPORTIONS,
  PROPORTION_VARIANTS,
} from "./fixtures";
import { PLACEHOLDER_REGISTERED_IDS } from "../fixtures";
import { CANONICAL_FLOW, CANONICAL_REGISTERED_IDS } from "./workflows";

export type ScenarioKind = "template-matrix" | "canonical-key-frame";

/** One screenshot scenario: a single validated LayoutSpec + expectations. */
export interface Scenario {
  id: string;
  title: string;
  description: string;
  kind: ScenarioKind;
  spec: LayoutSpec;
  /** Expected primary activity in this frame (exact match). */
  expectedPrimary: string[];
  /** Shell-owned persistent surfaces active in this frame. */
  persistent?: string[];
}

/** Template × proportion matrix (5 × 3 = 15 scenarios). */
export function templateMatrixScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];
  for (const template of ALL_TEMPLATES) {
    for (const proportion of ALL_PROPORTIONS) {
      const spec = PROPORTION_VARIANTS[template][proportion];
      scenarios.push({
        id: `matrix-${template}-${proportion}`,
        title: `${template} / ${proportion}`,
        description: `Template fixture "${template}" at "${proportion}" proportion.`,
        kind: "template-matrix",
        spec,
        expectedPrimary: spec.assignments
          .filter((a) => a.role === "primary")
          .map((a) => a.surfaceId),
      });
    }
  }
  return scenarios;
}

/** Canonical-flow key frames (9 steps of the frozen flow). */
export function canonicalKeyFrameScenarios(): Scenario[] {
  return CANONICAL_FLOW.map((step) => ({
    id: `flow-${step.id}`,
    title: step.label,
    description: `Canonical flow key frame: ${step.id}.`,
    kind: "canonical-key-frame" as const,
    spec: step.spec,
    expectedPrimary: step.expectedPrimary,
    persistent: step.persistent,
  }));
}

/** The full screenshot scenario catalog. */
export function scenarioCatalog(): Scenario[] {
  return [...templateMatrixScenarios(), ...canonicalKeyFrameScenarios()];
}

/**
 * Registry covering BOTH surface universes in the catalog: the placeholder
 * surfaces used by the template×proportion matrix scenarios AND the
 * canonical surfaces used by the canonical-flow key frames. Full-storyboard
 * renders (renderStoryboard / storyboardPayload) need this union.
 */
export const STORYBOARD_REGISTERED_IDS: ReadonlySet<string> = new Set([
  ...PLACEHOLDER_REGISTERED_IDS,
  ...CANONICAL_REGISTERED_IDS,
]);

/** Result of rendering one scenario frame. */
export interface ScenarioRender {
  scenario: Scenario;
  /** Validated spec + primary ids + stub geometry. */
  applied: AppliedLayout;
  /** Stub geometry per template slot. */
  slots: SlotGeometryMap;
  /** Shell-owned persistent region (present when the scenario has persistent surfaces). */
  persistentBar: SlotRect | null;
  /** Template this frame renders. */
  template: AdaptiveTemplate;
  /** Proportion the frame resolves at. */
  proportion: Proportion;
}

/**
 * The render hook: turn a scenario into something a screenshot pipeline can
 * paint. Pure — validates the spec (throws on contract violation) and
 * derives geometry. The real shell (UI-101/UI-102) replaces this at GATE-2;
 * the shape stays: spec + primary + slot geometry.
 */
export function renderScenario(
  scenario: Scenario,
  registered: ReadonlySet<string>,
): ScenarioRender {
  const applied = applyLayoutForTest(scenario.spec, registered);
  assertGeometryCoversTemplate(applied.geometry, scenario.spec.template);
  return {
    scenario,
    applied,
    slots: applied.geometry,
    persistentBar: (scenario.persistent?.length ?? 0) > 0 ? stubPersistentBar() : null,
    template: scenario.spec.template,
    proportion: scenario.spec.proportion ?? "balanced",
  };
}

/** Render every catalog scenario (fresh geometry per frame, no cross-frame claims). */
export function renderStoryboard(
  registered: ReadonlySet<string>,
): ScenarioRender[] {
  return scenarioCatalog().map((scenario) => renderScenario(scenario, registered));
}

/** JSON-serializable storyboard payload for the capture script. */
export function storyboardPayload(registered: ReadonlySet<string>): unknown {
  return {
    canvas: { width: 1280, height: 800 },
    note: "UI-105 placeholder storyboard — real screenshots land at GATE-2 with the shell.",
    scenarios: renderStoryboard(registered).map((render) => ({
      id: render.scenario.id,
      title: render.scenario.title,
      description: render.scenario.description,
      kind: render.scenario.kind,
      template: render.template,
      proportion: render.proportion,
      primary: render.applied.primary,
      persistent: render.scenario.persistent ?? [],
      geometry: render.slots,
      persistentBar: render.persistentBar,
    })),
  };
}

/** Stub geometry for one template (exported for matrix convenience). */
export function geometryForTemplate(
  template: AdaptiveTemplate,
  proportion: Proportion = "balanced",
): SlotGeometryMap {
  return stubGeometry(template, proportion);
}
