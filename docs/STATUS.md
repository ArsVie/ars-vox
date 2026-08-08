---
type: status
title: Ars-Vox current state
description: Single authority for current implementation state. Supersedes all current-state claims in ADRs, audits, and HANDOFF.md. Updated 2026-08-08.
timestamp: 2026-08-08T03:55:00Z
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

## Test gates (last full run, 2026-08-08 ~03:50Z, post GATE-2)

- vitest: 306 passed (25 files) — apps/desktop (baseline 240 + wave-2: 6 browser,
  8 conversation, 6 reading, 7 tasks, 6 media, 6 motion, 8 inertia + 6 gate wiring)
- pytest: 110 passed — tests/python (84 + 26 utterance-level STOP matcher,
  merged from parked branch 2026-08-08)
- typecheck: clean (tsconfig.json + tsconfig.electron.json)
- build: clean (vite build + tsc electron)
- OKF docs validator: 18 concepts validated (2026-08-08)

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
- WAVE 3 UNLOCKED — UI-301 agent layout planner, UI-302 user overrides,
  UI-303 a11y/usability (3 parallel; dispatch pending owner go-ahead).
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
- STT / TTS providers: run in MOCK mode for the demo; real provider
  path exists but is NOT verified end-to-end.
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
  tasks.update, media.state + layout/panel/status/overlay events.
- User commands: youtube.play, browser nav, document.save, tasks.toggle,
  media.play_pause/seek, stop, confirm.
- Python models + TS mirrors + JSON schemas; conformance tests green.

## Security posture

- Local STOP path: implemented, LLM-independent (ADR 0004).
- Confirmation snapshots: SQLite-stored frozen args, executed directly
  (ADR 0003); approval copy is deterministic (tool-specific formatter,
  never model-generated).
- Policy gate: deny-by-default; denied-always tools (shell.exec,
  file.write, file.delete, browser.generic_agent).
- GAP: WebSocket on 127.0.0.1:8765 has NO client auth and NO Origin
  check. Exposure today is limited (web demo, same-origin content
  only). REQUIRED before the Electron browser ships: per-launch
  session credential + Origin check, or main-process-only IPC
  mediation. See threat-model T9.

## Known gaps (next work, prioritized)

1. Voice loop proof on the physical machine (wake/VAD/STT/TTS/barge-in/
   sleep/STOP) + latency + recovery measurements.
2. WS auth + Origin (T9) and deterministic confirmation guards — before
   the real browser.
3. Browser as security boundary: WebContentsView, allowlist enforced,
   remote content sandboxed (no Node), page text treated as untrusted.
4. Product loops: reminder cron context injection, message timestamps
   in agent context, memory-informed search, book progress resume,
   unified media pipeline (real YouTube/local playback).
5. Real-user observation pass — design polish is deferred until
   interaction problems are observed.
