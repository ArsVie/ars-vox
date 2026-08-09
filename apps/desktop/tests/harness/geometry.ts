/**
 * UI-105 — Stub slot geometry for the test harness.
 *
 * ⚠️ TEST-ONLY STUB. The real deterministic geometry engine is owned by
 * UI-102 (template geometry / proportion mapping) and integrates at
 * GATE-1. This module exists ONLY so workflow tests and the scenario
 * renderer can reason about slot rects BEFORE the geometry engine lands.
 *
 * Contract compliance: it derives everything from the frozen semantic
 * vocabulary (AdaptiveTemplate / Proportion / TEMPLATE_SLOTS). No
 * coordinate, pixel, or CSS value ever enters a LayoutSpec — this map is
 * a pure function OF the spec, never part of it.
 */

import type { AdaptiveTemplate, Proportion } from "../../src/adaptive/contracts";
import { TEMPLATE_SLOTS } from "../../src/adaptive/contracts";

/** Virtual canvas the stub geometry resolves against (documented, fixed). */
export const STUB_CANVAS = { width: 1280, height: 800 } as const;

/** Axis-aligned rectangle on the virtual canvas. */
export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Geometry for every slot a template offers. */
export type SlotGeometryMap = Record<string, SlotRect>;

/**
 * Fixed design-system main-region widths per proportion (frozen ratios,
 * mirroring the contract's "mapped to fixed design-system proportions").
 * UI-102 owns the real mapping; these are the harness's stand-ins.
 */
const PROPORTION_MAIN_WIDTH: Record<Proportion, number> = {
  narrow: Math.round(STUB_CANVAS.width * 0.4),
  balanced: Math.round(STUB_CANVAS.width * 0.55),
  wide: Math.round(STUB_CANVAS.width * 0.7),
};

/** Rail column width (triple template). */
const RAIL_WIDTH = 240;

/** Bottom strip height for the stacked companion (stack template). */
const STACK_SIDE_HEIGHT = 240;

/** Height of the shell-owned persistent media bar (stub). */
export const PERSISTENT_BAR_HEIGHT = 64;

/**
 * Deterministic stub geometry for a template + proportion.
 *
 * Every offered slot (per the frozen TEMPLATE_SLOTS) gets exactly one
 * rect; rects tile the canvas without gaps or overlap; values are
 * integers. `proportion` only affects horizontal main/side distribution
 * (stack/split are fixed by their template semantics).
 */
export function stubGeometry(
  template: AdaptiveTemplate,
  proportion: Proportion = "balanced",
): SlotGeometryMap {
  const { width: W, height: H } = STUB_CANVAS;
  switch (template) {
    case "focus":
      return { main: { x: 0, y: 0, width: W, height: H } };
    case "sidecar": {
      const mainW = PROPORTION_MAIN_WIDTH[proportion];
      return {
        main: { x: 0, y: 0, width: mainW, height: H },
        side: { x: mainW, y: 0, width: W - mainW, height: H },
      };
    }
    case "stack":
      return {
        main: { x: 0, y: 0, width: W, height: H - STACK_SIDE_HEIGHT },
        side: { x: 0, y: H - STACK_SIDE_HEIGHT, width: W, height: STACK_SIDE_HEIGHT },
      };
    case "split": {
      const mainW = Math.round(W / 2);
      return {
        main: { x: 0, y: 0, width: mainW, height: H },
        side: { x: mainW, y: 0, width: W - mainW, height: H },
      };
    }
    case "triple": {
      const mainW = PROPORTION_MAIN_WIDTH[proportion];
      const railX = W - RAIL_WIDTH;
      return {
        main: { x: 0, y: 0, width: mainW, height: H },
        side: { x: mainW, y: 0, width: railX - mainW, height: H },
        rail: { x: railX, y: 0, width: RAIL_WIDTH, height: H },
      };
    }
  }
}

/**
 * Geometry for the shell-owned persistent region (media bar, notifications).
 * NOT a template slot — the shell (UI-101) decides placement. The harness
 * uses this only to render persistent surfaces in scenario frames.
 */
export function stubPersistentBar(): SlotRect {
  return {
    x: 0,
    y: STUB_CANVAS.height - PERSISTENT_BAR_HEIGHT,
    width: STUB_CANVAS.width,
    height: PERSISTENT_BAR_HEIGHT,
  };
}

/**
 * Coverage check helper: the geometry returned for a template must contain
 * exactly the slots the contract says the template offers.
 */
export function assertGeometryCoversTemplate(
  geometry: SlotGeometryMap,
  template: AdaptiveTemplate,
): void {
  const offered = TEMPLATE_SLOTS[template];
  const missing = offered.filter((slot) => !(slot in geometry));
  const extra = Object.keys(geometry).filter((slot) => !offered.includes(slot));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `stub geometry for "${template}" must cover exactly its offered slots ` +
        `(${offered.join(", ")}); missing: ${missing.join(", ") || "none"}, ` +
        `extra: ${extra.join(", ") || "none"}`,
    );
  }
}
