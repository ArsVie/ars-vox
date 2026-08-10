# UI Screenshots — current state

Current UI screenshots, captured 2026-08-07/09 from the live app
(vite 5173 + agent on 8765, Edge CDP / built-in browser tool). Standing rule
(owner, 2026-08-08): refresh this folder after EVERY redesign wave — new
wave shots get the next free numbers, and the wave list below stays current.

## GATE-5 Wave 0 (merged 2026-08-09, packaged build)

Post-W0 state: template selector DELETED (dev included), ARS·VOX wordmark is
the home button, close X on every panel header, confirmation as a card
inside the chat, minimal state pill in the shell chrome. Fresh start =
central-mic hero; snapshot history NEVER auto-restored (directive
implemented). Captured from the packaged Electron app over CDP with the
real model (deepseek-v4-flash, mock off).

* [Cold start / hero](29-gate5-cold-start.png) — central-mic hero
  ("Toca para hablar"), minimal chrome pill (ARS·VOX + En espera +
  DETENER), no template selector, no error panel
* [Compose — split](30-gate5-compose-split.png) — real model composed
  split: document_editor + media, two 640x800 slots
* [Confirmation in chat](31-gate5-confirm-in-chat.png) — telegram
  confirmation card rendered INSIDE the conversation panel, voice state
  "Esperando confirmación"
* [After service restart](32-gate5-after-restart.png) — layout +
  in-memory chat survived the restart; confirmation correctly cleared
  (server-side in-memory pending)
* [Final state](33-gate5-final-state.png) — split layout held, no error
  panel, no stale confirmation

## GATE-5 GATE-2 — integrated browser (closed 2026-08-10, packaged build, real model)

W2-VIEW + W2-DRIVE + W2-NAVIGATE merged; ADR 0007 reversed the iframe
decision (WebContentsView is the browser). Captured from the packaged
Electron 42 app over CDP with the real model (deepseek-v4-flash, mock
off). The WebContentsView is a native layer (not part of the renderer's
compositor), so each screen has a pair: the app window (chrome +
conversation) and the view's own target capture (the actual page).

* [Browser panel (empty viewport)](gate2-browser-panel.png) — browser
  surface after W2-VIEW: nav buttons (Atrás/Adelante/Recargar), address
  bar ("Busca o escribe una dirección…"), empty-state hint; conversation
  shows the agent's honest "no veo ninguna página cargada" (no page yet)
* [Browser loaded](gate2-browser-loaded.png) — user-path navigate →
  WebContentsView loaded wikipedia.org (allowlist passed); view target
  capture shows the real Wikipedia landing page
* [Agent read the page](gate2-agent-navigated.png) — conversation shows
  the agent summarizing the open page; view target capture shows the
  Spanish Wikipedia portada after the agent CLICKED the Español link
  (`#js-link-box-es` → real navigation to es.wikipedia.org)
* [Agent navigated alone](gate2-browser-openstreetmap.png) — "Navegá a
  openstreetmap.org" → browser.navigate tool → real view load → round-trip
  returned the REAL url/title ("…terminó en
  https://www.openstreetmap.org/#map=3/23.94/-102.58 — OpenStreetMap")
  with can_go_back: true on the wire; view capture shows the OSM map
* Allowlist working: example.com (not listed) blocked; wikipedia.org /
  openstreetmap.org / youtube.com pass — the hardened view governs

## GATE-3.5 consolidation (closed 2026-08-09)

Post-consolidation state: R43 status bar (brand + ONE status pill
"En espera" + DETENER + plantilla selector + connection dot), real model
connected (no mock). NOTE: the shot shows the current build, which
restores the conversation on start — the fresh-start directive (mic hero
only, history on explicit request) is pending.

* [Home / default](28-gate35-home-default.png) — live capture, real model,
  no mock: R43 status bar, conversation (current build restores it on
  start; fresh-start directive pending), composer with "Escribe una
  petición…".

NOTE (tooling finding, 2026-08-09): the template fixture shots
(focus/sidecar/stack/split/triple via the demo combobox) could NOT be
recaptured this gate from the built-in browser tool — the tool's eval/click
routing split across two engine targets (Lightpanda DOM vs Chrome render),
so select changes never reached React. ALSO (real, from App.tsx): the demo
combobox is INERT whenever an adaptive spec exists in the store — which is
the normal post-GATE-3.5 state (snapshot restores the composition). Future
template shots: drive the store directly from ONE engine
(applyAdaptiveSpec with TEMPLATE_FIXTURES shapes) or run the Edge CDP +
agent-browser recipe (references/wave-screenshots-2026-08.md) with the
service NOT carrying a restored adaptive composition.

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

Captured from the REAL deepseek-v4-flash model, auth off, via the page's
quick-action chips.

* [Mic hero live](24-mic-hero-live.png) — fresh boot = central-mic hero
  (snapshot does not restore panels): Escuchando status,
  DETENER, plantilla selector, suggestion chips, input.
* [Document + chat live](25-doc-chat-live.png) — after clicking "Abre un
  documento": REAL turn (audit: document.list → document.open →
  ui.open_panel → ui.apply_layout, all done), document_editor became the
  main panel, conversation beside. NOTE: opened doc was an empty file, so
  the editor shows its empty-state; chat-bubble rendering in headless is
  under debug (deleg_5facf00a).
* [Chat history restored](26-chat-history-live.png) — shows the previous
  REAL turns (user + assistant) after reload. HISTORICAL behavior:
  the fresh-start directive (mic hero only) supersedes this.
* [Video playing live](27-video-live.png) — user-captured: REAL Rick
  Astley video playing in the main surface after "pon un video" (real
  model, no mock). Note: the bottom dock (0:00/0:00, YOUTUBE) is the
  app's own control bar — unrelated to the iframe progress (backlog).

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
