---
type: status
title: Ars-Vox current state
description: Single authority for current implementation state. Supersedes all current-state claims in ADRs, audits, and HANDOFF.md. Updated 2026-08-07.
timestamp: 2026-08-07T21:30:00Z
---

# Ars-Vox — current state (2026-08-07)

THIS FILE IS THE SINGLE AUTHORITY for current implementation state.
HANDOFF.md is roadmap + session history; ADRs are historical decisions;
audits are snapshots. If any other doc contradicts this file, this file
wins.

## Target hardware

- Physical Windows 11 desktop (mic + speakers), WSL for dev, Windows
  git/gh. The 2014 MacBook Air / Big Sur was an early compatibility
  eval only (ADR 0001 status note).

## Test gates (last full run, 2026-08-07 ~18:56, post GATE-1)

- vitest: 240 passed (13 files) — apps/desktop (baseline 111 + wave-1: 20 tokens,
  38 geometry, 28 roles, 43 harness)
- pytest: 84 passed — tests/python
- typecheck: clean (tsconfig.json + tsconfig.electron.json)
- build: clean (vite build + tsc electron)
- OKF docs validator: 18 concepts validated

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
- WAVE 2 UNLOCKED — UI-201..207 (7 tasks; runs as 5+2 batches, Hermes caps
  parallel children at 5).
- Execution contract: docs/plans/adaptive-ui-redesign-execution-2026-08-07.md.

## Documents

- TXT/MD: text renderer with chapters; MD editable (Editar → Guardar →
  document.save).
- PDF: pdf.js v6 real renderer (lazy-loaded, worker via vite asset).
- EPUB: epub.js 0.3.x real renderer (paginated, CFI locations, themes,
  A−/A+).
- ⚠️ READERS CURRENTLY BROKEN ON MAIN (root cause established 2026-08-07 by
  hermes-epub investigation, evidence-backed, stable CDP browser on a FRESH
  vite — the long-running 5173 vite was serving a STALE pre-parking
  transform with the fixes baked in, so tests against it saw the fix, not
  main; always verify against a fresh vite):
  - EPUB: theme styles are passed to epub.js as CSS STRINGS; epub.js
    addStylesheetRules emits empty rules (`body { }`), body stays
    transparent with black text → invisible page on the dark stage. Text
    IS in the DOM; iframes mount after ~6–11s. Fix: parked branch
    `wip/advisor-round2-reader-polish` (nested `{selector:{prop:value}}`
    objects + re-apply after display) — validated correct at epubjs
    source level.
  - PDF: pdfjs-dist@6.2.108 API drift — `render({canvas})` without
    `canvasContext` silently no-ops (v6 destructures
    `canvasContext, canvas = canvasContext.canvas`); canvas stays 100%
    black, zero paint calls. Fix NOT in parked branch (its pdfReader
    change is only fit-width) — must pass `canvasContext` + wrap
    loadTask/showPage errors (intermittent "No se pudo abrir el
    documento" flash observed). Implement-and-verify NEXT.
  - Parked branch `wip/advisor-round2-reader-polish` = previous session's
    reader/statusbar/local-intents work; merge + add the PDF canvasContext
    fix + visually verify before claiming readers work. Expect merge
    conflicts in styles.css/content.css with wave-1 catalog tokens.
- Local-file access in Electron (custom protocol): PLANNED.
- Book position persistence: backend library.get_position/set_position
  exists; UI resume wiring PLANNED.

## Voice

- Voice state machine, silence timer, wake/listen/speak/interrupt
  semantics: implemented (real code, provider-agnostic).
- STT / TTS providers: run in MOCK mode for the demo; real provider
  path exists but is NOT verified end-to-end.
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
