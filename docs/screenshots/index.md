# UI Screenshots — current state

Current UI screenshots, captured 2026-08-07 from the live mock-mode app
(vite 5173 + mock agent on 8765, viewport 1700×1050, Edge CDP).
Regenerate: boot `npx vite --port 5173` + `python -m arsvox_agent --mock`,
send any message (demo_populate fills the panels), then apply the layout
template per shot and screenshot.

## Populated panels

* [Dashboard](01-dashboard-populated.png) - browser (local news page) main, TAREAS rail (3 todos + 2 permanent reminders), unified media player (local audio), conversation
* [Reading — document](02-reading-document.png) - document panel with markdown chapters and Editar button (text-renderer path)
* [Split](03-split-document-conversation.png) - document + conversation split

## Real format readers

* [EPUB reader](04-reading-epub.png) - Don Quijote rendered by epub.js: serif book page, Página 1 de 1, A−/A+ font, Papel/Sepia/Nocturno themes
* [PDF reader](05-reading-pdf.png) - 2-page PDF rendered by pdf.js: canvas page with text, Página 1 de 2, A−/A+ zoom

Historical pre-fix advisor shots (01-focus.png .. 04-dashboard.png) and
the advisor round-1 record live in `../review-2026-08-07/`.
