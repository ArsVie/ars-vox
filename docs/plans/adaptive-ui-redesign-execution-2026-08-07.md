---
type: plan
title: Ars-Vox adaptive UI redesign — execution contract with orchestration graph
description: Frozen shared contract (roles/templates/proportions/LayoutSpec/invariants) + 4-wave execution DAG with gates — Wave 0 single contract task, Wave 1 five parallel foundation tasks, GATE-1, Wave 2 seven parallel surface tasks, GATE-2, Wave 3 three parallel intelligence tasks, GATE-3, Wave 4 end-to-end validation. Verbatim YAML is the orchestrator input.
date: 2026-08-07
status: proposed
---

# Ars-Vox adaptive UI redesign — execution contract (2026-08-07)

Source: Ars (owner), delivered 2026-08-07. Supersedes the multizone-layout
contract (focus/split/reading/dashboard + slots) as the layout direction: the
panel system becomes ARCHITECTURAL, not visually exposed — one continuous
application surface, one visually obvious primary activity, the agent chooses
semantic layout only (template / role assignments / proportion), never CSS or
coordinates.

## Execution graph (DAG)

```
Wave 0: UI-000 (single task — contract freeze)
   ↓  gate CONTRACT_FROZEN
Wave 1: UI-101 Shell · UI-102 Geometry · UI-103 Roles · UI-104 Tokens · UI-105 QA harness (5 parallel)
   ↓  gate GATE-1 FOUNDATION_INTEGRATION
Wave 2: UI-201 Browser · UI-202 Conversation · UI-203 Reading · UI-204 Tasks · UI-205 Media · UI-206 Motion · UI-207 Spatial inertia (7 parallel)
   ↓  gate GATE-2 ADAPTIVE_SURFACE_INTEGRATION
Wave 3: UI-301 Agent planner · UI-302 User overrides · UI-303 Accessibility/usability (3 parallel)
   ↓  gate GATE-3 INTELLIGENT_LAYOUT_INTEGRATION
Wave 4: UI-400 (single task — end-to-end adaptive UX validation)
```

## Orchestration notes

- One branch/worktree per task; wave tasks execute concurrently; only the
  designated gate resolves cross-task integration.
- Ownership boundaries (conflict_avoidance) are narrow enough that no two
  workers edit the root layout concurrently — the orchestrator enforces them
  via per-task briefs, never by hoping workers behave.
- ⚠ delegation cap: Hermes batches max 5 concurrent children. Wave 1 (5) and
  Wave 3 (3) fit; Wave 2 (7) must run as 5+2 batches (or CLI subagents per
  worktree). DAG semantics unchanged — GATE-2 still waits for all seven.
- Workers announce on hey.md before starting; gates resolve after integration.

## Contract (verbatim YAML — orchestrator input)

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


execution:

  # ============================================================
  # WAVE 0 — CONTRACT
  # One task only. Nothing else starts until this is merged.
  # ============================================================

  - id: UI-000
    name: Freeze adaptive UI contract
    wave: 0
    parallel: false
    depends_on: []

    goal: >
      Establish the interfaces every parallel worker will use so that the
      redesign can proceed without independent agents inventing incompatible
      layout systems or visual conventions.

    scope:
      - Define SurfaceRole.
      - Define Template.
      - Define allowed proportions.
      - Define LayoutSpec.
      - Define surface registration interface.
      - Define role passed to surfaces.
      - Define shell-owned persistent surface behavior.
      - Define design-token names consumed by all UI work.
      - Document rule that layout regions themselves are not cards.
      - Document ownership boundaries for later tasks.

    deliverables:
      - Shared TypeScript interfaces/types.
      - Short adaptive-ui-contract document.
      - Token API/naming contract.
      - Placeholder fixtures for every template.
      - Validation rules for LayoutSpec.

    acceptance:
      - Every later task can compile against the contract without knowing another task's implementation.
      - All five templates can be represented by LayoutSpec.
      - No API exposes raw coordinates to the agent.
      - Contract explicitly supports moving the same surface between roles without changing surface identity.

    gate:
      name: CONTRACT_FROZEN
      unlocks:
        - UI-101
        - UI-102
        - UI-103
        - UI-104
        - UI-105


  # ============================================================
  # WAVE 1 — FOUNDATION
  # FIVE TASKS RUN IN PARALLEL
  # ============================================================

  - id: UI-101
    name: Unified application shell
    wave: 1
    parallel: true
    depends_on:
      - UI-000

    goal: >
      Make Ars Vox visually read as one application rather than a collection
      of bordered panels.

    owns:
      - Root application shell.
      - Global top bar.
      - Assistant state presentation.
      - STOP control placement.
      - Application background.
      - Global content stage.
      - Shell-level persistent regions.

    must_not_touch:
      - Browser internals.
      - Conversation internals.
      - Reader internals.
      - Tasks/reminders internals.
      - Layout-selection intelligence.

    implementation:
      - Remove the assumption that every surface requires an outer card.
      - Create one continuous activity stage.
      - Introduce one separator/gutter language.
      - Establish shell handling for persistent media/notifications.
      - Keep surfaces as placeholder children during this task.

    acceptance:
      - Placeholder rectangles inside the shell already look like regions of one application.
      - No large dark moat separates normal layout regions.
      - No redundant panel-level outer shadows.
      - STOP and assistant state remain globally visible.
      - Shell works with all template fixtures.


  - id: UI-102
    name: Adaptive template geometry engine
    wave: 1
    parallel: true
    depends_on:
      - UI-000

    goal: >
      Implement deterministic geometry for the five allowed adaptive
      compositions independently from surface content and independently from
      the LLM.

    owns:
      - focus template
      - sidecar template
      - stack template
      - split template
      - triple template
      - proportion mapping
      - responsive slot geometry

    must_not_touch:
      - Individual surface rendering.
      - Agent prompts/tools.
      - Product-specific surface logic.

    implementation:
      - Render LayoutSpec deterministically.
      - Map narrow/balanced/wide to fixed design-system proportions.
      - Use placeholders for testing.
      - Ensure slots consume the available activity stage cleanly.
      - Avoid visible container chrome owned by layout engine.

    acceptance:
      - All five templates render with arbitrary registered placeholder surfaces.
      - No arbitrary pixel geometry enters through LayoutSpec.
      - Templates work at target desktop resolution.
      - Invalid assignments fail deterministically.
      - A surface can move between slots without requiring a new surface instance.


  - id: UI-103
    name: Surface role framework
    wave: 1
    parallel: true
    depends_on:
      - UI-000

    goal: >
      Allow every activity surface to know whether it is currently primary,
      companion, support, or persistent.

    owns:
      - Role context/API.
      - Surface registry.
      - Surface host.
      - Role capability metadata.
      - Fallback behavior for unsupported roles.

    must_not_touch:
      - Final appearance of Browser/Reader/etc.
      - Agent layout planning.

    implementation:
      - Pass semantic role to every mounted surface.
      - Support capability declarations per surface.
      - Keep surface identity independent from layout role.
      - Provide demo surfaces for each role.

    acceptance:
      - Same surface instance can transition primary -> companion -> primary.
      - State survives role changes.
      - Unsupported role requests degrade predictably.
      - Surface APIs do not know template geometry.


  - id: UI-104
    name: Unified visual token system
    wave: 1
    parallel: true
    depends_on:
      - UI-000

    goal: >
      Eliminate the visual impression that each panel was designed as a
      separate mini-application.

    owns:
      - Typography tokens.
      - Spacing tokens.
      - Divider tokens.
      - Surface/background tokens.
      - Radius rules.
      - Control sizing.
      - Icon sizing/treatment.
      - Focus/hover/active states.

    implementation:
      - Implement the token names frozen by UI-000.
      - Prefer separation by whitespace or subtle divider.
      - Define strong/normal/subordinate content hierarchy.
      - Define minimum interaction sizing suitable for the target UX.

    acceptance:
      - No surface needs custom global spacing constants.
      - No surface needs to invent its own divider color.
      - Primary/secondary typography hierarchy is explicit.
      - Design system supports card content without forcing regions themselves to be cards.


  - id: UI-105
    name: Adaptive workflow test harness
    wave: 1
    parallel: true
    depends_on:
      - UI-000

    goal: >
      Build the QA mechanism before the redesign is integrated so the team
      evaluates transitions and workflows rather than isolated screenshots.

    owns:
      - Layout fixtures.
      - Screenshot scenarios.
      - Workflow test definitions.
      - Assertions about preserved state and primary role.

    canonical_flow:
      - Start/home.
      - Open Facebook/browser.
      - Open assistant conversation alongside browser.
      - Start video.
      - Keep media playing while changing activity.
      - Open a book.
      - Ask assistant about current activity.
      - Create a reminder.
      - Return to browser.

    acceptance:
      - Tests can drive LayoutSpec directly without an LLM.
      - Every test can identify the expected primary activity.
      - Harness can detect accidental surface remount/state loss.
      - Screenshot fixtures exist for all five templates.


  gate_after_wave_1:
    id: GATE-1
    name: FOUNDATION_INTEGRATION
    depends_on:
      - UI-101
      - UI-102
      - UI-103
      - UI-104
      - UI-105

    integration_goal: >
      Merge shell, geometry, roles, tokens, and test harness before any
      product surface redesign is merged.

    required_checks:
      - All template fixtures render inside unified shell.
      - Role changes preserve demo surface state.
      - All tests compile/pass.
      - No surface-specific design has entered foundation code.

    unlocks:
      - UI-201
      - UI-202
      - UI-203
      - UI-204
      - UI-205
      - UI-206
      - UI-207


  # ============================================================
  # WAVE 2 — SURFACES + MOTION
  # SEVEN TASKS RUN IN PARALLEL
  # ============================================================

  - id: UI-201
    name: Browser adaptive surface
    wave: 2
    parallel: true
    depends_on:
      - GATE-1

    goal: >
      Make browsing feel like the current application rather than a browser
      widget embedded in a dashboard.

    owns:
      - Browser surface UI only.

    variants:
      primary: Full browsing experience and appropriate browser controls.
      companion: Reduced browser presentation for side-by-side workflows.
      support: Compact contextual representation where useful.

    rules:
      - No outer Browser card.
      - No permanent label merely saying "Browser".
      - Use shared shell/tokens.
      - Primary browser content must dominate when selected.

    acceptance:
      - Browser primary feels like Ars Vox has become a browser.
      - Companion variant clearly yields visual priority.
      - Browser state survives role/template changes.


  - id: UI-202
    name: Conversation adaptive surface
    wave: 2
    parallel: true
    depends_on:
      - GATE-1

    goal: >
      Keep Ars available as a companion without forcing a large chat
      application to occupy the screen at all times.

    owns:
      - Conversation surface UI only.

    variants:
      primary: Full conversation.
      companion: Compact recent conversation/context.
      support: Minimal assistant interaction/status when appropriate.

    acceptance:
      - Companion conversation no longer looks like a second full application.
      - Conversation can become primary without changing identity/history.
      - Redundant shell-level state is not repeated inside the surface.


  - id: UI-203
    name: Reading adaptive surface
    wave: 2
    parallel: true
    depends_on:
      - GATE-1

    goal: >
      Make EPUB/PDF reading feel like a dedicated consumer reading experience
      when primary while remaining usable alongside the assistant.

    owns:
      - EPUB UI.
      - PDF UI.
      - Reading-specific contextual controls.

    requirements:
      - Constrain EPUB readable line length.
      - Prefer usable PDF fit behavior.
      - Remove redundant "READING" container chrome.
      - Preserve page/chapter/zoom state across layout changes.

    acceptance:
      - Primary reading mode visually prioritizes the document/book.
      - Sidecar conversation does not make the reader feel boxed in.
      - Reading position survives role/template changes.


  - id: UI-204
    name: Tasks and reminders adaptive surface
    wave: 2
    parallel: true
    depends_on:
      - GATE-1

    goal: >
      Turn tasks/reminders into contextual companion information rather than
      a permanently competing dashboard panel.

    owns:
      - Tasks UI.
      - Reminder UI.

    variants:
      primary: Full management experience if explicitly requested.
      companion: Useful current tasks/reminders.
      support: Small high-priority summary.

    acceptance:
      - Support mode can show only the most relevant information.
      - Tasks do not visually compete with an unrelated primary activity.
      - Existing task interactions remain functional.


  - id: UI-205
    name: Media adaptive surface
    wave: 2
    parallel: true
    depends_on:
      - GATE-1

    goal: >
      Separate "watching media" from "media continuing in the background."

    owns:
      - Full media surface.
      - Persistent shell media control implementation.

    variants:
      primary: Large video/media experience.
      companion: Secondary visible media where appropriate.
      persistent: Compact shell-level playback bar.

    acceptance:
      - Media can transition primary -> persistent without playback reset.
      - Persistent mode does not compete with the current primary activity.
      - Playback controls remain easily accessible.


  - id: UI-206
    name: Layout transition system
    wave: 2
    parallel: true
    depends_on:
      - GATE-1

    goal: >
      Make adaptive rearrangement visually understandable by showing surfaces
      moving/resizing rather than replacing one screen with another.

    owns:
      - Layout transition animation.
      - Mount preservation during transitions.
      - Reduced-motion behavior.

    requirements:
      - Restrained transitions, approximately 200-300ms where appropriate.
      - Resize/move existing surfaces instead of remounting them.
      - Respect reduced-motion preference.

    acceptance:
      - User can visually track where a surface moved.
      - Layout changes do not flash/reset.
      - Media/browser/reader state remains intact during animated changes.


  - id: UI-207
    name: Spatial inertia policy
    wave: 2
    parallel: true
    depends_on:
      - GATE-1

    goal: >
      Prevent agent-driven adaptability from making the interface unstable or
      unpredictable.

    owns:
      - Deterministic layout-change scoring.
      - Position-preservation rules.
      - Movement-cost calculation.

    policy_priority:
      - Keep existing satisfactory layout.
      - Resize existing region.
      - Add/remove supporting region.
      - Move a surface.
      - Change template substantially.

    requirements:
      - Movement has explicit cost.
      - Existing surfaces prefer their current general screen region.
      - Agent response alone is never sufficient reason to rearrange.
      - Material user activity change may justify template change.

    acceptance:
      - Equivalent layouts prefer the one with less movement.
      - Repeated agent responses do not cause layout churn.
      - Tests cover stable placement across multi-step workflows.


  gate_after_wave_2:
    id: GATE-2
    name: ADAPTIVE_SURFACE_INTEGRATION
    depends_on:
      - UI-201
      - UI-202
      - UI-203
      - UI-204
      - UI-205
      - UI-206
      - UI-207

    integration_goal: >
      Produce a fully working adaptive UI that can be controlled manually by
      LayoutSpec before giving any layout authority to the model.

    required_checks:
      - All surfaces render correctly in supported roles.
      - Canonical workflow passes without LLM involvement.
      - One primary activity is always visually evident.
      - Surface state survives all tested layout transitions.
      - No major region has reintroduced independent panel chrome.
      - Spatial inertia tests pass.

    unlocks:
      - UI-301
      - UI-302
      - UI-303


  # ============================================================
  # WAVE 3 — INTELLIGENCE + USER CONTROL + ACCESSIBILITY
  # THREE TASKS RUN IN PARALLEL
  # ============================================================

  - id: UI-301
    name: Agent layout planner
    wave: 3
    parallel: true
    depends_on:
      - GATE-2

    goal: >
      Give the agent semantic composition authority without giving it control
      over visual implementation.

    owns:
      - Agent layout tool/schema.
      - Layout intent interpretation.
      - Deterministic validation before application.

    allowed_agent_output:
      - template
      - surface-role assignments
      - allowed proportion

    forbidden_agent_output:
      - pixels
      - CSS
      - colors
      - arbitrary coordinates
      - arbitrary component trees
      - animation implementation

    acceptance:
      - Invalid model output cannot corrupt layout state.
      - Planner output always validates through deterministic code.
      - Same valid LayoutSpec produces same geometry.
      - Planner respects spatial-inertia policy.


  - id: UI-302
    name: User layout overrides
    wave: 3
    parallel: true
    depends_on:
      - GATE-2

    goal: >
      Allow simple user commands to constrain or override agent composition
      without exposing a window-manager UI.

    supported_intents:
      - Make this bigger.
      - Make this smaller.
      - Put this on the right.
      - Put this on the left.
      - Keep it here.
      - Show both.
      - Close this.
      - Full screen.

    owns:
      - Layout constraint model.
      - Pinning/stickiness semantics.
      - Manual UI affordances if needed.

    acceptance:
      - Explicit user constraints beat planner preferences.
      - Constraints can be removed.
      - Invalid requested arrangements degrade to nearest valid template.
      - No draggable freeform window system is introduced.


  - id: UI-303
    name: Consumer usability and accessibility pass
    wave: 3
    parallel: true
    depends_on:
      - GATE-2

    goal: >
      Ensure the cohesive design is actually easier to use, not merely more
      visually elegant.

    owns:
      - Hit-target audit.
      - Typography/readability audit.
      - Focus/keyboard behavior.
      - Contrast.
      - Reduced motion.
      - Primary-action discoverability.
      - Status wording.

    acceptance:
      - Important controls meet agreed minimum target size.
      - STOP is immediately recognizable and accessible.
      - Listening/thinking/speaking/waiting states are semantically clear.
      - Primary content remains readable in every supported composition.
      - No critical behavior depends only on subtle visual styling.


  gate_after_wave_3:
    id: GATE-3
    name: INTELLIGENT_LAYOUT_INTEGRATION
    depends_on:
      - UI-301
      - UI-302
      - UI-303

    required_checks:
      - Planner cannot bypass deterministic layout validation.
      - User overrides supersede planner decisions.
      - Accessibility checks pass.
      - Canonical workflow succeeds with planner enabled.

    unlocks:
      - UI-400


  # ============================================================
  # WAVE 4 — FINAL SYSTEM VALIDATION
  # ============================================================

  - id: UI-400
    name: End-to-end adaptive UX validation
    wave: 4
    parallel: false
    depends_on:
      - GATE-3

    goal: >
      Validate the product as a continuous consumer experience rather than as
      a collection of individually successful screens.

    canonical_scenario:
      - Start with a simple home/default activity.
      - Open Facebook/browser as primary.
      - Ask Ars a question without losing browsing context.
      - Start a video and promote media to primary.
      - Continue playback while opening another activity.
      - Open a book and make reading primary.
      - Ask Ars about the book.
      - Create a reminder.
      - Return to the previous browser state.

    evaluate_each_transition:
      - Is the current primary activity immediately obvious?
      - Did anything move that did not need to move?
      - Did state survive?
      - Can the user infer where the previous activity went?
      - Does the screen still feel like Ars Vox rather than multiple apps?
      - Did secondary content surrender attention appropriately?

    final_acceptance:
      - Entire canonical scenario completes without surface-state loss.
      - Agent never directly controls geometry.
      - No unexpected layout churn.
      - User overrides are respected.
      - Media persists correctly.
      - Browser/reader/conversation state persists correctly.
      - Major regions visually form one application surface.
      - Test users do not need to understand the words panel, template, slot, or role.


orchestration_rules:

  branch_strategy:
    - One branch/worktree per task.
    - Wave tasks may execute concurrently.
    - Only designated gate/integration task resolves cross-task integration.
    - Surface workers must not modify shared shell/layout contracts without escalating.

  conflict_avoidance:
    UI-101: "owns shell/root layout only"
    UI-102: "owns template geometry only"
    UI-103: "owns role/registry infrastructure only"
    UI-104: "owns design tokens only"
    UI-105: "owns workflow fixtures/tests only"
    UI-201: "owns browser surface"
    UI-202: "owns conversation surface"
    UI-203: "owns reader surface"
    UI-204: "owns tasks/reminders surface"
    UI-205: "owns media surface"
    UI-206: "owns transition infrastructure"
    UI-207: "owns layout stability policy"
    UI-301: "owns agent composition tool/planner"
    UI-302: "owns explicit user layout constraints"
    UI-303: "owns accessibility/usability corrections"

  universal_surface_rules:
    - Do not add an outer card around the entire surface.
    - Do not add permanent headings that merely name the surface.
    - Do not introduce surface-specific global spacing systems.
    - Do not introduce custom region backgrounds when shell tokens suffice.
    - Primary variant should feel like the current application.
    - Companion/support variants must reduce visual dominance.
    - Preserve state when changing role or template.
    - Do not modify another surface to make your surface work.

  stop_conditions:
    - A worker discovers the shared contract cannot support its task.
    - A worker needs to change LayoutSpec.
    - A worker needs arbitrary geometry.
    - A worker needs to modify another worker's owned surface.
    - State preservation requires architectural changes outside UI scope.

  definition_of_done: >
    Internally, Ars Vox remains a modular agent-arranged workspace.
    Externally, users experience one stable consumer application in which one
    activity is clearly primary and supporting activities quietly rearrange
    around it as needs change.
```

## Relationship to existing contract

The current engine (`apps/desktop/src/layout/engine.ts`) implements 4 templates
(focus/split/reading/dashboard) + slots (main/side/rail/dock) with px floors.
This contract supersedes that vocabulary: 5 templates
(focus/sidecar/stack/split/triple), 4 roles (primary/companion/support/
persistent), 3 proportions (narrow/balanced/wide). The frozen panel-vision
(`docs/panel-vision.md`) is NOT modified — no new product surfaces, no business
logic redesign. Wave 0 must decide how the old vocabulary maps/deprecates.
