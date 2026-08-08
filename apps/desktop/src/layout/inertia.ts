/**
 * UI-207 — Spatial inertia policy (pure, deterministic, no React, no side
 * effects, no time/randomness).
 *
 * PURPOSE
 *   Prevent agent-driven adaptability from making the interface unstable or
 *   unpredictable. The agent may propose a new LayoutSpec after every
 *   response; most proposals are chatter. This module scores a proposed
 *   change against the current layout and decides whether applying it is
 *   worth the movement it causes.
 *
 * POLICY PRIORITY (verbatim from the UI-207 brief / execution contract)
 *   1. Keep existing satisfactory layout.
 *   2. Resize existing region.
 *   3. Add/remove supporting region.
 *   4. Move a surface.
 *   5. Change template substantially.
 *
 *   Encoded as monotonically increasing cost bands:
 *     resize  (same template, same assignments, proportion/geometry delta)
 *             -> ~0..< ADD_REMOVE_COST
 *     add/remove supporting surface (same template, no region moves)
 *             -> ADD_REMOVE_COST (25) per surface .. < MOVE_COST
 *     move a surface between general screen regions
 *             -> MOVE_COST (50) per surface
 *     template change
 *             -> TEMPLATE_CHANGE_COST (100) on top of everything else,
 *                so it always costs the most (>= 100, and every real
 *                template change also carries its per-surface deltas).
 *
 * SATISFACTORY — deterministic definition (documented here per the brief):
 *   A current layout is satisfactory when it is non-empty and the requested
 *   spec keeps the SAME set of primary surfaceIds (sorted, so split's equal
 *   two-primaries are order-insensitive). I.e. the current composition still
 *   serves the same primary activity, and no user-initiated or material
 *   activity change justifies rearranging it. Nothing else is consulted —
 *   no timers, no agent text, no history.
 *
 * GUARD RULES (decision mapping)
 *   - userInitiated            -> always 'apply' (never build a wall; user
 *                                 overrides are Wave 3 but the policy layer
 *                                 must not block them).
 *   - no current layout        -> 'apply' (first placement is free).
 *   - cost === 0               -> 'keep'  (identical/equivalent layout:
 *                                 repeated identical agent requests cause
 *                                 ZERO churn).
 *   - resize band              -> 'resize' (policy step 2 is an allowed
 *                                 adaptation; apply the requested spec,
 *                                 which IS the resize step).
 *   - add/remove band          -> 'adjust' (policy step 3: supporting
 *                                 region added/removed; apply).
 *   - move/template band       -> 'apply' only when the change is justified
 *                                 (userInitiated | materialActivityChange |
 *                                 primary set changed — the agent is
 *                                 legitimately re-focusing), else 'keep'
 *                                 ("agent response alone is never sufficient
 *                                 reason to rearrange").
 *
 * MOVEMENT COST
 *   For every surface present in both layouts, its general screen region is
 *   its template slot (main/side/rail). Same slot -> only a resize delta:
 *   the L1 distance between the two slot rects (fractions of the stage,
 *   via the frozen UI-102 computeTemplateRects — no viewport needed),
 *   scaled by RESIZE_SCALE and capped per surface at RESIZE_CAP. Different
 *   slot -> the surface MOVED (MOVE_COST). Surfaces present in only one
 *   layout -> added/removed (ADD_REMOVE_COST each). Different template
 *   adds TEMPLATE_CHANGE_COST. Deterministic: identical inputs always
 *   produce identical verdicts.
 */

import type { LayoutSpec, Proportion } from "../adaptive/contracts";
import { computeTemplateRects } from "./adaptiveEngine";

/** Policy decisions, ordered from least to most disruptive. */
export type InertiaDecision = "keep" | "resize" | "adjust" | "apply";

/** Frozen cost table — encodes the policy priority order. */
export const INERTIA_COSTS = {
  /** Per-surface resize delta scale (fraction L1 distance * scale). */
  resizeScale: 5,
  /** Per-surface resize contribution ceiling (keeps resize < add/remove). */
  resizeCap: 20,
  /** Policy step 3: adding/removing one supporting surface. */
  addRemove: 25,
  /** Policy step 4: moving one surface to another general screen region. */
  move: 50,
  /** Policy step 5: template identity change (always the most expensive). */
  templateChange: 100,
} as const;

/** Optional signals that justify movement. Defaults are agent-only. */
export interface InertiaContext {
  /** A user-initiated change always applies (user overrides beat policy). */
  userInitiated?: boolean;
  /** Material user activity change may justify a template change. */
  materialActivityChange?: boolean;
}

export interface InertiaVerdict {
  decision: InertiaDecision;
  /** Total movement cost (>= 0). Deterministic. */
  cost: number;
  /** Stable, human-readable explanation (also used in tests). */
  reason: string;
}

const DEFAULT_PROPORTION: Proportion = "balanced";

function proportionOf(spec: LayoutSpec): Proportion {
  return spec.proportion ?? DEFAULT_PROPORTION;
}

/** Primary surfaceIds as a sorted, order-insensitive set (split equal
 *  two-primaries included). */
function primaryIds(spec: LayoutSpec): string[] {
  return spec.assignments
    .filter((a) => a.role === "primary")
    .map((a) => a.surfaceId)
    .sort();
}

/** Deterministic satisfactory check: the requested spec keeps the same
 *  primary set the current layout serves. */
export function isSatisfactory(
  current: LayoutSpec | null,
  requested: LayoutSpec,
): boolean {
  if (!current) return false; // nothing to preserve
  const a = primaryIds(current);
  const b = primaryIds(requested);
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Frozen rects for a spec's slots (fractions of the stage). */
function rectsOf(spec: LayoutSpec): Record<string, Rect> {
  const equalSplit =
    spec.template === "split" &&
    spec.assignments.filter((a) => a.role === "primary").length >= 2;
  return computeTemplateRects(spec.template, proportionOf(spec), {
    equalSplit,
  });
}

/** L1 distance between two rects (fractions). */
function rectDelta(a: Rect, b: Rect): number {
  return (
    Math.abs(a.x - b.x) +
    Math.abs(a.y - b.y) +
    Math.abs(a.width - b.width) +
    Math.abs(a.height - b.height)
  );
}

/**
 * Score a requested layout change against the current layout.
 *
 * Precondition: both specs are valid (validateLayoutSpec); the store calls
 * this AFTER resolveLayout, and tests use the frozen fixtures. Invalid
 * specs are not this module's concern (they never reach layout state).
 *
 * @param current   The layout currently applied (null on first placement).
 * @param requested The agent-requested layout.
 * @param context   Optional justification signals (default: agent-only).
 * @returns A deterministic verdict: decision, total movement cost, reason.
 */
export function scoreChange(
  current: LayoutSpec | null,
  requested: LayoutSpec,
  context: InertiaContext = {},
): InertiaVerdict {
  if (context.userInitiated) {
    return {
      decision: "apply",
      cost: 0,
      reason: "user-initiated change — user overrides beat policy",
    };
  }
  if (!current) {
    return {
      decision: "apply",
      cost: 0,
      reason: "initial layout — no prior composition to preserve",
    };
  }

  // ---- movement cost ----------------------------------------------------
  const curRects = rectsOf(current);
  const reqRects = rectsOf(requested);
  const curBySurface = new Map(
    current.assignments.map((a) => [a.surfaceId, a.slot]),
  );
  const reqBySurface = new Map(
    requested.assignments.map((a) => [a.surfaceId, a.slot]),
  );

  let cost = 0;
  let moved = 0;
  let addedRemoved = 0;

  // Surfaces present in both: same region -> resize delta, else move.
  for (const [surfaceId, curSlot] of curBySurface) {
    const reqSlot = reqBySurface.get(surfaceId);
    if (reqSlot === undefined) {
      addedRemoved += 1;
      continue;
    }
    if (reqSlot !== curSlot) {
      moved += 1;
      continue;
    }
    const delta = rectDelta(curRects[curSlot], reqRects[reqSlot]);
    cost += Math.min(delta * INERTIA_COSTS.resizeScale, INERTIA_COSTS.resizeCap);
  }
  // Surfaces only in the requested layout: added.
  for (const [surfaceId] of reqBySurface) {
    if (!curBySurface.has(surfaceId)) addedRemoved += 1;
  }

  cost += addedRemoved * INERTIA_COSTS.addRemove;
  cost += moved * INERTIA_COSTS.move;
  const templateChanged = current.template !== requested.template;
  if (templateChanged) cost += INERTIA_COSTS.templateChange;

  // ---- decision ----------------------------------------------------------
  if (cost === 0) {
    return {
      decision: "keep",
      cost,
      reason: "equivalent layout — no movement, keeping current composition",
    };
  }

  if (!templateChanged && moved === 0 && cost < INERTIA_COSTS.addRemove) {
    return {
      decision: "resize",
      cost,
      reason: "resize existing region only (policy step 2)",
    };
  }

  if (!templateChanged && moved === 0 && cost < INERTIA_COSTS.move) {
    return {
      decision: "adjust",
      cost,
      reason: "add/remove supporting region only (policy step 3)",
    };
  }

  // Movement or template change: only justified by a real signal.
  const satisfactory = isSatisfactory(current, requested);
  const justified =
    context.materialActivityChange === true || !satisfactory;
  if (justified) {
    return {
      decision: "apply",
      cost,
      reason: satisfactory
        ? "material user activity change justifies the template change"
        : "primary activity changed — agent is re-focusing the interface",
    };
  }
  return {
    decision: "keep",
    cost,
    reason:
      "change requires moving surfaces or changing template, but the " +
      "current layout is satisfactory and no user activity change " +
      "justifies it — agent response alone is not sufficient reason to " +
      "rearrange",
  };
}
