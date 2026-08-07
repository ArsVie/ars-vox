---
type: status
title: Ars-Vox current state
description: Single authority for current implementation state. Supersedes all current-state claims in ADRs, audits, and HANDOFF.md. Updated 2026-08-07.
timestamp: 2026-08-07T20:34:25Z
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

## Test gates (last full run, this commit)

- vitest: 96 passed (6 files) — apps/desktop
- pytest: 67 passed — tests/python
- typecheck: clean (tsconfig.json + tsconfig.electron.json)
- build: clean (vite build + tsc electron)
- OKF docs validator: 13 concepts validated

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

## Documents

- TXT/MD: text renderer with chapters; MD editable (Editar → Guardar →
  document.save).
- PDF: pdf.js v6 real renderer (lazy-loaded, worker via vite asset).
- EPUB: epub.js 0.3.x real renderer (paginated, CFI locations, themes,
  A−/A+). Verified visually: docs/screenshots/04-reading-epub.png,
  05-reading-pdf.png.
- Local-file access in Electron (custom protocol): PLANNED.
- Book position persistence: backend library.get_position/set_position
  exists; UI resume wiring PLANNED.

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
