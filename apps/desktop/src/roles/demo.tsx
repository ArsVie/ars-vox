/**
 * Demo placeholder surfaces — UI-103 (2026-08-07).
 *
 * One generic placeholder surface proves the role framework: it reads its
 * role from useSurfaceRole() and renders it, so tests (and humans) can see
 * that every mounted surface KNOWS its current role. Four registrations
 * (from the frozen PLACEHOLDER_REGISTRY) cover the four roles:
 * placeholder.primary / placeholder.companion / placeholder.support
 * (template-assignable) and placeholder.persistent (shell-hosted).
 *
 * State-survival demo: `demoRoleHistory` is a per-surfaceId state bag that
 * records every role the surface rendered. Because the host keys surfaces by
 * surfaceId, role changes hit the SAME instance, and the bag's entry grows —
 * a remount would start a fresh component state. The rendered
 * `data-demo-stamp` mirrors the store-level per-surface state bag
 * (store.surfaceState[surfaceId]) so tests can assert state survives role
 * transitions through the real render path.
 */

import type { ComponentType } from "react";
import { useStore } from "zustand";

import { appStore } from "../store";
import { useSurfaceRole } from "./context";

export interface DemoRoleHistory {
  /** Roles this surface instance rendered, in order. */
  roles: string[];
  /** Number of renders recorded (one entry per surfaceId, never reset by
   *  role changes — keyed identity). */
  renders: number;
}

const history = new Map<string, DemoRoleHistory>();

export const demoRoleHistory = {
  record(surfaceId: string, role: string): void {
    const entry = history.get(surfaceId) ?? { roles: [], renders: 0 };
    entry.roles.push(role);
    entry.renders += 1;
    history.set(surfaceId, entry);
  },
  get(surfaceId: string): DemoRoleHistory | undefined {
    return history.get(surfaceId);
  },
  clear(): void {
    history.clear();
  },
};

export function DemoPlaceholderSurface() {
  const { surfaceId, role, requestedRole, capabilities, degraded } =
    useSurfaceRole();
  // Per-surface state bag (store-level, keyed by surfaceId). The role
  // framework never touches it; it survives any role transition.
  const bag = useStore(appStore, (s) => s.surfaceState[surfaceId]);
  demoRoleHistory.record(surfaceId, role);
  return (
    <div
      className="demo-surface"
      data-demo-surface={surfaceId}
      data-demo-role={role}
      data-demo-requested-role={requestedRole}
      data-demo-degraded={degraded || undefined}
      data-demo-capabilities={capabilities.join(",")}
      data-demo-stamp={String(bag?.stamp ?? "fresh")}
    >
      <strong>{surfaceId}</strong>
      <span>role: {role}</span>
      {degraded ? <span>(requested {requestedRole})</span> : null}
    </div>
  );
}

/** Demo component map: every placeholder surface id -> demo surface. */
export const DEMO_SURFACE_COMPONENTS: Record<string, ComponentType> = {
  "placeholder.primary": DemoPlaceholderSurface,
  "placeholder.companion": DemoPlaceholderSurface,
  "placeholder.support": DemoPlaceholderSurface,
  "placeholder.persistent": DemoPlaceholderSurface,
};
