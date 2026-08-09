# docs/plans

## Active

- `consolidation-program-2026-08-08.md` — two-stage consolidation + MVP
  program (advisor program, Ars-approved direction): S0 contract freeze →
  Wave 1 (10 agents: voice/STOP, secure launch, native layout contract,
  single reducer, media authority, snapshot/reconnect, confirmations,
  electron security, visual cleanup, adversarial) → GATE-3.5 → Wave 2 MVP
  backlog → GATE-4 → Wave 3 user validation. Frozen contract:
  `docs/consolidation-contract-2026-08-08.md`. Status: S0 DONE, WAVE 1 ✅
  (all 10 branches merged, GATE-3.5 CLOSED 2026-08-09 — pytest 308 / vitest
  601, typecheck + build clean; 20-item acceptance checklist passed).
  Wave 2 (MVP backlog) unlocked.
- `adaptive-ui-redesign-execution-2026-08-07.md` — Ars-Vox adaptive UI redesign
  execution contract (owner-reviewed 2026-08-07): one continuous application
  surface, 4 roles / 5 templates / 3 proportions, LayoutSpec semantics, 4-wave
  DAG with gates (UI-000 → 5 → GATE-1 → 7 → GATE-2 → 3 → GATE-3 → UI-400).
  Status: WAVE 0 ✅ (CONTRACT_FROZEN), WAVE 1 ✅ (GATE-1 FOUNDATION_INTEGRATION
  closed 2026-08-07 — all five branches merged, 240 vitest / 84 pytest /
  typecheck / build green), WAVE 2 ✅ (GATE-2 ADAPTIVE_SURFACE_INTEGRATION
  closed 2026-08-08 — UI-201..207 merged, 306 vitest / 110 pytest green).
  WAVE 3 ✅ (UI-301 planner / UI-302 overrides / UI-303 a11y merged
  2026-08-08 — 441 vitest; UI-301+302 landed via merge 3efe9cf / 2b1c957,
  UI-303 via faeb265). GATE-3 (UI-400 validation) remains as the UI-track
  follow-up inside the GATE-3.5 consolidation program.

## Done

The multi-zone layout advisor plan (2026-08-07) was fully
implemented by both workstreams and has been removed. Open work is tracked
in `docs/HANDOFF.md` (see docs/STATUS.md for the current gap list; media dock controls
and the advisor review are done).
