---
type: plan
title: Multi-zone layout — advisor implementation plan (two workstreams)
description: claude-opus-4.8 implementation plan for fixed-template + agent-assigns-slots layouts; Workstream A (UI) and Workstream B (backend) ship independently, coordinated via hey.md
date: 2026-08-07
status: proposed
---

# Multi-zone layout — advisor implementation plan (2026-08-07)

Source: claude-opus-4.8 (copilot CLI advisor), grounded by reading the repo
(engine.ts, contracts, tools, prompts, panels). Verified design model:
**fixed templates, engine-owned proportions; the agent assigns panels to
slots; the model never sends coordinates.**

Wireframe coverage: 2-zone (split, ships today), 3-zone (reading: main +
side + dock), 4-zone (dashboard: rail + main + side + dock).

---

## 1. Frozen interface (both workstreams agree up front — Phase 0)

### 1.1 Template vocabulary

| template   | zones | slots offered              | aliases (deprecated, accepted) |
|------------|-------|----------------------------|--------------------------------|
| focus      | 1     | `main`                     | —                             |
| split      | 2     | `main`, `side`             | —                             |
| reading    | 3     | `main`, `side`, `dock`     | `reference`                   |
| dashboard  | 4     | `rail`, `main`, `side`, `dock` | `background_media`        |

`reference`/`background_media` stay valid enum values but are treated as
deprecated aliases of `reading` — never removed (deployed configs).

### 1.2 Slot vocabulary

`main | side | rail | dock`

### 1.3 Wire shape of `layout.apply` (frozen)

Additive, backward-compatible with today's `{primary_panel, secondary_panel}`:

```jsonc
{
  "action": "layout.apply",
  "template": "focus|split|reading|dashboard",
  "primary_panel": "<PanelType>",        // REQUIRED. Canonical == slot "main".
  "secondary_panel": "<PanelType>|null", // optional. == slot "side" when slots omitted.
  "slots": {                             // optional superset; when present it WINS.
    "main":  "<PanelType>",
    "side":  "<PanelType>|null",
    "rail":  "<PanelType>|null",
    "dock":  "<PanelType>|null"
  },
  "preserve": true
}
```

**Frozen invariants (both sides encode):**
1. Model sends only `template` + panel→slot assignments. Never coordinates.
2. `main` always populated. If `slots` present, `primary_panel` MUST equal
   `slots.main` (B enforces at emit; A treats `slots.main` as source of truth).
3. Engine owns geometry, px floors, degrade, slot-affinity. Contract carries none.
4. Unknown/legacy template or over-assigned slots → deterministic engine
   degrade (never an error, never silent coerce-to-focus that loses panels).
5. `conversation` is the anchor: mounted-but-unassigned → best remaining slot.

---

## 2. Workstream A — UI / Desktop (Electron / React / TS)

Owns `apps/desktop/**`. Ships fully against the frozen contract using mock
`layout.apply` payloads in tests — needs nothing from B to be green.

### A1. Widen engine types to slots + 4 templates
- `src/layout/engine.ts` — `LayoutTemplateId` (+`reading`,`dashboard`; keep
  accepting `reference`/`background_media`), `SlotName = "main"|"side"|"rail"|"dock"`,
  extend `PanelRole`/geometry to carry `slot`; `LayoutSpec.slots?`; rework
  `normalizeSpec` to resolve nearest supported template (no silent focus).
- Tests: `tests/layout.test.ts` — `describe("template resolution")`: 4
  templates resolve; aliases map; unknown degrades.
- Acceptance: 4 distinct slot sets; legacy aliases map; focus/split tests pass.

### A2. Template → slot geometry table
- `src/layout/engine.ts` — replace `rectFor(template, role)` with
  `slotRects(template, viewport)`; `TEMPLATE_SLOTS` map.
- Tests: `reading` = 3 non-overlapping rects (main widest, side+dock stacked
  right); `dashboard` = left rail + center stack + right rail, rails narrower.
- Acceptance: matches wireframes; deterministic per viewport.

### A3. px floors + deterministic degrade ladder
- `src/layout/engine.ts` — `MIN_SLOT_PX: Record<SlotName,{w,h}>`;
  `computeLayout` takes real `viewport {width,height}` (tests already declare
  an unused `VIEWPORT`); degrade `dashboard → reading → split → focus`; emit
  `degradedFrom?` on `LayoutResult`.
- Tests: narrow viewport forces `dashboard→split`, very narrow → `focus`;
  pure function of (template, viewport).
- Acceptance: no slot below floor; monotonic deterministic ladder.

### A4. Slot-affinity reassignment
- `src/layout/engine.ts` — `PANEL_AFFINITY` (document_editor/book_reader→main,
  conversation→side, media/youtube→dock, notes/tasks/reminders→rail). Overflow
  → hidden; empty affinity slots get filled.
- Tests: 4 panels into 2-slot `split` keeps 2 highest-affinity; media lands in
  `dock` under `reading`.
- Acceptance: deterministic; anchor invariant holds.

### A5. Dock component + PanelHost slot rendering
- New `src/components/MediaDock.tsx`; `PanelHost.tsx` — extend
  `PANEL_COMPONENTS`, render by slot with per-slot class
  `panel-slot--main|side|rail|dock`; dock slot → MediaDock for media panels.
- Tests: `reading` with media in `dock` mounts dock region.
- Acceptance: dock renders; unmapped panels still render nothing (no crash).

### A6. Chrome densities (full / compact / rail)
- Engine derives `density` per panel from px size + slot; expose on
  `PanelGeometry`. `PanelHeader.tsx`/`PanelHost.tsx` apply density class;
  `styles.css` density rules (rail = icon-only vertical header); composer
  collapse driven by density.
- Tests: density per slot/size; rail-slot panel gets `rail` density.
- Acceptance: rail = icon-only; compact collapses composer labels; full
  unchanged; reduced-motion + a11y preserved.

### A7. Composer collapse (finalize)
- Drive collapse from computed `density` (A6) instead of raw container query.
- Acceptance: deterministic; never icon-only at full desktop size.

### A8. Store integration for `slots`
- `src/store.ts` `applyUiCommand` case `layout.apply`: read `command.slots`,
  fold into `LayoutSpec`, keep primary/secondary fallback. `src/contracts.ts`
  — extend `layout.apply` union member with optional `slots`.
- Tests: slots-bearing command drives 3-zone; legacy command still works.
- Acceptance: both wire forms correct; history/restore intact.

**A ships alone:** `npm run test` (vitest), typecheck, build — all payloads
hand-built in tests.

---

## 3. Workstream B — Backend / Contracts (Python)

Owns `packages/contracts/**`,
`services/agent/arsvox_agent/{tools/ui_tools.py,prompts/system.md}`. Ships
fully against the frozen contract validated by pydantic + schema tests.

### B1. Enum + contract consistency
- `packages/contracts/arsvox_contracts/enums.py` — `LayoutTemplate`:
  +`READING="reading"`, +`DASHBOARD="dashboard"`; keep REFERENCE/BACKGROUND_MEDIA.
- Tests: `tests/python/test_contracts.py` — new values valid; bad rejected.
- Acceptance: enum is frozen union; no removals.

### B2. `LayoutApply` gains `slots`
- `packages/contracts/arsvox_contracts/commands.py` — `LayoutSlots(BaseModel)`
  (`main` required; `side|rail|dock` optional), `LayoutApply.slots: LayoutSlots|None`;
  validator enforces `slots.main == primary_panel` when both present.
- Tests: round-trip `model_dump(mode="json")`; validator rejects mismatch.
- Acceptance: union keys on `action`; back-compat payloads validate.

### B3. `ui_apply_layout` tool signature
- `services/agent/arsvox_agent/tools/ui_tools.py` — add optional flat kwargs
  `side`, `rail`, `dock` (`PanelType|None`). Flat kwargs, NOT nested object
  (build_pydantic_tools derives JSON schema from flat typed params).
  Assemble into LayoutSlots/LayoutApply; keep `primary_panel` required as `main`.
  Keep tool count in `test_registry_registers_all_tools` in sync (41).
- Tests: `tests/python/test_tools_api.py` — reading + side/dock emits correct
  `slots` in UiCommandEvent.
- Acceptance: model expresses 3/4-zone; 2-zone calls unchanged.

### B4. `system.md` vocabulary + decision table
- `services/agent/arsvox_agent/prompts/system.md` — replace 4-template prose
  with frozen 4; define slots; add decision table (task→template→slots,
  e.g. "read a document while chatting → reading: main=document_editor,
  side=conversation, dock=media"). Remove reference/background_media from
  model-facing text (valid but undocumented).
- Tests: lightweight `test_prompts.py` — system prompt names all 4 templates
  and 4 slot names.
- Acceptance: guidance matches frozen enum/slots; table covers wireframes.

### B5. Config defaults
- `packages/contracts/arsvox_contracts/config.py` — `UiSection.templates`
  default → include `reading`, `dashboard`. Update `configs/app.yaml` if it
  enumerates templates.
- Tests: `tests/python/test_config.py` — defaults load; strict extra=forbid OK.
- Acceptance: config advertises frozen set.

### B6. Regenerate schemas
- Run `python packages/contracts/scripts/export_schemas.py` →
  `packages/contracts/schemas/*.json` (shared artifact, B owns generation).
- Tests: schema contains reading/dashboard + `slots` def.
- Acceptance: schema on disk matches models.

**B ships alone:** `pytest tests/python`.

---

## 4. Sequencing / Dependency Notes

- **Phase 0 — Joint, blocking:** ratify §1 in a single `hey.md` "Active"
  entry (interface freeze): legacy-alias decision (§1.1) + flat-kwargs tool
  signature (§B3). Nothing else starts until posted.
- **Phase 1 — Fully parallel, zero mid-flight coupling:** A1–A8 and B1–B6
  are fully independent; file ownership disjoint
  (`apps/desktop/**` vs `packages/contracts/**` + two agent files); record
  boundaries in each team's `hey.md` entry.
- **Phase 2 — Coordinated at the very end (single handshake):**
  1. B runs `export_schemas.py`, commits regenerated schema.
  2. A diffs its `src/contracts.ts` mirror; adds/confirms a conformance test
     reading the JSON schema and asserting `layout.apply`/`slots` shape.
  3. Run both suites + WS e2e (`tests/python/test_ws_e2e.py`) to confirm an
     emitted `slots` command survives the wire into the store.
- **Must NOT be split across teams mid-flight:** the wire shape (§1.3).
  Either side needing a change stops, posts a `hey.md` amendment, both re-sync.

---

## 5. Risks

1. **Template-name reconciliation (highest).** Keep reference/background_media
   as accepted aliases (§1.1); ratify in Phase 0.
2. **Silent-coerce regression.** Widening to 4 templates + degrade must
   replace normalizeSpec's silent coerce with an explicit tested ladder (A1/A3).
3. **Tool-signature schema derivation.** build_pydantic_tools derives JSON
   schema from FLAT typed params; nested `slots` object may serialize
   awkwardly → flat side/rail/dock kwargs (B3), assembled server-side.
4. **px-floor / viewport source.** computeLayout currently ignores viewport
   (unused VIEWPORT constant); A3 must thread real viewport from renderer,
   PanelHost passes live dimensions.
5. **Anchor invariant under N slots.** Generalizing the conversation-anchor
   rule to 4 slots risks hidden replies — cover in tests.
6. **Older-user chrome guardrail.** styles.css avoids icon-only except ≤260px;
   `rail` density reintroduces icon-only — must only apply to genuinely small
   rail slots, never `main`.
7. **Schema drift between phases.** If B regenerates schemas and A's mirror
   lags, silos pass but joint WS e2e fails → Phase-2 conformance test mandatory.
8. **Test-count coupling.** `test_registry_registers_all_tools` asserts 41;
   update in same commit if a tool is added.

---

*Plan only — no files modified by the advisor. Phase 0 should be posted as
the first `hey.md` "Active" entry by whichever team starts.*
