# UI Screenshots — current state

Current UI screenshots, captured 2026-08-07 from the live mock-mode app
(vite 5173 + mock agent on 8765, Edge CDP). Standing rule (owner, 2026-08-08):
refresh this folder after EVERY redesign wave — new wave shots get the next
free numbers, and the wave list below stays current.

## Wave 1 — unified application shell (GATE-1, merged 2026-08-07)

Post-GATE-1 state: UI-101 shell + UI-102 geometry engine placeholders +
UI-103 role framework + UI-104 token values + UI-105 harness. One
continuous dark surface, top bar (ARS·VOX, assistant state, DETENER ≥48px,
plantilla selector), persistent Multimedia/Notificaciones regions at the
bottom, regions separated by subtle dividers (no card borders). Product
surfaces land in Wave 2 — these show the placeholder fixtures.

* [Home / default](06-wave1-home-default.png) - conversation panel, plantilla "Automática"
* [Focus](07-wave1-focus.png) - template `focus`: one primary region (placeholder.primary)
* [Sidecar](08-wave1-sidecar.png) - template `sidecar`: primary + companion
* [Stack](09-wave1-stack.png) - template `stack`
* [Split](10-wave1-split.png) - template `split`: primary + companion side by side
* [Triple](11-wave1-triple.png) - template `triple`: primary + companion + support

## Pre-wave-1 (2026-08-07, old panel UI — historical)

## Populated panels

* [Dashboard](01-dashboard-populated.png) - browser (local news page) main, TAREAS rail (3 todos + 2 permanent reminders), unified media player (local audio), conversation
* [Reading — document](02-reading-document.png) - document panel with markdown chapters and Editar button (text-renderer path)
* [Split](03-split-document-conversation.png) - document + conversation split

## Real format readers

* [EPUB reader](04-reading-epub.png) - Don Quijote rendered by epub.js: serif book page, Página 1 de 1, A−/A+ font, Papel/Sepia/Nocturno themes
* [PDF reader](05-reading-pdf.png) - 2-page PDF rendered by pdf.js: canvas page with text, Página 1 de 2, A−/A+ zoom

Historical pre-fix advisor shots (01-focus.png .. 04-dashboard.png) and
the advisor round-1 record live in `../review-2026-08-07/`.
