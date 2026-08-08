---
type: reference
title: Surface role framework (UI-103) — registry, role context, fallback ladder
description: "UI-103 implementation record — surface registry, per-surface role context/API, role capability metadata, deterministic fallback ladder for unsupported roles, geometry-blind SurfaceHost keyed by surfaceId, store integration. Wave-1 foundation (roles)."
date: 2026-08-07
status: implemented
---

# Surface role framework (UI-103) — 2026-08-07

Wave-1 foundation task. Every activity surface knows whether it is currently
`primary`, `companion`, `support`, or `persistent` — via infrastructure, not
per-surface code. Frozen interface authority: `docs/adaptive-ui-contract.md`
(UI-000) + `apps/desktop/src/adaptive/contracts.ts` /
`packages/contracts/arsvox_contracts/adaptive.py`.

## Modules (apps/desktop/src/roles/)

| file | role |
|------|------|
| `registry.ts` | `SurfaceRegistry` — register/unregister/list/lookup/`capabilitiesOf`/`isPersistentCapable`/`registeredIds`; singleton `surfaceRegistry` seeded with the frozen `PLACEHOLDER_REGISTRY`. Registered ids feed `validateLayoutSpec` at apply time. |
| `fallback.ts` | `resolveRole` + `resolveLayout` — the deterministic degradation ladder; `ResolvedAssignment` (surfaceId/slot/requestedRole/role/degraded — semantic only). |
| `context.tsx` | `SurfaceRoleProvider` + `useSurfaceRole()` — delivers `{ surfaceId, role, requestedRole, capabilities, degraded }` to every mounted surface. |
| `host.tsx` | `SurfaceHost` — mounts role-resolved assignments keyed by surfaceId (role changes never remount), geometry-blind, persistent region for shell-hosted surfaces. |
| `demo.tsx` | Placeholder surfaces for all four roles + per-surfaceId demo state bag + role history. |

Store integration (`apps/desktop/src/store.ts`, additive): `adaptive`
(validated `LayoutSpec` + resolved assignments), `surfaceState`
(per-surfaceId state bag — never touched by role changes), `applyAdaptiveSpec`
(validate → resolve → store; throws on invalid specs, state never partially
updated), `setSurfaceState`.

## Fallback ladder (deterministic, documented)

Requested role → first capability the surface supports, most preferred first:

```
primary   -> companion -> support
companion -> support
support   -> (none — support is the floor)
persistent-> (never resolved through template roles; shell hosting checks
             registry.isPersistentCapable)
```

- `support` is the universal reduced presentation.
- Fallbacks never PROMOTE a surface (a companion-requested surface never
  becomes primary), so the invariant "exactly one primary" cannot be violated
  by degradation.
- When no acceptable role exists (e.g. a primary-only surface asked for
  `support`), resolution fails deterministically at apply time — the invalid
  spec never reaches the host. Frozen `validateLayoutSpec` rules run FIRST
  (unregistered ids, persistent-in-template, duplicate assignment, etc.);
  capability resolution runs second.

## Identity & state

- Surfaces are keyed by `surfaceId`: primary → companion → primary reuses the
  SAME instance; component state and the store-level `surfaceState` bag
  survive every role/slot change.
- The role API is geometry-blind: no rects, px, coordinates, or inline
  geometry anywhere in the framework. Slots are semantic strings; template
  geometry is UI-102's job.

## Acceptance (all passing — tests/roles.test.tsx, 28 tests)

- (a) same instance transitions primary → companion → primary — store +
  host tests, role history `["primary","companion","primary"]` on one
  per-surfaceId entry.
- (b) state survives role changes — `surfaceState` bag (stamp) survives
  swaps through the real render path (`data-demo-stamp`).
- (c) unsupported role requests degrade predictably — ladder unit tests +
  end-to-end `resolveLayout` + rendered degraded attrs.
- (d) surface APIs geometry-blind — markup has no style=/px/rect/width/height;
  `ResolvedAssignment` carries only semantic fields.

Gates: 139 vitest (111 baseline + 28 new), `npm run typecheck`, `npm run
build` — all green. No changes to `src/adaptive/*` contract code,
`layout/engine.ts`, `components/*`, or product surfaces.
