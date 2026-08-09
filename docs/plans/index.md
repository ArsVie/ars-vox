# docs/plans

## Active

- `gate-4-remediation-orchestration-2026-08-09.md` — **ACTIVE / IN
  PROGRESS** — GATE-3.5 remediation orchestration contract: 4 production
  defects in the seams between individually-correct Wave-1 branches, 4
  waves with disjoint file ownership (W0 stop-the-bleeding, W1 contracts
  and boundaries, W2 one layout system, W3 remaining duplicate
  authorities), packaged-build gates. This program reopens GATE-3.5.
- `consolidation-program-2026-08-08.md` — two-stage consolidation + MVP
  program (advisor program, Ars-approved direction): S0 contract freeze →
  Wave 1 (10 agents) → GATE-3.5 → Wave 2 MVP backlog → GATE-4 → Wave 3
  user validation. Frozen contract: `docs/consolidation-contract-2026-08-08.md`.
  Status: S0 DONE, WAVE 1 ✅ (all 10 branches merged; pytest 308 / vitest
  601, typecheck + build clean). **GATE-3.5 REOPENED 2026-08-09** — the
  merged system has 4 seam defects; the remediation contract
  (`gate-4-remediation-orchestration-2026-08-09.md`) is ACTIVE. **Wave 2
  (MVP backlog) is BLOCKED until the remediation waves land.**
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
