---
type: handoff
title: Ars-Vox handoff — 2026-08-07 (multi-zone layouts shipped, advisor rounds done)
description: Authoritative roadmap and latest session state (UI workstream A1-A8 + ContentPanel + advisor round-1 fixes shipped and green; advisor round-2 items pending; real-mic smoke test still open)
---
# Ars-Vox handoff — 2026-08-07

This handoff supersedes the 2026-08-06 one (mic path) and the routing
handoff `docs/HANDOFF-multizone-layout.md` (deleted — both workstreams
landed). Pick-up-cold summary below.

## State summary

The project is: **a verified agent-service foundation with a multi-zone
desktop UI, a verified live model path, and a fully wired real voice path
EXCEPT the physical microphone on the target machine.**

This session shipped the multi-zone layout program end to end:

- **UI workstream A (A1-A8)** — commit `049f697`: layout engine rewritten
  (`focus`/`split`/`reading`/`dashboard` templates, `main|side|rail|dock`
  slots, px floors main≥480×360 side≥280×240 rail≥240×240 dock≥240×64,
  deterministic degrade ladder, slot-affinity reassignment, MediaDock,
  chrome densities full/compact/rail, composer collapse driven by density,
  store `slots`/`viewport` integration). Aliases: `reference`→`reading`,
  `background_media`→`dashboard` (plan §1.1 authoritative).
- **Backend workstream B (B1-B6)** — commit `6a3328c` (committed on behalf
  of the backend agent, who left it uncommitted): enum READING/DASHBOARD,
  `LayoutSlots` + validator, flat `side/rail/dock` kwargs in
  `ui_apply_layout`, system.md frozen vocabulary + decision table, config
  defaults, regenerated schemas. 57/57 pytest + 7/7 WS e2e (incl. the
  slots-bearing wire test).
- **Advisor round-1 fixes** — commit `c787eb2`: generic ContentPanel for
  news/tasks/notes/reminders/browser/book_reader/telegram_preview/settings
  (per-type icons + Spanish empty states), STOP moved to the left status
  cluster (filled red-tinted 40px), rail density = icon + one-word label,
  non-main slots flattened, bubble min-width, 44px hit targets, TÚ
  contrast, media dock dedupe.
- **Phase 2 handshake** — conformance test
  `apps/desktop/tests/conformance.test.ts` reads the regenerated
  `packages/contracts/schemas/ui-commands.schema.json` (A-side mirror).

Verification gates all green: **62/62 vitest, typecheck, build; 57/57
pytest; 7/7 WS e2e.**

## Advisor reviews (claude-opus-4.8, two rounds)

Artifacts in `docs/review-2026-08-07/`: screenshots of the 4 templates
(`01-focus.png` .. `04-dashboard.png`) and `advisor-round1.md`
(full review + applied delta).

Round-2 verdict: STOP, rail identity, media dock, TÚ, bubbles, elevation —
**resolved**. Remaining items (prioritized, still open):

1. **Composer placeholder still clips at the narrowest density (dashboard
   side, 24% slot)** — the composer-collapsed placeholder-hide is not
   triggering at that breakpoint (side 367px ≥ 360 → density full → not
   collapsed → clipped "Escr"). Fix: collapse threshold or width-aware
   placeholder (hide below ~460px / ellipsize).
2. **Placeholder clips in split/reading** ("petició") — same root cause,
   placeholder not width-aware; ellipsize or hide below min-width.
3. **NOTICIAS main shows title-only, not the empty-state pattern** — when
   the agent sends `panel.open` with a title but no content, ContentPanel
   renders the bare heading; decide: treat title-only as empty (show the
   icon + hint below the title) or add a content flag.
4. **TAREAS rail body fully empty** — add the muted empty-state line
   (rail density currently hides the text; show a 1-line hint).

Not started (deliberately): real media playback controls in MediaDock
(no media pipeline yet — `media.state` still no-ops in the store) and the
**real-mic smoke test** on the physical Windows machine (standing item
from the 08-06 handoff; everything else in the voice path is verified).

## Commands

```bash
# python suite (repo root, .venv)
.venv/bin/python -m pytest tests/python -q          # 57/57
# desktop suite + typecheck + build
cd apps/desktop && npm test && npm run typecheck && npm run build   # 62/62
# mock service + vite dev for browser verification
.venv/bin/python -m arsvox_agent --mock             # 127.0.0.1:8765
cd apps/desktop && npx vite --port 5173 --strictPort
# CDP browser verification recipe: wsl-webapp-development skill
# (drive layouts via import('/src/store.ts').then(m=>m.appStore.getState().applyUiCommand(...)))
```

## Notes for the next agent

- **Ports at session end**: mock service (8765) and vite (5173) were left
  running; Edge CDP browser on 9222 with a leftover second tab on
  `localhost:5174` (backend agent's page — harmless, do not kill blindly;
  check `process list`/`ss` before reusing ports).
- **Note:** zustand's SSR snapshot uses `api.getServerState || getInitialState`
  — renderToString tests need a live `getServerState` on the store
  (see `tests/panelhost.test.tsx` beforeEach).
- **Stale-module trap**: vite on /mnt/c does not see edits; restart vite
  after any source change and verify served modules (fetch sentinel).
- **Layout quirk**: reading/split share the 31% side column, so they
  co-degrade on width (documented in layout tests); px floors were
  ratified by the UI stream (owner review optional).
- hey.md: UI entry marked resolved; Phase 0 entry carries the ratified
  interface + the `background_media`→`dashboard` alias correction.
