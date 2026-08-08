# hey.md — Agent Message Board

Purpose: agents working in this repo (possibly in parallel) announce what they are doing so nobody walks over each other's work. **Read this file before starting ANY work in the repo.**

## Rules
- Append-only: new entries go on top. Never edit or delete another agent's entry except to flip its `status` to `resolved`.
- One entry per agent per work session. Remove your own entry when done (or flip status and leave it).
- If an active entry claims files/dirs you need: coordinate in the entry thread or wait — do NOT clobber.
- Re-read after long pauses; new agents may have entered.

## Active
### hermes (orchestrator — GATE-2.5 runtime contract hardening, 2026-08-08)
- trigger: full-source advisor audit (GATE-2.5 review) — architecture strong, cross-layer seams weak; Wave 3 NOT dispatched yet per audit verdict
- tracks (7 parallel, deleg_ed648132, all leaf): H1 bidirectional action protocol (P0), H2 reminder correctness (P0), H3 STOP+voice ownership (P0), H4 local service boundary (P0), H5 reconnect+confirmations (P1), H6 paths+lockfile (P1), H7 media wiring+adaptive corrections (P1/P2)
- worktrees: /mnt/c/dev/ars-vox-worktrees/h{1..7}-*, branches wip/h{1..7}-* (briefs /tmp/gate25-briefs/)
- status: in_progress — dispatched 2026-08-08 ~04:40Z; gate: merge 7 branches, cross-track suite (306 vitest / 110 pytest baselines + new seam tests), docs pass (STATUS Wire/threat-model/README corrections per audit), screenshots NOT needed (no visual redesign), then GATE-2.5 close + Wave 3 go-decision
### hermes (orchestrator — adaptive UI redesign, WAVE 2)
- timestamp: 2026-08-08T02:00:00Z
- task: WAVE 2 KICKOFF (owner go-ahead received) — UI-201..207 dispatched as 5+2 leaf batches in worktrees /mnt/c/dev/ars-vox-worktrees/ui-2{01..07}-* (branches wip/ui-2XX-*). Workers told: NO merges (gate = orchestrator), NO hey.md/docs edits (orchestrator owns the board), commit early (600s child cap), surface ownership per contract conflict-avoidance map. Main tree: previous session's EOL-noise dirty state RESTORED (git checkout -- ., content unchanged — diff was 100% line-ending flip, verified via --ignore-space-at-eol); parked wip/advisor-round2-reader-polish INTACT (reader engine fixes stay parked until GATE-2; UI-203 scope excludes engines). Mock 8765 + vite 5173 left running from last session.
- files/dirs: 7 new worktrees under /mnt/c/dev/ars-vox-worktrees/ (ui-201-browser .. ui-207-inertia)
- status: ✅ WAVE 2 + GATE-2 CLOSED (2026-08-08) — 7/7 tasks self-completed (5+2 batches, zero timeouts), all merged; gate wiring registered product surfaces (browser/conversation/document_editor/tasks/media) into the adaptive stage (src/adaptive/surfaces.ts); readers FIXED + pixel-verified (EPUB nested themes, PDF canvasContext); 306 vitest / 110 pytest / typecheck / build green; screenshots 12..22-wave2-*; STATUS/HANDOFF/plans updated. WAVE 3 (UI-301..303) UNLOCKED — dispatch pending owner go-ahead.

### hermes-epub (EPUB reader investigation)
- timestamp: 2026-08-07T18:15:00Z
- task: Investigate why the EPUB reader does not render in Ars-Vox. Authoritative brief: `docs/handoff-epub-reader-debug-2026-08-07.md`.
- status: RESOLVED 2026-08-07 — root cause established with evidence (stable CDP browser): EPUB theme styles passed to epub.js as CSS STRINGS → addStylesheetRules emits empty rules → transparent body + black text on dark stage = invisible page; PDF renders 100%-black canvas (pdfjs never paints). Fix exists in parked branch `wip/advisor-round2-reader-polish` (nested theme objects + re-apply after display; PDF fit-width). Merge + visual verify = next step. Full evidence: docs/handoff-epub-reader-debug-2026-08-07.md.

### hermes-ui-101 (Wave 1 — unified application shell)
- timestamp: 2026-08-07T23:40:00Z
- task: UI-101 Unified application shell — make Ars Vox read as ONE application: continuous activity stage (no per-panel card chrome, no dark moat), one divider/gutter language (frozen `divider-*` token names), global top bar (brand + assistant state + STOP ≥48px), shell-owned persistent regions (media/notifications host), placeholder children + demo toggle rendering all five TEMPLATE_FIXTURES. Surfaces stay as placeholders (Wave 2 owns real adaptive rendering).
- files/dirs: `apps/desktop/src/App.tsx`, `apps/desktop/src/components/{PanelHost,StatusBar,PlaceholderSurface(new),PersistentRegions(new)}.tsx`, `apps/desktop/src/styles.css`, `hey.md`
- boundaries: will NOT touch `src/layout/engine.ts`, `src/adaptive/**`, Browser/Conversation/Reader/Tasks/Media component internals (only shared shell chrome in styles.css: `.panel`, `.panel-header`, `.panel-slot`, `.status-bar`, `.stop-button`). DOM contract `.panel-slot` etc. preserved.
- status: resolved (GATE-1 merged, commit on main)

### hermes (UI-102 — adaptive template geometry engine)
- timestamp: 2026-08-07T23:40:00Z
- task: Deterministic geometry engine for the five frozen adaptive compositions (focus/sidecar/stack/split/triple) + proportion mapping (narrow/balanced/wide) + responsive slot geometry. Consumes LayoutSpec only; renders template+assignments+proportion → concrete slot rects; deterministic errors for invalid specs (reuses validateLayoutSpec + geometry-level fit/duplicate-slot checks); placeholder surfaces from TEMPLATE_FIXTURES; keeps .panel-slot DOM contract.
- files/dirs: apps/desktop/src/layout/adaptiveEngine.ts (new), apps/desktop/src/layout/AdaptiveStage.tsx (new), apps/desktop/tests/adaptive-geometry.test.ts (new), apps/desktop/tests/adaptive-stage.test.tsx (new), hey.md
- boundaries: will NOT touch src/adaptive/* (contract code), components/*, src/layout/engine.ts (legacy), store/App/ws/electron; engine+fixture-placeholder render only. No npm installs (node_modules is a junction to main).
- status: resolved (GATE-1 merged, commit on main)

### hermes (UI-104 — unified visual token system)
- timestamp: 2026-08-07T23:40:00Z
- task: Implement VALUES for the UI-000 frozen token catalog (40 names, 8 groups: typography/spacing/divider/surface/radius/control/icon/state) as CSS custom properties in styles.css :root; explicit strong/normal/subordinate typography hierarchy (font shorthand); control floors for the older-user target (lg 48px / md 44px / touch-target 48px); card-content surface distinct from region surfaces; legacy token bridge (--panel/--panel-2/--panel-3/--panel-border/--panel-border-soft/--bg/--radius route through catalog); high-contrast mode re-routed to catalog tokens; STOP wired to --control-height-lg; focus/hover/active/disabled routed to state tokens; divider/spacing tokens used by canonical rules; new conformance suite tests/token-values.test.ts (20 tests: catalog↔CSS set equality, hierarchy, sizing floors, surface separation, legacy bridge, wiring).
- files/dirs: apps/desktop/src/styles.css (token catalog + legacy bridge + routed rules), apps/desktop/tests/token-values.test.ts (new)
- boundaries: did NOT touch components/**, readers/**, layout/engine.ts, src/adaptive/* (contract code), content.css, packages/**, services/**; no new token names outside the frozen catalog; region/shell chrome left to UI-101; no stop-condition escalations.
- verification: 131/131 vitest (111 baseline + 20 new), typecheck clean, build clean (both renderer + electron).
- status: resolved

### hermes (orchestrator — adaptive UI redesign)
- timestamp: 2026-08-07T23:30:00Z
- task: Execution contract encoded + owner-reviewed: `docs/plans/adaptive-ui-redesign-execution-2026-08-07.md` (4 roles / 5 templates / 3 proportions, LayoutSpec, 4-wave DAG). ✅ WAVE 0 COMPLETE — UI-000 froze the adaptive UI contract: `packages/contracts/arsvox_contracts/adaptive.py` (SurfaceRole/AdaptiveTemplate/Proportion/LayoutSpec + TEMPLATE_SLOTS + validate_layout_spec), TS mirror `apps/desktop/src/adaptive/{contracts,fixtures,tokens}.ts`, placeholder fixtures for all 5 templates, token naming contract, 2 JSON schemas, docs/adaptive-ui-contract.md. Verified: 110 pytest (17 new), 111 vitest (15 new), typecheck+build clean, OKF OK. GATE CONTRACT_FROZEN CLOSED (merge a3e996d).
- ⚠️ PARKED: previous session's uncommitted advisor-round2/reader work → branch `wip/advisor-round2-reader-polish` (main was dirty; Wave 1 needs styles.css/components clean). Revertible — merge that branch back when convenient.
- WAVE 1 STARTING: UI-101..105 in worktrees /mnt/c/dev/ars-vox-worktrees/ui-1{01..05}-*. Workers announce on hey.md before touching files.
- ✅ GATE-1 FOUNDATION_INTEGRATION CLOSED 2026-08-07 (~18:56): all five branches merged to main (UI-101 shell, UI-102 geometry, UI-103 roles, UI-104 tokens, UI-105 harness). 4/5 workers hit the 600s cap — their landed work was gate-verified by the orchestrator (vitest/typecheck/build per worktree) and committed. Conflicts resolved: hey.md (union), styles.css (UI-101 shell vs UI-104 tokens — kept catalog tokens: radius via --radius-*, STOP via --control-height-lg 48px). Merged main: 240 vitest, 84 pytest, typecheck+build clean, storyboard capture works (24 scenarios). WAVE 2 UNLOCKED: UI-201..207 (7 tasks → 5+2 batches, Hermes caps parallel children at 5).
- files/dirs: (wave 0) packages/contracts/** , apps/desktop/src/adaptive/*, apps/desktop/tests/adaptive-contract.test.ts, tests/python/test_adaptive_contract.py, docs/adaptive-ui-contract.md
- boundaries: contract types ONLY — additive, no rewrite of existing wire behavior; did NOT touch components/, readers/, layout/engine.ts, services/agent.
- status: ✅ WAVE 0 + WAVE 1 + GATE-1 COMPLETE (2026-08-07) — CONTRACT_FROZEN (a3e996d) and FOUNDATION_INTEGRATION closed; wave 2 (UI-201..207) UNLOCKED, dispatch pending owner go-ahead. Screenshots: docs/screenshots/06..11-wave1-*.png (widescreen).

### hermes (advisor round-2 fixes + reader polish)
- timestamp: 2026-08-07T22:50:00Z
- task: STOP matcher fixed (utterance-level, "para" removed from vocabulary per owner), tests 26/26 new; UI fixes (En espera label, STOP 48px, EPUB 72ch centered measure, PDF fit-width); docs consolidated (STATUS.md voice wording + timestamp, ADR 0004, HANDOFF news landmines, threat-model index T9, plans pointer). VERIFYING epub theme paint via headless Edge (9223) — rAF dead in occluded window.
- files/dirs: services/agent/arsvox_agent/local_intents.py, tests/python/test_local_intents_stop.py, apps/desktop/src/{components/StatusBar.tsx, components/ReaderView.tsx, readers/epubReader.ts, readers/pdfReader.ts, styles.css, content.css}, docs/{STATUS.md, HANDOFF.md, decisions/0004-local-stop-path.md, threat-model/index.md, plans/index.md}
- boundaries: no pending collisions; commit pending after epub visual verify (uncommitted working tree).
- status: in_progress

### hermes (config-driven UI + live windows demo + modularity cleanup)
- timestamp: 2026-08-07T22:30:00Z
- task: Wire configs/app.yaml into the UI (endpoints.ts single-source URLs, store.applyConfig: default template/primary, large_text/high_contrast, tts speed/queue_max); typed wire enum unions + extended conformance tests; live multi-turn LLM window-management demo (demo_live.py --scenario windows, MULTI_OK 5/5); modularity audit fixes (scripts/_harness.py, utcnow_iso dedup, enum-driven repos, conftest loads real app.yaml, max_steps via UsageLimits, system.md drift guard); taste-skill design-governance pass in styles.css.
- files/dirs: apps/desktop/src/{endpoints.ts (new), store.ts, contracts.ts, App.tsx, TtsPlayer.tsx, mic.ts, ws/client.ts, main.tsx, styles.css}, apps/desktop/tests/*, services/agent/arsvox_agent/{runtime.py, __main__.py, prompts/system.md, tools/library_tools.py, tools/scheduler.py}, services/memory/arsvox_memory/repos/*, services/tts/arsvox_tts/providers.py, scripts/{_harness.py (new), demo_live.py, demo_voice.py, smoke_mock.py}, packages/contracts/** (_util.py new), configs/app.example.yaml, tests/python/{conftest.py, test_prompts.py}, docs/{audit-modularity-2026-08-07.md, taste-skill-analysis-2026-08-07.md}
- boundaries: no pending collisions; all committed (28493cf). Ports 8765/5173 FREE at session end — kill leftovers before starting services.
- status: resolved

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
