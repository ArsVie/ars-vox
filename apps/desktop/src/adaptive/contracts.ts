/**
 * Adaptive UI contract — TypeScript mirror (UI-000, 2026-08-07).
 *
 * Single source of truth: packages/contracts/arsvox_contracts/adaptive.py.
 * JSON schema: packages/contracts/schemas/adaptive-layout.schema.json (+
 * adaptive-surface-registration.schema.json). Cross-checked by
 * tests/adaptive-contract.test.ts — regenerate schemas before editing here.
 *
 * The agent may ONLY produce a LayoutSpec: template + surface-role
 * assignments + optional proportion. No pixels, no CSS, no coordinates.
 */

/** Semantic role a surface may occupy. Persistent = shell-owned. */
export type SurfaceRole = "primary" | "companion" | "support" | "persistent";

/** Allowed adaptive compositions (geometry owned by the implementation). */
export type AdaptiveTemplate = "focus" | "sidecar" | "stack" | "split" | "triple";

/** Allowed relative size of the primary region. */
export type Proportion = "narrow" | "balanced" | "wide";

/** Templates that explicitly support equal split (two primaries allowed). */
export const EQUAL_SPLIT_TEMPLATES: ReadonlySet<AdaptiveTemplate> = new Set([
  "split",
]);

/** Slots each template offers. Persistent surfaces are NOT template slots. */
export const TEMPLATE_SLOTS: Record<AdaptiveTemplate, readonly string[]> = {
  focus: ["main"],
  sidecar: ["main", "side"],
  stack: ["main", "side"],
  split: ["main", "side"],
  triple: ["main", "side", "rail"],
};

/** Roles the agent may assign through LayoutSpec (persistent is shell-owned). */
export const ASSIGNABLE_ROLES: ReadonlySet<SurfaceRole> = new Set([
  "primary",
  "companion",
  "support",
]);

/** One surface placed in one role at one semantic slot. */
export interface LayoutAssignment {
  surfaceId: string;
  role: SurfaceRole;
  slot: string;
}

/** The ONLY layout shape the agent may produce. Semantic composition only. */
export interface LayoutSpec {
  template: AdaptiveTemplate;
  assignments: LayoutAssignment[];
  proportion?: Proportion | null;
}

/** Contract a surface must satisfy to be placeable. */
export interface SurfaceRegistration {
  surfaceId: string;
  /** Roles this surface declares it can render meaningfully. */
  roles: SurfaceRole[];
  /** Persistent-capable surfaces may be hosted by the shell. */
  persistentCapable?: boolean;
}

/**
 * Deterministic pre-application validation. Raises on ANY violation —
 * an invalid spec must never reach layout state.
 */
export function validateLayoutSpec(
  spec: LayoutSpec,
  registered: ReadonlySet<string>,
): void {
  if (!spec.assignments || spec.assignments.length === 0) {
    throw new Error("layout requires at least one assignment");
  }
  const primaries = spec.assignments.filter((a) => a.role === "primary");
  if (EQUAL_SPLIT_TEMPLATES.has(spec.template)) {
    if (primaries.length < 1 || primaries.length > 2) {
      throw new Error(
        "split template requires one or two primary surfaces (equal split)",
      );
    }
  } else if (primaries.length !== 1) {
    throw new Error("exactly one primary surface is required");
  }
  const ids = spec.assignments.map((a) => a.surfaceId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("a surface may be assigned at most once per layout");
  }
  for (const a of spec.assignments) {
    if (a.role === "persistent") {
      throw new Error(
        "persistent surfaces are shell-controlled, not template slots",
      );
    }
    if (!TEMPLATE_SLOTS[spec.template].includes(a.slot)) {
      throw new Error(
        `slot "${a.slot}" is not offered by template "${spec.template}"`,
      );
    }
  }
  const unknown = spec.assignments
    .map((a) => a.surfaceId)
    .filter((id) => !registered.has(id));
  if (unknown.length > 0) {
    throw new Error(`unregistered surfaces in layout: ${[...new Set(unknown)].sort().join(", ")}`);
  }
}
