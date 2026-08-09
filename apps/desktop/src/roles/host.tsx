/**
 * SurfaceHost — UI-103 (2026-08-07).
 *
 * Mounts role-resolved layout assignments as SURFACES. Geometry-blind by
 * design: the host knows only surfaceId / role / slot (semantic strings) —
 * it never computes, receives, or renders any pixel geometry. Template
 * geometry is the template engine's job (UI-102); this host only guarantees
 * the role framework:
 *
 *  - Surfaces are KEYED BY surfaceId, so a role or slot change NEVER remounts
 *    a surface: React keeps the same instance, and component state survives
 *    primary -> companion -> primary. (The keyed element may MOVE between
 *    stage positions — React moves, it does not recreate.)
 *  - Every mounted surface receives { surfaceId, role, requestedRole,
 *    capabilities, degraded } through SurfaceRoleProvider (useSurfaceRole).
 *  - Assignments are expected to come from resolveLayout() (./fallback), so
 *    requested roles are already degraded through the deterministic ladder;
 *    the host renders the RESOLVED role.
 *  - The persistent region hosts shell-chosen surfaces with role
 *    "persistent". Only surfaces registered persistentCapable are honored —
 *    anything else in the `persistent` list is skipped deterministically.
 *  - A surfaceId without a component renders a neutral unmapped marker
 *    (no crash).
 */

import type { ComponentType } from "react";

import type { ResolvedAssignment } from "./fallback";
import { SurfaceRoleProvider, type SurfaceRoleInfo } from "./context";
import type { SurfaceRegistry } from "./registry";

/** surfaceId -> component that renders the surface. */
export type SurfaceComponentMap = Record<string, ComponentType>;

export interface SurfaceHostProps {
  /** Role-resolved assignments (output of resolveLayout). */
  assignments: readonly ResolvedAssignment[];
  /** surfaceIds the shell wants hosted persistently (role = persistent).
   *  Only persistentCapable surfaces are honored. */
  persistent?: readonly string[];
  registry: SurfaceRegistry;
  components: SurfaceComponentMap;
}

export function SurfaceHost({
  assignments,
  persistent = [],
  registry,
  components,
}: SurfaceHostProps) {
  const persistentIds = persistent.filter((id) =>
    registry.isPersistentCapable(id),
  );
  return (
    <div className="surface-host" data-surface-host>
      <div data-surface-region="stage">
        {assignments.map((a) => {
          const info: SurfaceRoleInfo = {
            surfaceId: a.surfaceId,
            role: a.role,
            requestedRole: a.requestedRole,
            capabilities: registry.capabilitiesOf(a.surfaceId),
            degraded: a.degraded,
          };
          const Component = components[a.surfaceId];
          return (
            <div
              key={a.surfaceId}
              data-surface-id={a.surfaceId}
              data-surface-slot={a.slot}
              data-surface-role={a.role}
              data-surface-requested-role={a.requestedRole}
              data-surface-degraded={a.degraded || undefined}
            >
              {Component ? (
                <SurfaceRoleProvider value={info}>
                  <Component />
                </SurfaceRoleProvider>
              ) : (
                <div data-surface-unmapped={a.surfaceId}>
                  no component for {a.surfaceId}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div data-surface-region="persistent">
        {persistentIds.map((id) => {
          const info: SurfaceRoleInfo = {
            surfaceId: id,
            role: "persistent",
            requestedRole: "persistent",
            capabilities: registry.capabilitiesOf(id),
            degraded: false,
          };
          const Component = components[id];
          return (
            <div key={id} data-surface-id={id} data-surface-role="persistent">
              {Component ? (
                <SurfaceRoleProvider value={info}>
                  <Component />
                </SurfaceRoleProvider>
              ) : (
                <div data-surface-unmapped={id}>no component for {id}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
