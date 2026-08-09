---
type: plan
title: Ars-Vox adaptive UI redesign — frozen contract
description: "Frozen shared contract for the adaptive UI redesign: one continuous application surface, 4 roles / 5 templates / 3 proportions, LayoutSpec semantics, invariants. The execution DAG (waves UI-000..UI-400) ran to completion 2026-08-08; wave/gate narrative lives in git history."
date: 2026-08-07
status: frozen
---

# Ars-Vox adaptive UI redesign — frozen contract (2026-08-07)

Source: Ars (owner), delivered 2026-08-07. Supersedes the multizone-layout
contract (focus/split/reading/dashboard + slots) as the layout direction: the
panel system becomes ARCHITECTURAL, not visually exposed — one continuous
application surface, one visually obvious primary activity, the agent chooses
semantic layout only (template / role assignments / proportion), never CSS or
coordinates.

## Contract (verbatim YAML — frozen)

```yaml
project:
  name: ars-vox-adaptive-ui-redesign

  objective: >
    Redesign Ars Vox so it feels like one cohesive consumer application,
    while preserving the core adaptive-workspace capability: the agent may
    choose the current layout template, which activity occupies each role,
    and an allowed proportion based on the user's current need.

  product_principles:
    - The panel system is architectural, not visually exposed.
    - The application should feel like one continuous surface.
    - There is always one visually obvious primary activity.
    - Secondary activities surrender visual dominance.
    - The agent chooses semantic layout, never CSS or arbitrary coordinates.
    - Existing activity state survives layout changes.
    - Layout changes should be minimal and spatially understandable.
    - Major regions are not cards.
    - Content may contain cards.
    - Global application chrome belongs to Ars Vox, not to individual panels.
    - User placement commands override agent preferences.

  non_goals:
    - Do not rewrite backend agent architecture.
    - Do not introduce arbitrary draggable desktop windows.
    - Do not allow LLM-generated pixel dimensions.
    - Do not redesign business logic inside Browser, Reader, Tasks, etc.
    - Do not add new product surfaces during this project.

  shared_contract:
    roles:
      - primary
      - companion
      - support
      - persistent

    templates:
      - focus
      - sidecar
      - stack
      - split
      - triple

    proportions:
      - narrow
      - balanced
      - wide

    required_layout_shape: |
      LayoutSpec {
        template
        assignments[] {
          surfaceId
          role
          slot
        }
        proportion?
      }

    invariants:
      - Exactly one primary surface unless template explicitly supports equal split.
      - No duplicate surface assignment.
      - Only registered surfaces may be placed.
      - Persistent surfaces are controlled by the shell, not normal template slots.
      - Layout implementation determines actual pixel geometry.
      - Surface state must not be reset merely because its role or slot changes.
```

## Relationship to existing contract

The current engine (`apps/desktop/src/layout/engine.ts`) implements 4 templates
(focus/split/reading/dashboard) + slots (main/side/rail/dock) with px floors.
This contract supersedes that vocabulary: 5 templates
(focus/sidecar/stack/split/triple), 4 roles (primary/companion/support/
persistent), 3 proportions (narrow/balanced/wide). The frozen panel-vision
(`docs/panel-vision.md`) is NOT modified — no new product surfaces, no business
logic redesign. The legacy engine remains until remediation Wave 2 deletes it
(see gate-4-remediation-orchestration-2026-08-09.md).
