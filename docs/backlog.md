---
type: backlog
title: Ars-Vox backlog — user directions
---

# Backlog — user directions

Direct instructions from Ars. Each item is a requirement; do not treat as
optional. Guidance, not history.

**Format contract:** the backlog states what IS and the direction —
never narratives, never what was fixed or how. No historical writing.
The backlog is always the present state; it is not tied to a date.

---

## UI architecture

- **Manual navigation always available.** The user must be able to go
  from one view to another manually and navigate the app as an usual
  page. The AI can control everything, but everything a casual tech
  user could want to do must also be doable by hand. No single feature
  may remove every other panel from the screen.
- **No unescapable views.** Once the agent puts media in primary, the
  user must be able to leave that view without restarting the app and
  without voice. Chat must remain reachable.
- **Media proportions.** Video must never be a long stripe. Chat+video
  proportions are off; the layout wastes vertical space.
- **Video is the primary activity.** "Why would it put the video on the
  second panel?" When the user asks to watch a video, the video goes in
  the primary panel — never the secondary one. Chat is the companion.
- **Secondary panel expands to the borders.** "why does the secondary
  panel not exapn into the borders even though there are only two
  activities? Lot of wasted space there and panels are not properly
  prioritazed" With only two activities, the layout must use the
  available space — no wasted space, and the more important panel gets
  priority.
- **Conversation is always present.** The agent arranged the layout
  without the conversation panel at all (tasks primary, media
  companion) — dropping the chat entirely. The conversation surface
  must appear in every composition the agent builds; it is the core of
  the app and must never be composed away.
- **The composed primary is the primary.** "the agent put the news to
  the side": a layout.compose naming surface X as primary must render
  X primary. Verified (2026-08-14): a persistent conversation
  constraint (panel.set_primary / home click pins the surface to main)
  silently degrades every later agent compose — the requested surface
  is demoted, while the agent is still told "Disposición aplicada";
  after layout.restore the identical compose applied exactly as
  requested. The agent must learn what actually applied, and the
  pinned state must be visible to the user and resettable.
- **Opening a panel is not composing.** For "Put the news from today,
  mexicali" the agent opened the browser panel (ui.open_panel) but
  never composed it to primary, so the browser stayed a side strip.
  When browsing/news is the user's ask, the browser is the primary
  activity — it must go primary (same rule as video).
- **Panels must fit their slots.** "the side panels have weird
  cropping": the document panel (min-width 360px) is wider than the
  companion slot (~242-288px) and gets clipped at the right edge
  (toolbar controls cut off). Panels must adapt to their slot size or
  slots must respect panel minimums.
- **Maximize must not exile the chat.** Clicking Maximizar on a panel
  removes the conversation and the composer from the screen entirely;
  only a faint Restaurar icon brings them back. The chat must remain
  reachable from any maximized/fullscreen state.
- **The conversation must never collapse to a sliver.** After the document/media turns the conversation panel shrank to a ~76px strip at the top with the messages scrolled out of view, while the media dock (672×316) filled the window and the composer row overlapped the media panel's top edge — the user could not read the assistant's last reply at all. Severity: MAJOR. Every composition must keep the conversation readable, and no panel may overlap the composer.

## Media

- **YouTube progress bar.** "the progress bar at the bottom is useless
  for youtube it's stuck on 0:00/ 0:00" The app-level progress bar for
  a YouTube track must show the real playback time (tracked from the
  player), or it must be removed in favor of the player's own
  controls.
- **Video removal is complete.** The user asks to remove the video;
  the assistant claims it did ("Quité el video" / "El video ya estaba
  quitado") but the media region remains — a title and play button
  over an empty area, or the video still shown. Removal must clear the
  surface and its content entirely: no ghost region.
  Root cause (live-verified 2026-08-13): the request is currently
  UNFULFILLABLE — `media.stop` keeps the loaded track
  (services/agent/arsvox_agent/media.py:139 "keeping the loaded
  track"), and NO tool clears title/videoId/url/localPath. In a live
  turn asking to quit the video the model replied "Listo" without
  touching media; the persistent bar kept showing "KT vs T1 | WORLDS
  2025 | Gran final | Día 17" (DOM probe: media-dock--persistent with
  stale title). Fix needs: (a) a media disposal tool (e.g. media.clear)
  that clears the track and emits an empty media state, and (b)
  app.get_state reporting media content so the model can see the stale
  track and knows to call it. (The ghost-guard in MediaDock.tsx covers
  the title-with-no-target variant only.)
- **Playing means playing.** "the youtube panel doens't seem to work
  again": the YouTube embed mounts but autoplay is blocked in the web
  renderer (player unstarted, poster with play overlay) while the UI
  shows a pause button — nothing plays, nothing audible. The playing
  state must reflect the real player, and a blocked/stopped embed must
  show honest state.
- **The announced title must match the video.** Verified (2026-08-14):
  for result CnHGab2JMYw the search metadata says "Música Para Dormir
  Profundamente En Menos De 5 Minutos; Musica Relajante Para Dormir
  #8" while the embed's own player reports the same ID as "Relaxing
  music with the sound of nature Bamboo Water Fountain 2021 #2" (both
  Helios Piano, same 7h duration). The UI announces one thing and the
  player delivers another — the played content must match what the
  UI states.
- **No silent fake dock.** When the media surface is not in the
  composition, the persistent dock shows the track as "playing" but
  nothing plays (the persistent variant renders no embed element for
  YouTube). A docked track that cannot play must show honest state.
- **Titles are fully readable.** The media panel truncates titles
  ("MUSICA Z…") and the document panel header truncates ("DOCU…"),
  with no way to see the full name. Titles must fit their area or be
  expandable.
- **The dock play button is dead.** After "Listo, reproduciendo Música Zen Ultra Relajante. Que disfrutes." the docked track shows a play symbol; tapping it does nothing — no player opens, no audio, no feedback, the lone title and button stay. Severity: MAJOR. The dock must actually start the track when its play control is pressed, or show an honest non-playing state without a dead control.

## Browser

- **Browser must respond — DONE (browser-use integration, 2026-08-13).**
  Asking for news ("noticias de Mexicali") used to fail with "El
  escritorio no respondió" — the agent's browser actions hard-depended
  on the Electron desktop round-trip. The agent now executes navigation
  and DOM actions IN-PROCESS on a local, text-first Chromium engine
  (browser_use 0.13.7, pinned; `services/agent/arsvox_agent/
  browser_engine.py`): real url/title, real page text, no screenshots,
  no vision. The desktop WebContentsView remains the USER'S display via
  the same frozen wire events (best-effort mirror — the agent never
  waits on it). Navigation policy (scheme/local-private/allowlist) is
  enforced server-side, mirroring security-policy.ts. Live-verified:
  real turns navigate + read real Wikipedia content; non-allowlisted
  URLs are refused before any emission.
  Open follow-ups:
  - **Chromium in the packaged app**: dev runs download Chromium via
    `browser-use install` (one-time); the packaged build must bundle or
    provision the Chromium binary + declare the path (engine accepts
    `executable_path` via config today is NOT wired — wire it).
  - **Headful mode for the user**: engine runs headless by default
    (agent reads text); if the desktop is absent the user sees nothing —
    decide whether `engine_headless: false` or CDP-attach to the
    Electron view is the product answer.
  - **Click by visible text**: current click target matching covers
    aria-label/visible text on a/button/input; full text-fragment
    search (any element) is a possible refinement.
- **The browser surface must show the page.** "why no view on the
  browser?" — after a real navigation the panel header shows the true
  title but the viewport stays empty: the view is an Electron-owned
  WebContentsView that does not exist in the web renderer (and the
  engine is text-first, no screenshots). The user must see the page or
  an explicit no-view state — never a silent blank.

## Status bar

- **Minimal always.** The status bar must be a minimal bar with no
  distracting elements, always near the main view of the user — not a
  separate header region.
- **STOP is a red symbol.** The stop control is a small red symbol,
  nothing more. Reference:
  `docs/screenshots/backlog-minimal-statusbar-example.png`.
- **Stop must be a clearly visible red symbol.** The stop control in the composer row renders a near-black glyph (rgb(11,18,32)) over a faint 22%-alpha red square on the dark background — hard to find for an elderly user who needs to stop the assistant mid-turn. Severity: MINOR. The stop symbol must be clearly red and stand out against the dark theme, as in the reference screenshot.

## Reminders

- The reminders surface breaks the user flow and wastes vertical and
  horizontal space; a single reminder must not take over the whole
  screen. Reference:
  `docs/screenshots/backlog-reminders-fullscreen-problem.png`.
- **Reminder replies are human, reminders are visible.** After
  creating a reminder the assistant answers with a raw dump ("Tienes:
  #2 2026-08-14T14:00:00+00:00 — Tomar las pastillas (se repite
  daily)") and no reminders surface appears on screen at all. The
  reply must be plain language and the created reminder must be
  visible somewhere (a surface or a plain chat summary).
- **The reminder confirmation lacks when-it-rings, and reminders cannot be reviewed or cancelled.** "poné un recordatorio a las 9 de la noche para regar las plantas" answers "Listo. Recordatorio para regar las plantas a las 9 de la noche." and nothing appears on screen — the user never learns if it will ring today or tomorrow, and no view ever lists the pending reminders to check or delete them. Severity: MINOR. The confirmation must state the next firing time, and a manual reminders view (list, cancel) must exist.

## Library / reading

- **Reading has a surface.** Asking to open a book ("abrí un libro")
  is answered with "Listo" but the book text is read inside the chat
  with no reader surface. Reading must have a dedicated surface or an
  explicit in-chat reading mode — never a claim without a view.

## Documents

- **Creating a document must show a document.** "creá un documento" titled "mis recetas" was answered "Encontré una receta guardada: receta de avena. Ya la abrí." and no editor or document panel appeared anywhere on screen — the user cannot see, type, or save anything. Severity: MAJOR. Creating or opening a document must open a visible editor panel with its content, or plainly say it could not.

## Chat input

- **Short replies send.** A simple "si" must be sendable; a minimum
  character restriction currently swallows it.
- **Markdown rendering.** The chat renders markdown: `**`, `__`, `##`
  and friends must display formatted.
- **STOP next to the input controls.** "the red stop button should be
  along the microphone and send button": the stop control must sit in
  the same row as Micrófono/Enviar, not on a separate status row above
  the composer.

## Agent responses

- **No repetition of UI-visible information.** The system prompt tells
  the model not to repeat what is already shown in the UI (e.g. the
  full details returned by the YouTube search tool) unless the user
  needs it restated.
- **User-friendly, human-readable.** Replies are written for a casual
  user, not as tool-output dumps.
- **No claiming panels that are not on screen.** Twice in a row the assistant said a results panel was open ("Te dejo las opciones en el panel", "El panel ya está abierto con los resultados") while the screen showed only the chat — the user looks for the promised panel and finds nothing. Severity: MAJOR. The agent must not announce a panel that is not visible; when search results are offered in a panel, the panel must actually open and show them.
- **Context must resolve "nota" before acting on it.** After the assistant listed news articles, "abrí la primera nota en pantalla grande" was answered "Listo, abrí la primera nota —\"comprar leche y pan\"—" — the assistant opened a saved shopping note instead of the first news article, so the user never sees the article they asked for. Severity: MAJOR. The agent must resolve "nota" against the current context (the news list) before assuming a saved note.

## Data persistence

- **Logs must never be lost.** Every session's record — turns, tool
  calls, audit events, reminders fired — must survive app restarts,
  crashes, and cleanup. The log store is a stable, user-owned location
  (`ARSVOX_DATA_DIR`, else `XDG_DATA_HOME`, else `~/.local/share`,
  under `arsvox/arsvox.db`) — never the config file's directory, never
  /tmp. An explicit `memory.db_path` in the config overrides the
  default.
- **Session state may reset.** A reset that starts the app fresh (no
  restored conversation) is acceptable — the session itself does not
  need to persist. What must persist is the log of what happened, so
  nothing that occurred is unrecoverable.

## Analytics / personalization

- SPIKE: logging of user queries to derive personalized behavior — what
  to log, where it lives (local SQLite), retention, and how the agent
  consumes it.

## Messaging

- **The family contact must be configurable from the screen.** "mandale un mensaje a mi familia" is answered "No pude preparar el mensaje: no hay un contacto aprobado configurado en la aplicación... configurar el destinatario en los ajustes" — but no settings or contact setup exists anywhere in the visible UI, so the request ends in a dead end for the user. Severity: MAJOR. The recipient must be configurable from within the app, and the failure message must point to a visible way to do it.

## Conversation steering

- The user must be able to send SUBSEQUENT messages to steer the agent —
  the first message starts the task, follow-ups ("the second one", "no,
  the other track", "now continue writing") drive the rest. Without
  subsequent messages, conversation cannot happen properly: the agent
  offers options and the user must be able to answer with a follow-up
  turn. Verify this path in the packaged app: offer -> user picks via a
  NEW message -> the agent acts on the pick.
