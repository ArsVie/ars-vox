---
type: handoff
title: "Ars-Vox roadmap and operating guidance"
description: Roadmap + standing rules. NOT a history log. Current implementation state lives in docs/STATUS.md (single authority).
---

# Ars-Vox — roadmap and operating guidance

This file tells you where the project is going and what the standing rules
are. It is NOT a narrative of what happened. Current state: docs/STATUS.md.
Frozen product direction: docs/panel-vision.md (Ars's spec, never edit).

## Current phase

GATE-3.5 consolidation is CLOSED (2026-08-09): 10 wave-1 branches merged,
308 pytest / 601 vitest / typecheck / build green, 19/19 acceptance items
checked. Contract: docs/consolidation-contract-2026-08-08.md.
Program: docs/plans/consolidation-program-2026-08-08.md.

Next phase: WAVE 2 (MVP backlog, below). Wave 2 work runs IN PARALLEL with
any remaining plumbing — visible product value comes first.

## What exists (state, one line per domain)

- VOICE: TTS started/finished/cancelled acks; renderer owns physical
  playback; silence timer anchored to speech end; STOP cancels model + mic
  + TTS; spoken STOP works; wake-word/VAD providers exist but are NOT
  wired.
- SERVICE: Electron spawns the Python service with one per-launch token,
  authenticated handshake, pre-connect input buffered exactly once,
  startup failures visible, renderer never holds the token.
- LAYOUT: model speaks native LayoutSpec (5 templates, 4 roles, 3
  proportions); news removed from every model-visible surface; all layout
  mutations go through one choke; user overrides beat agent preferences.
- MEDIA: one MediaController for agent + human + player; seek changes real
  position; no fake success when nothing is loaded; media=null clears.
- RECONNECT: continuous snapshot tracker; authoritative null clears;
  sequence-gap resync; notifications restored.
- CONFIRMATIONS: spoken approve/reject; one global pending; executing
  actions carry cancellation tokens; ClientAction = narrowed human-initiated
  union (16 members, all handled).
- DOCS/TOOLS: adaptive surfaces (browser/conversation/reading/tasks/media),
  real PDF/EPUB/TXT readers, planner + overrides + a11y pass.
- BACKEND GAPS (unchanged, planned): reminder cron context injection,
  message timestamps in context, memory-driven search, real media,
  Electron WebContentsView browser + DOM bridge.

## Standing rules (directives — do not violate)

- PANEL VISION: docs/panel-vision.md is frozen and authoritative. There is
  NO news panel (browser covers news). Agent never sends coordinates.
- WAKE WORD: phrase UNDECIDED. "Ars" is the family prefix, NOT the wake
  word. "Lily" is a candidate. No wake-word training/benchmarking until
  Ars selects it.
- FRICTIONLESS POLICY: no confirmation gates except MAYBE messages and
  email. Confirmation UX = popup in chat or voice-ask. No silent pending
  gates where the model says "done" while the action waits.
- START STATE: a fresh app start shows ONLY the central-mic hero.
  Conversation history is stashed and loads ONLY on explicit request —
  never auto-restored on load/reload. (Code currently auto-restores;
  fix pending.)
- TEMPLATE SELECTOR: no template selector in the UI, dev builds included.
  (Dev builds still show a dev-gated one; removal pending.)
- DETENER: stops what is happening (voice/activity), NEVER "go home".
- EXIT AFFORDANCE: ARS·VOX logo/home in the header returns to the mic
  hero, always the same place; every panel header has a close (X); the
  agent prompt guides the agent to restore the hero when the user signals
  leaving.
- STATE PANEL: minimal, not a header; placed where the eyes land (in the
  chat or beside the main panel).
- MEDIA HONESTY: the agent must play real media or report honestly — no
  claimed success on fixtures. Real YouTube search is mandatory (scrape
  ytInitialData or a public API); progress bar must reflect the real
  iframe position.
- DOCS STYLE: docs are guidance, not narrative. No "was fixed / merged /
  today X" prose. STATUS.md is the single authority for state.
- ELECTRON ORDER: Electron major upgrade lands BEFORE arbitrary real
  browsing.

## Next work — Wave 2 (MVP, prioritized)

A. Wake word / VAD physical voice loop (phrase-agnostic).
B. Real browser WebContentsView (allowlist enforced, hardened partition).
C. Browser DOM interaction bridge (snapshot/find/click/fill/submit/scroll;
   page content = untrusted; consequential actions follow the policy).
D. Real media discovery/playback (real YouTube search, no fixtures).
E. Reminder/task notification integration (snooze/dismiss/restart
   reliability).
F. Reader persistence (book progress resume, PDF page/zoom restore).
G. Context timestamps + durable user state.
H. Memory-informed search with provenance.
I. Telegram/notes/tasks polish (no tool names visible to the user).
UI: confirmation popup-in-chat / voice-ask, minimal state panel near the
gaze, media progress bar tied to the iframe, exit/home affordance + panel
close X, mic-hero-only start, template selector removal.

## Commands

```bash
# python suite (repo root, .venv)
.venv/bin/python -m pytest tests/python -q
# desktop suite + typecheck + build
cd apps/desktop && npm test && npm run typecheck && npm run build
# live multi-turn demo (needs OPENCODE_GO_API_KEY)
source /tmp/arsvox-env.sh
.venv/bin/python scripts/demo_live.py --scenario windows --wait-s 90
# mock service + vite dev (for browser verification only)
.venv/bin/python -c "import yaml; cfg=yaml.safe_load(open('configs/app.yaml')); cfg['agent']['mock']=True; yaml.safe_dump(cfg, open('/tmp/arsvox-mock.yaml','w'), sort_keys=False, allow_unicode=True)"
.venv/bin/python -c "import uvicorn; from arsvox_agent.app import create_app; uvicorn.run(create_app('/tmp/arsvox-mock.yaml'), host='127.0.0.1', port=8765, log_level='warning')"   # background
cd apps/desktop && npx vite --port 5173 --strictPort   # background
```

## Operational notes (rules, not stories)

- Before booting any service, verify the port is free
  (`ss -tlnp | grep 8765` / `:5173`) and kill leftover listeners.
- vite on /mnt/c serves stale modules — restart it after source changes
  and verify freshness with a code literal, not a comment.
- Browser checks: use DOM-level assertions (computed styles, classes,
  store state) over pixel screenshots; the eval and screenshot targets can
  diverge.
- API key: OPENCODE_GO_API_KEY lives in ~/.hermes/.env (line 362);
  /tmp/arsvox-env.sh exports it.
- tests/python/conftest.py loads the real configs/app.yaml — changing it
  changes test behavior by design.
