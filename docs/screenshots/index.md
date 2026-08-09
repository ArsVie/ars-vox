# UI Screenshots — current state

Current UI screenshots, captured 2026-08-07/08 from the live mock-mode app
(vite 5173 + mock agent on 8765, Edge CDP). Standing rule (owner, 2026-08-08):
refresh this folder after EVERY redesign wave — new wave shots get the next
free numbers, and the wave list below stays current.

## Wave 3 — planner/overrides/a11y (merged 2026-08-08)

Post-GATE-2.5 + wave-3 state. Agent layout intents route through the
planner (UI-301), user overrides apply on top (UI-302), and the a11y pass
(UI-303) landed: dark-on-bright ink for contrast (4.8–7.7:1), status
icons + Spanish aria labels, focus-visible rings, hit-target floor,
reduced-motion coverage, STOP active while listening.

* [Shell](23-wave3-shell.png) - boot state after wave 3 (En espera status
  with icon, DETENER, template selector, conversation hero) — captured
  with real Chrome headless at 1920x1080.

### Live real-model captures (2026-08-08, NO mock)

Captured from the REAL deepseek-v4-flash model (harness boot, auth off)
via the page's quick-action chips (headless typing is impossible; chips
are the page-originated triggers that transmit over the page's WS).

* [Mic hero live](24-mic-hero-live.png) — fresh boot = central-mic hero
  (snapshot no longer restores panels, 2026-08-08): Escuchando status,
  DETENER, plantilla selector, suggestion chips, input.
* [Document + chat live](25-doc-chat-live.png) — after clicking "Abre un
  documento": REAL turn (audit: document.list → document.open →
  ui.open_panel → ui.apply_layout, all done), document_editor became the
  main panel, conversation beside. NOTE: opened doc was an empty file, so
  the editor shows its empty-state; chat-bubble rendering in headless is
  under debug (deleg_5facf00a).
* [Chat history restored](26-chat-history-live.png) — after the
  snapshot-history fix (H5 gap): reload no longer blanks the chat; the
  conversation shows the previous REAL turns (user + assistant).

## Wave 2 — adaptive surfaces + motion (GATE-2, merged 2026-08-08)

Post-GATE-2 state: UI-201..207 + gate wiring. The adaptive stage now hosts
the REAL product surfaces through LayoutSpec (browser / conversation /
document_editor / tasks / media registered + role host), with motion
transitions (UI-206) and the spatial inertia policy (UI-207) wired. The
readers were also fixed and verified on main: EPUB theme (nested objects +
re-apply after display) paints the light "Papel" page with readable text;
PDF renders via `canvasContext` (pdfjs v6 drift) — canvas pixel-probed
100% white (was 100% black) and vision-verified.

* [Split — browser + conversation](12-wave2-split-browser-conversation.png) - real surfaces, adaptive stage, LayoutSpec-driven (both primary in split)
* [Reading — PDF primary](13-wave2-reading-pdf.png) - pdf.js canvasContext fix, fit-width (Quijote fixture, "Página 1 de 2")
* [Reading — EPUB primary](14-wave2-reading-epub.png) - epub.js nested-theme fix, 72ch measure, readable light page
* [Media primary](15-wave2-media-primary.png) - MediaDock full player (youtube title, position, controls)
* [Media persistent bar](16-wave2-media-persistent-bar.png) - compact shell-level playback bar after media left the layout (primary→persistent, no playback reset)
* [Home / default](17-wave2-home-default.png) - boot state (legacy PanelHost path, no adaptive spec)
* [Template focus](18-wave2-template-focus.png) - plantilla demo: one primary region
* [Template sidecar](19-wave2-template-sidecar.png) - primary + companion
* [Template stack](20-wave2-template-stack.png) - vertical stack
* [Template split](21-wave2-template-split.png) - side by side
* [Template triple](22-wave2-template-triple.png) - primary + companion + support

## Wave 1 — unified application shell (GATE-1, merged 2026-08-07 — historical)

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
