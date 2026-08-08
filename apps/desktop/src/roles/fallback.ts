/**
 * Role capability resolution + deterministic fallback ladder — UI-103.
 *
 * Every surface declares which roles it can render (registry capabilities).
 * When a layout requests a role the surface does not support, the role is
 * RESOLVED through the documented degradation ladder instead of failing —
 * the surface is still mounted, in the closest role it can render:
 *
 *   requested primary   -> companion -> support
 *   requested companion -> support
 *   requested support   -> (no fallback — support is the floor)
 *   requested persistent-> (never resolved here; shell-owned, rejected by
 *                           validateLayoutSpec inside template assignments)
 *
 * `support` is the universal "reduced presentation": the compact contextual
 * representation. Fallbacks never PROMOTE a surface (a companion-requested
 * surface never becomes primary), so the layout invariant "exactly one
 * primary" cannot be violated by degradation.
 *
 * When no acceptable role exists (e.g. a primary-only surface asked to
 * render `support`), resolution FAILS deterministically at apply time — the
 * invalid spec never reaches the host. Degradation only ever goes DOWN the
 * ladder; it never invents capabilities.
 *
 * resolveLayout is the single deterministic entry point used by the store:
 * it validates the frozen LayoutSpec rules first (validateLayoutSpec with the
 * registry's registered ids), then resolves every assignment's role.
 */

import {
  validateLayoutSpec,
  type LayoutSpec,
  type SurfaceRole,
} from "../adaptive/contracts";
import { ALL_ROLES, type SurfaceRegistry } from "./registry";

export { ALL_ROLES };

/**
 * Dominance order, most dominant first. `persistent` is orthogonal: it is
 * shell-owned and never participates in template-role degradation.
 */
export const ROLE_DOMINANCE: readonly SurfaceRole[] = [
  "primary",
  "companion",
  "support",
  "persistent",
];

/**
 * The documented degradation ladder: requested role -> fallback candidates,
 * most preferred first. Only strictly less-dominant roles are ever used.
 */
export const ROLE_FALLBACK_LADDER: Record<
  SurfaceRole,
  readonly SurfaceRole[]
> = {
  primary: ["companion", "support"],
  companion: ["support"],
  support: [],
  persistent: [],
};

export type RoleResolution =
  | { kind: "exact"; requested: SurfaceRole; role: SurfaceRole }
  | { kind: "fallback"; requested: SurfaceRole; role: SurfaceRole };

/**
 * Resolve a requested role against a surface's declared capabilities.
 * Returns the exact role when supported, the first ladder fallback that IS
 * supported, or null when no acceptable role exists (deterministic).
 */
export function resolveRole(
  requested: SurfaceRole,
  capabilities: readonly SurfaceRole[],
): RoleResolution | null {
  // persistent is shell-owned and never resolved through template roles —
  // shell hosting checks registry.isPersistentCapable instead.
  if (requested === "persistent") {
    return null;
  }
  if (capabilities.includes(requested)) {
    return { kind: "exact", requested, role: requested };
  }
  for (const candidate of ROLE_FALLBACK_LADDER[requested]) {
    if (capabilities.includes(candidate)) {
      return { kind: "fallback", requested, role: candidate };
    }
  }
  return null;
}

/** One placement after role resolution: the role the surface actually
 *  renders (role) may differ from what the layout requested (requestedRole)
 *  when the surface's capabilities forced a ladder fallback. */
export interface ResolvedAssignment {
  surfaceId: string;
  /** Semantic slot only — geometry is owned by the template engine. */
  slot: string;
  requestedRole: SurfaceRole;
  role: SurfaceRole;
  /** True when the requested role was unsupported and the ladder was used. */
  degraded: boolean;
}

/**
 * Validate a LayoutSpec against the registry and resolve every assignment's
 * role through the fallback ladder. Throws deterministically on any frozen
 * validation violation or on a role with no acceptable fallback — an invalid
 * spec never reaches the host.
 */
export function resolveLayout(
  spec: LayoutSpec,
  registry: SurfaceRegistry,
): ResolvedAssignment[] {
  validateLayoutSpec(spec, registry.registeredIds());
  return spec.assignments.map((a) => {
    const capabilities = registry.capabilitiesOf(a.surfaceId);
    const resolution = resolveRole(a.role, capabilities);
    if (!resolution) {
      throw new Error(
        `surface "${a.surfaceId}" cannot render role "${a.role}" ` +
          `(capabilities: ${capabilities.length > 0 ? capabilities.join(", ") : "none"}) — ` +
          "no fallback available",
      );
    }
    return {
      surfaceId: a.surfaceId,
      slot: a.slot,
      requestedRole: a.role,
      role: resolution.role,
      degraded: resolution.kind === "fallback",
    };
  });
}
