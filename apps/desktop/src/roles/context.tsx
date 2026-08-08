/**
 * Role context — UI-103 (2026-08-07).
 *
 * Every mounted surface learns its current semantic role through React
 * context: useSurfaceRole() delivers { surfaceId, role, requestedRole,
 * capabilities, degraded }. Surfaces never reach into the layout, the
 * registry, or any geometry — the role is handed to them by the host.
 *
 * `role` is the role the surface is CURRENTLY rendered with (after the
 * deterministic fallback ladder, see ./fallback). `requestedRole` is what
 * the layout asked for; they differ only when the surface's capabilities
 * forced a degradation. `capabilities` is the surface's declared role set
 * (its registry registration), so a surface can adapt its presentation
 * within the roles it declared.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { SurfaceRole } from "../adaptive/contracts";

export interface SurfaceRoleInfo {
  /** Stable identity — the same surfaceId across role changes is the SAME
   *  mounted instance (state survives). */
  surfaceId: string;
  /** The role this surface is currently rendered with (post-fallback). */
  role: SurfaceRole;
  /** The role the layout requested (equals role unless degraded). */
  requestedRole: SurfaceRole;
  /** Roles this surface declared it can render (registry capabilities). */
  capabilities: readonly SurfaceRole[];
  /** True when requestedRole was unsupported and the ladder was used. */
  degraded: boolean;
}

const SurfaceRoleContext = createContext<SurfaceRoleInfo | null>(null);

export function SurfaceRoleProvider({
  value,
  children,
}: {
  value: SurfaceRoleInfo;
  children: ReactNode;
}) {
  return (
    <SurfaceRoleContext.Provider value={value}>
      {children}
    </SurfaceRoleContext.Provider>
  );
}

/** Read the current role info. Only valid inside a mounted surface. */
export function useSurfaceRole(): SurfaceRoleInfo {
  const ctx = useContext(SurfaceRoleContext);
  if (!ctx) {
    throw new Error(
      "useSurfaceRole() requires a SurfaceRoleProvider ancestor — mount surfaces through SurfaceHost",
    );
  }
  return ctx;
}
