---
type: plan
title: Cordis discipline implementation plan (2026-08-13)
paper: docs/paper-mining-spatiotemporal-composability-2026-08-13.md
---

# Cordis discipline — implementation plan

Goal: implement the HIGH-fit borrows from the Cordis paper as surgical,
behavior-preserving mechanisms. Written WITH the work (ADR-style): this
documents what each lane owns and what is deliberately out of scope.

## Seam contract

- Four mechanisms, two lanes, no shared files between leaves.
- Backend lane: per-run effect ledger (rollback on abort) + tool effect
  tags (revertible | emission).
- Frontend lane: layout reconciliation (diff, not swap) + transition
  gate (in-flight completion). Parent wires store.ts (assistant-owned).
- Everything is ADDITIVE: no behavior change for paths that don't opt in.
  Normal turn completion KEEPS its effects (the user wanted them) — the
  ledger only rolls back on ABORT (STOP/cancel/error).
- Product invariants are frozen: media stays after a turn (watching a
  video survives the run); STOP stays a small red symbol; confirmations
  keep their two-phase flow.

## Lane A — backend (leaves A1, A2)

### A1. Per-run effect ledger (revertible effects, §3.1)
Owner: runtime.py + NEW arsvox_agent/effect_ledger.py + tests/python/test_effect_ledger.py
- EffectLedger: LIFO list of (key, inverse) pairs. `add(key, inverse)` returns an
  arming token; `rollback()` runs inverses in reverse, each at most once
  (idempotent), swallowing handler errors (log + continue — teardown must
  never fail the teardown).
- Wire into AgentRuntime._run_turn: fresh ledger per turn; on
  CancelledError/exception → rollback; on normal completion → discard
  (effects persist). STOP already cancels _active_task, so abort-rollback
  rides the existing path — no new STOP surface.
- Which tools record inverses? Only opt-in pairs with REAL inverses:
  document.create → document.delete (same title), tasks.add → tasks.remove
  (id), media surface state set → clear media (only when the run also
  OPENED it this turn). Emissions (telegram.*, reminders.create) never
  record inverses — they ride the existing PNR/confirmation machinery.
- Reversal must reuse EXISTING tool handlers via registry.execute_direct
  (no new side-effect code paths).

### A2. Effect tags on tools (acquisition/emission taxonomy, §6.1)
Owner: tools/__init__.py + tools/register.py + policy.py + tests/python/test_tool_effect_tags.py
- Add `effect: "revertible" | "emission"` to ToolSpec (default
  "revertible"); add a per-module spec helper so SPECS lists carry the tag
  without touching handlers.
- Tag truth: every `approval=True` tool MUST be an emission (validation
  test); emissions are skipped by the A1 ledger (defensive, by tag not by
  name); ui/media/document/tasks/memory/browser/local tools are
  revertible.
- Policy behavior UNCHANGED: the tag is descriptive + used by A1; the
  confirmation path keeps deciding on `approval` exactly as today.

## Lane B — frontend (leaves B1, B2; parent wires)

### B1. Layout reconciliation (target-vs-committed diff, §5.2.1) + dependency specs
Owner: adaptive/planner.ts + roles/registry.ts + NEW tests/reconcile-planner.test.tsx
- Pure function `reconcileLayout(desired: LayoutSpec, current: LayoutSpec |
  null) → { spec, changes }`: per-surfaceId diff. Unchanged surfaces are
  marked untouched (carry identity — supports the no-change-during-reading
  rule and the surfaceId-keyed identity contract); removed surfaces get
  `removedSurfaceIds` (the disposal cue); added surfaces get
  `addedSurfaceIds`.
- Dependency specs: registry entries may declare `requires?: (store-like
  snapshot) => boolean`. Planner consults requirements on reconcile:
  media requires active media content; document_editor requires an open
  document context. A surface whose requirement vanished is dropped from
  the composition (disposal cue emitted). Requirements are PURE functions
  of a snapshot type — no store import (keeps planner testable).
- All existing planner behavior preserved where requirements are absent
  (none declared yet → apply B1's declared ones only: media +
  document_editor).

### B2. Transition gate (inertia: in-flight completion, §4.3.3)
Owner: NEW layout/transitionGate.ts + tests/transition-gate.test.tsx
- Pure state machine `TransitionGate`: IDLE → TRANSITIONING (commit +
  start) → on `settle()` → IDLE (or TRANSITIONING again with the queued
  target). Proposals arriving while TRANSITIONING are QUEUED (last-wins);
  the in-flight transition always completes. `reduce(state, event) →
  {state, command}` — no timers inside (the caller owns timing); expose a
  `TRANSITION_MS` constant for the host to settle with.
- inertia.ts is untouched: the gate composes AFTER the UI-207 cost policy
  (policy decides whether; gate decides when).

### Parent wiring (store.ts, assistant-owned)
- applyLayoutIntent: run planner reconcile; route through the gate; on
  settle, apply committed spec + emit disposal for removedSurfaceIds
  (close media state / drop panel registry residue).
- STOP path: mark surfaces unloading → drain → dispose (withdrawal guard,
  §4.3.1) — backend rollback (A1) plus frontend disposal run together.

## Out of scope (explicit)
HMR engine, runtime component loading, realms/tenancy, service brokers,
sandboxing, dependency versioning machinery, any Cordis dependency, and
any change to the frozen adaptiveEngine.ts / movement rules / panel vision.

## Acceptance
- All four items: new unit tests pass; existing suites green (pytest 441+
  and vitest 794+ baseline).
- Live checks (parent): (1) video open → user asks to remove → layout AND
  media state both cleaned; (2) STOP mid-run after document.create → the
  document is rolled back; (3) two rapid layout.compose calls → first
  transition completes, second queues and lands; (4) screenshots ≥100KB
  + vision-checked where UI changed.

## File ownership (one owner per file)
A1: effect_ledger.py (new), runtime.py, tests/python/test_effect_ledger.py
A2: tools/__init__.py, tools/register.py, policy.py,
    tests/python/test_tool_effect_tags.py
B1: adaptive/planner.ts, roles/registry.ts, tests/reconcile-planner.test.tsx
B2: layout/transitionGate.ts (new), tests/transition-gate.test.tsx
Parent: store.ts, App.tsx (only if wiring requires), docs, commits.
