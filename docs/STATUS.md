---
type: status
title: Ars-Vox current state
description: Single authority for current implementation state. Supersedes all current-state claims in ADRs, audits, and HANDOFF.md. Updated 2026-08-09.
timestamp: 2026-08-09T05:00:00Z
---

# Ars-Vox — current state (2026-08-09)
THIS FILE IS THE SINGLE AUTHORITY for current implementation state.
HANDOFF.md is roadmap + session history; ADRs are historical decisions;
audits are snapshots. If any other doc contradicts this file, this file
wins.

## Target hardware

- Physical Windows 11 desktop (mic + speakers), WSL for dev, Windows
  git/gh. The 2014 MacBook Air / Big Sur was an early compatibility
  eval only (ADR 0001 status note).

## Test gates (last full run, 2026-08-09 ~00:00 CST, post GATE-3.5 consolidation)

- vitest: 601 passed (48 files) — apps/desktop (441 post-wave-3 + GATE-3.5:
  A1 TTS acks, A4 one-choke + spoken overrides, A5 media controller, A6
  snapshot/sequence, A7 confirmation, A9 R43 visual, A10 adversarial TS)
- pytest: 308 passed — tests/python (194 post-GATE-2.5 + GATE-3.5: A1 voice
  lifecycle, A3 native layout, A5 media tools + honest seek, A6 tracker +
  snapshot, A7 spoken confirmation + client actions, A10 adversarial python,
  R18 no-news enum, G1/G2 gate fixes)
- typecheck: clean (tsconfig.json + tsconfig.electron.json)
- build: clean (vite build + tsc electron)
- OKF docs validator: 23 concepts validated (2026-08-09)

## GATE-3.5 consolidation (CLOSED 2026-08-09)

Program: docs/plans/consolidation-program-2026-08-08.md (two-stage:
consolidation → MVP backlog). Frozen contract:
docs/consolidation-contract-2026-08-08.md — 8 invariants
(VOICE/STOP/LAYOUT/MEDIA/CONFIRMATION/SERVICE/RECONNECT/CLIENT-ACTIONS),
C1–C8 semantic deltas, R01–R47 regression freeze. All 10 wave-1 branches
merged to main in the frozen order A7→A1→A2→A6→A3→A4→A5→A8→A9→A10 (S0 doc
df48da6; last merge 3d74afb; gate fixes 14e36e0/c0f0526/3006b13/dbb5e5d).

- VOICE (A1, R01–R08): tts.started/finished/cancelled acks; the renderer is
  physical-playback authority; the turn stays THINKING until tts.started and
  only tts.finished settles to LISTENING (or WAITING_FOR_CONFIRMATION);
  silence timer anchored to speech end (SPEAKING is timer-free); late acks
  after STOP are state-guarded no-ops; WS disconnect settles pending speech.
- SERVICE (A2, R09–R15, the P0): Electron main generates ONE per-launch
  token, spawns the Python service, completes an authenticated
  /health→/config handshake; a foreign service holding the port returns 401
  → "failed" (never silently adopted); pre-connect user input is buffered
  and delivered exactly once (R11); startup failures surface as clear UI
  errors (R12); desktop quit kills the child tree (R13); the renderer never
  holds the token (R14 — token-exposing IPC retired); wildcard/empty origins
  and PATCH-persisted auth.enabled=false are rejected (R15).
- LAYOUT (A3+A4, R16–R23): the model speaks the native adaptive LayoutSpec
  (focus/sidecar/stack/split/triple + primary/companion/support/persistent +
  narrow/balanced/wide) through layout.compose; news is gone from every
  model-visible surface incl. PanelType.NEWS (R18, gate-fixed); every layout
  mutation enters ONE applyAdaptiveSpec choke; user overrides (pin/stick/
  position/size/remove/fullscreen/showBoth) apply AFTER planner output and
  beat later agent preferences; spoken override intents are deterministic.
- MEDIA (A5, R24–R27): ONE MediaController for agent tools + human client
  actions + player events; media.seek really changes position (position_s on
  the wire) and answers honestly when nothing is loaded (failed verdict, no
  "Posición cambiada" lie); media=null in the snapshot is authoritative
  absence (player cleared through the controller); snapshot restore routes
  through the same controller.
- RECONNECT (A6, R28–R34): SnapshotTracker holds current state continuously
  (listener-based; the 1000-cap starvation class is gone); authoritative
  null/empty snapshot fields clear stale state; adaptive composition
  (template/assignments/proportion/overrides) rides the snapshot and is
  restored through the ONE choke; client-side sequence-gap detection fires
  resyncHook → WsClient.forceReconnect (R29 — gap item 5 below is now DONE);
  snapshot carries conversation history (reload no longer blanks the chat).
- CONFIRMATION + CLIENT ACTIONS (A7, R35–R39, C1): spoken approve/reject
  vocabulary (confirmar/confirmo/sí/sí enviar/aprobar · cancelar/rechazar/
  no/no enviar) resolves the one global pending against its FROZEN SQLite
  args; ambiguous sí/no with NO pending is ignored (no turn starts);
  executing approved actions carry cancellation tokens + points of no
  return; ClientAction is the narrowed human-initiated union (16 members,
  all with authoritative handlers; tts.speak is server-originated and NOT a
  client action).
- ELECTRON SECURITY (A8, R40–R42): hardened remote-content foundation
  (isolated persistent partition, deny-by-default permissions, navigation
  filter, window-open denial, custom local-doc protocol, IPC sender
  validation) — not wired to UI yet; Electron major upgrade lands BEFORE
  arbitrary real browsing (migration-note-electron-upgrade-2026-08-08.md).
- VISUAL (A9, R43): PLANTILLA combobox dev-gated (DEMO_TOGGLE_ENABLED),
  redundant "agente conectado" gone, one status pill (role="status" with
  STATUS_VOCABULARY), "Lee mis correos" fake suggestion removed, English mic
  aria labels fixed, STOP ≥48px, status vocabulary consistent.
- ADVERSARIAL (A10, R44–R47): cold secure startup, spoken STOP during TTS,
  spoken confirmation, persistent override vs later agent layout, agent
  media → human pause/seek → agent resume, restart with media=null,
  notification reconnect, sequence-gap resync, tracker >1000 events, voice
  disabled on fresh reconnect, client-action completeness, no-news surface.
  20-item gate acceptance: PASSED.

Seam lessons + test-discipline pitfalls (flattened-vs-dotted tool names,
singleton pollution, R11 buffering test channels, merge-marker hygiene):
skill reference gate35-merge-lessons-2026-08.md.

## Adaptive UI redesign (waves)

- WAVE 0 DONE — UI-000 frozen the adaptive UI contract (SurfaceRole /
  AdaptiveTemplate / Proportion / LayoutSpec, registration interface, token
  naming catalog, placeholder fixtures, deterministic validation). Gate
  CONTRACT_FROZEN closed (merge a3e996d). Docs:
  docs/adaptive-ui-contract.md, docs/plans/adaptive-ui-redesign-execution-2026-08-07.md.
- WAVE 1 DONE — UI-101 shell, UI-102 geometry engine, UI-103 role framework,
  UI-104 token values, UI-105 workflow harness all merged to main (GATE-1
  FOUNDATION_INTEGRATION closed 2026-08-07). Note: 4/5 workers hit the
  600s subagent cap; their landed work was gate-verified by the orchestrator
  and committed (UI-104 was the only clean self-commit, d3dae0c).
- WAVE 2 DONE — UI-201 browser, UI-202 conversation, UI-203 reading,
  UI-204 tasks, UI-205 media, UI-206 motion, UI-207 spatial inertia ALL
  merged (GATE-2 ADAPTIVE_SURFACE_INTEGRATION closed 2026-08-08; 7/7 workers
  self-completed in 5+2 batches — no timeouts this wave). Gate wiring:
  product surfaces (browser/conversation/document_editor/tasks/media)
  registered in the surface registry and hosted by the adaptive stage
  through LayoutSpec with the UI-103 role host (src/adaptive/surfaces.ts +
  AdaptiveStage; legacy PanelHost stays for the non-adaptive path). Motion:
  240ms slot transitions keyed by surfaceId (no remount), reduced-motion
  gated. Inertia: pure layout-change scorer + thin store guard in
  applyAdaptiveSpec (equivalent layouts / chatter never churn; user signal
  always applies). Verified live in CDP: split browser+conversation with
  real surfaces, media primary→persistent bar without playback reset,
  readers pixel-verified (below). Screenshots: docs/screenshots/12..22-wave2-*.
- WAVE 3 DONE (2026-08-08, 3 of 3 tracks merged): UI-301 agent layout planner
  (semantic composition authority — agent says WHAT never HOW; invalid
  model output rejected with structured reasons, never reaches state;
  legacy wire layout.apply routed through the planner), UI-302 user
  overrides (persistent constraint set pin/stick/position applied AFTER
  planner output; user-initiated signal bypasses the inertia damping
  wall, agent-initiated stays damped; invalid arrangements degrade
  deterministically to nearest valid), UI-303 usability+a11y (hit-target
  floor, focus-visible rings + tab order, reduced-motion coverage,
  status icons + Spanish aria labels, STOP accessibility, 12px text
  floor, contrast fixes — token catalog only, no redesign). +89 tests
  (27 planner / 40 overrides / 22 a11y).
- GATE-2.5 HARDENING DONE (2026-08-08, 7 tracks merged): H1 bidirectional
  client-action protocol (authoritative ui_command handlers + action_result
  verdicts + cross-language fixtures), H2 reminder correctness (UTC
  instants, occurrence lifecycle, correct snooze/recurrence + tz), H3 STOP
  locally authoritative (renderer-first cancellation, canonical voice
  state machine), H4 local service boundary (bearer auth HTTP+WS, CORS
  lockdown, TTS POST, config validators — audit P0/P1s), H5 reconnect
  recovery (state_snapshot on connect, global one-pending confirmations,
  explicit execute lifecycle, stop invalidates pendings, migration
  0003), H6 canonical config paths + uv.lock, H7 media wiring
  (IFrame-player YouTube control, audio.play, adaptive stage role
  resolution). Merge: 7 branches, 6 deliberate conflict resolutions on
  shared seams (ws.py, mic.ts, contracts.ts, events.py, runtime.py,
  config.py). Integration fix: migration version collision 0002/0002 →
  0003 (reminder lifecycle was being skipped on fresh DBs).
- Execution contract: docs/plans/adaptive-ui-redesign-execution-2026-08-07.md.

## Documents

- TXT/MD: text renderer with chapters; MD editable (Editar → Guardar →
  document.save).
- PDF: pdf.js v6 real renderer (lazy-loaded, worker via vite asset).
- EPUB: epub.js 0.3.x real renderer (paginated, CFI locations, themes,
  A−/A+).
- ✅ READERS FIXED AND VERIFIED ON MAIN (2026-08-08, merge a48c8fe — parked
  branch wip/advisor-round2-reader-polish + the PDF canvasContext fix):
  - EPUB: theme styles are now NESTED OBJECTS ({selector:{prop:value}});
    epub.js addStylesheetRules was emitting EMPTY rules for CSS strings,
    leaving the body transparent with black text. Theme + font are also
    re-applied after display() resolves. Verified live in CDP: body
    computed style rgb(247,244,238) background + dark text, 840 chars of
    Quijote visible, vision-confirmed on the light "Papel" page.
  - PDF: render() now passes `canvasContext` (pdfjs-dist 6.2.108 silently
    no-ops on bare `canvas`), device-pixel transform, fit-width base scale,
    and deterministic error wrapping for open/page failures. Verified live:
    canvas pixel-probe = 100% white (was 100% black).
  - PITFALL (still live): epub display() stalls silently in backgrounded
    CDP tabs (rAF-throttled queue) — activate the tab before driving.
- Local-file access in Electron (custom protocol): PLANNED.
- Book position persistence: backend library.get_position/set_position
  exists; UI resume wiring PLANNED.

## Voice

- Voice state machine, silence timer, wake/listen/speak/interrupt
  semantics: implemented (real code, provider-agnostic).
- WAKE-WORD / VAD PROVIDERS ARE NOT WIRED: `WakeWordDetector`,
  `MockWakeWordDetector`, `Vad` exist in services/voice but have ZERO
  consumers, and `voice.wake_word.*` / `voice.vad.provider` config has
  zero readers. Wiring is IMPLEMENTATION WORK, not just verification.
- STT / TTS providers: real (faster-whisper / edge-tts) with mock
  fallback; verified end to end with a fake audio device
  (scripts/demo_voice.py VOICE_OK, CDP TTS playback). Wake-word/VAD
  providers remain unwired (above).
- STOP vocabulary (utterance-level, accent-stripped): stop, detente,
  deten, alto, basta. "para" was REMOVED (2026-08-07, Ars's decision)
  because it is a common mid-sentence Spanish word.
- Physical microphone smoke test: NOT DONE (blocked on being at the
  physical machine). The wake → ask → interrupt → continue → sleep →
  wake loop is NOT yet proven on real hardware.

## Browser

- Web demo: BrowserPanel with address bar + iframe viewport, driven by
  user and agent (local news page fixture).
- Electron: WebContentsView owned by main process is the DESIGNED
  shape; NOT yet implemented (iframe is web-demo-only).
- Allowlist (`browser.allowlist`) and home URL: NOT enforced anywhere
  (zero readers) — PLANNED before enabling arbitrary remote browsing.

## Wire (contracts)

- Events: youtube.search, browser.navigate, document.load (carries url),
  tasks.update, media.state + layout/panel/status/overlay events +
  action_result (H1) + state_snapshot (H5).
- User commands: ServerCommand = the full UiCommand surface (browser nav,
  document.save, tasks.toggle, media.play_pause/seek, youtube.search,
  layout.apply, panel.* — model + UI both) with authoritative handlers and
  action_result verdicts. ClientAction (GATE-3.5 C1/R39) = the NARROWED
  human-initiated union (16 members: browser.back/forward/navigate/refresh,
  document.save, layout.apply/restore, media.play_pause/seek,
  panel.close/fullscreen/open/set_primary, tasks.toggle, youtube.play/search)
  — tts.speak and other server-originated commands are NOT client actions;
  every declared ClientAction has an authoritative handler (enumeration
  guard test).
- Cross-language conformance: every TS UiCommand action has a Python-
  parseable fixture (packages/contracts/fixtures/); the bridge test
  fails if one side drifts.
- Python models + TS mirrors + JSON schemas; conformance tests green.

## Security posture

- Local STOP path: implemented, LLM-independent (ADR 0004); now locally
  authoritative in the renderer (mic/STT/TTS aborted first, generation
  guards) + one canonical voice state machine (GATE-2.5 H3).
- Confirmation snapshots: SQLite-stored frozen args, executed directly
  (ADR 0003); approval copy is deterministic (tool-specific formatter,
  never model-generated). Explicit lifecycle pending → approved →
  executing → executed | failed (H5); global one-pending policy
  (new confirmable supersedes the old, reported on the wire); stop
  invalidates pendings.
- Policy gate: deny-by-default; denied-always tools (shell.exec,
  file.write, file.delete, browser.generic_agent).
- Local service boundary (GATE-2.5 H4 + GATE-3.5 A2): per-launch bearer
  token on HTTP + WS (query param for WS), CORS locked to configured
  origins (no wildcard), /tts is POST-only, STT upload capped, config
  validation constrains model base_url (https / localhost-http only) and
  system_prompt_file (repo docs/configs only). Electron main GENERATES the
  token, spawns the service with it, and owns the authenticated handshake;
  the renderer NEVER holds the token (preload token IPC retired, R14);
  wildcard/empty origins and PATCH-persisted auth.enabled=false are
  rejected (R15). Dev/mock mode can disable auth via config
  (auth.enabled=false).

## Known gaps (next work — WAVE 2 of the consolidation program, prioritized)

0. GATE-3.5 is CLOSED (see above). Wave 2 = MVP backlog (program doc
   `docs/plans/consolidation-program-2026-08-08.md`):
   A real wake word / VAD physical voice loop (phrase UNDECIDED — "Ars" is
   the family prefix, NOT the wake word; "Lily" is a candidate; no
   training/benchmarking until Ars selects it),
   B real browser WebContentsView (allowlist enforced, hardened partition,
   Electron major upgrade FIRST),
   C browser DOM interaction bridge (snapshot/find/click/fill/submit/scroll;
   page content = untrusted),
   D real media discovery/playback (real YouTube search + accurate metadata,
   no fake fixtures),
   E reminder/task notification integration (repeated snooze/dismiss/
   restart reliability),
   F reader persistence (book progress resume, PDF page/zoom restore),
   G context timestamps + durable user state (time/activity/tasks in
   runtime context, never dump the DB),
   H memory-informed search with provenance (user/agent/web/document),
   I telegram/notes/tasks end-to-end polish (no tool names visible to the
   user), plus UI: confirmation popup-in-chat / voice-ask, minimal state
   panel embedded near the gaze, media-player progress bar tied to the
   YouTube iframe (R26), exit/home affordance + panel close X (backlog).
1. Voice loop proof on the physical machine (wake/VAD/STT/TTS/barge-in/
   sleep/STOP) + latency + recovery measurements.
2. Browser as security boundary: WebContentsView, allowlist enforced,
   remote content sandboxed (no Node), page text treated as untrusted.
   (WS auth + Origin are DONE — GATE-2.5 H4; hardened-view module exists
   — GATE-3.5 A8 — wiring is Wave 2 B.)
3. Product loops: reminder cron context injection, message timestamps
   in agent context, memory-informed search, book progress resume,
   unified media pipeline (real YouTube/local playback).
4. Real-user observation pass — design polish is deferred until
   interaction problems are observed.
5. DONE (GATE-3.5 A6/R29): client-side sequence-gap detection fires
   resyncHook → WsClient.forceReconnect on sequence jumps.
