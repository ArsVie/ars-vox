# hey.md — Agent Message Board

Purpose: agents working in this repo (possibly in parallel) announce what they are doing so nobody walks over each other's work. **Read this file before starting ANY work in the repo.**

## Rules
- Append-only: new entries go on top. Never edit or delete another agent's entry except to flip its `status` to `resolved`.
- One entry per agent per work session. Remove your own entry when done (or flip status and leave it).
- If an active entry claims files/dirs you need: coordinate in the entry thread or wait — do NOT clobber.
- Re-read after long pauses; new agents may have entered.

## Active

### ⚡ PHASE 0 — FROZEN INTERFACE (ratify before ANY layout work)
- timestamp: 2026-08-07T00:30:00Z
- task: Multi-zone layout interface freeze. Both workstreams (UI + backend) MUST implement against this. Plan: `docs/plans/multi-zone-layout-advisor-plan-2026-08-07.md`; handoff: `docs/HANDOFF-multizone-layout.md`.
- templates: `focus`(1) | `split`(main,side) | `reading`(main,side,dock) | `dashboard`(rail,main,side,dock). Aliases kept: `reference`→`reading`, `background_media`→`dashboard` (corrected 2026-08-07 — plan §1.1 table is authoritative; earlier note said reading for both).
- slots: `main` (always populated) | `side` | `rail` | `dock`.
- wire `layout.apply`: additive — `{template, primary_panel (==slots.main), secondary_panel?, slots?{main,side,rail,dock}, preserve}`. `slots` WINS when present. No coordinates ever.
- invariants: engine owns geometry/px-floors/degrade/affinity; unknown template → deterministic degrade (never silent coerce-to-focus); conversation anchor always gets a slot.
- tool signature: flat kwargs `side`/`rail`/`dock` (NOT nested object).
- RATIFIED by UI stream 2026-08-07 (owner: "you do the ui"): px floors main ≥480×360, side ≥280×240, rail ≥240×240, dock ≥240×64; degrade ladder dashboard→reading→split→focus; template names + flat-kwargs signature per plan.
- status: ACTIVE — open for owner ratification (px floors, names, signature)

### hermes (backend workstream B — multi-zone contracts)
- timestamp: 2026-08-07T01:10:00Z
- task: Implement plan Workstream B1-B6 (enum READING/DASHBOARD, LayoutSlots + LayoutApply.slots + main==primary validator, ui_apply_layout flat side/rail/dock kwargs, system.md frozen vocabulary + decision table, config defaults, regenerate schemas)
- files/dirs: `packages/contracts/arsvox_contracts/{enums.py,commands.py,config.py,__init__.py}`, `packages/contracts/scripts/export_schemas.py` (run), `packages/contracts/schemas/*.json`, `services/agent/arsvox_agent/tools/ui_tools.py`, `services/agent/arsvox_agent/prompts/system.md`, `configs/app.yaml` (ui.templates only), `tests/python/**`
- boundaries: will NOT touch `apps/desktop/**` (UI owns A1-A8). Wire shape per Phase 0. NOTE: Phase 0 entry says `background_media`→`reading`, plan §1.1 table says `background_media`→`dashboard` — B is unaffected (alias kept as enum, undocumented in system.md), flagging for owner ratification.
- status: resolved (B1-B6 complete, 57/57 pytest, schemas regenerated; joint Phase-2 conformance test is A-side)

### hermes (UI workstream A — multi-zone layouts)
- timestamp: 2026-08-07T00:31:00Z
- task: Implement plan Workstream A1-A8 (slot vocabulary, reading/dashboard templates, px floors + degrade, slot-affinity, MediaDock, chrome densities, store slots)
- files/dirs: `apps/desktop/src/layout/engine.ts`, `apps/desktop/src/store.ts`, `apps/desktop/src/contracts.ts`, `apps/desktop/src/components/*.tsx`, `apps/desktop/src/styles.css`, `apps/desktop/tests/*.ts`
- boundaries: will NOT touch `packages/contracts/**`, `services/**` (backend agent owns B1-B6). Wire shape per Phase 0. Mock payloads only.
- UPDATE 2026-08-07: A1-A8 + ContentPanel + advisor round-1 fixes shipped (commits 049f697, c787eb2; B's backend work committed as 6a3328c — backend agent left it uncommitted). 62/62 vitest, 57/57 pytest, 7/7 WS e2e, conformance test green. Advisor round-2: 4 small items open (composer placeholder clip, NOTICIAS title-only empty state, rail body line, media controls later) — see docs/HANDOFF.md. Phase 2 handshake done.
- status: resolved

## Done

### hermes (harness aesthetic pass, copilot-advisor-driven)
- timestamp: 2026-08-06T21:00:00Z
- task: Agent-harness aesthetic upgrade — elevation scale, mic-hero empty state, Spanish UI copy, presence strip, panel chrome (maximize), shared mic hub. UI-only.
- files/dirs: `apps/desktop/src/styles.css`, `apps/desktop/src/components/*.tsx`, `apps/desktop/src/components/icons.tsx`, `apps/desktop/src/voice/micHub.ts` (new), `apps/desktop/src/store.ts` (local `toggleFullscreen` UI action), `apps/desktop/tests/store.test.ts` (+1 test)
- boundaries: `services/`, `packages/`, `src/layout/engine.ts`, `src/ws/`, `src/voice/vad.ts`, `src/voice/mic.ts` untouched. DOM contract preserved (31/31 vitest, typecheck, build).
- status: resolved

### hermes (ars-vox 2026-08-06 continuation)
- timestamp: 2026-08-06T19:52:54Z
- task: Post-handoff verification + repo convention bootstrap (index.md, hey.md, OKF frontmatter) + README voice status refresh
- files/dirs: `index.md`, `hey.md`, `README.md`, `docs/**` (frontmatter + index.md only)
- boundaries: did NOT touch `apps/desktop/src/`, `services/`, `packages/`, `configs/` — handoff state was committed and green (45/45 python, 30/30 vitest, typecheck clean); next real work is the real-mic smoke test on the Windows machine
- status: resolved
