---
type: handoff
title: "Ars-Vox handoff — 2026-08-07 (night): config-driven UI + live windows demo + modularity audit fixes"
description: Authoritative roadmap and latest session state. Session shipped config-driven UI wiring (endpoints.ts, store.applyConfig, a11y modes, tts knobs), live multi-turn LLM window-management demo (MULTI_OK 5/5), modularity audit fixes, and the taste-skill design-governance pass.
---

# Ars-Vox handoff — 2026-08-07 (night session)

> UPDATE (late 2026-08-07): content channel shipped — panels are POPULATED
> in mock mode (screenshots: docs/review-2026-08-07/05-dashboard-populated.png,
> 06-reading-populated.png, 07-split-populated.png). Frozen panel vision:
> docs/panel-vision.md — Ars's spec, NOT agent-editable (mirrored in ars-vox
> skill ref panel-vision-2026-08.md). New events: youtube.search,
> browser.navigate, document.load, tasks.update, media.state (Python +
> TS mirrors + schemas). New components: YoutubePanel, BrowserPanel,
> TasksPanel, DocumentPanel (reader+editor), unified MediaDock.
> Mock opens a populated dashboard via demo_populate (policy-classified).
> Tests: 96 vitest (desktop), 67 pytest. Next: backend runtime wiring —
> reminder cron context injection, message timestamps in agent context,
> memory-driven search personalization, Electron webview for browser,
> real media pipeline.
>
> UPDATE 2 (late 2026-08-07): REAL PDF/EPUB readers shipped (pdf.js v6 +
> epub.js 0.3.x behind one Reader interface; ReaderView with nav/location/
> font/theme controls; single-page spreads). Verified: 08-reading-epub.png
> (serif book page) + 09-reading-pdf.png (rendered Quijote canvas).
> document.load now carries url. Details + pitfalls in ars-vox skill ref
> document-reader-2026-08.md. Fixture generator:
> apps/desktop/scripts/gen-demo-fixtures.py. Remaining: Electron custom
> protocol for local files, book position persistence pass.

Supersedes the evening handoff (advisor round-2 state remains true; this
session added the config-driven layer + demo hardening + cleanup).

## State summary

**A verified agent-service foundation with a multi-zone desktop UI, a
verified live model path (deepseek-v4-flash via opencode-go), and a
fully wired real voice path EXCEPT the physical microphone on the
target machine.** This session's theme: make the config actually drive
the UI, prove the LLM manages windows across turns, and kill
duplicated/reinvented parts.

## Shipped this session (commit 28493cf)

1. **Config-driven UI (the "tuneable configs" deliverable)** — the UI
   no longer hardcodes anything that app.yaml declares:
   - NEW `apps/desktop/src/endpoints.ts` — single source for WS/TTS/STT
     URLs, overridable at build time with `VITE_AGENT_URL`. Killed the
     4x hardcoded `127.0.0.1:8765` (was ws/client.ts, main.tsx, mic.ts,
     TtsPlayer.tsx).
   - `store.applyConfig` on `config_update` now wires: `ui.reduced_motion`,
     `ui.large_text`, `ui.high_contrast`, `ui.default_template`,
     `ui.default_primary` (applied only BEFORE the first layout command,
     so reconnects can't clobber user state), `tts.speed` (TtsPlayer
     playbackRate), `tts.queue_max` (shared pushSpeak helper replaces
     the 3x copy-pasted cap).
   - `App.tsx` sets `data-large-text` / `data-high-contrast`; styles.css
     has matching blocks. Both verified in-browser.
   - VERIFIED: mock service booted with `ui.default_template: reading,
     ui.default_primary: news` → UI booted to reading/news straight
     from config (store spec showed reading/news, DOM showed Noticias
     62% main + Conversación 31% side).
2. **Typed wire contracts** — contracts.ts now has typed enum unions
   (NotificationKind, MediaState, ConfirmationStatus, WirePanelId,
   AppConfigWire) instead of `string`; conformance tests extended to
   check ALL 4 schema enums + PanelType parity (layout 12 + overlay
   2). Store narrows overlay panels (confirmation/notification) out of
   the layout registry.
3. **Live multi-turn window-management demo** — `scripts/demo_live.py`
   gained `--scenario windows` (5 turns: open youtube, split document
   + conversation, news main + conversation, fullscreen, restore).
   Result: **MULTI_OK turns=5, 0 errors** (ran twice, incl. after the
   harness refactor; turn 1 emitted 2 typed commands). `--scenario
   single` preserved byte-compatible.
4. **Modularity audit fixes** (report: docs/audit-modularity-2026-08-07.md):
   - `scripts/_harness.py` — shared temp-config/health/run_server used
     by demo_live.py, smoke_mock.py, __main__.py (SMOKE_OK re-verified).
   - `utcnow_iso` from arsvox_memory.db replaces 10 copy-pasted `_now()`.
   - Memory repos import contracts enums instead of SQL literals /
     STATUSES tuples.
   - `tests/python/conftest.py` now loads the REAL configs/app.yaml and
     overrides only test-specific keys (was a stale 4th copy of the tree).
   - `runtime.py` enforces `agent.model.max_steps` via
     `UsageLimits(tool_calls_limit=...)`.
   - system.md panel list fixed (was missing settings/confirmation/
     notification) + new drift-guard test
     (`test_system_prompt_names_all_panel_types`).
   - configs/app.example.yaml template list synced; export_schemas.py
     docstring fixed; TTS default voice constant shared.
5. **Design governance pass (taste-skill adoption, MIT)** — report:
   docs/taste-skill-analysis-2026-08-07.md. styles.css now has a
   governance header (VARIANCE 3 / MOTION 2 / DENSITY 5), documented
   radius scale (--radius-xs/sm/lg/pill), machined panel inset
   highlight, tabular-nums in status bar, tactile press on mic button,
   hardened reduced-motion block, accessibility-mode blocks.

## Verification (all real, this session)

- 58/58 pytest (was 57; +1 drift-guard), 74/74 vitest (was 64),
  typecheck clean, build clean.
- LIVE_OK single turn; MULTI_OK 5/5 twice (live dsv4-flash via
  opencode-go, key from ~/.hermes/.env).
- SMOKE_OK after _harness refactor.
- Browser (CDP): config-driven default layout verified; full user turn
  verified (sendText "Abre un documento" → split/document_editor +
  user/assistant messages); vision review passed (reading layout,
  empty states, status bar correct).

## Still open (deliberately not started)

1. Real media playback controls in MediaDock (media.state still no-ops
   in the store).
2. Real-mic smoke test on the physical Windows machine.
3. copilot-advisor (claude-opus-4.8) review of the NEW screenshots —
   planned but not run (browser screenshot/eval targets diverged; see
   pitfall). Vision review passed in-session; the advisor round is
   polish, not a blocker.
4. Remaining taste-skill items (optional): Geist display font eval,
   full skeleton-loader states, copy discipline sweep (one label per
   intent, em-dash audit in chrome strings).

## Commands

```bash
# python suite (repo root, .venv)
.venv/bin/python -m pytest tests/python -q          # 58/58
# desktop suite + typecheck + build
cd apps/desktop && npm test && npm run typecheck && npm run build   # 74/74
# live multi-turn window-management demo (needs OPENCODE_GO_API_KEY)
source /tmp/arsvox-env.sh   # or export the key from ~/.hermes/.env
.venv/bin/python scripts/demo_live.py --scenario windows --wait-s 90
# mock service + vite dev for browser verification
.venv/bin/python -c "import yaml; cfg=yaml.safe_load(open('configs/app.yaml')); cfg['agent']['mock']=True; yaml.safe_dump(cfg, open('/tmp/arsvox-mock.yaml','w'), sort_keys=False, allow_unicode=True)"
.venv/bin/python -c "import uvicorn; from arsvox_agent.app import create_app; uvicorn.run(create_app('/tmp/arsvox-mock.yaml'), host='127.0.0.1', port=8765, log_level='warning')"   # background
cd apps/desktop && npx vite --port 5173 --strictPort   # background
```

## Notes for the next agent

- **Ports are FREE at session end** — both services were killed. The
  previous sessions left stale squatters (old mock on 8765, old vite
  on 5173) which caused: a false LIVE_OK (demo bound to the mock) and
  stale-module serving. Kill any leftover listener before starting.
- **demo_live.py MUST NOT find a service on 8765** — it boots its own
  instance; verify with `ss -tlnp | grep 8765` first.
- **Browser eval/screenshot target divergence persists** (documented in
  wsl-webapp-development skill): evals hit the live tab, screenshots
  may hit a stale tab. For UI checks use DOM-level assertions (computed
  styles/classes/store state) over pixel screenshots; if you need
  screenshots for the advisor, drive the SCREENSHOT target with real
  type+click actions, not store evals.
- **vite on /mnt/c serves stale modules** — restart vite after any
  source change; verify freshness via fetch sentinel (code literals,
  never comments).
- **Config-driven default layout is intentionally one-shot**: it applies
  only before the first layout command, so reconnects don't clobber the
  user's layout. Tests cover this (store.test.ts config-driven block).
- **API key**: OPENCODE_GO_API_KEY lives in ~/.hermes/.env (line 362).
  `source /tmp/arsvox-env.sh` exports it (file created this session).
- **Conftest now loads the real app.yaml** — changing configs/app.yaml
  may change test behavior (that's the point).
- hey.md: this session's entry is at the top, status resolved.
