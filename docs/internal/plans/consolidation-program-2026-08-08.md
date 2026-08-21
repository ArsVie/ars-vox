---
type: plan
title: Ars-Vox consolidation + MVP program — two-stage execution DAG (2026-08-08)
description: "Stage 1: GATE-3.5 consolidation (S0 contract freeze → Wave 1, 10 parallel agents → integration gate). Stage 2: MVP backlog completion (Wave 2, 10 agents → GATE-4 hands-free scenario). Stage 3: target-user validation (Wave 3). Hard rule: no new architecture or major product feature until GATE-3.5 passes. Frozen contract: docs/consolidation-contract-2026-08-08.md."
date: 2026-08-08
status: proposed
---

# Ars-Vox consolidation + MVP program — execution DAG (2026-08-08)

Source: advisor consolidation program (2026-08-08), direction approved by
Ars ("Start this"). Extends the GATE-3.5 reviewer 5-track plan (A-E) into a
two-stage program. Supersedes the per-wave gap list in STATUS.md as the
execution contract; STATUS.md is updated ONLY at gates (orchestrator rule 5).

## Program

```yaml
name: ars-vox-consolidation-and-mvp
top_level_goal: >
  One authoritative state and execution path for voice, layout, media,
  confirmations, service lifecycle, and reconnect recovery; then complete
  the remaining MVP product integrations without reintroducing parallel
  legacy systems.
success_definition: >
  A user can launch Ars Vox normally, speak to it, interrupt it, confirm
  actions, browse, watch/listen to media, read, create reminders, and move
  between activities for hours without the UI/backend disagreeing about
  what is happening.
hard_rule: >
  No new architecture or major product feature begins until GATE-3.5 passes.
```

## Execution graph

```
S0: contract spike (orchestrator; docs/consolidation-contract-2026-08-08.md)
   ↓  gate S0 — contract frozen (Ars approval)
WAVE 1: A1..A10 parallel (8 implementation + A8 security spike + A10 adversarial)
   ↓  gate GATE-3.5 — controlled merge + adversarial rerun + acceptance checklist
WAVE 2: B1..B10 parallel (MVP backlog: wake/VAD, WebContentsView browser, DOM
        bridge, real media, reminders, reader persistence, context timestamps,
        memory search, telegram/notes/tasks polish, adversarial)
   ↓  gate GATE-4 — full cold-start hands-free scenario (below)
WAVE 3: target-user validation (4 implementation + 3 UX/a11y + 2 reliability/security
        + 1 regression keeper) — changes map to observed failures only
```

## Wave 1 ownership (one authority per agent — no shared ownership)

| Agent | Authority | Owns | Must fix (headline) | Forbidden |
|-------|-----------|------|---------------------|-----------|
| A1 | Voice lifecycle + STOP | voice/session state machine, TTS lifecycle events, STOP cancellation path, renderer TTS cancellation, silence timer | R01-R08 (TTS acks, physical-anchored states, generation guards) | redesign confirmation handling |
| A2 | Process/auth lifecycle | Electron → Python spawn, token lifecycle, health handshake, connect buffering, shutdown | R09-R15 (P0 one-token launch, buffered early input, visible failures) | broaden renderer privilege |
| A3 | Agent layout contract | Python adaptive tool, model-visible schema, prompt layout instructions | R16-R18 (native LayoutSpec tool, delete news from vocab) | expose CSS/pixels/coordinates |
| A4 | Frontend layout authority | adaptive reducer, constraints, inertia, legacy migration, override runtime | R19-R23 (one choke, spoken overrides, retire old authority) | touch A3's contract silently (CROSS-OWNER protocol) |
| A5 | Media authority | MediaController, agent media tools, client media actions, player sync, snapshot media | R24-R27 (one controller, real seek, position sync, no simulated playback state) | build a recommendation engine (Wave 2) |
| A6 | Reconnect state | SnapshotTracker, snapshot assembly, gap detection, reconciliation | R28-R34 (continuous tracker, authoritative nulls, adaptive composition in snapshot) | decide layout survival semantics alone (document, don't assume) |
| A7 | Confirmations + client contracts | spoken confirm/reject, execution task ownership, ClientAction union, handler coverage | R35-R39 (C1 narrow union, executing cancellation) | widen the confirmation gate surface |
| A8 | Electron security foundation | browser/security module (NOT service spawning), WebContentsView design, IPC validation | R40-R42 (hardened view spike + migration note) | heavily edit A2's startup code (small integration patch only) |
| A9 | Visual cleanup | component-level vocabulary/a11y cleanup only | R43 (PLANTILLA, fake suggestions, labels, STOP sizing) | redesign the shell; touch core state machinery |
| A10 | Adversarial integration tests | seam tests + reproductions; reports failures to owners | R44-R47 + reruns of R01-R43 against merged state | implement fixes unless explicitly reassigned |

## Worktree + brief conventions (Wave 1)

- Worktrees: `/mnt/c/dev/ars-vox-worktrees/g35-a1-voice` … `g35-a10-adversarial`,
  branches `wip/g35-a1-voice` … `wip/g35-a10-adversarial`, from main @ 6fe61c4.
- node_modules junction per worktree:
  `cmd.exe /c "mklink /J node_modules C:\dev\ars-vox\apps\desktop\node_modules"`
- Python from a worktree: single-root PYTHONPATH
  `PYTHONPATH="packages/contracts:services/agent:services/memory:services/tts"`
  from the worktree root (venv `__editable__` finders shadow otherwise —
  the root conftest shim on main handles isolation; do NOT add worktree
  conftest shims).
- Every brief (written to /tmp by the orchestrator, short pointers not
  inline payloads) carries: frozen-scope list (files the agent may touch),
  the R-scenarios it owns, its cross-owner boundary list, and the handoff
  template. Workers coordinate through the orchestrator (hey.md was
  removed 2026-08-09 — see gate-4 remediation standing rules).
- Mandatory context packet for every agent, read IN ORDER: STATUS.md →
  panel-vision.md → latest HANDOFF.md → packages/contracts → files directly
  relevant to the task → this program + the consolidation contract. Warnings
  embedded in every brief:
  1. STATUS.md is useful but not evidence — verify current source before
     modifying anything.
  2. panel-vision.md contains product constraints and beats stale
     implementation comments.
  3. Do not preserve a legacy implementation merely because tests currently
     exercise it if the task explicitly migrates authority away from it.
- Every task ends with the handoff block (TASK / STATUS / WHAT I VERIFIED
  BEFORE EDITING / FILES CHANGED / BEHAVIOR BEFORE / BEHAVIOR AFTER / TESTS
  ADDED / TESTS RUN / KNOWN LIMITATIONS / ASSUMPTIONS / CROSS-TASK IMPACT /
  FOLLOW-UP REQUIRED / COMMIT). No agent gets to say simply "done".

## Orchestrator rules

1. No drive-by cleanup — agents only change files required for their
   assigned outcome. No opportunistic architectural refactoring.
2. Every bug gets a regression test first when practical, especially
   cross-layer bugs.
3. Green unit tests are not enough — every wave gate contains at least one
   vertical scenario crossing renderer → protocol → Python →
   state/persistence/external system → event → renderer. GATE-3.5's
   vertical scenario: R09 cold secure launch, plus seam tests R17/R24/R20.
4. One migration, then delete compatibility — compatibility shims get an
   explicit deletion task/date; legacy layout/media paths must not survive
   forever.
5. STATUS.md is updated only at the gate, by the orchestrator, from
   integrated behavior — never by individual agents declaring the feature
   complete.
- Cross-owner protocol: if an agent discovers a change outside its
  ownership, it does NOT edit silently — it sends the orchestrator
  `CROSS-OWNER CHANGE REQUIRED { owner, reason, proposed interface,
  blocking: yes/no }`.
- Spare capacity within a wave: review another branch, write regression
  tests, inspect cross-layer assumptions — but keep the wave barrier. No
  agent wanders into Wave 2 while GATE-3.5 has failures.

## GATE-3.5 — integration

Controlled merge order (contract must land before both implementation
sides diverge): A7 contracts → A1 voice → A2 launch → A6 snapshots → A3
backend layout → A4 frontend authority → A5 media → A8 security → A9
cleanup → A10 suite. A3/A4 may swap if frontend types depend on
Python-generated schemas. After integration: adversarial rerun (A10) +
full suites from main (pytest + vitest + typecheck + build) + OKF
validator + cold-start e2e.

Acceptance — GATE-3.5 is NOT complete unless ALL hold:

- [x] Cold app launch works without manually sharing an auth token.
- [x] User input during service startup is not lost.
- [x] Button STOP stops model + mic/STT + current TTS.
- [x] Spoken STOP does the same.
- [x] Long TTS does not start the inactivity timeout prematurely.
- [x] Spoken confirmation approves the frozen pending action.
- [x] One global confirmation policy remains intact.
- [x] All ClientActions have real authoritative handlers.
- [x] Agent emits native adaptive LayoutSpec.
- [x] No model-visible News panel remains.
- [x] All layout changes pass through one constrained reducer.
- [x] Persistent user overrides beat later agent preferences.
- [x] Agent and user media actions share one controller.
- [x] Agent media.seek actually changes position.
- [x] SnapshotTracker remains current after >1000 events.
- [x] Sequence gap causes resync.
- [x] Authoritative null/empty snapshot fields clear stale state.
- [x] Frontend + Python suites pass.
- [x] Full cold-start end-to-end scenario passes.

If any fails, the real-browser feature wave does NOT start.

## Wave 2 (MVP backlog — briefs written at GATE-3.5 close, not before)

B1 wake-word/VAD physical voice loop (phrase-AGNOSTIC — wake phrase
undecided, "Lily" a candidate, never "Ars"; no wake-word training or
benchmarking) · B2 browser WebContentsView (real isolated surface,
allowlist enforced; Electron upgrade lands BEFORE enabling arbitrary
browsing) · B3 browser DOM interaction bridge (snapshot/find/click/fill/
submit/scroll; provenance from the start — origin/frame-tagged
observations, never flattened web content; read-only vs state-changing vs
consequential tiers; consequential → deterministic policy/confirmation;
local/private-network + dangerous schemes blocked independently of
allowlists) · B4 real media discovery/playback (ytInitialData search per
backlog; real metadata before user-facing testing — title/channel must
match the video ID; YouTube desktop/embed client-identification) ·
B5 reminder/task notification integration (spoken, snooze, recovery) ·
B6 reader persistence (EPUB progress, PDF page/zoom, resume, library) ·
B7 context timestamps + durable user state (no SQLite dump into context) ·
B8 memory-informed search with provenance (user/inferred/web/doc) +
poisoning tests · B9 Telegram/notes/tasks end-to-end UX · B10 adversarial
reviewer (disconnects, restarts, repeated STOP, long TTS, rapid layout,
malicious browser text, stale confirmations, media while navigating,
suspend/resume, relaunch, provider failures).

## GATE-4 — MVP feature integration

Required scenario (must be boringly reliable or MVP is not finished):
cold launch → wake Ars → open Facebook → browse via DOM controls → ask Ars
something while browser remains primary → play a real YouTube video →
pause and seek → continue media in persistent mode → open a book → continue
from previous position → ask about current activity → create reminder →
reminder fires while another activity is open → snooze by voice → send
Telegram message with spoken confirmation → STOP while Ars is speaking →
leave idle for one minute → Ars sleeps → wake again → close/reopen app →
relevant durable state returns.

## Wave 3 — target-user validation

4 implementation agents (fix observed bugs) + 3 UX/a11y reviewers
(hesitation, readability, layout understandability, voice-state visibility,
mouse reach, natural phrases) + 2 reliability/security reviewers (long
sessions, hostile content) + 1 regression keeper (every real-user failure
becomes a permanent test). No UI redesign from taste alone — every change
maps to an observed failure.

## Priority if something must be cut

Must ship before target-user use: STOP/TTS/voice lifecycle · secure
automatic startup · confirmations · reminder reliability · single layout
authority · reconnect correctness · real browser boundary · wake/VAD
physical test.
Strong MVP: real media · reader resume · Telegram/notes/tasks polish ·
timestamps/context.
Can follow: memory-informed search sophistication · broader browser skill
vocabulary · deeper personalization · visual refinements beyond a11y.
Single-authority cleanup is NOT deferrable — it compounds exponentially
once the browser, wake word, and skills sit on top of it.

## Concurrency notes

- Hermes batch cap is 10 children (env) — Wave 1 dispatches as one batch
  of 10; if the runtime rejects it, fall back to 5+5 with identical briefs.
- Subagent wall-clock caps (~1000s) have bitten every prior wave — timeout
  is expected; the orchestrator runs takeover workers and the gate resolves
  integration. Wave semantics unchanged.
- Worktree conftest shims from previous waves are historical artifacts —
  main's root conftest is the only one that counts.
