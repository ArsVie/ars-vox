/**
 * UI-105 — Thin LayoutSpec test driver (no LLM involved).
 *
 * `applyLayoutForTest` is the harness's front door: it takes a LayoutSpec
 * produced directly by a test (never by a model), validates it through the
 * frozen contract validator, and returns the semantic result — the primary
 * surface ids and the stub slot geometry. Geometry-engine integration is
 * UI-102's job at GATE-1; until then this pure function is the driver.
 *
 * Contract boundaries honored:
 *  - LayoutSpec / validation / registry checks come from src/adaptive/contracts.ts (frozen).
 *  - No coordinate ever enters a LayoutSpec; geometry is derived, never input.
 */

import { validateLayoutSpec } from "../contracts";
import type { LayoutSpec } from "../contracts";
import type { SlotGeometryMap } from "../../../tests/harness/geometry";
import { assertGeometryCoversTemplate, stubGeometry } from "../../../tests/harness/geometry";

/** Result of applying a LayoutSpec through the test driver. */
export interface AppliedLayout {
  /** The spec as given (frozen contract shape). */
  spec: LayoutSpec;
  /** surfaceIds occupying the `primary` role — the expected primary activity. */
  primary: string[];
  /** Stub geometry for every slot the template offers (UI-102 replaces at GATE-1). */
  geometry: SlotGeometryMap;
  /**
   * Persistent surfaces active in this frame. Always empty from the
   * template's perspective — persistent is shell-owned and never assigned
   * through LayoutSpec (frozen rule 4).
   */
  persistent: string[];
}

/**
 * Validate a LayoutSpec against a registry and derive the semantic result.
 * Throws deterministically on any contract violation (invalid specs never
 * reach layout state).
 */
export function applyLayoutForTest(
  spec: LayoutSpec,
  registered: ReadonlySet<string>,
): AppliedLayout {
  validateLayoutSpec(spec, registered);
  const primary = spec.assignments
    .filter((a) => a.role === "primary")
    .map((a) => a.surfaceId);
  const geometry = stubGeometry(spec.template, spec.proportion ?? "balanced");
  assertGeometryCoversTemplate(geometry, spec.template);
  return { spec, primary, geometry, persistent: [] };
}

/**
 * Exactly-one-primary invariant check (frozen contract rule 1): non-split
 * templates require exactly one primary; split allows one or two. Returns
 * the violation message or null when the layout satisfies the rule.
 */
export function primaryInvariantViolation(spec: LayoutSpec): string | null {
  const primaries = spec.assignments.filter((a) => a.role === "primary");
  const count = primaries.length;
  if (spec.template === "split") {
    if (count < 1 || count > 2) {
      return `split requires one or two primaries, got ${count}`;
    }
    return null;
  }
  if (count !== 1) {
    return `expected exactly one primary, got ${count}`;
  }
  return null;
}
