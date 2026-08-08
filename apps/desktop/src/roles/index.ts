/**
 * Role framework (UI-103) — public surface.
 *
 *   registry  — SurfaceRegistry + the renderer singleton (seeded with the
 *               frozen placeholder registrations); registered ids feed
 *               validateLayoutSpec.
 *   fallback  — resolveRole / resolveLayout: the deterministic degradation
 *               ladder for unsupported roles.
 *   context   — SurfaceRoleProvider + useSurfaceRole: every mounted surface
 *               learns { surfaceId, role, requestedRole, capabilities,
 *               degraded }.
 *   host      — SurfaceHost: mounts role-resolved assignments keyed by
 *               surfaceId (role changes never remount), geometry-blind.
 *   demo      — placeholder surfaces for all four roles.
 */

export * from "./registry";
export * from "./fallback";
export * from "./context";
export * from "./host";
export * from "./demo";
