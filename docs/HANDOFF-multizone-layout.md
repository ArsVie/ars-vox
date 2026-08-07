---
type: handoff
title: Multi-zone layout — handoff for two independent workstreams (UI + backend)
description: Split the validated fixed-template layout design into two parallel workstreams (UI/desktop and backend/contracts), coordinated via hey.md; link route to the advisor plan
date: 2026-08-07
status: active
---

# Handoff — multi-zone layout, two workstreams (2026-08-07)

## Link route to the advisor plan

**THE PLAN (authoritative, full detail):**
`docs/plans/multi-zone-layout-advisor-plan-2026-08-07.md`

That document is the direct output of claude-opus-4.8 (copilot CLI advisor,
grounded by reading the repo). It contains the frozen interface (§1), the
complete UI workstream A1–A8 (§2), the complete backend workstream B1–B6
(§3), sequencing (§4), and risks (§5). **Everything below is a routing
summary — the plan file is the source of truth.**

## Context (one paragraph)

The owner's design model was validated by the advisor: FIXED layout
templates with engine-owned proportions; the agent picks a template name and
assigns panels to SLOTS (main/side/rail/dock); the model never sends
coordinates. Current state: engine implements only focus/split with 2 roles;
contracts/enums/config already enumerate focus/split/reference/background_media
but the TS engine silently coerces unknown templates to focus (a real bug —
system.md teaches the model a vocabulary the engine discards); PANEL_COMPONENTS
maps only conversation + document_editor; no px floors, no degrade, no
slot-affinity, no dock component.

## The two workstreams (independent, coordinated via hey.md)

### Workstream A — UI / Desktop (Electron / React / TS)
Owns `apps/desktop/**`. Ships alone against mock payloads; needs nothing from B.
Tasks: A1 slot vocabulary + 4 templates, A2 template→slot geometry table,
A3 px floors + deterministic degrade ladder, A4 slot-affinity reassignment,
A5 dock component + PanelHost slot rendering, A6 chrome densities (full/
compact/rail), A7 composer collapse, A8 store `slots` integration.
Ships alone: `npm run test` (vitest), typecheck, build.

### Workstream B — Backend / Contracts (Python)
Owns `packages/contracts/**` + `services/agent/arsvox_agent/{tools/ui_tools.py,
prompts/system.md}`. Ships alone via pydantic + schema tests.
Tasks: B1 enum consistency, B2 LayoutApply.slots (+validator), B3
ui_apply_layout flat side/rail/dock kwargs, B4 system.md vocabulary + decision
table, B5 config defaults, B6 regenerate schemas.
Ships alone: `pytest tests/python`.

## Coordination rules (hey.md)

1. **Phase 0 (blocking, before ANY implementation):** post the frozen
   interface (§1 of the plan — template vocabulary, slot names, wire shape,
   invariants, legacy-alias decision, flat-kwargs tool signature) as a single
   `hey.md` "Active" entry. Nothing starts until it's posted.
2. **Phase 1 (parallel):** each team adds its own hey.md entry with exact
   file boundaries (A: `apps/desktop/**`; B: `packages/contracts/**` + the
   two agent files). No clobbering.
3. **Phase 2 (single handshake):** B regenerates + commits schemas; A diffs
   its `contracts.ts` mirror and adds the conformance test; run both suites +
   `tests/python/test_ws_e2e.py`.
4. **The wire shape (§1.3) is the one forbidden mid-flight coupling.** Any
   change → stop, post hey.md amendment, both re-sync.

## Key bugs the plan fixes (priority framing)

1. Silent coerce-to-focus drops agent panels with no error (A1/A3).
2. system.md advertises reference/background_media the engine discards (B4/A1).
3. No px floors → squished rails unusable for an older user (A3).
4. No dock component → media has nowhere to render in 3-zone layouts (A5).
5. Conversation-anchor rule is hand-coded for 2 roles (A4, generalize).

## Verification gates (both sides, from the plan)

- A: vitest green (layout.test.ts per-template rect/degrade/affinity cases),
  typecheck, build.
- B: pytest green (contracts, tools_api, config, prompts drift guard),
  regenerated schemas on disk.
- Joint (Phase 2): both suites + WS e2e with a `slots`-bearing command
  surviving the wire into the store.

## Open questions for the owner (ratify in Phase 0)

- Exact px floors (advisor suggested main ≥480×360, rail ≥240 wide, dock
  ≥64 tall) — confirm or adjust.
- Template names: `reading`/`dashboard` proposed; `reference`/
  `background_media` become deprecated aliases — confirm.
- Tool signature: flat `side/rail/dock` kwargs (not nested object) — confirm.
