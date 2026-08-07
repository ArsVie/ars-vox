---
type: handoff
title: Ars-Vox handoff — 2026-08-07 (advisor round-2 shipped: placeholder fit, title-only empty state, rail hint)
description: Authoritative roadmap and latest session state (advisor round-2 items 1-4 resolved + verified in-browser; media playback controls and real-mic smoke test still open)
---
# Ars-Vox handoff — 2026-08-07 (evening)

This handoff supersedes the morning 2026-08-07 one (multi-zone layouts +
advisor round-1). Pick-up-cold summary below.

## State summary

**A verified agent-service foundation with a multi-zone desktop UI, a
verified live model path, and a fully wired real voice path EXCEPT the
physical microphone on the target machine.** Advisor round-2 is now
closed: all four open items shipped and verified.

Shipped this session (see `git log -1` for the actual commit hash):

- **Round-2 item 1+2 — composer placeholder clipping** (the "Escr" /
  "petició" clips in dashboard side ~367-384px and split/reading side
  ~397-476px): new engine flag `placeholderHidden` on `PanelGeometry` —
  conversation at `full` density with slot pxW < `PLACEHOLDER_MIN_PX`
  (540) gets the `.placeholder-hidden` class; CSS hides the placeholder
  instead of clipping it. Deterministic (pure function of slot width),
  no container queries, no runtime measuring; compact/rail keep their
  existing collapsed-composer behavior. Engine is still the single
  source of truth for chrome adaptation. Density thresholds unchanged.
- **Round-2 item 3 — NOTICIAS title-only bare heading**: `ContentPanel`
  now renders content ONLY when `content_reference` is present; a
  title-only `panel.open` renders the heading PLUS the empty state
  (icon + Spanish hint) below it.
- **Round-2 item 4 — TAREAS rail fully empty**: rail density now shows
  the muted hint as one line (nowrap + ellipsis, icon + text inline)
  instead of hiding the text entirely.

Verification (all real):

- 64/64 vitest (33 layout + 15 store + 2 panelhost + 4 conformance + 8
  vad + 2 new placeholder tests), typecheck, build; 57/57 pytest.
- In-browser DOM verification (mock service 8765 + vite 5173, driven via
  `appStore.applyUiCommand`): side 397px (split @1280) → `density-full
  placeholder-hidden`, placeholder computed color transparent; side 384px
  (dashboard @1600, forced viewport) → same; side 595px (split @1920) →
  placeholder visible; NOTICIAS title-only → h2 + icon + hint; TAREAS
  rail → "No hay tareas pendientes." 1-line ellipsized; content-bearing
  panel → title + reference, no empty state.

## Still open (deliberately not started)

1. **Real media playback controls in MediaDock** — no media pipeline yet
   (`media.state` still no-ops in the store).
2. **Real-mic smoke test** on the physical Windows machine (standing
   item since 08-06; everything else in the voice path is verified).

## Commands

```bash
# python suite (repo root, .venv)
.venv/bin/python -m pytest tests/python -q          # 57/57
# desktop suite + typecheck + build
cd apps/desktop && npm test && npm run typecheck && npm run build   # 64/64
# mock service + vite dev for browser verification
.venv/bin/python -m arsvox_agent --mock             # 127.0.0.1:8765
cd apps/desktop && npx vite --port 5173 --strictPort
# CDP browser verification recipe: wsl-webapp-development skill
# (drive layouts via import('/src/store.ts').then(m=>m.appStore.getState().applyUiCommand(...)))
```

## Notes for the next agent

- **Ports at session end**: mock service (8765) and vite (5173) left
  running (vite restarted fresh this session — serves the new code).
  Edge CDP browser with a leftover second app tab still present; the
  built-in browser tools' eval target and screenshot target diverged
  this session (screenshots showed a stale initial-state tab while
  evals hit the live one) — see wsl-webapp-development skill pitfall;
  prefer DOM-level checks (computed styles, classes) + forced-store
  viewport over pixel screenshots when the tabs disagree.
- **`window.resizeTo` works in the Chrome fallback** (Lightpanda throws)
  and resizing the headless window RELOADS the page — re-apply layout
  commands after any resize, and remember the mock service's scripted
  turn also re-asserts `split/document_editor` on wake.
- **Zustand SSR snapshot**: `api.getServerState || getInitialState` —
  renderToString tests need a live `getServerState` (see
  `tests/panelhost.test.tsx` beforeEach).
- **Stale-module trap**: vite on /mnt/c does not see edits; restart vite
  after any source change and verify served modules (fetch sentinel,
  grep for code literals not comments).
- **Layout quirk**: reading/split share the 31% side column and
  co-degrade on width; dashboard degrades to reading below ~1500px
  (rail 16% < 240 floor) — rail slots only exist on wide viewports
  (force `setViewport` for rail checks).
- hey.md: UI entry resolved; Phase 0 entry carries the ratified
  interface + the `background_media`→`dashboard` alias correction.
