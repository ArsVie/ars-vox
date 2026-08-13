/**
 * Surface registry — UI-103 (2026-08-07).
 *
 * Implements the frozen SurfaceRegistration interface
 * (src/adaptive/contracts.ts, UI-000): a surface must be registered before it
 * can be placed, and the registered id set feeds validateLayoutSpec's
 * registry argument at apply time (see resolveLayout in ./fallback).
 *
 * Deterministic rules:
 *  - register() throws on duplicate surfaceId (already registered).
 *  - register() throws when roles[] is empty — a surface that cannot render
 *    ANY role can never be placed, so an empty capability set is invalid.
 *  - register() throws on a role outside the four SurfaceRoles.
 *  - unregister() removes a surface (returns false when absent); a surface
 *    may be registered again afterwards.
 *  - registeredIds() returns a fresh snapshot Set — no aliasing.
 *  - declareRequirement() attaches a PURE placement predicate (B1 dependency
 *    spec) to a surfaceId. Requirements are keyed by surfaceId and are
 *    consulted ONLY by the planner's reconcileLayout — register() and
 *    resolveLayout never consult them, and undeclared ids have no
 *    requirement (requiresOf returns undefined). Declaring a requirement
 *    for an unregistered id is allowed (consultation only happens for ids
 *    that appear in a desired spec).
 *
 * The module-level `surfaceRegistry` singleton is seeded with the frozen
 * PLACEHOLDER_REGISTRY (every placeholder surface with full roles) so the
 * store and demo hosts work out of the box. Product surfaces (UI-201..205)
 * register through this same API.
 */

import type { SurfaceRegistration, SurfaceRole } from "../adaptive/contracts";
import { PLACEHOLDER_REGISTRY } from "../adaptive/fixtures";

/** The four semantic roles (frozen vocabulary). */
export const ALL_ROLES: readonly SurfaceRole[] = [
  "primary",
  "companion",
  "support",
  "persistent",
];

/**
 * B1 dependency spec — client-side placement snapshot (2026-08-13).
 *
 * Deliberately NOT in adaptive/contracts.ts: that module mirrors the Python
 * wire schemas (schema cross-checked by tests/adaptive-contract.test.ts),
 * while this snapshot is a pure client-side predicate input with no wire or
 * Python counterpart. NO store import — the snapshot is structural and the
 * caller (store wiring) builds it.
 */
export interface SurfaceRequirementSnapshot {
  /** True when media content is active (a title and videoId/url exist). */
  mediaActive: boolean;
  /** True when an open document context exists. */
  documentOpen: boolean;
}

/** Pure placement requirement declared by a surface — a deterministic
 *  function of the snapshot; never touches the store. */
export type SurfaceRequirement = (
  snapshot: SurfaceRequirementSnapshot,
) => boolean;

export interface SurfaceRegistry {
  /** Register a surface. Throws deterministically on duplicate id, empty
   *  roles, or an unknown role string. */
  register(registration: SurfaceRegistration): void;
  /** Remove a surface. Returns true when it was registered. */
  unregister(surfaceId: string): boolean;
  /** All registrations, in registration order. */
  list(): SurfaceRegistration[];
  /** Registration for a surface, or undefined when unregistered. */
  lookup(surfaceId: string): SurfaceRegistration | undefined;
  /** True when the surface is registered. */
  has(surfaceId: string): boolean;
  /** Roles the surface declares it can render (empty when unregistered). */
  capabilitiesOf(surfaceId: string): readonly SurfaceRole[];
  /** True when the surface may be hosted persistently by the shell. */
  isPersistentCapable(surfaceId: string): boolean;
  /** Placement requirement the surface declares (B1), or undefined when it
   *  declares none. Consulted by reconcileLayout, never by register() or
   *  resolveLayout. */
  requiresOf(surfaceId: string): SurfaceRequirement | undefined;
  /** Declare (or redeclare) a surface's placement requirement predicate.
   *  Keyed by surfaceId; declaring for an unregistered id is allowed. */
  declareRequirement(surfaceId: string, requires: SurfaceRequirement): void;
  /** Snapshot of registered ids — feed this to validateLayoutSpec. */
  registeredIds(): ReadonlySet<string>;
  /** Number of registered surfaces. */
  size(): number;
}

export function createSurfaceRegistry(
  initial: readonly SurfaceRegistration[] = [],
): SurfaceRegistry {
  const byId = new Map<string, SurfaceRegistration>();
  const order: string[] = [];
  const requirements = new Map<string, SurfaceRequirement>();

  const register = (registration: SurfaceRegistration): void => {
    const { surfaceId, roles } = registration;
    if (byId.has(surfaceId)) {
      throw new Error(
        `surface "${surfaceId}" is already registered (roles are immutable per registration)`,
      );
    }
    if (!roles || roles.length === 0) {
      throw new Error(
        `surface "${surfaceId}" must declare at least one role it can render`,
      );
    }
    for (const role of roles) {
      if (!ALL_ROLES.includes(role)) {
        throw new Error(
          `surface "${surfaceId}" declares unknown role "${role}"`,
        );
      }
    }
    byId.set(surfaceId, { surfaceId, roles: [...roles], persistentCapable: registration.persistentCapable ?? false });
    order.push(surfaceId);
  };

  for (const registration of initial) {
    register(registration);
  }

  return {
    register,
    unregister(surfaceId: string): boolean {
      const removed = byId.delete(surfaceId);
      if (removed) {
        const idx = order.indexOf(surfaceId);
        if (idx >= 0) order.splice(idx, 1);
      }
      return removed;
    },
    list(): SurfaceRegistration[] {
      return order.map((id) => {
        const reg = byId.get(id);
        // order and byId are kept in sync; reg is always present.
        return reg as SurfaceRegistration;
      });
    },
    lookup(surfaceId: string): SurfaceRegistration | undefined {
      return byId.get(surfaceId);
    },
    has(surfaceId: string): boolean {
      return byId.has(surfaceId);
    },
    capabilitiesOf(surfaceId: string): readonly SurfaceRole[] {
      return byId.get(surfaceId)?.roles ?? [];
    },
    isPersistentCapable(surfaceId: string): boolean {
      return byId.get(surfaceId)?.persistentCapable ?? false;
    },
    requiresOf(surfaceId: string): SurfaceRequirement | undefined {
      return requirements.get(surfaceId);
    },
    declareRequirement(surfaceId: string, requires: SurfaceRequirement): void {
      requirements.set(surfaceId, requires);
    },
    registeredIds(): ReadonlySet<string> {
      return new Set(order);
    },
    size(): number {
      return order.length;
    },
  };
}

/**
 * The renderer's surface registry, seeded with the frozen placeholder
 * registrations. The store validates and resolves adaptive LayoutSpecs
 * against this singleton; demo hosts render from it.
 */
export const surfaceRegistry: SurfaceRegistry = createSurfaceRegistry(
  PLACEHOLDER_REGISTRY,
);

// B1 dependency specs (2026-08-13): placement requirements consulted by the
// planner's reconcileLayout when a snapshot is supplied. media only mounts
// while media content is active; document_editor only while an open document
// context exists. Every other surface declares NO requirement — behavior
// unchanged. Declarations are keyed by surfaceId, so they hold once
// registerProductSurfaces() (adaptive/surfaces.ts) registers these ids into
// this same singleton.
surfaceRegistry.declareRequirement("media", (snapshot) => snapshot.mediaActive);
surfaceRegistry.declareRequirement(
  "document_editor",
  (snapshot) => snapshot.documentOpen,
);
