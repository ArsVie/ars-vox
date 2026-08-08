/**
 * UI-102 — Adaptive template geometry engine (deterministic).
 *
 * Consumes ONLY the frozen LayoutSpec (template + role assignments +
 * optional proportion) and produces concrete slot rectangles. Geometry is
 * a PURE function of (LayoutSpec, stage viewport) — no surface content,
 * no LLM output, no instance identity ever enters the math. The same valid
 * LayoutSpec always produces the same geometry; assignments are keyed by
 * surfaceId, never by instance, so a surface may move between slots (and
 * roles) without any new surface instance.
 *
 * Frozen design-system proportions (UI-102 owns the mapping — the agent
 * may only name narrow|balanced|wide):
 *
 *   PROPORTION_PRIMARY_RATIO = { narrow: 0.62, balanced: 0.72, wide: 0.82 }
 *
 *   The ratio is the primary region's share of the template's dominant
 *   axis: WIDTH for sidecar/split/triple, HEIGHT for stack (the stacked
 *   companion band), and is irrelevant for focus (full stage) and for
 *   split-with-two-primaries (frozen equal 50/50 split).
 *
 * Template compositions (fractions of the stage, exact tiling — widths and
 * heights sum to exactly 1, no gaps, no overflow):
 *
 *   focus   main            : full stage
 *   sidecar main | side     : vertical divider; main = P, side = 1-P
 *   stack   main / side     : horizontal divider; main = top (1-side) of
 *                             height, side = full-width bottom band; the
 *                             band never compresses below a frozen 25% of
 *                             stage height (usable 200px strip at 800px)
 *   split   main | side     : one primary → like sidecar (P governs);
 *                             two primaries → frozen equal 50/50 (P ignored)
 *   triple  main | side | rail : rail reserves a frozen 16% right column;
 *                             main = P × 84%, side = (1-P) × 84%
 *
 * Regions tile the stage edge-to-edge; the shell (UI-101) owns any
 * dividers/gutters as chrome. The engine emits geometry only, never
 * decorations.
 *
 * Deterministic failure: every invalid input throws AdaptiveGeometryError
 * with a stable message — contract violations go through the frozen
 * validateLayoutSpec, geometry-level violations (unknown template,
 * unknown proportion, duplicate slot assignment, template whose slots
 * cannot fit the stage) are checked here. Invalid specs NEVER reach
 * layout state.
 */

import {
  TEMPLATE_SLOTS,
  validateLayoutSpec,
  type AdaptiveTemplate,
  type LayoutAssignment,
  type LayoutSpec,
  type Proportion,
  type SurfaceRole,
} from "../adaptive/contracts";

/** Stage size in device-independent pixels. */
export interface Viewport {
  width: number;
  height: number;
}

/** One computed slot: canonical geometry (fractions of the stage) + the
 * surfaceId occupying it. `x`/`y`/`width`/`height` are fractions in [0,1]
 * that tile the stage exactly; `pxWidth`/`pxHeight` are the derived
 * pixel sizes (fraction × viewport). */
export interface SlotGeometry {
  slot: string;
  surfaceId: string;
  role: SurfaceRole;
  /** Fraction of stage width from the left edge (0..1). */
  x: number;
  /** Fraction of stage height from the top edge (0..1). */
  y: number;
  /** Fraction of stage width. */
  width: number;
  /** Fraction of stage height. */
  height: number;
  /** Derived pixel size (width × viewport.width). */
  pxWidth: number;
  /** Derived pixel size (height × viewport.height). */
  pxHeight: number;
  /** Deterministic stacking order (main dominates). */
  zIndex: number;
}

/** Complete deterministic output of the geometry engine. */
export interface AdaptiveGeometry {
  template: AdaptiveTemplate;
  /** Resolved proportion (defaults to "balanced" when omitted). */
  proportion: Proportion;
  viewport: Viewport;
  /** Occupied slots in canonical template order (main, side, rail). */
  slots: SlotGeometry[];
}

/** Every failure of the adaptive engine — deterministic messages only. */
export class AdaptiveGeometryError extends Error {
  constructor(message: string) {
    super(`adaptive geometry: ${message}`);
    this.name = "AdaptiveGeometryError";
  }
}

/**
 * FROZEN proportion table (UI-102). narrow/balanced/wide → primary region
 * ratio on the dominant axis. Step is a perceptible 10pp; 0.62 keeps a
 * usable secondary at 1280px (≈486px), 0.82 gives the primary clear
 * dominance while leaving a working companion (≈230px). Values are design
 * decisions, not agent input.
 */
export const PROPORTION_PRIMARY_RATIO: Record<Proportion, number> = {
  narrow: 0.62,
  balanced: 0.72,
  wide: 0.82,
} as const;

/** Proportion used when LayoutSpec omits it. */
export const DEFAULT_PROPORTION: Proportion = "balanced";

/** FROZEN triple composition: the rail (support column) reserves a fixed
 * 16% of stage width; main and side share the remaining 84% by proportion. */
export const TRIPLE_RAIL_FRACTION = 0.16;

/** FROZEN split composition with two primaries: exactly 50/50. */
export const SPLIT_EQUAL_FRACTION = 0.5;

/** FROZEN stack composition: the companion band never compresses below
 * 25% of stage height (a usable 200px strip at the 800px target), even at
 * "wide" — the proportion table governs until it would crush the band. */
export const STACK_SIDE_MIN_FRACTION = 0.25;

/**
 * FROZEN usability floors (px). A template whose computed slots cannot
 * meet these floors fails deterministically (AdaptiveGeometryError) — the
 * engine never silently squashes a composition. All five templates pass at
 * the target desktop resolution (1280×800+).
 */
export const MIN_SLOT_PX: Record<string, { width: number; height: number }> = {
  main: { width: 360, height: 300 },
  side: { width: 180, height: 200 },
  rail: { width: 160, height: 200 },
};

/** Deterministic stacking order — primary region dominates visually. */
export const SLOT_Z_INDEX: Record<string, number> = {
  main: 30,
  side: 20,
  rail: 12,
};

const PROPORTIONS: ReadonlySet<string> = new Set([
  "narrow",
  "balanced",
  "wide",
]);

const EMPTY_REGISTRY: ReadonlySet<string> = new Set();

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Canonical rect for every slot of a template (fractions of the stage).
 * Exported for geometry-math tests and GATE-1 consumers. */
export function computeTemplateRects(
  template: AdaptiveTemplate,
  proportion: Proportion,
  opts: { equalSplit?: boolean } = {},
): Record<string, Rect> {
  const p = PROPORTION_PRIMARY_RATIO[proportion];
  switch (template) {
    case "focus":
      return { main: { x: 0, y: 0, width: 1, height: 1 } };
    case "sidecar":
      return {
        main: { x: 0, y: 0, width: p, height: 1 },
        side: { x: p, y: 0, width: 1 - p, height: 1 },
      };
    case "stack": {
      const sideH = Math.max(1 - p, STACK_SIDE_MIN_FRACTION);
      const mainH = 1 - sideH;
      return {
        main: { x: 0, y: 0, width: 1, height: mainH },
        side: { x: 0, y: mainH, width: 1, height: sideH },
      };
    }
    case "split": {
      if (opts.equalSplit) {
        const w = SPLIT_EQUAL_FRACTION;
        return {
          main: { x: 0, y: 0, width: w, height: 1 },
          side: { x: w, y: 0, width: 1 - w, height: 1 },
        };
      }
      return {
        main: { x: 0, y: 0, width: p, height: 1 },
        side: { x: p, y: 0, width: 1 - p, height: 1 },
      };
    }
    case "triple": {
      const railX = 1 - TRIPLE_RAIL_FRACTION;
      const mainW = p * railX;
      return {
        main: { x: 0, y: 0, width: mainW, height: 1 },
        side: { x: mainW, y: 0, width: railX - mainW, height: 1 },
        rail: { x: railX, y: 0, width: TRIPLE_RAIL_FRACTION, height: 1 },
      };
    }
  }
}

function fmtPx(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Render a LayoutSpec deterministically.
 *
 * @param spec       The frozen agent-produced shape (template, assignments,
 *                   optional proportion). No pixel field exists in it —
 *                   every pixel is derived here from frozen constants.
 * @param viewport   The activity stage size in px (measured by the shell).
 * @param registered Registered surfaceIds (UI-103 registry; pass
 *                   PLACEHOLDER_REGISTERED_IDS for fixture testing). Defaults
 *                   to an empty registry → unregistered assignments fail.
 * @returns Concrete slot rectangles; identical inputs always produce
 *          identical output (deep-equal).
 * @throws AdaptiveGeometryError on ANY invalid input.
 */
export function computeAdaptiveGeometry(
  spec: LayoutSpec,
  viewport: Viewport,
  registered: ReadonlySet<string> = EMPTY_REGISTRY,
): AdaptiveGeometry {
  // ---- 1. shape pre-checks (deterministic messages BEFORE contract code) --
  if (!spec || typeof spec !== "object" || !Array.isArray(spec.assignments)) {
    throw new AdaptiveGeometryError(
      "invalid LayoutSpec: expected { template, assignments[], proportion? }",
    );
  }
  if (!(spec.template in TEMPLATE_SLOTS)) {
    throw new AdaptiveGeometryError(
      `unknown template "${String(spec.template)}"`,
    );
  }
  const proportion: Proportion = spec.proportion ?? DEFAULT_PROPORTION;
  if (!PROPORTIONS.has(proportion)) {
    throw new AdaptiveGeometryError(
      `unknown proportion "${String(proportion)}"`,
    );
  }

  // ---- 2. frozen contract validation (UI-000) ------------------------------
  try {
    validateLayoutSpec(spec, registered);
  } catch (error) {
    throw new AdaptiveGeometryError((error as Error).message);
  }

  // ---- 3. geometry-level validation ----------------------------------------
  // A slot is a single region: two surfaces may not share it. (Contract
  // validation does not cover this — slot uniqueness is geometry's job.)
  const bySlot = new Map<string, LayoutAssignment>();
  for (const assignment of spec.assignments) {
    if (bySlot.has(assignment.slot)) {
      throw new AdaptiveGeometryError(
        `slot "${assignment.slot}" is assigned more than once`,
      );
    }
    bySlot.set(assignment.slot, assignment);
  }

  const equalSplit =
    spec.template === "split" &&
    spec.assignments.filter((a) => a.role === "primary").length === 2;
  const rects = computeTemplateRects(spec.template, proportion, {
    equalSplit,
  });

  // A template is a composition: ALL its slots must fit the stage, occupied
  // or not. Below-fit templates fail deterministically — the engine never
  // silently degrades or squashes (the legacy engine owns the old ladder).
  for (const slot of TEMPLATE_SLOTS[spec.template]) {
    const rect = rects[slot];
    if (!rect) {
      throw new AdaptiveGeometryError(
        `template "${spec.template}" has no geometry for slot "${slot}"`,
      );
    }
    const floor = MIN_SLOT_PX[slot];
    const pxWidth = rect.width * viewport.width;
    const pxHeight = rect.height * viewport.height;
    if (pxWidth + 1e-9 < floor.width || pxHeight + 1e-9 < floor.height) {
      throw new AdaptiveGeometryError(
        `template "${spec.template}" cannot fit slot "${slot}" ` +
          `(needs ≥${floor.width}×${floor.height}px, stage ` +
          `${viewport.width}×${viewport.height}px gives ` +
          `${fmtPx(pxWidth)}×${fmtPx(pxHeight)}px)`,
      );
    }
  }

  // ---- 4. canonical output (template slot order, keyed by surfaceId) -------
  const slots: SlotGeometry[] = [];
  for (const slot of TEMPLATE_SLOTS[spec.template]) {
    const assignment = bySlot.get(slot);
    if (!assignment) continue; // unassigned slots are simply not rendered
    const rect = rects[slot];
    slots.push({
      slot,
      surfaceId: assignment.surfaceId,
      role: assignment.role,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      pxWidth: rect.width * viewport.width,
      pxHeight: rect.height * viewport.height,
      zIndex: SLOT_Z_INDEX[slot] ?? 0,
    });
  }

  return { template: spec.template, proportion, viewport, slots };
}
