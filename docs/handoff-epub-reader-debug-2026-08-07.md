---
type: handoff
title: EPUB reader debug — investigation RESOLVED (root cause + fix location)
description: "Factual state and evidence for the EPUB reader not-rendering issue in Ars-Vox. Root cause ESTABLISHED 2026-08-07 (hermes-epub, stable CDP browser). Fix exists in parked branch wip/advisor-round2-reader-polish; merge + visual verify pending. Supersedes the earlier open handoff."
date: 2026-08-07
status: resolved
---

# EPUB reader debug — RESOLVED investigation (2026-08-07)

## Outcome

Root cause established with evidence. The fix already exists in the parked
branch `wip/advisor-round2-reader-polish` (the previous session's work that
was parked so main stayed clean for Wave 1). Remaining work: merge that
branch and visually verify.

## Root cause — EPUB (evidence-backed, stable CDP browser on true main code)

- Reader machinery mounts correctly: `.reader-stage`, `.reader-mount`,
  iframes appear ~11s after open (lazy import + fetch), location reports
  "Página 1 de 2", and the book text IS present in the iframe DOM
  ("Don Quijote de la Mancha / Capítulo I...").
- The bug is the THEME: `THEME_STYLES` in `apps/desktop/src/readers/epubReader.ts`
  defines values as CSS STRINGS:
  `body: "background:#f7f4ee; color:#26221c;"`.
  epub.js `themes.register` → `addStylesheetRules` iterates keys and emits
  INVALID rules — observed live: `rules: ["body { }", "a { }"]` (empty).
- Result: body background stays `rgba(0, 0, 0, 0)` (transparent), text
  color stays `rgb(0, 0, 0)` (black) — on the dark stage
  (`rgb(16, 21, 31)`) the page is INVISIBLE. DOM evidence: all 18 elements
  in both iframes have zero painted backgrounds; computed body bg/color
  transparent+black. Screenshots: /tmp/epub-maincode-invisible.png,
  /tmp/epub-maincode-activated.png (investigator's machine).
- Secondary contributor (from skill ref readers-2026-08.md pitfall #10):
  theme must ALSO be re-applied after `await rendition.display()` — the
  parked branch does both (nested objects + re-apply).

## Root cause — PDF (same investigation, same browser) — CORRECTED

- pdf.js renders a 100%-BLACK canvas: `whitePct 0.0, blackPct 100.0`,
  mean RGB [0,0,0]. Zero `getContext` / paint calls observed after
  monkey-patching — pdfjs NEVER touches any canvas even though `open()`
  resolves and location reads "Página 1 de 2". No console errors.
- REAL CAUSE (source-level, pdfjs-dist@6.2.108): `PDFPageProxy.render({...})`
  destructures `canvasContext, canvas = canvasContext.canvas` — the
  app's pdfReader passes only `canvas`, so `canvasContext` is undefined
  and the render silently no-ops. This is pdfjs v6 API drift (pitfall #2).
- CORRECTION: the parked branch's pdfReader.ts change (fit-width baseScale)
  does NOT address this. The PDF fix must pass `canvasContext` (or the
  param shape v6 actually consumes) + wrap loadTask/showPage errors
  (intermittent "No se pudo abrir el documento" failure state observed).
  Marked implement-and-verify NEXT.
- Fixture is good (21 proper `Tj` operators), identical across branches.

## The fix (parked, unmerged)

`git.exe diff main..wip/advisor-round2-reader-polish --stat`:
- apps/desktop/src/readers/epubReader.ts | 24 +-  (THEME_STYLES nested
  objects + re-apply after display — CORRECT fix, validated at epubjs
  source level + live probe)
- apps/desktop/src/readers/pdfReader.ts | 17 +-  (fit-width scale — does
  NOT fix the v6 render-param bug; keep the scale change, ADD the
  canvasContext fix)
- apps/desktop/src/components/ReaderView.tsx | 10 +-
- apps/desktop/src/content.css | 14 +  (reader-mount 72ch measure)
- plus StatusBar (STOP 48px), local_intents, docs.

⚠️ CONTAMINATION SOURCE FOUND (explains the earlier failed verification):
the 5173 vite dev server (started 17:12, BEFORE the work was parked at
17:24) was serving the CACHED TRANSFORM of the pre-parking working tree —
i.e. the FIXED epubReader.ts (nested objects), not main's CSS strings.
Any browser test against 5173 was testing the fix, not the bug. Main code
must be served from a FRESH vite (e.g. 5174 from the worktree) or a
restarted 5173 to reproduce the real bug.

NEXT STEP for whoever picks this up: merge wip/advisor-round2-reader-polish
into main (EPUB fix + ReaderView + CSS are correct), then apply the PDF
canvasContext fix (pdfjs v6 render param shape), run gates
(vitest/typecheck/build/pytest), then visually verify EPUB + PDF render in
a stable browser (see ars-vox skill → readers-2026-08.md for the verified
CDP drive recipe). NOTE: main has since grown Wave-1 shell/token/role work
(styles.css heavily edited by UI-101/UI-104) — expect merge conflicts in
styles.css/content.css; resolve keeping catalog tokens (--control-height-lg,
--radius-*) and the 72ch .reader-mount--book measure.

## Environment state at investigation time

- Mock agent on 127.0.0.1:8765, vite on 5173 (main tree) + investigator's
  own vite on 5174 (confirmed serving true main code: CSS strings present).
- Fixtures OK: /demo-book.epub (2047B), /demo-doc.pdf (1798B), 200s.
- Previous session's uncommitted reader work = parked branch (see above).

## Original open questions — answers

1. iframe created? YES (~11s).
2. text in contentDocument? YES (Don Quijote text present).
3. invisible vs absent? INVISIBLE (transparent body + black text on dark
   stage) — CSS-string theme bug.
4. PDF comparison? ALSO broken (blank black canvas, never paints).
5. real-path vs store-driven? Store-driven path reproduces it; UI input
   path in automation remained unreliable (browser-tooling artifact, not
   investigated further — the reader bug is independent of it).
6. screenshots? /tmp/epub-maincode-invisible.png (pre-activation),
   /tmp/epub-maincode-activated.png, /tmp/pdf-maincode-works.png (stale
   frame), /tmp/pdf-maincode-ok.png (black canvas evidence).

## Handoff history

- 2026-08-07: open handoff written (facts only, no theories) + hermes-epub
  dispatched. Investigation completed same day; this doc supersedes it.
- hermes-epub did NOT modify any repo files (root-cause report only).
