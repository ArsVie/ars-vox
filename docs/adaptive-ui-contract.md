---
type: contract
title: Adaptive UI contract — frozen shapes and rules
description: "UI-000 freeze — roles, templates, proportions, LayoutSpec, registration interface, shell-owned persistent behavior, token naming contract, ownership boundaries. Single source: packages/contracts/arsvox_contracts/adaptive.py; TS mirror: apps/desktop/src/adaptive/contracts.ts; fixtures: apps/desktop/src/adaptive/fixtures.ts."
date: 2026-08-07
status: frozen
---

# Adaptive UI contract (UI-000, frozen 2026-08-07)

The agent may choose the current layout template, which activity occupies
each role, and an allowed proportion — never CSS, pixels, or coordinates.

## Roles

| role        | meaning                                              |
|-------------|------------------------------------------------------|
| `primary`   | The one visually obvious activity.                   |
| `companion` | Visible secondary activity that yields priority.     |
| `support`   | Compact contextual representation where useful.      |
| `persistent`| Shell-owned (media bar, notifications) — NOT a template slot. |

## Templates

| template  | slots offered         | notes                                   |
|-----------|-----------------------|-----------------------------------------|
| `focus`   | main                  | single primary activity                 |
| `sidecar` | main, side            | primary + companion                     |
| `stack`   | main, side            | primary + stacked companion             |
| `split`   | main, side            | equal split allowed (two primaries)     |
| `triple`  | main, side, rail      | primary + companion + support           |

## Proportions

`narrow` · `balanced` · `wide` — mapped to fixed design-system proportions by
the layout implementation (UI-102). Never raw numbers from the agent.

## LayoutSpec (the ONLY agent-produced shape)

```
LayoutSpec {
  template
  assignments[] { surfaceId, role, slot }
  proportion?
}
```

Frozen validation rules (deterministic; invalid specs never reach layout state):

1. Exactly one primary surface, unless the template explicitly supports
   equal split (`split` allows one or two primaries).
2. No duplicate surface assignment.
3. Only registered surfaces may be placed (registry check at apply time).
4. `persistent` role is NOT assignable through LayoutSpec — the shell owns
   persistent placement.
5. Assignment slots must belong to the template's offered slots.
6. No coordinate, pixel, CSS, or component-tree field exists anywhere in the
   shape.

## Surface identity

`surfaceId` is a surface's stable identity. Moving a surface between roles or
slots MUST reuse the same `surfaceId` — surface state must never be reset
merely because its role or slot changed. Same instance can transition
primary → companion → primary.

## Registration interface

A surface must be registered before it can be placed:

```
SurfaceRegistration {
  surfaceId
  roles[]            // roles this surface can render meaningfully
  persistentCapable? // may be hosted by the shell outside template slots
}
```

Registry implementation is owned by UI-103; the interface is frozen here.

## Shell-owned persistent surfaces

Persistent surfaces (media playback bar, notifications) are controlled by the
shell, not by template slots. The shell decides when a persistent-capable
surface is shown persistently. Template slots never contain `persistent`
assignments.

## Design-token naming contract

UI-000 freezes token NAMES (catalog in `apps/desktop/src/adaptive/tokens.ts`).
UI-104 implements their VALUES. Groups (exhaustive):

`typography` · `spacing` · `divider` · `surface` · `radius` · `control` ·
`icon` · `state`

Rules: kebab-case, group-prefixed, semantic scale (-xs…-xl), strong/normal/
subordinate hierarchy via suffixes. Workers must not invent tokens outside
the catalog — that is what makes surfaces read as one application.

## Layout regions are not cards

Major regions are architectural, not visual cards. Content may contain cards.
Global chrome belongs to Ars Vox, not to individual panels.

## Ownership boundaries (later tasks)

| task | owns |
|------|------|
| UI-101 | shell, global chrome, persistent regions |
| UI-102 | template geometry, proportion mapping |
| UI-103 | role context, surface registry, surface host |
| UI-104 | token VALUES (names frozen here) |
| UI-105 | workflow test harness, fixtures |
| UI-201..205 | browser/conversation/reading/tasks/media surfaces |
| UI-206 | transitions; UI-207 spatial inertia |
| UI-301 | agent planner tool; UI-302 user overrides; UI-303 a11y |

Stop conditions: any worker that needs to change LayoutSpec, needs arbitrary
geometry, or must modify another worker's owned surface escalates instead of
working around the contract.
