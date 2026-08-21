---
type: contract
title: Consolidation contract — one authority per runtime concern (S0)
description: "S0 freeze before the GATE-3.5 consolidation wave: 8 runtime invariants, semantic deltas vs current implementation (C1-C8), and the P0/P1 regression scenario freeze (R01-R47). Proposed — Ars approval at the S0 gate freezes it. Program DAG: docs/internal/plans/consolidation-program-2026-08-08.md."
date: 2026-08-08
status: proposed
---

# Consolidation contract (S0 — 2026-08-08)

Source: advisor consolidation program (2026-08-08, direction approved by Ars:
"Start this") + GATE-3.5 external review triage. This document freezes what
"one authority" means BEFORE ten workers touch the system. It is NOT an
implementation plan — Wave-1 scope per owner lives in the program doc.

Evidence snapshot: repo main @ 6fe61c4, 2026-08-08 20:25 CST. Last commit
(248e69d) reports 206 pytest / 444 vitest, typecheck+build clean. Suites are
re-run at the gate; per-file claims below were verified against the live tree
at snapshot time.

## Invariants (one authority each)

### VOICE
One canonical session/voice state machine. Physical TTS start/end
participates in that state.
- Baseline: canonical machine exists (H3, renderer-first, generation guards),
  but there are NO `tts.started/finished/cancelled` acks — Python may return
  to LISTENING while the speaker still talks, and the silence timer has no
  physical-playback anchor.
- Frozen: `tts.started` / `tts.finished` / `tts.cancelled` (or equivalent
  acks) exist on the wire; LISTENING only after physical TTS playback ends;
  silence timeout begins after speech finishes, not when the model finishes.

### STOP
Every STOP path performs the same cancellation semantics.
- Baseline: local STOP path is authoritative (H3); button + spoken share the
  renderer-first primitive. Gap: STOP cannot cancel an already-EXECUTING
  approved action (coordinator awaits the executor directly; runtime.cancel
  only invalidates pending).
- Frozen: one cancellation primitive, used by button, spoken STOP, and
  executing-action cancellation (tokens + per-tool point-of-no-return).

### LAYOUT
One adaptive layout contract. All layout mutations enter one reducer.
User constraints > agent preference.
- Baseline: frozen LayoutSpec exists (packages/contracts/arsvox_contracts/
  adaptive.py; TS mirror; planner UI-301; overrides UI-302; applyAdaptiveSpec
  choke with userInitiated seam), but the MODEL still speaks the old
  vocabulary: `ui_apply_layout(template=focus/split/reading/dashboard,
  primary_panel=..., slots main/side/rail/dock)` and prompts/system.md
  (lines 12-70) teaches it. `news` remains in executable code
  (src/layout/engine.ts, ContentPanel.tsx, BrowserPanel.tsx, PanelHost.tsx,
  ui_tools.py, demo_tools.py template="dashboard").
- Frozen: agent emits native LayoutSpec (template sidecar/stack/split/triple,
  role assignments, proportion; no pixels/CSS/coordinates); old vocab removed
  from every model-visible surface; legacy adapter may exist only as a
  non-authoritative compatibility shim with an explicit deletion task.

### MEDIA
One MediaController. Agent + user + player events all use it.
- Baseline: split-brain confirmed — H1's `_MediaController`
  (services/agent/arsvox_agent/actions.py:57,83,89) vs the H7 media tool
  path emitting MediaStateChange directly; `media.seek(seconds)` reports
  "Posición cambiada" without emitting a position; player progress bar is
  unrelated to iframe playback; youtube.search is fixtures-only (Wave 2).
- Frozen: agent tools, client actions, and player events all route through
  one controller; seek actually changes position; duration/position synced;
  primary ↔ persistent transitions never remount/reset playback. NO
  React-only simulated playback state — player callbacks feed the
  controller and the controller is the single authoritative state.

### CONFIRMATION
One global pending confirmation. Executing actions have explicit
cancellation semantics.
- Baseline: one-pending policy + lifecycle pending→approved→executing→
  executed|failed (H5), SQLite frozen args, stop invalidates pendings.
  Gap: executing actions have no cancellation token / point-of-no-return
  table; spoken confirm/reject vocabulary exists but is not wired to the
  pending action.
- Frozen: spoken approval/rejection of the single pending confirmation;
  explicit execution lifecycle incl. cancelled; each external side effect
  documents its point of no return.

### SERVICE
Electron owns secure service startup. One token per launch. Renderer does
not coordinate service credentials manually.
- Baseline: token rides ARSVOX_AUTH_TOKEN env, exported to both processes
  (electron/main.ts:28-32); renderer reads it via preload
  `getAuthToken` (P2: token exposed to renderer JS); Python and Electron
  can independently generate different tokens (reviewer P0); no spawn/
  handshake ownership; no buffering of pre-connect input.
- Frozen: Electron main generates one per-launch token, spawns the service,
  completes an authenticated health handshake; renderer never holds the
  token (main proxies auth); pre-connect user input is buffered and
  delivered exactly once; desktop exit terminates the child; startup
  failures are visible, not a silent disconnected state.

### RECONNECT
Snapshot represents current truth. Sequence gaps trigger resynchronization.
- Baseline: state_snapshot on connect (H5) now carries history (248e69d,
  `_recent_history`) + sequence + pending + media + notifications + panels.
  Gaps: voice fallback hardcodes LISTENING (snapshot.py:136); media=null
  does NOT clear a stale player (a test asserts preservation); notifications
  are sent but the UI ignores them; adaptive composition
  (template/roles/proportion/constraints) is NOT in the snapshot; sequence
  numbers are never checked client-side (STATUS gap 5); SnapshotTracker
  buffers bus events between connects (drain-on-snapshot) — QueueFull can
  drop media/voice events (reviewer: starvation >1000 events).
- Frozen: snapshot fields are authoritative — null/empty MEANS absence and
  clears stale state; voice comes from pipeline config, never a hardcoded
  default; adaptive composition is reconstructible from the snapshot;
  client tracks last sequence and a gap triggers resync; tracker holds
  current state continuously.

### CLIENT ACTIONS
ClientAction and ServerCommand are separate contracts.
- Baseline: H1 mirrored the FULL UiCommand surface into ClientAction (incl.
  renderer-only things like tts.speak) — mirror, not a real separation.
- Frozen: ClientAction = ONLY the actions the human client is allowed to
  initiate; ServerCommand keeps the full union. Every declared ClientAction
  has an authoritative handler; an enumeration test fails if one drifts.

## Semantic deltas (C1-C8) — where this contract contradicts main

These are direction changes on top of H1/H3/H5/H7 work, not claims those
tracks were wrong. They are the consolidation targets.

| # | Area | Today (main @ 6fe61c4) | Frozen |
|---|------|------------------------|--------|
| C1 | ClientAction | full UiCommand mirror (client_messages.py) | narrowed human-initiated union; server keeps full |
| C2 | media=null | renderer preserves stale player (test asserts it) | authoritative absence → clears player |
| C3 | snapshot voice | hardcoded VoiceState.LISTENING fallback (snapshot.py:136) | from pipeline config/state |
| C4 | TTS physical | no started/finished/cancelled acks; LISTENING while speaker talks | acks on wire; LISTENING after speech ends; silence timer anchored to speech end |
| C5 | layout vocab | model speaks focus/split/reading/dashboard + main/side/rail/dock; news in code | native LayoutSpec tool; news gone from model-visible vocab; legacy adapter non-authoritative + deletion task |
| C6 | service token | env-shared token; renderer getAuthToken (P2) | Electron main generates + spawns + handshakes; renderer never holds token |
| C7 | executing cancel | stop invalidates pending only; executor awaited directly | cancellation tokens; explicit point-of-no-return per tool |
| C8 | snapshot tracker | buffers between connects; drain-on-snapshot; QueueFull drops | continuously current state; no event loss window |

## Regression scenario freeze (P0/P1 findings)

Each scenario is a cross-layer guard (renderer → protocol → Python →
state → event → renderer where applicable). Owner = Wave-1 agent. Status is
checked at dispatch; "new" means no known test guards it today.

### A1 Voice lifecycle (R01-R08)
- R01 Spoken STOP during TTS stops physical playback. (new)
- R02 Button STOP during TTS — same primitive/outcome as R01. (partial: H3)
- R03 STOP while STT pending aborts mic/STT, no partial turn. (partial: H3)
- R04 Late STT result after STOP is dropped (generation guard). (new)
- R05 TTS finishes → LISTENING; never before speech ends. (new)
- R06 Long TTS does not start the silence timer mid-playback. (new)
- R07 TTS cancelled → expected terminal state + tts.cancelled ack. (new)
- R08 tts.started/finished/cancelled exist in contracts and the renderer
  consumes them (voice state reflects physical playback). (new)

### A2 Secure launch (R09-R15)
- R09 Cold launch with no manually shared token: Electron generates one,
  spawns service, authenticated health OK, UI ready. (P0; new integration)
- R10 Wrong token fails; right token succeeds. (partial: H4 unit)
- R11 Early user_text before first WS connect is buffered, delivered
  exactly once. (new)
- R12 Service startup failure shows a clear UI error, not silent
  disconnected. (new)
- R13 Desktop exit terminates the child service. (new)
- R14 Token never readable by renderer JS (preload narrowed; auth via
  main-proxied calls). (inverts P2)
- R15 Auth config cannot be persisted into disabled/wildcard state via
  PATCH (quality-reviewer finding). (new)

### A3 Agent layout contract (R16-R18)
- R16 Every valid adaptive template parses via the native model tool
  (sidecar/stack/split/triple + roles + proportion). (new)
- R17 Invalid specs — duplicate surfaces, unsupported roles, arbitrary
  geometry — are rejected deterministically and never reach state.
  (partial: validator unit)
- R18 Model-visible surface vocabulary contains NO news (prompt + tool
  schema + demo). (new)

### A4 Frontend layout authority (R19-R23)
- R19 All layout sources (agent/manual/spoken/reconnect/migration) enter
  the one applyAdaptiveSpec choke. (partial: UI-301/302)
- R20 User closes Conversation → later agent composition → explicit
  constraint still wins; equivalents for pin/right/fullscreen/showBoth.
  (partial: override-bypass seam test exists; extend)
- R21 Spoken overrides ("haz esto más grande", "déjalo ahí", ...) reach
  deterministic OverrideIntents — no vague model suggestions. (new)
- R22 Old layout authority retired or non-authoritative; legacy adapter
  has an explicit deletion task. (new)
- R23 Legacy wire layout.apply still routes through the planner. (exists:
  UI-301 tests; keep)

### A5 Media authority (R24-R27)
- R24 Agent play → user pause → user seek → agent resume: one controller,
  no "no media loaded" on user actions. (new)
- R25 media.seek(seconds) actually changes playback position (no fake
  "Posición cambiada"). (new)
- R26 Player duration/current position synced with the iframe; progress
  bar reflects real playback; no React-only simulated state — player
  callbacks feed the controller. (backlog item; new)
- R27 Primary ↔ persistent transition never remounts/resets playback.
  (exists: UI-205; keep + controller wiring)

### A6 Snapshot/reconnect (R28-R34)
- R28 SnapshotTracker holds current state after >1000 bus events (no
  starvation). (new)
- R29 Client detects a sequence gap and requests/forces a resync. (new)
- R30 media=null in snapshot clears the stale player. (inverts a test)
- R31 history=[] / notifications=[] are authoritative clears. (new)
- R32 Snapshot voice state comes from pipeline config, never hardcoded
  LISTENING. (inverts snapshot.py:136)
- R33 Adaptive composition (template/roles/proportion/constraints) is in
  the snapshot; a reload reconstructs the workspace. (new)
- R34 Pending confirmation restored on reconnect (exists: H5) and
  notifications actually rendered by the UI. (partial)

### A7 Confirmations + client actions (R35-R39)
- R35 Spoken approval (confirmar/confirmo/sí/sí enviar/aprobar) executes
  the frozen pending args; spoken rejection (cancelar/rechazar/no) cancels.
  (new)
- R36 Ambiguous sí/no outside confirmation mode is ignored (conservative).
  (new)
- R37 One global pending policy intact: new confirmable supersedes old,
  reported on the wire. (exists: H5; keep)
- R38 STOP cancels an already-executing approved action (token +
  point-of-no-return per tool). (new)
- R39 Contract-enumeration test fails if any declared ClientAction lacks an
  authoritative handler; union is the narrowed human-initiated set. (C1)

### A8 Electron security foundation (R40-R42)
- R40 Hardened remote-content view spike: permission deny-by-default,
  navigation filtering, window-open denial, custom protocol over permissive
  file:, separate persistent session/partition + isolated-world DOM
  execution, NO privileged Ars-Vox preload in remote pages; local/
  private-network destinations and dangerous schemes blocked independently
  of domain allowlists — instantiable, with a migration note. (new)
- R41 IPC sender validation (no unvalidated senders). (new)
- R42 Electron upgraded BEFORE enabling arbitrary real browsing; CSP,
  navigation/new-window restrictions, permissions, isolated session, and
  IPC-sender validation fold into the real-browser milestone. (new)

### A9 Visual cleanup (R43)
- R43 Production UI free of implementation vocabulary: no PLANTILLA
  selector, no "Lee mis correos" suggestion, one status indicator, no
  CONVERSACIÓN header when primary, no raw `tool:` names in confirmations,
  Spanish mic accessibility labels, STOP sizing/touch-target floor,
  consistent status vocabulary. DOM/aria assertions. (new)

### A10 Adversarial integration (R44-R47)
- R44 One-shot reminder snooze across the full path (spoken snooze).
- R45 Recurring reminder snooze across the full path.
- R46 Voice disabled on fresh reconnect — no spurious LISTENING.
- R47 Service restart with media=null + notification reconnect (reruns the
  R28-R34 family against the integrated system).

## Advisor additions folded in at S0 (paste_5, Ars-pasted 2026-08-08)

- Wake word: phrase is UNDECIDED — "Ars" is the project-family prefix, NOT
  the wake word; "Lily" is one candidate. Keep providers/config
  phrase-agnostic; no wake-word benchmarking or training until Ars picks
  the phrase. (Enforced: Not-frozen section + program B1.)
- Browser provenance from the start: observations/actions retain page/frame
  origin + source provenance; never flatten web content into anonymous
  text/elements — the future policy layer reasons about cross-origin data
  flow as well as action type. (Program B3.)
- Browser security: Electron-main-owned WebContentsView + separate
  persistent session/partition + isolated-world DOM execution; remote pages
  receive NO privileged Ars-Vox preload/API; web content is untrusted data.
  (R40.)
- Browser action policy: read-only (snapshot/find/scroll) vs state-changing
  (click/fill) vs consequential (submit/send/upload/account changes)
  tiers; consequential routes through deterministic policy/confirmation;
  local/private-network destinations and dangerous schemes blocked
  independently of domain allowlists. (R40, program B3.)
- Electron upgrade lands BEFORE enabling arbitrary real browsing; CSP,
  navigation/new-window restrictions, permissions, isolated session, and
  IPC-sender validation fold into the real-browser milestone. (R42,
  program B2.)
- Media: no React-only simulated playback state; the actual player and the
  single MediaController converge on one authoritative state; agent tools,
  human controls, and player callbacks all use the same controller; real
  seek, current time, duration, and playback state required. (MEDIA
  invariant, R24-R26.)
- YouTube: fake search metadata replaced before user-facing testing —
  displayed title/channel must correspond to the actual video ID; account
  for YouTube desktop/embed client-identification requirements in the real
  player integration. (Program B4.)

## Not frozen here (deferred by design)

- Real YouTube search backend (Wave 2; backlog ytInitialData suggestion).
- Wake-word / VAD provider wiring + physical hardware proof (Wave 2).
- WebContentsView full browser + DOM interaction bridge (Wave 2).
- Reader/book persistence, memory-informed search, context timestamps,
  Telegram/notes/tasks polish (Wave 2).
- Electron upgrade final target version (decided with the browser wave —
  but the upgrade itself must land BEFORE arbitrary browsing is enabled,
  per advisor addition).
- Wake-word phrase: UNDECIDED (see advisor additions above). No wake-word
  training/benchmarking until Ars selects it.
- Any UI redesign beyond the R43 cleanup list (Wave 3, mapped to observed
  failures only — no taste-driven redesign).
- Ambiguous-confirmation policy details beyond R36 (conservative default
  unless Ars specifies otherwise).

## Gate

Ars approval at the S0 gate freezes this contract. Changes afterwards are
CROSS-OWNER CHANGE REQUIRED messages to the orchestrator, and the contract
is updated at the GATE-3.5 gate only.
