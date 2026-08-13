/**
 * UI-301 — Agent layout planner: semantic composition authority WITHOUT
 * visual control (Wave 3).
 *
 * The agent may express WHAT it wants — template id, surface-role
 * assignments, allowed proportion — never HOW it looks (no pixels, no CSS,
 * no coordinates). This module is the CLIENT-SIDE interpretation layer
 * between the wire (ui_command/layout.apply, legacy vocabulary — GATE-2.5
 * H1) and the frozen adaptive contract (LayoutSpec, UI-000):
 *
 *   1. intent → LayoutSpec mapping (deterministic, documented below);
 *   2. deterministic validation through the EXISTING frozen gates
 *      (validateLayoutSpec + computeAdaptiveGeometry in
 *      ../layout/adaptiveEngine.ts);
 *   3. structured rejection reasons instead of throwing — invalid model
 *      output can NEVER corrupt layout state.
 *
 * Planner output is the PREFERENCE layer: the store applies it only through
 * the UI-207 spatial-inertia guard (agent-initiated changes stay subject to
 * inertia). UI-302's user-override model composes ON TOP of this module —
 * it is not wired here.
 *
 * WIRE VOCABULARY MAPPING (deterministic, documented):
 *   focus → focus | split → split | reading → sidecar | dashboard → triple
 *   reference → sidecar | background_media → triple
 *   primary_panel   → { role: "primary",   slot: "main" }
 *   secondary_panel → { role: "companion", slot: "side" }
 *   slots.main → primary | slots.side → companion | slots.rail → support
 *   slots.dock → DROPPED with a note (no adaptive slot exists; persistent
 *     surfaces are shell-owned — media is persistent-capable, UI-205).
 *   slots WIN over primary/secondary (mirrors the legacy engine rule).
 *   preserve → ignored (adaptive spec is a full composition; mounting is a
 *     legacy-engine concern).
 *
 * REJECTION EXAMPLES (stable codes, deterministic reasons):
 *   invalid_template   — template "hologram" is not a known id
 *   invalid_role       — role "persistent" is shell-owned; a surface asked
 *                        for a role it cannot render (no ladder fallback)
 *   invalid_slot       — slot "rail" is not offered by template "focus"
 *   unregistered_surface — surface "ghost" is not in the registry
 *   invalid_primary    — two primaries in sidecar (only split may pair)
 *   geometry           — template cannot fit the stage px floors
 *
 * RECONCILE (B1, 2026-08-13): reconcileLayout() diffs a desired LayoutSpec
 * against the committed one PER SURFACE ID — unchanged surfaces keep their
 * identity (surfaceId-keyed identity contract + no-change-during-reading
 * rule), removed surfaces are the disposal cue, added surfaces the mount
 * cue. Dependency specs: registry entries may declare a PURE
 * requires(snapshot) predicate (roles/registry.ts); a desired surface whose
 * requirement the snapshot does not satisfy is DROPPED with code
 * requirement_unsatisfied (never thrown mid-way). The snapshot is
 * caller-supplied (the store's wiring builds it): an ABSENT snapshot or
 * registry means requirements are NOT consulted — every existing call site
 * and behavior is preserved.
 */

import type { LayoutSlotsWire } from "../contracts";
import type { AnyTemplate, PanelId } from "../contracts";
import {
  ASSIGNABLE_ROLES,
  EQUAL_SPLIT_TEMPLATES,
  TEMPLATE_SLOTS,
  validateLayoutSpec,
  type AdaptiveTemplate,
  type LayoutAssignment,
  type LayoutSpec,
  type Proportion,
  type SurfaceRole,
} from "./contracts";
import {
  computeAdaptiveGeometry,
  type Viewport,
} from "../layout/adaptiveEngine";
import { resolveRole } from "../roles/fallback";
import type {
  SurfaceRequirement,
  SurfaceRequirementSnapshot,
} from "../roles/registry";

/** Shell default viewport until the renderer reports real size (matches
 *  the store's DEFAULT_VIEWPORT; kept local to avoid an import cycle). */
export const DEFAULT_PLANNER_VIEWPORT: Viewport = { width: 1280, height: 800 };

/**
 * Adaptive-native semantic intent — the agent's ALLOWED output vocabulary.
 * Same shape as the frozen LayoutSpec; the planner validates it before it
 * may become one.
 */
export interface LayoutIntent {
  template: AdaptiveTemplate;
  assignments: LayoutAssignment[];
  proportion?: Proportion | null;
}

/** Legacy wire payload of ui_command/layout.apply (H1) — accepted directly,
 *  mapped to the adaptive vocabulary deterministically. */
export interface WireLayoutIntent {
  template: AnyTemplate;
  primary_panel: PanelId | null;
  secondary_panel: PanelId | null;
  slots?: LayoutSlotsWire | null;
  preserve?: boolean;
}

/** Anything the planner accepts: adaptive-native or legacy wire shape. */
export type PlannerInput = LayoutIntent | WireLayoutIntent;

/** Stable rejection codes — deterministic, human-readable, tested. */
export type PlannerRejectionCode =
  | "invalid_shape"
  | "invalid_template"
  | "invalid_proportion"
  | "invalid_role"
  | "invalid_slot"
  | "invalid_assignment"
  | "invalid_primary"
  | "unregistered_surface"
  | "geometry"
  | "requirement_unsatisfied";

export interface PlannerRejection {
  code: PlannerRejectionCode;
  /** Stable, human-readable explanation (never thrown). */
  reason: string;
}

export type PlannerResult =
  | { ok: true; spec: LayoutSpec; notes: string[] }
  | { ok: false; rejection: PlannerRejection };

/** Minimal registry view the planner needs (SurfaceRegistry satisfies it
 *  structurally — see ../roles/registry.ts). */
export interface PlannerRegistry {
  registeredIds(): ReadonlySet<string>;
  capabilitiesOf(surfaceId: string): readonly SurfaceRole[];
  /** B1 dependency specs: the placement requirement predicate a surface
   *  declares, or undefined. OPTIONAL so every existing structural consumer
   *  keeps satisfying this interface (createSurfaceRegistry always provides
   *  it); when absent, reconcileLayout cannot consult requirements. */
  requiresOf?(surfaceId: string): SurfaceRequirement | undefined;
}

/** Deterministic legacy-wire template → adaptive template mapping.
 *  ⛔ NON-AUTHORITATIVE compatibility adapter (GATE-3.5, R22): it exists
 *  ONLY to keep the legacy wire vocabulary (layout.apply, config
 *  default_template) flowing through the planner into the ONE choke.
 *  DELETION TASK (program rule 4): remove with the legacy wire vocabulary
 *  once A3's native LayoutSpec tool is the only agent surface (GATE-3.5
 *  merge) and config templates speak adaptive ids. Do NOT extend. */
export const LEGACY_TEMPLATE_MAP: Record<string, AdaptiveTemplate> = {
  focus: "focus",
  split: "split",
  reading: "sidecar",
  dashboard: "triple",
  reference: "sidecar",
  background_media: "triple",
};

/** Wire slot → semantic role (dock intentionally absent). */
const WIRE_SLOT_ROLE: Record<string, SurfaceRole> = {
  main: "primary",
  side: "companion",
  rail: "support",
};

function reject(code: PlannerRejectionCode, reason: string): PlannerResult {
  return { ok: false, rejection: { code, reason } };
}

/** Resolve an adaptive template id or a legacy wire id. Unknown → null. */
function resolveTemplate(template: string): AdaptiveTemplate | null {
  if (template in TEMPLATE_SLOTS) return template as AdaptiveTemplate;
  return LEGACY_TEMPLATE_MAP[template] ?? null;
}

/** Derive semantic assignments from the legacy wire fields (slots win). */
function wireAssignments(
  wire: WireLayoutIntent,
  template: AdaptiveTemplate,
  notes: string[],
): LayoutAssignment[] {
  const built: LayoutAssignment[] = [];
  if (wire.slots) {
    for (const slot of ["main", "side", "rail"] as const) {
      const surfaceId = wire.slots[slot];
      if (surfaceId == null) continue;
      built.push({ surfaceId, role: WIRE_SLOT_ROLE[slot], slot });
    }
    if (wire.slots.dock != null) {
      notes.push(
        `wire slot "dock" (${wire.slots.dock}) has no adaptive equivalent — ` +
          "dropped (persistent surfaces are shell-owned)",
      );
    }
    // slots wins over primary/secondary, but main is mandatory: when the
    // wire omitted it, fall back to primary_panel (legacy engine rule).
    if (!built.some((a) => a.slot === "main") && wire.primary_panel) {
      built.push({ surfaceId: wire.primary_panel, role: "primary", slot: "main" });
    }
  } else {
    if (wire.primary_panel) {
      built.push({ surfaceId: wire.primary_panel, role: "primary", slot: "main" });
    }
    if (wire.secondary_panel) {
      built.push({ surfaceId: wire.secondary_panel, role: "companion", slot: "side" });
    }
  }
  return built;
}

/**
 * Plan a layout intent: map it to a LayoutSpec, validate it deterministically
 * through the frozen gates (validateLayoutSpec + computeAdaptiveGeometry),
 * and return either the validated spec or a structured rejection.
 *
 * Pure: identical inputs (intent, registry, viewport) always produce
 * identical results — no time, no randomness, no side effects.
 *
 * @param input    Adaptive-native LayoutIntent or legacy wire layout.apply
 *                 payload (ui_command/layout.apply, H1).
 * @param registry Surface registry (ids + role capabilities).
 * @param opts     Optional viewport for the geometry px-floor gate (defaults
 *                 to the shell default 1280×800).
 */
export function planLayout(
  input: PlannerInput,
  registry: PlannerRegistry,
  opts: { viewport?: Viewport } = {},
): PlannerResult {
  const viewport = opts.viewport ?? DEFAULT_PLANNER_VIEWPORT;
  const notes: string[] = [];

  // ---- shape ------------------------------------------------------------
  if (!input || typeof input !== "object") {
    return reject("invalid_shape", "layout intent must be an object");
  }
  const rawTemplate = (input as { template?: unknown }).template;
  if (typeof rawTemplate !== "string" || rawTemplate.length === 0) {
    return reject("invalid_shape", "layout intent requires a template id");
  }

  // ---- template ----------------------------------------------------------
  const template = resolveTemplate(rawTemplate);
  if (!template) {
    return reject(
      "invalid_template",
      `unknown template "${rawTemplate}" (adaptive: focus, sidecar, stack, ` +
        "split, triple; legacy wire: reading, dashboard, reference, " +
        "background_media)",
    );
  }

  // ---- proportion --------------------------------------------------------
  const rawProportion = (input as { proportion?: unknown }).proportion;
  let proportion: Proportion | null = null;
  if (rawProportion != null) {
    if (
      rawProportion !== "narrow" &&
      rawProportion !== "balanced" &&
      rawProportion !== "wide"
    ) {
      return reject(
        "invalid_proportion",
        `unknown proportion "${String(rawProportion)}" (allowed: narrow, balanced, wide)`,
      );
    }
    proportion = rawProportion;
  }

  // ---- assignments -------------------------------------------------------
  let assignments: LayoutAssignment[];
  if ("assignments" in input && Array.isArray(input.assignments)) {
    assignments = input.assignments;
  } else {
    assignments = wireAssignments(input as WireLayoutIntent, template, notes);
  }
  if (assignments.length === 0) {
    return reject(
      "invalid_assignment",
      "layout requires at least one surface assignment",
    );
  }

  // ---- per-assignment validation (deterministic order) -------------------
  const seenSurfaces = new Set<string>();
  const seenSlots = new Set<string>();
  let primaries = 0;
  for (const a of assignments) {
    if (!a || typeof a.surfaceId !== "string" || a.surfaceId.length === 0) {
      return reject("invalid_assignment", "assignment requires a surfaceId");
    }
    if (a.role === "persistent") {
      return reject(
        "invalid_role",
        'role "persistent" is shell-owned and cannot be assigned to a template slot',
      );
    }
    if (!ASSIGNABLE_ROLES.has(a.role)) {
      return reject(
        "invalid_role",
        `unknown role "${String(a.role)}" (allowed: primary, companion, support)`,
      );
    }
    if (!TEMPLATE_SLOTS[template].includes(a.slot)) {
      return reject(
        "invalid_slot",
        `slot "${a.slot}" is not offered by template "${template}"`,
      );
    }
    if (seenSlots.has(a.slot)) {
      return reject("invalid_slot", `slot "${a.slot}" is assigned more than once`);
    }
    seenSlots.add(a.slot);
    if (seenSurfaces.has(a.surfaceId)) {
      return reject(
        "invalid_assignment",
        `surface "${a.surfaceId}" is assigned more than once`,
      );
    }
    seenSurfaces.add(a.surfaceId);
    if (a.role === "primary") primaries += 1;
    if (!registry.registeredIds().has(a.surfaceId)) {
      return reject(
        "unregistered_surface",
        `surface "${a.surfaceId}" is not registered`,
      );
    }
    const capabilities = registry.capabilitiesOf(a.surfaceId);
    if (!resolveRole(a.role, capabilities)) {
      return reject(
        "invalid_role",
        `surface "${a.surfaceId}" cannot render role "${a.role}" ` +
          `(capabilities: ${capabilities.join(", ") || "none"}, no ladder fallback)`,
      );
    }
  }

  // ---- primary-count rule (frozen contract) ------------------------------
  if (EQUAL_SPLIT_TEMPLATES.has(template)) {
    if (primaries < 1 || primaries > 2) {
      return reject(
        "invalid_primary",
        "split template requires one or two primary surfaces (equal split)",
      );
    }
  } else if (primaries !== 1) {
    return reject("invalid_primary", "exactly one primary surface is required");
  }

  const spec: LayoutSpec = { template, assignments, proportion };

  // ---- frozen deterministic gate -----------------------------------------
  // Every planner output MUST pass through the existing validation code
  // before any state change. Both gates are pure and deterministic.
  try {
    validateLayoutSpec(spec, registry.registeredIds());
    computeAdaptiveGeometry(spec, viewport, registry.registeredIds());
  } catch (error) {
    return reject("geometry", (error as Error).message);
  }

  return { ok: true, spec, notes };
}

/* ------------------------------------------------------------- reconcile */

/**
 * B1 — reconcile a desired spec against the committed one (per-surfaceId
 * diff, Cordis §5.2.1).
 *
 * Diff semantics are keyed by surfaceId, NOT by assignment equality:
 *  - unchangedSurfaceIds: surfaces present in both specs — they keep their
 *    identity (surfaceId-keyed identity contract + no-change-during-reading
 *    rule). A template change with identical assignments is still a change
 *    (the returned spec differs) but every surface is unchanged.
 *  - removedSurfaceIds: surfaces in `current` but not in the reconciled
 *    spec — the disposal cue (in `current` assignment order).
 *  - addedSurfaceIds: surfaces in the reconciled spec but not in `current`
 *    — the mount cue (in spec assignment order).
 *
 * Dependency specs (B1): when a `snapshot` AND a `registry` are supplied,
 * every desired surface's declared requires(snapshot) predicate is
 * consulted; a surface whose requirement is unsatisfied is DROPPED from the
 * composition with a structured rejection (code "requirement_unsatisfied",
 * surfaceId in the reason) — never thrown mid-way. Absent snapshot or
 * registry = requirements NOT consulted (all existing behavior preserved;
 * the snapshot is the caller's wiring concern).
 *
 * The desired spec is assumed already validated (planner output). Only the
 * requirement-filtered composition is re-gated through the frozen
 * validateLayoutSpec: when filtering invalidates it (no primary left, empty
 * composition), the committed `current` spec is kept untouched (no-op diff)
 * and the rejections still report why. With `current` null and nothing
 * valid left, the filtered spec is returned as-is — the caller's frozen
 * gate rejects it; nothing here throws.
 *
 * Pure and deterministic: identical inputs always produce identical
 * results — no time, no randomness, no side effects.
 */
export interface ReconcileResult {
  /** Spec to commit: the desired spec minus requirement-dropped surfaces
   *  (or the kept `current` when filtering invalidated the composition).
   *  With no drops it is the desired object itself. */
  spec: LayoutSpec;
  /** Mount cue — spec surfaces absent from `current`, in spec order. */
  addedSurfaceIds: string[];
  /** Disposal cue — `current` surfaces absent from the spec, in `current`
   *  order. */
  removedSurfaceIds: string[];
  /** Identity-preserved surfaces — present in both, in spec order. */
  unchangedSurfaceIds: string[];
  /** Structured reasons for requirement-dropped surfaces. Empty when the
   *  snapshot is absent or every requirement is satisfied. */
  rejections: PlannerRejection[];
}

export function reconcileLayout(
  desired: LayoutSpec,
  current: LayoutSpec | null,
  snapshot?: SurfaceRequirementSnapshot | null,
  registry?: PlannerRegistry,
): ReconcileResult {
  const rejections: PlannerRejection[] = [];

  // ---- requirement consultation (B1) ------------------------------------
  // Snapshot and registry are both required to consult; otherwise the
  // desired spec passes through untouched (existing call sites preserved).
  let spec: LayoutSpec = desired;
  if (snapshot != null && registry?.requiresOf) {
    const kept: LayoutAssignment[] = [];
    for (const assignment of desired.assignments) {
      const requires = registry.requiresOf(assignment.surfaceId);
      if (requires && !requires(snapshot)) {
        rejections.push({
          code: "requirement_unsatisfied",
          reason:
            `surface "${assignment.surfaceId}" has an unsatisfied placement ` +
            "requirement (requires(snapshot) returned false)",
        });
        continue;
      }
      kept.push(assignment);
    }
    if (kept.length !== desired.assignments.length) {
      spec = { ...desired, assignments: kept };
    }
  }

  // ---- deterministic validity fallback -----------------------------------
  // Dropping surfaces can break composition rules (no primary left, empty
  // composition). The frozen gate decides: an invalid filtered spec must
  // never be returned as the committed one — keep `current` instead.
  if (spec !== desired && registry) {
    try {
      validateLayoutSpec(spec, registry.registeredIds());
    } catch {
      if (current) spec = current;
      // current == null: no valid composition exists that satisfies the
      // requirements; return the filtered spec (caller's gate rejects it —
      // nothing here throws, per the header note above).
    }
  }

  // ---- per-surfaceId diff (deterministic order) --------------------------
  const specIds = spec.assignments.map((a) => a.surfaceId);
  const currentIds = current ? current.assignments.map((a) => a.surfaceId) : [];
  const currentSet = new Set(currentIds);
  const specSet = new Set(specIds);
  const addedSurfaceIds = specIds.filter((id) => !currentSet.has(id));
  const removedSurfaceIds = currentIds.filter((id) => !specSet.has(id));
  const unchangedSurfaceIds = specIds.filter((id) => currentSet.has(id));

  return {
    spec,
    addedSurfaceIds,
    removedSurfaceIds,
    unchangedSurfaceIds,
    rejections,
  };
}
