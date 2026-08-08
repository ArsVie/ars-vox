/**
 * UI-302 — User layout overrides (Wave 3, 2026-08-08).
 *
 * Explicit user constraints on agent composition, with NO window-manager UI:
 * the user speaks ("make this bigger", "put this on the right", "close
 * this"...) and the agent interprets the intent INTO an OverrideIntent
 * (no NLU lives here — interpretation is UI-301's job). This module is the
 * client-side override model: constraint representation, intent → constraint
 * mapping, constraint-set operations (add / remove / clear), and the
 * deterministic application pipeline that sits ON TOP of the planner's
 * output (UI-301's layer).
 *
 * LAYERING (frozen)
 *   The store's applyAdaptiveSpec is the single choke point:
 *     1. planner (UI-301) proposes a LayoutSpec;
 *     2. this module applies the persistent user constraint set AFTER it —
 *        explicit user constraints BEAT planner preferences;
 *     3. invalid constrained arrangements degrade deterministically to the
 *        NEAREST VALID template (via the existing frozen validateLayoutSpec);
 *     4. the constrained spec (not the raw planner output) is what the
 *        UI-207 inertia scorer sees and what becomes layout state.
 *
 * CONSTRAINT MODEL
 *   One SurfaceConstraint per surfaceId, composed of orthogonal fields:
 *     pin       — the surface must stay in the composition (the planner may
 *                 not drop it).
 *     stick     — the surface must stay in this exact slot ("main" | "side"
 *                 | "rail"). Implies pin (a stuck surface must be present).
 *     position  — "left" → the surface becomes the main primary ("put this
 *                 on the left"); "right" → the surface becomes the side
 *                 companion ("put this on the right").
 *     size      — "bigger"/"smaller": slot-aware proportion intent ("make
 *                 this bigger/smaller").
 *     remove    — the surface must be absent ("close this").
 *     fullscreen— the surface alone in the focus template ("full screen").
 *     showBoth  — the surface shares a split with the current primary
 *                 ("show both").
 *   Composition-level constraints (remove / fullscreen / showBoth) replace
 *   the surface's previous constraint; granular constraints (pin / stick /
 *   position / size) merge field-wise, so "keep it here" + "make it bigger"
 *   coexist on one surface. Constraint state persists across planner rounds
 *   until removed (removeSurfaceOverrides / "restore layout" intent).
 *
 * APPLICATION RULES (frozen, deterministic)
 *   1. Removals apply first and are absolute — a removed surface cannot be
 *      re-added by any other constraint. A removal that would empty the
 *      layout degrades to the unconstrained planner composition (an empty
 *      arrangement is not valid, so the nearest valid one keeps the surface).
 *   2. fullscreen replaces the composition with focus{target}. showBoth
 *      replaces it with split{target + partner as co-primaries}. Both ignore
 *      all other constraints except removals (which win).
 *   3. Otherwise constraints apply over the planner output in surfaceId
 *      sorted order: pin re-adds dropped surfaces as side companions; stick
 *      forces the slot; position rewrites the target's slot+role (left:
 *      target → main primary, previous main occupant → side companion; right:
 *      target → side companion, first other surface promoted into main — a
 *      no-op when the target is the ONLY surface); size maps the target's
 *      slot to a proportion (main: bigger→wide, smaller→narrow; side:
 *      inverted — the side region grows when the primary shrinks).
 *   4. The candidate then degrades to the NEAREST VALID template: the
 *      candidate's own template first, then ascending slot count (focus →
 *      sidecar → stack → split → triple). Projection: constrained surfaces
 *      keep their slot (a template that cannot host a stick constraint is
 *      skipped); slot conflicts resolve constrained-first, then stable order;
 *      unconstrained surfaces rehome to the first free slot or are dropped;
 *      primary-count repair promotes the first assignment into main when the
 *      layout has no primary, and demotes extra primaries to companion.
 *   5. If no template can host the constrained composition, the constraint
 *      set degrades to the unconstrained planner composition (fallback).
 *
 * Everything here is pure and deterministic — no React, no time, no
 * randomness. Identical inputs always produce identical outputs.
 */

import {
  TEMPLATE_SLOTS,
  validateLayoutSpec,
  type AdaptiveTemplate,
  type LayoutAssignment,
  type LayoutSpec,
  type Proportion,
} from "./contracts";

/** Slot vocabulary in canonical (left-to-right) order. */
const SLOT_ORDER: readonly string[] = ["main", "side", "rail"];

/** Canonical template order by ascending slot count (nearest = smallest
 *  template that can host the constrained composition). */
const TEMPLATE_ORDER: readonly AdaptiveTemplate[] = [
  "focus",
  "sidecar",
  "stack",
  "split",
  "triple",
];

/* ------------------------------------------------------------ intents */

/**
 * The eight frozen user intents (plus "restore layout"). The surfaceId is
 * resolved by the agent (UI-301 interprets "this"); the constraint mapping
 * below is pure.
 */
export type OverrideIntent =
  | { kind: "restore" }
  | {
      kind:
        | "bigger"
        | "smaller"
        | "right"
        | "left"
        | "keep"
        | "showBoth"
        | "close"
        | "fullscreen";
      surfaceId: string;
    };

/* ------------------------------------------------------- constraint model */

/** Per-surface user constraint. All fields optional; the empty object is a
 *  no-op constraint. See the module header for field semantics. */
export interface SurfaceConstraint {
  surfaceId: string;
  /** The surface must stay in the composition (planner may not drop it). */
  pin?: boolean;
  /** The surface must stay in this exact slot ("main" | "side" | "rail"). */
  stick?: string;
  /** "left" → main primary; "right" → side companion. */
  position?: "left" | "right";
  /** Slot-aware proportion intent: "bigger" | "smaller". */
  size?: "bigger" | "smaller";
  /** The surface must be absent ("close this"). Absolute. */
  remove?: boolean;
  /** The surface alone in the focus template ("full screen"). */
  fullscreen?: boolean;
  /** The surface shares a split with the current primary ("show both"). */
  showBoth?: boolean;
}

/** The persistent constraint set: one constraint per surfaceId. */
export interface OverrideSet {
  bySurface: Record<string, SurfaceConstraint>;
}

export const EMPTY_OVERRIDES: OverrideSet = { bySurface: {} };

export function isOverridesEmpty(set: OverrideSet): boolean {
  return Object.keys(set.bySurface).length === 0;
}

/** Constraints in canonical (surfaceId sorted) order — deterministic
 *  application regardless of insertion order. */
function sortedConstraints(overrides: OverrideSet): SurfaceConstraint[] {
  return Object.values(overrides.bySurface).sort((a, b) =>
    a.surfaceId.localeCompare(b.surfaceId),
  );
}

/* ------------------------------------------------------- intent mapping */

/**
 * Map a frozen user intent to its constraint patch.
 *
 * "keep it here" needs the CURRENT composition to learn the slot being
 * stuck to — pass the planner/current spec as `base` (null when none).
 * "restore layout" maps to null (the store clears the whole set instead).
 */
export function intentToConstraint(
  intent: OverrideIntent,
  base: LayoutSpec | null,
): SurfaceConstraint | null {
  if (intent.kind === "restore") return null;
  const { surfaceId } = intent;
  switch (intent.kind) {
    case "bigger":
      return { surfaceId, size: "bigger" };
    case "smaller":
      return { surfaceId, size: "smaller" };
    case "right":
      return { surfaceId, position: "right" };
    case "left":
      return { surfaceId, position: "left" };
    case "keep": {
      const slot = base?.assignments.find((a) => a.surfaceId === surfaceId)?.slot;
      // "keep it here" = pinned in place; with no current slot it still pins.
      return slot ? { surfaceId, pin: true, stick: slot } : { surfaceId, pin: true };
    }
    case "showBoth":
      return { surfaceId, showBoth: true };
    case "close":
      return { surfaceId, remove: true };
    case "fullscreen":
      return { surfaceId, fullscreen: true };
  }
}

/**
 * Merge one constraint into a set (returns a NEW set; the input is never
 * mutated). Composition-level intents (remove / fullscreen / showBoth)
 * replace the surface's previous constraint; granular intents merge
 * field-wise. `base` is the current planner/current spec ("keep" needs the
 * slot). The "restore" intent clears the whole set.
 */
export function mergeOverrideIntent(
  overrides: OverrideSet,
  intent: OverrideIntent,
  base: LayoutSpec | null,
): OverrideSet {
  if (intent.kind === "restore") return EMPTY_OVERRIDES;
  const next = intentToConstraint(intent, base);
  if (!next) return overrides;
  return { bySurface: { ...overrides.bySurface, [next.surfaceId]: mergeConstraint(overrides.bySurface[next.surfaceId], next) } };
}

function mergeConstraint(
  prev: SurfaceConstraint | undefined,
  next: SurfaceConstraint,
): SurfaceConstraint {
  // Composition-level intents replace everything the surface had.
  if (!prev || next.remove || next.fullscreen || next.showBoth) return next;
  // A fresh granular intent clears a stale composition-level constraint
  // ("keep it here" after "close this" brings the surface back).
  if (prev.remove || prev.fullscreen || prev.showBoth) return next;
  return { ...prev, ...next };
}

/** Remove every constraint for one surface (returns a NEW set; no-op when
 *  the surface is unconstrained — the input reference is returned). */
export function removeSurfaceOverrides(
  overrides: OverrideSet,
  surfaceId: string,
): OverrideSet {
  if (!overrides.bySurface[surfaceId]) return overrides;
  const bySurface = { ...overrides.bySurface };
  delete bySurface[surfaceId];
  return { bySurface };
}

/* -------------------------------------------------- application pipeline */

/**
 * Apply the user constraint set ON TOP of the planner's output.
 *
 * `base` must be a valid LayoutSpec (planner output — invalid specs still
 * throw, preserving the UI-103 "invalid spec never reaches state" contract).
 * Returns `base` UNCHANGED (same reference) when no constraints are active,
 * so unconstrained agent chatter keeps its exact zero-churn semantics.
 *
 * @param base       The planner's proposed layout (UI-301's layer).
 * @param overrides  The persistent user constraint set.
 * @param registered Registered surface ids (feed the frozen validation).
 */
export function applyOverrides(
  base: LayoutSpec,
  overrides: OverrideSet,
  registered: ReadonlySet<string>,
): LayoutSpec {
  if (isOverridesEmpty(overrides)) return base;
  // Planner garbage still throws — constraint application never masks it.
  validateLayoutSpec(base, registered);

  const constraints = sortedConstraints(overrides);
  const removeIds = new Set(
    constraints.filter((c) => c.remove).map((c) => c.surfaceId),
  );

  // Rule 2a — fullscreen replaces the composition (removals still win).
  const fullscreen = constraints.find(
    (c) => c.fullscreen === true && !removeIds.has(c.surfaceId),
  );
  if (fullscreen) {
    return {
      ...base,
      template: "focus",
      assignments: [
        { surfaceId: fullscreen.surfaceId, role: "primary", slot: "main" },
      ],
    };
  }

  // Rule 2b — showBoth replaces the composition with a two-primary split.
  const showBoth = constraints.find(
    (c) => c.showBoth === true && !removeIds.has(c.surfaceId),
  );
  if (showBoth) {
    const survivors = base.assignments.filter(
      (a) => !removeIds.has(a.surfaceId),
    );
    const basePrimary = survivors.find((a) => a.role === "primary");
    const partner =
      basePrimary && basePrimary.surfaceId !== showBoth.surfaceId
        ? basePrimary
        : survivors.find((a) => a.surfaceId !== showBoth.surfaceId);
    return {
      ...base,
      template: "split",
      assignments: partner
        ? [
            { surfaceId: partner.surfaceId, role: "primary", slot: "main" },
            { surfaceId: showBoth.surfaceId, role: "primary", slot: "side" },
          ]
        : [{ surfaceId: showBoth.surfaceId, role: "primary", slot: "main" }],
    };
  }

  // Rule 1 — removals first (absolute).
  let assignments = base.assignments.filter((a) => !removeIds.has(a.surfaceId));
  let template = base.template;
  let proportion: Proportion | null | undefined = base.proportion;

  // Rule 3 — pin/stick re-add surfaces the planner dropped (side companions;
  // a template without a side slot is skipped by the repair step).
  for (const c of constraints) {
    if (
      (c.pin === true || c.stick !== undefined) &&
      !removeIds.has(c.surfaceId) &&
      !assignments.some((a) => a.surfaceId === c.surfaceId)
    ) {
      assignments = [
        ...assignments,
        { surfaceId: c.surfaceId, role: "companion", slot: c.stick ?? "side" },
      ];
    }
  }

  // Rule 3 — stick: force the slot.
  for (const c of constraints) {
    if (c.stick === undefined || removeIds.has(c.surfaceId)) continue;
    assignments = assignments.map((a) =>
      a.surfaceId === c.surfaceId ? { ...a, slot: c.stick as string } : a,
    );
  }

  // Rule 3 — position: rewrite the target's slot + role.
  for (const c of constraints) {
    if (c.position === undefined || removeIds.has(c.surfaceId)) continue;
    if (c.position === "left") {
      // "put this on the left" → target becomes the main primary; the
      // previous main occupant moves to the side companion.
      const target = c.surfaceId;
      const others = assignments.filter((a) => a.surfaceId !== target);
      const oldMain = others.find((a) => a.slot === "main");
      const rest = others.filter((a) => a !== oldMain);
      const next: LayoutAssignment[] = [
        { surfaceId: target, role: "primary", slot: "main" },
      ];
      if (oldMain) {
        next.push({ surfaceId: oldMain.surfaceId, role: "companion", slot: "side" });
      }
      next.push(...rest);
      assignments = next;
    } else {
      // "put this on the right" → target becomes the side companion; the
      // first other surface is promoted into main. Moving the ONLY surface
      // right would leave the main region empty — a no-op (nearest valid
      // arrangement is the current one).
      const target = c.surfaceId;
      const others = assignments.filter((a) => a.surfaceId !== target);
      if (others.length === 0) continue;
      const wasMain = assignments.some(
        (a) => a.surfaceId === target && a.slot === "main",
      );
      const next: LayoutAssignment[] = [
        { surfaceId: target, role: "companion", slot: "side" },
      ];
      if (wasMain) {
        const promoted = others[0];
        next.push({ surfaceId: promoted.surfaceId, role: "primary", slot: "main" });
        next.push(...others.slice(1));
      } else {
        next.push(...others);
      }
      assignments = next;
    }
  }

  // Rule 3 — size: the first size-constrained surface (canonical order)
  // sets the primary-region proportion, slot-aware.
  const sizeC = constraints.find(
    (c) => c.size !== undefined && !removeIds.has(c.surfaceId),
  );
  if (sizeC) {
    const target = assignments.find((a) => a.surfaceId === sizeC.surfaceId);
    const inMain = target !== undefined && target.slot === "main";
    proportion =
      sizeC.size === "bigger" ? (inMain ? "wide" : "narrow") : inMain ? "narrow" : "wide";
  }

  const candidate: LayoutSpec = { ...base, template, assignments, proportion };
  return degradeToNearestValid(candidate, registered, base, constraints);
}

/* ----------------------------------------------- degrade to nearest valid */

function isValid(spec: LayoutSpec, registered: ReadonlySet<string>): boolean {
  try {
    validateLayoutSpec(spec, registered);
  } catch {
    return false;
  }
  // Composition conflicts: the frozen validator checks slot membership but
  // not slot uniqueness — a valid arrangement hosts at most one surface per
  // slot (two surfaces claiming one region is exactly the kind of invalid
  // arrangement the degrade step must repair).
  const slots = spec.assignments.map((a) => a.slot);
  return new Set(slots).size === slots.length;
}

/** Templates to try, nearest first: the candidate's own template, then
 *  ascending slot count (smallest template that can host the composition). */
function templateOrder(candidateTemplate: AdaptiveTemplate): AdaptiveTemplate[] {
  return [candidateTemplate, ...TEMPLATE_ORDER.filter((t) => t !== candidateTemplate)];
}

/**
 * Deterministic nearest-valid degradation for a constrained arrangement.
 *
 * The candidate's own template is tried first; then templates with more
 * slots (focus → sidecar → stack → split → triple). Projection rules:
 *  - constrained surfaces (pin/stick/position/size) place before unconstrained
 *    ones and keep their slot; a template that cannot host every stick
 *    constraint is skipped;
 *  - slot conflicts resolve constrained-first, then stable order; the loser
 *    rehomes to the first free slot (main → side → rail);
 *  - unconstrained surfaces the template cannot host are dropped (the planner
 *    may re-propose them next round — that is what pin prevents);
 *  - primary-count repair: zero primaries → the first assignment is promoted
 *    to primary in main; too many primaries → extras demote to companion.
 * When NO template can host the arrangement (e.g. every surface removed),
 * the unconstrained planner composition is returned.
 *
 * @param candidate   The constrained arrangement (possibly invalid).
 * @param registered  Registered surface ids (frozen validation).
 * @param fallback    The unconstrained planner composition (deterministic
 *                    fallback when nothing valid exists).
 * @param constraints The active constraint set (drives projection priority).
 */
export function degradeToNearestValid(
  candidate: LayoutSpec,
  registered: ReadonlySet<string>,
  fallback: LayoutSpec,
  constraints: readonly SurfaceConstraint[],
): LayoutSpec {
  if (candidate.assignments.length === 0) return fallback;
  if (isValid(candidate, registered)) return candidate;
  for (const t of templateOrder(candidate.template)) {
    const projected = projectOntoTemplate(candidate, t, constraints);
    if (projected && isValid(projected, registered)) return projected;
  }
  return fallback;
}

function projectOntoTemplate(
  candidate: LayoutSpec,
  template: AdaptiveTemplate,
  constraints: readonly SurfaceConstraint[],
): LayoutSpec | null {
  const offered = TEMPLATE_SLOTS[template];

  // A template that cannot host every stick constraint is not a candidate.
  for (const c of constraints) {
    if (
      c.stick !== undefined &&
      !c.remove &&
      c.fullscreen !== true &&
      c.showBoth !== true &&
      !offered.includes(c.stick)
    ) {
      return null;
    }
  }

  const slotLoyalIds = new Set(
    constraints
      .filter(
        (c) =>
          !c.remove &&
          c.fullscreen !== true &&
          c.showBoth !== true &&
          (c.stick !== undefined || c.position !== undefined),
      )
      .map((c) => c.surfaceId),
  );
  const pinOnlyIds = new Set(
    constraints
      .filter(
        (c) =>
          !c.remove &&
          c.fullscreen !== true &&
          c.showBoth !== true &&
          c.pin === true &&
          c.stick === undefined &&
          c.position === undefined,
      )
      .map((c) => c.surfaceId),
  );
  // "Must place or fail this template": both slot-loyal and pin-only
  // surfaces are constrained — a template that cannot host them is skipped.
  const constrainedIds = new Set([...slotLoyalIds, ...pinOnlyIds]);

  // Placement order: slot-loyal surfaces first (they claim their slot), then
  // the planner's own arrangement, then pin-only re-adds (no slot loyalty —
  // they fill the first free slot, so a pinned companion never displaces the
  // planner's primary; instead the template degrades to one with room).
  const slotLoyal: LayoutAssignment[] = [];
  const free: LayoutAssignment[] = [];
  const pinOnly: LayoutAssignment[] = [];
  for (const a of candidate.assignments) {
    if (slotLoyalIds.has(a.surfaceId)) slotLoyal.push(a);
    else if (pinOnlyIds.has(a.surfaceId)) pinOnly.push(a);
    else free.push(a);
  }

  const placed: LayoutAssignment[] = [];
  const owner = new Map<string, LayoutAssignment>();

  const place = (a: LayoutAssignment): boolean => {
    const trySlots = [...new Set([a.slot, ...offered])].filter((s) =>
      offered.includes(s),
    );
    for (const slot of trySlots) {
      if (!owner.has(slot)) {
        const entry = { ...a, slot };
        owner.set(slot, entry);
        placed.push(entry);
        return true;
      }
    }
    return false;
  };

  for (const a of [...slotLoyal, ...free, ...pinOnly]) {
    if (!place(a)) {
      // Unconstrained surfaces are dropped when no slot is free; a
      // constrained surface that cannot be placed fails this template.
      if (constrainedIds.has(a.surfaceId)) return null;
    }
  }

  if (placed.length === 0) return null;

  // Primary-count repair — the frozen "exactly one primary (1..2 for split)"
  // invariant. Zero primaries: promote the first assignment into main.
  const primaries = placed.filter((a) => a.role === "primary");
  if (primaries.length === 0) {
    const promoted = placed[0];
    const mainOwner = owner.get("main");
    if (mainOwner && mainOwner.surfaceId !== promoted.surfaceId) {
      // Swap: the promoted surface takes main; the evicted occupant takes
      // the promoted surface's former slot.
      const formerSlot = promoted.slot;
      owner.delete(formerSlot);
      owner.delete("main");
      owner.set("main", promoted);
      owner.set(formerSlot, mainOwner);
      promoted.slot = "main";
      mainOwner.slot = formerSlot;
    } else if (!mainOwner) {
      owner.delete(promoted.slot);
      owner.set("main", promoted);
      promoted.slot = "main";
    }
    promoted.role = "primary";
  } else {
    const maxPrimaries = template === "split" ? 2 : 1;
    for (const extra of primaries.slice(maxPrimaries)) {
      extra.role = "companion";
    }
  }

  return {
    ...candidate,
    template,
    assignments: placed,
  };
}
