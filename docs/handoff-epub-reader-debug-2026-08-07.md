---
type: handoff
title: EPUB reader debug handoff — open investigation
description: "Factual state and observations for the EPUB reader not-rendering issue in Ars-Vox. Root cause NOT determined. References the adaptive UI redesign orchestrator plan. Assigned to a fresh investigation agent."
date: 2026-08-07
status: open
---

# EPUB reader debug handoff (2026-08-07)

## Task

The EPUB reader in Ars-Vox (`apps/desktop`) does not appear to work — the
book page does not render visibly. Root cause is NOT determined. This
handoff records only verifiable state and observations so a fresh agent can
investigate without repeating the failed paths.

## References

- Orchestrator plan (this work is a side investigation, not a wave task):
  `docs/plans/adaptive-ui-redesign-execution-2026-08-07.md`
- Reader integration history + 12 known pitfalls (read FIRST):
  ars-vox skill → `references/readers-2026-08.md` (mirrors the repo's reader
  stack: `readers/reader.ts`, `readers/epubReader.ts`, `readers/pdfReader.ts`,
  `components/ReaderView.tsx`, `components/DocumentPanel.tsx`)
- Current-state authority: `docs/STATUS.md`

## Environment state (verified 2026-08-07 ~17:50–18:10)

- Mock agent service RUNNING on `127.0.0.1:8765` (health: ok, mock:true,
  model deepseek-v4-flash, uptime ~43min at check).
- Vite dev server RUNNING on `127.0.0.1:5173` from
  `/mnt/c/dev/ars-vox/apps/desktop` (pid 2961, started 17:12).
- Fixtures served OK: `GET /demo-book.epub` → 200 (2047B),
  `GET /demo-doc.pdf` → 200 (1798B).
- `main` at `2524b36`. Previous session's uncommitted reader/statusbar/
  local-intents work was parked on branch `wip/advisor-round2-reader-polish`
  on 2026-08-07 so main stayed clean for the redesign waves. That branch
  exists; it contains reader-related edits from the prior session. Whether
  those edits are relevant to this bug is UNKNOWN — investigator should
  diff and decide.
- Wave-1 redesign worktrees exist under
  `/mnt/c/dev/ars-vox-worktrees/ui-1{01..05}-*`; do not touch them.

## Observations (empirical, as recorded)

1. App loads at 5173; WS connects ("agente conectado"); voice state
   listening.
2. Sending a request through the UI (typed text + Enter / Enviar click)
   produced NO visible turn in the automated browser session: no user
   message, no agent reply, no layout change. Not confirmed in the user's
   own browser — may be an artifact of the automation environment.
3. Driving the store directly (applyEvent `document.load` kind=epub
   url=/demo-book.epub + `ui_command` layout.apply reading with
   document_editor main) DID mount the reader machinery:
   `.reader-stage` present, `.reader-mount` present, 2 iframes created,
   template reading, slots main/side/dock. So the epub engine starts.
4. A vision screenshot of that same session showed NO book content — the
   screen still read as the home/empty conversation state. CAVEAT: heavy
   browser-tooling contamination was observed — eval contexts landed on
   `about:blank` and on different tabs between calls; page reloads were
   observed (window/sessionStorage markers vanished within seconds).
   Visual verification from that session is NOT trustworthy. The next
   investigator must use a stable single-browser setup (e.g. agent-browser
   + CDP on a dedicated Edge/Chromium instance) and verify DOM and pixels
   in the SAME tab.
5. Whether the reader renders invisible content (e.g. text present in the
   iframe DOM but not visible), fails to render at all, or never finishes
   loading was NOT established because of the tooling contamination above.

## Open questions for the investigator

- In a stable browser: does the EPUB iframe get created, and does its
  contentDocument contain the book text?
- Is the visible failure: no iframe / iframe but invisible text / iframe
  with wrong colors / reader stuck on a loading state / reader never
  opened at all from the user's actual flow?
- Does the PDF reader work in the same stable browser (comparison case)?
- Is the failure reproducible from the user's real interaction path
  (voice/typed request through the mock), or only relevant to the
  document.load-driven path?

## How to work (boundaries)

- Work in an isolated worktree/branch (per the orchestrator plan's branch
  strategy). Do not touch main, the parked branch, or the wave-1 worktrees.
- You MAY touch: `apps/desktop/src/readers/*`,
  `apps/desktop/src/components/ReaderView.tsx`,
  `apps/desktop/src/components/DocumentPanel.tsx`, `apps/desktop/src/content.css`,
  `apps/desktop/public/demo-book.epub` (fixture regeneration script:
  `scripts/gen_reading_fixtures.py`).
- Do NOT modify: `packages/contracts/**`, `apps/desktop/src/adaptive/**`
  (frozen contract, UI-000), `apps/desktop/src/layout/engine.ts`,
  services/agent logic.
- Announce on `hey.md` before starting (agent entry), mark resolved when
  done. Constant hey.md communication per owner instruction.
- Verify: `cd apps/desktop && npx vitest run && npm run typecheck && npm run build`
  before committing anything.

## Deliverable

Root-cause report (evidence: DOM facts + screenshots from a stable browser)
with a fix proposal or a verified fix on your branch. If you cannot
reproduce in a stable browser, say so explicitly and record what you did
verify — do not guess.
