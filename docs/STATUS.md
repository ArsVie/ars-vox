---
type: status
title: Ars-Vox current state
description: Single authority for current implementation state. Supersedes all current-state claims in ADRs, audits, and HANDOFF.md. Updated 2026-08-08.
timestamp: 2026-08-08T06:15:00Z
---

# Ars-Vox — current state (2026-08-08)
THIS FILE IS THE SINGLE AUTHORITY for current implementation state.
HANDOFF.md is roadmap + session history; ADRs are historical decisions;
audits are snapshots. If any other doc contradicts this file, this file
wins.

## Target hardware

- Physical Windows 11 desktop (mic + speakers), WSL for dev, Windows
  git/gh. The 2014 MacBook Air / Big Sur was an early compatibility
  eval only (ADR 0001 status note).

## Test gates (last full run, 2026-08-08 ~06:11 CST, post GATE-2.5 + WAVE 3)

- vitest: 441 passed (35 files) — apps/desktop (306 baseline + 46 GATE-2.5
  + 89 wave-3: 27 planner, 40 overrides, 22 a11y)
- pytest: 194 passed — tests/python (110 baseline + 83 GATE-2.5
  + youtube.play client-local ack)
- typecheck: clean (tsconfig.json + tsconfig.electron.json)
- build: clean (vite build + tsc electron)
- OKF docs validator: 19 concepts validated (2026-08-08)

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
- User commands: the FULL UiCommand surface is authoritative — browser
  nav (navigate/back/forward/refresh), document.save, tasks.toggle,
  media.play_pause/seek, audio.play, youtube.search, layout.apply —
  every action string has a Python ClientAction union entry and an
  authoritative handler; the UI receives action_result verdicts
  (accepted/done/failed/unsupported) instead of optimistic silence
  (GATE-2.5 H1).
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
- Local service boundary (GATE-2.5 H4): per-launch bearer token on HTTP
  + WS (query param for WS), CORS locked to configured origins (no
  wildcard), /tts is POST-only, STT upload capped, config validation
  constrains model base_url (https / localhost-http only) and
  system_prompt_file (repo docs/configs only). Electron main generates
  and injects the token via preload. Dev/mock mode can disable auth via
  config (auth.enabled=false).

## Known gaps (next work, prioritized)

1. Voice loop proof on the physical machine (wake/VAD/STT/TTS/barge-in/
   sleep/STOP) + latency + recovery measurements.
2. Browser as security boundary: WebContentsView, allowlist enforced,
   remote content sandboxed (no Node), page text treated as untrusted.
   (WS auth + Origin are DONE — GATE-2.5 H4.)
3. Product loops: reminder cron context injection, message timestamps
   in agent context, memory-informed search, book progress resume,
   unified media pipeline (real YouTube/local playback).
4. Real-user observation pass — design polish is deferred until
   interaction problems are observed.
5. Post-reconnect gap detection: state_snapshot carries the bus
   sequence, but QueueFull-drop resync (requesting a replay on gap) is
   not yet wired — reconnect is the sync mechanism today (H5).
