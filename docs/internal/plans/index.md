# docs/plans

## Active

- `gate-5-vision-conformance-orchestration-2026-08-09.md` — **PROPOSED /
  NOT STARTED** — the first program judged against `docs/panel-vision.md`
  rather than against suite counts. W0 spine (whole-program wire surface
  frozen up front + `store.ts` decomposition + outstanding Ars directives),
  W1 populate the panels (real YouTube search, local media, shared
  document, authoritative memory, reminder cadence, conformance harness),
  W2 the browser (serial, reverses the `8d1fb3f` iframe ADR), W3 voice on
  real hardware. Three decisions are pending from Ars.
- `gate-4-remediation-orchestration-2026-08-09.md` — **CLOSED 2026-08-09**
  (`c3f2be9`) — GATE-3.5 remediation orchestration contract: 4 production
  defects in the seams between individually-correct Wave-1 branches, 4
  waves with disjoint file ownership (W0 stop-the-bleeding, W1 contracts
  and boundaries, W2 one layout system, W3 remaining duplicate
  authorities), packaged-build gates. Defects D1-D7 + ADV F1-F6 landed.
  Residual: `store.ts` is still 1,420 lines — the consolidation deleted
  the legacy authority but did not shrink the god object; carried into
  GATE-5 `W0-SLICE` as a gate condition.
- `consolidation-program-2026-08-08.md` — two-stage consolidation + MVP
  program (advisor program, Ars-approved direction): S0 contract freeze →
  Wave 1 (10 agents) → GATE-3.5 → Wave 2 MVP backlog → GATE-4 → Wave 3
  user validation. Frozen contract: `docs/consolidation-contract-2026-08-08.md`.
  Status: S0 DONE, WAVE 1 ✅ (all 10 branches merged; pytest 308 / vitest
  601, typecheck + build clean). GATE-3.5 was reopened 2026-08-09 for 4
  seam defects and closed again at `c3f2be9` via
  `gate-4-remediation-orchestration-2026-08-09.md`. **Wave 2 (MVP backlog)
  is superseded by `gate-5-vision-conformance-orchestration-2026-08-09.md`,
  which folds the remaining backlog into vision-conformance lanes.**
- `adaptive-ui-redesign-execution-2026-08-07.md` — frozen adaptive UI
  redesign contract (owner-reviewed 2026-08-07): one continuous
  application surface, 4 roles / 5 templates / 3 proportions, LayoutSpec
  semantics. Waves 0-3 executed and merged (UI-000 → UI-303, 2026-08-07..
  08); the file now carries the frozen contract only — wave/gate narrative
  is in git history. UI-400 (GATE-3 end-to-end validation) remains as the
  UI-track follow-up inside the GATE-3.5 program.

## Done

The multi-zone layout advisor plan (2026-08-07) was fully
implemented by both workstreams and has been removed. Open work is tracked
in `docs/HANDOFF.md` (see docs/STATUS.md for the current gap list; media dock controls
and the advisor review are done).
