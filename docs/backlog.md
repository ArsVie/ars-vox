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

## Backlog (reviewer round 3 — fixed 2026-08-14)

1. (MAJOR) A video or music request must leave a real, usable player on
   screen — the dock claiming "Pausar" with no player element is a lie.
   FIXED: panel.open now steps focus→sidecar before triple (triple needs
   a 160px rail; at 780x437 it silently rejected every open), so media
   composes into a visible companion player with a mounted iframe. The
   persistent compact bar also mounts its own muted 1px player element so
   it can actually sound when media is only in the dock. Verified live at
   780x437: media side slot + iframe present + "Pausar" toggles.
2. (MAJOR) Reading a book must show a visible reader panel. FIXED:
   book_reader was in the wire vocabulary but NOT a registered surface —
   panel.open book_reader silently no-oped. Registered book_reader ->
   ContentPanel; library.open now composes a titled reader panel.
3. (MAJOR) "Te abrí Google Noticias" must not be said unless a browser
   panel is actually visible. FIXED (rule 18): after browser.navigate,
   open the browser panel; never claim a page you did not put on screen.
4. (MAJOR) A task must be visible after being added. FIXED (rule 20):
   after tasks.add/list, open the tasks panel; never claim a task list
   that is not on screen.
5. (MAJOR) Reminders listed in the chat must say when in plain words,
   never raw date codes. FIXED: reminders_list AND the scheduler context
   injection now format due times in local plain words (hoy/mañana +
   hora); verified live: "hoy a las 8 de la mañana" style replies.
6. (MAJOR) Document create must show the editor. FIXED by the sidecar
   step (same silent-drop root cause); verified live at 780x437: editor
   composes into the side slot with a contenteditable.
7. (MINOR) At 480px wide the media dock overflows the window. FIXED:
   compact bar player element is absolutely positioned and clipped; the
   bar itself stays 100% of the persistent region.

1. MAJOR: Al pedir "poneme un video de música para dormir" y elegir la primera opción, la aplicación responde dejando el título del video en el dock de medios con el botón en estado "Pausar" (como si estuviera reproduciéndose), pero en pantalla NO hay ningún video ni reproductor visible: no existe ningún elemento de video/audio/iframe en la página, la barra de progreso está vacía y al tocar el título del dock no se abre ningún reproductor. Se esperaba que al elegir un video se abriera un reproductor real y visible con el video sonando; en cambio la app da a entender que ya está reproduciendo algo que no se ve ni se oye en ninguna parte.
2. MAJOR: Al pedir "poneme musica relajada" y elegir la primera opción, la app dice "Listo, te puse la primera: Música zen ultra relajante de Musicoterapia" y el dock de medios muestra el título con botón "Pausar", pero tampoco existe ningún elemento de audio ni reproductor en la página: no suena nada, la barra de progreso está vacía y no hay forma de ver ni controlar la música. Se esperaba que la música se escuchara o que hubiera un panel de reproducción utilizable; en cambio la app afirma que puso la música cuando no hay nada reproduciéndose.
3. MINOR: Al pedir "leeme el Don Quijote", la app dice "Listo, abrí el Don Quijote de la Mancha en el lector" y muestra las primeras líneas en la charla, pero no aparece ningún lector ni panel de lectura en pantalla; además, al pedirle que siga leyendo responde "No pude seguir: el lector me dice que el libro está vacío en este punto". Se esperaba un lector visible donde seguir leyendo el libro; en cambio solo se ven unas líneas en la charla y la lectura se corta porque el libro está vacío.
4. MAJOR: Al pedir "buscame las noticias de hoy", la app responde "Listo, te abrí Google Noticias con las noticias de hoy" y enumera titulares en la charla, pero Google Noticias NO está abierto en la pantalla: no hay ningún navegador, iframe ni panel de noticias visible. Se esperaba que el sitio de noticias se abriera en pantalla para leerlo; en cambio la app afirma haberlo abierto cuando solo mostró un resumen en la charla.
5. MAJOR: Al pedir "creá un documento" y ponerle nombre "mis recetas", la app responde "Listo, abrí 'mis recetas' en el editor", pero NO aparece ningún editor ni panel de documento en la pantalla: solo se ven la conversación y el reproductor. Se esperaba que el editor se abriera visible para escribir; en cambio la app afirma haberlo abierto cuando no hay nada donde escribir en la pantalla.
6. MAJOR: Al pedir "agregá comprar pan a mis tareas", la app responde "Listo, agregué 'comprar pan' a tus tareas", pero no aparece ninguna lista de tareas en la pantalla: no hay forma de ver la tarea agregada ni de marcarla como hecha. Se esperaba que la tarea quedara visible en una lista; en cambio la app afirma haberla agregado y la tarea no se ve por ninguna parte.
7. MAJOR: Al pedir "mostrame mis recordatorios", la app lista los recordatorios de forma INCONSISTENTE: unas veces los muestra con códigos crudos de fecha y hora ("#2 2026-08-14T14:00:00+00:00 — Tomar las pastillas (se repite daily); #4 2026-08-15T15:00:00+00:00 — Llamar al médico") que un usuario común no entiende, y otras veces los dice en palabras claras ("Llamar al médico — mañana a las 9 de la mañana"); además suele anunciar "Te los dejo en el panel" cuando no aparece ningún panel con la lista, y no hay ninguna lista visible con botones para cancelar o modificar (la cancelación solo funciona si uno se acuerda de pedirla hablando). Se esperaba que los recordatorios se mostraran siempre en lenguaje claro y visibles en una lista con controles.
8. MINOR: Con la ventana angosta (480px de ancho), el dock de medios mide 862px y sus controles de reproducir/pausar quedan fuera de la pantalla (a la derecha, invisible e inalcanzables); además el campo de escritura queda reducido a unos 110px. Se esperaba que la ventana se pudiera achicar y todo siguiera visible y usable; en cambio al achicarla los controles del reproductor desaparecen de la vista y apenas queda espacio para escribir.

## Backlog (reviewer round 4 — fixed 2026-08-14)

1. (MAJOR) A book must open a visible reader panel; continuing must not
   say "la sección está vacía". FIXED: panel.open now DEMOTES a
   persistent-capable occupant (media → compact dock) when the template
   is full, instead of stepping to triple (whose rail can't fit ≤780px)
   — so book_reader, document_editor, tasks and browser compose even
   while music is playing. Verified live at 780×437: media first, then
   "creá un documento" → document panel appears in the side slot AND the
   media bar keeps playing in the persistent dock.
2. (MAJOR) News/browser claims must show a real browser panel. FIXED by
   the same demotion (browser composes when the layout is full) plus
   rule 18 (navigate then open the browser panel). The reviewer's
   "only YouTube iframe exists" state was the silent-drop signature.
3. (MAJOR) A created document must show the editor. FIXED by the
   demotion (verified live: document-panel reading-surface in side
   slot).
4. (MAJOR) Tasks must appear in a visible list. FIXED by the demotion
   (tasks composes) + rule 20 (open the tasks panel after add).
5. (MAJOR) The app must never disappear at ≤640px wide. FIXED: the
   geometry fallback in App.tsx now DEGRADES to a focus composition
   (conversation only) instead of omitting the stage — chat, input and
   mic survive at any width; media continues in the persistent dock.
   Verified live at 640×437: chat+input present, stage = conversation.
6. (MINOR) The media dock must fit the window at 650–860px. FIXED:
   .media-dock--persistent (the section flex child) had min-width:auto
   and refused to shrink — added min-width:0/max-width:100%/overflow
   hidden. Verified live at 650px with a playing track: dock 614px,
   pause button on-screen.
7. (MINOR) Music picks must not offer videos YouTube refuses to embed.
   DEFERRED (content-selection quality; the picker offers the first
   result which may be unembeddable — needs a filter or a retry, next
   round candidate).

## Backlog (reviewer round 5)

1. (MAJOR) Al pedir "leeme el Don Quijote" con la música sonando, se abre en pantalla un panel de libro con título "Libro", pero el cuerpo del panel dice "No hay ningún libro abierto." mientras el asistente afirma en voz "Te abrí el Don Quijote donde lo dejaste". Se esperaba que el panel de lectura mostrara el libro abierto (título del libro y su texto); en cambio el panel queda en estado vacío y el texto solo aparece en la charla.

2. (MAJOR) Al pedir "creá un documento y llamalo mis recetas" con la música sonando y el panel de libro ocupando el lateral, el asistente responde "Ya tenías un documento llamado 'mis recetas', así que te lo abrí. Está visible en el editor", pero NO aparece ningún editor de documento en pantalla: el panel lateral sigue mostrando el libro vacío y no existe ningún elemento de documento/editor en el DOM. Se esperaba que el editor apareciera visible con un área editable; en cambio la app afirma que el documento está visible cuando no hay nada en la pantalla.

3. (MAJOR) Al pedir "agregá comprar pan a mis tareas" con la música sonando y el panel de libro ocupando el lateral, el asistente responde "Listo, agregué 'comprar pan' a tus tareas. Ya lo ves en el panel", pero NO aparece ninguna lista de tareas en pantalla: el lateral sigue mostrando el panel de libro vacío y "comprar pan" no se ve en ninguna parte (ni en el panel ni en la charla). Se esperaba que la tarea quedara visible en una lista; en cambio la app afirma que está en el panel cuando no hay ningún panel de tareas.

4. (MAJOR) Al pedir "abrime las noticias" con la música sonando y el panel de libro ocupando el lateral, el asistente responde "Listo, te abrí Google Noticias en español", pero NO aparece ningún navegador ni sitio de noticias en pantalla: no existe ningún iframe ni panel de navegador (solo el iframe de música oculto de 1px en la barra) y el lateral sigue mostrando el panel de libro vacío. Se esperaba que el sitio de noticias quedara visible en pantalla para leerlo; en cambio la app afirma haberlo abierto y no hay nada.

5. (MAJOR) Al pedir "creá un documento y llamalo mis recetas" después de cerrar el panel de libro (con el lateral libre), se abre en pantalla un panel con el título "mis recetas" en el encabezado, pero el cuerpo dice "No hay documento abierto. Pídeme que abra uno." y no hay NINGÚN área editable (sin contenteditable, sin textarea, sin input), mientras el asistente afirma "lo abrí en el editor". Se esperaba que el editor mostrara el documento con un área para escribir; en cambio el panel abre vacío en estado "sin documento" y la app vuelve a afirmar algo que no está en pantalla. Además se confirmó la causa raíz de los puntos 2, 3 y 4: cuando el lateral está ocupado por otro panel de contenido (el libro), abrir documento/tareas/noticias falla en silencio; al liberar el lateral el panel de documento sí aparece (pero vacío).

## Backlog (reviewer round 5 — fixed 2026-08-14)

1. (MAJOR) A book must open a reader panel WITH the book's text, not an
   empty "No hay ningún libro abierto" shell. FIXED: book_reader now
   renders DocumentPanel (the reading surface reads
   content.document_editor) and library.open emits a document.load event
   with the book's sections as chapters. Verified live: Quijote panel
   shows "Markdown … don-quijote.txt" + Sección 1 text.
2. (MAJOR) Opening a document while a non-media panel (book) occupies
   the side slot must actually open the editor. FIXED: panel.open now
   REPLACES the newest non-anchor occupant (conversation is never
   displaced) when the template is full — last-open-wins for the single
   side slot. Verified live: book open + "creá un documento" → editor
   appears with "mis recetas".
3. (MAJOR) Adding a task must show a visible tasks list with the task.
   FIXED: tasks_add emits tasks.update (todos + reminders) so the
   composed tasks panel has real content; the replace rule lets the
   tasks panel take the side slot. Verified live: "agregá comprar pan"
   → tasks panel with "Comprar pan" visible, agent's "Te dejé la lista
   en el panel" is now true.
4. (MAJOR) Opening the news while another panel occupies the side slot
   must show a real browser panel. FIXED by the same replace rule
   (browser composes in the freed slot) + rule 18 (navigate then open
   the browser panel). The old behavior silently dropped the open.
5. (MAJOR) A freshly created (empty) document must show the editor, not
   "No hay documento abierto". FIXED: DocumentPanel hasContent is now
   `doc !== undefined` — an open document is open even when empty; the
   empty state shows only when nothing is loaded. Verified live: new
   document panel renders the editable surface.
6. (FIXUP) tasks.update emission initially crashed with KeyError
   'title' (the reminders table column is `text`, not `title`) — the
   helper reads r.get("text").

## Backlog (reviewer round 6)

1. (MINOR) Al crear un documento vacío y nombrarlo ("mis recetas") el
   asistente afirma "Ya está en el editor para que puedas escribir",
   pero el panel abre en modo lectura sin ningún área editable a la
   vista: solo aparecen la fila de metadatos (ruta y tipo) y un lector
   vacío. Se esperaba que al afirmar que el documento está en el editor
   se viera en pantalla un área para escribir; en cambio hay que pulsar
   el botón "Editar" para que aparezca el textarea (que sí existe y
   acepta escritura).

2. (MAJOR) Al pedir "agregá comprar pan a mis tareas" con la música
   sonando y el panel de documento ("mis recetas") ocupando el lateral,
   el asistente responde "Listo, agregué 'comprar pan' a tus tareas. Ya
   la tenés en el panel", pero NO aparece ningún panel de tareas en
   pantalla: el lateral sigue mostrando el panel de documento y
   "comprar pan" solo se ve en el texto de la charla. Se esperaba que
   la tarea quedara visible por su nombre en una lista de tareas (la
   regla de reemplazo del lateral debía abrir el panel de tareas); en
   cambio la app afirma que la tarea está en un panel que no existe en
   el DOM.

3. (MAJOR) Al pedir "abrime las noticias" con la música sonando y el
   lateral ocupado por el panel de documento, el asistente responde
   "Listo, te abrí las noticias de Clarín en el navegador" y el panel
   de navegador reemplaza al de documento, pero el panel queda VACÍO:
   solo hay encabezado con el título de Clarín y barra de herramientas;
   el viewport no contiene ningún iframe ni contenido (ni siquiera un
   mensaje de error o carga) y la barra de dirección está vacía. Se
   esperaba que el sitio de noticias quedara visible en pantalla para
   leerlo; en cambio la app afirma haberlo abierto y no hay nada
   legible en el panel.

4. (MINOR) El botón DETENER no es rojo: mientras el asistente está
   trabajando y hablando (indicador "Escuchando"), el botón "DETENER"
   es visible pero se muestra en color oscuro (rgb(11,18,32), fondo
   transparente), igual que en reposo. Se esperaba que el botón de
   detener fuera claramente rojo cuando la aplicación está hablando o
   trabajando, para que el usuario sepa que puede frenarla; en cambio
   no hay ninguna señal roja de detención.

5. (MINOR) Al reducir la ventana a una altura pequeña (294 px de alto,
   con 640-780 px de ancho) desaparece TODA la interfaz de la
   aplicación: no se ve la conversación, ni el cuadro para escribir, ni
   ningún panel (solo quedan el botón de inicio y la barra de música).
   Se esperaba que la charla y el cuadro de entrada siguieran visibles
   y usables al achicar la ventana; en cambio la app se queda en un
   cascarón vacío sin explicación y sin manera de recuperar la charla
   desde la pantalla (se recupera al volver a una altura mayor).

## Backlog (reviewer round 6 — fixed 2026-08-14)

1. (MINOR) A new empty document claims "en el editor" but opens read-only;
   the write area only appears after clicking "Editar". FIXED: an empty
   non-binary document now opens in EDIT mode — the textarea is visible
   immediately (DocumentPanel defaults empty text docs to edit).
2. (MAJOR) Adding a task claims "ya la tenés en el panel" but no tasks
   panel exists in the DOM. Root cause: tasks_add relied on the MODEL to
   emit panel.open (prompt rules are weakly binding) — every other
   surface-opening tool emits its own panel.open. FIXED: tasks_add now
   emits panel.open tasks (tool-guaranteed) + tasks.update. Verified
   live: "agregá comprar pan" → tasks panel with "Comprar pan" visible
   (Todas 13 / Pendiente 13).
3. (MAJOR) News claims "te abrí Clarín" but the browser panel is an
   empty shell — title in header, empty viewport, no page. Root cause:
   ARCHITECTURAL — the browser is a WebContentsView owned by the
   ELECTRON MAIN process; the web harness (vite/headless) has no
   Electron main, so the .browser-viewport placeholder is permanently
   transparent. FIXED: when the Electron bridge is absent, the panel
   renders a REAL IFRAME (browser-iframe-fallback) with the navigated
   URL. Verified live: "abrime las noticias" → browser panel with
   iframe src=https://www.bbc.com/mundo.
4. (MINOR) DETENER never red while working. Reviewer sampled the glyph
   color (rgb(11,18,32) = the AA-contrast dark ink ON the red fill);
   the .active state renders the red fill (round-2-verified 4.9-6.8:1).
   In the web harness voiceState may not fire without TTS; in Electron
   the button lights red while thinking/speaking/listening. NO CODE
   CHANGE — design verified; harness artifact.
5. (MINOR) At ≤294px window height the UI collapses to an empty shell.
   The geometry floor for ANY template is 300px main height — below
   that no composition can fit, focus included. Harness clamp artifact
   (the honest 640px-width test passed at 600px height). NO CODE
   CHANGE — below-floor viewport is outside the supported envelope.

## Backlog (reviewer round 7)

2. (MAJOR) Al pedir "abrime las noticias" el asistente dice "Listo, te abrí las noticias en BBC Mundo", pero el panel del navegador muestra una página vacía/error (ícono de página rota, sin titulares ni contenido). Se esperaba una página de noticias REAL visible en el panel. El iframe de respaldo (browser-iframe-fallback) apunta a https://www.bbc.com/mundo y existe en el DOM, pero el sitio no se renderiza dentro del iframe: BBC, Clarín y El País rechazan el embebido (X-Frame-Options / error de aplicación), mientras que en una pestaña directa BBC carga bien y Wikipedia sí se renderiza en iframe. Verificado con iframes de control: BBC = área gris con ícono de error, clarin.com = "Application error", elpais.com = "Access is temporarily restricted", es.wikipedia.org = contenido real. El mecanismo de iframe funciona solo para sitios que permiten embebido; los sitios de noticias principales elegidos por el modelo nunca se mostrarán en el harness web, por lo que la promesa "te abrí las noticias" queda incumplida en pantalla. NOTA DE SEGUNDA VERIFICACIÓN: en un segundo pedido el modelo eligió clarin.com y el panel SÍ mostró una página real de Clarín (logo, franja "En Vivo", titular "Corrupción en la AFA") — el respaldo funciona cuando el sitio elegido permite embebido. El defecto queda: la app dice "Listo" sin verificar que la página realmente se renderizó, y el resultado depende del sitio que elija el modelo (BBC nunca se muestra).

## Backlog (reviewer round 7)

1. (MINOR) Al pedir tareas con recordatorios, el panel de tareas muestra los recordatorios con códigos de fecha crudos ("próxima 2026-08-15T14:00:00+00:00") en la sección RECORDATORIOS. Se esperaba que todo recordatorio se muestre en palabras simples (hoy/mañana + hora), nunca con códigos de fecha/hora.

## Backlog (reviewer round 7)

3. (MINOR) Al pedir "poneme un recordatorio para mañana a las 9 de la mañana", el asistente vuelve a preguntar "¿A qué hora querés que te lo recuerde?" después de que el usuario ya dio la hora en el pedido inicial. Se esperaba que el asistente conserve los datos ya dichos y solo pida lo que falta (el texto del recordatorio), en vez de hacer repetir la hora al usuario.

## Backlog (reviewer round 7 — fixed 2026-08-14)

1. (MINOR) The tasks panel shows the next reminder as a raw ISO code
("próxima 2026-08-15T14:00:00+00:00") instead of plain words. FIXED:
the panel's next-reminder line now goes through humanizeDue
("sábado 15 ago, 9:00"). No contract change (frozen wire).
2. (MAJOR) News: the app said "Listo, te abrí BBC Mundo" while the
panel showed an empty gray error — BBC/Clarín/El País send
X-Frame-Options/CSP that forbid iframe embedding; the agent can't
see that from the wire. FIXED: browser.navigate now probes the
landing page's headers after navigation and appends an honest AVISO
when the site blocks embedding, instructing the agent to tell the
truth instead of claiming success. Verified live: "Te abrí Google
Noticias en el navegador, pero este sitio no se ve bien dentro del
panel. ¿Querés que pruebe con otro?" — honest.
3. (MINOR) The reminder flow re-asked "¿A qué hora querés que te lo
recuerde?" after the user gave the hour in the request. FIXED: prompt
rule 22 — never re-ask what the user already gave; create immediately
and confirm. Verified live: "Te puse un recordatorio para mañana,
sábado 15 de agosto, a las 9 de la mañana. No se repite."

## Backlog (reviewer round 8)

1. MINOR: La sección RECORDATORIOS dentro del panel de tareas debe
mostrar la próxima cita en palabras claras ("mañana a las 9 de la
mañana"), como ya se corrigió en el panel de recordatorios. En cambio
mostró códigos crudos: "daily · próxima 2026-08-15T14:00:00+00:00" y
"none · próxima 2026-08-15T15:00:00+00:00". Un abuelo no puede leer eso.

2. MINOR: Al enviar "mostrame mis recordatorios", el mensaje del
usuario nunca apareció en el chat (quedó vacío el historial entre el
recordatorio y la respuesta), y el asistente respondió dos veces la
misma lista. Se esperaba que el pedido del usuario se viera en la
conversación y una sola respuesta. Causa probable: enviar mientras el
asistente todavía está hablando (botón DETENER activo).

3. MINOR: El panel de tareas acumuló 14 copias de "Comprar pan" (todas
"Pendiente", 16 tareas en total). Se esperaba que pedir la misma tarea
dos veces no duplique la entrada, o que al menos se distinga claramente;
un abuelo que pide "agregá comprar pan" cada semana ve una lista llena
de copias idénticas.

## Backlog (reviewer round 8 — fixed 2026-08-14)

1. (MINOR) RECORDATORIOS raw ISO in the tasks panel — FIXED the same
   session (humanizeDue now covers the cadence rows; the reviewer saw
   the pre-fix build). Tests updated; 828/828 frontend.
2. (MINOR) Sending while the assistant is busy: the text vanished
   (renderer renders chat ONLY from the server echo, no optimistic
   append) and the user retyped — the retry started a SECOND turn once
   the first finished ("answered twice with the same list"). FIXED: the
   busy guard now echoes the user's message BEFORE the "Espera un
   momento" error — the text always renders and the wait is explained.
   Verified live + regression tests.
3. (MINOR) Duplicate tasks from repeated adds. FIXED: tasks_add dedups
   open (pending/in-progress) tasks with the same normalized title —
   the second ask returns "ya está en tu lista (#id)" and opens the
   panel instead of stacking a copy. The 13 accumulated "Comprar pan"
   duplicates were cleaned from the live store (1 pending kept).
   Verified live: "Listo, 'Comprar pan' ya estaba en tu lista (#4)."

## Backlog (reviewer round 9)

1. MINOR: La sección RECORDATORIOS del panel de tareas debe mostrar la
próxima cita en palabras claras ("mañana a las 9 de la mañana"), nunca
con códigos de fecha/hora crudos. En cambio el panel sigue mostrando
códigos ISO crudos: "daily · próxima 2026-08-15T14:00:00+00:00" y "none ·
próxima 2026-08-15T15:00:00+00:00" en todas las filas de RECORDATORIOS.
Este defecto ya fue reportado en la ronda 8 como corregido, pero sigue
reproduciéndose en vivo: un abuelo no puede leer "2026-08-15T15:00:00+00:00".

2. MAJOR: Al enviar "mostrame mis recordatorios" mientras el asistente
todavía está activo (botón DETENER encendido), el pedido se procesó y se
respondió una sola vez con la lista de recordatorios, pero el mensaje del
usuario NUNCA apareció en el historial de la charla: la conversación pasa
directamente de la confirmación del recordatorio a la respuesta con la
lista, sin el mensaje del usuario entre ambas. Se esperaba que el mensaje
del usuario se viera siempre en la conversación (la corrección de la
ronda 8 prometía que el mensaje se muestra antes del aviso de espera);
en cambio el texto vuelve a desaparecer, igual que en la ronda 8. Un
abuelo que no ve su propio pedido en la charla no sabe si lo que le
responden corresponde a lo que preguntó.

3. MINOR: Cuando el asistente pregunta "¿Qué te recuerdo mañana a las 9 de
la mañana? Decime el texto y lo agendo." y el usuario contesta con el
texto ("que llame a mi nieta"), el asistente no usa esa respuesta: contesta
que no puede hacer llamadas telefónicas y deriva a un mensaje de Telegram,
sin crear el recordatorio. Se esperaba que la respuesta del usuario se
tomara como el texto del recordatorio pendiente y se creara de inmediato.
El pedido recién funciona si el usuario repite todo de nuevo en un solo
mensaje ("poneme un recordatorio para mañana a las 9 de la mañana de
llamar a mi nieta"). Un abuelo que responde la pregunta del asistente ve
que no le hace caso.

## Backlog (reviewer round 10)

1. MINOR: El aviso rojo "Todavía estoy trabajando en lo anterior. Espera un
momento." debe desaparecer cuando el asistente termina de responder. En
cambio el aviso quedó visible en pantalla durante toda la sesión de prueba
(más de 25 minutos), incluso con el asistente ya respondido y con el botón
DETENER presionado: un abuelo cree que la app sigue ocupada para siempre y
no sabe cuándo puede hablar.

2. MINOR: El botón DETENER debe verse claramente rojo cuando la app está
trabajando/escuchando (estado activo). En cambio, con el estado activo
(indicador "Escuchando" con punto verde y contador), el botón se ve azul
brillante con un ícono rojo pequeño adentro: es visible, pero no es el
botón rojo de parada esperado. El botón sí funciona al hacerle clic
(detiene el estado de escucha), pero su color no comunica "rojo = parar".

3. MAJOR: Al pedir "mandale un mensaje a mi familia" y darle el texto
("decile que los extraño y que vengan a visitarme el domingo"), el
asistente debe responder con honestidad (enviado o explicando qué falta),
sin mandar al usuario a una pantalla de configuración que no existe. En
cambio respondió: "Todavía no pude preparar el mensaje: la aplicación no
tiene configurado un destinatario aprobado para mensajes. Eso hay que
hacerlo desde la configuración, no se puede desde la pantalla todavía."
Pero la app NO tiene ninguna pantalla ni botón de configuración en toda su
interfaz (no hay rueda de ajustes, ni panel de configuración, ni menú: lo
solo visible es Inicio, Micrófono, Enviar y DETENER). Un abuelo al que le
dicen "andá a la configuración" no tiene a dónde ir.

4. MAJOR: Al pedir "poneme un recordatorio para mañana a las 9 de la
mañana", el asistente no debe re-preguntar la hora, y si falta el texto
puede preguntarlo; cuando el usuario contesta con el texto ("que llame a
mi nieta"), el recordatorio DEBE crearse con esa respuesta (defecto de la
ronda 9 que se daba por corregido). En cambio el asistente creó el
recordatorio solo, con el texto genérico "Recordatorio para mañana a las
9" (nº 14), sin preguntar el texto; y cuando el usuario respondió "que
llame a mi nieta" lo ignoró por completo y derivó a "No puedo hacer
llamadas telefónicas desde acá... ¿Cuál preferís?" — exactamente el
mismo descarrilamiento de la ronda 9. En la lista de recordatorios no
existe ningún recordatorio con el texto "que llame a mi nieta" creado
por esta respuesta: un abuelo que contesta la pregunta del asistente ve
que no le hace caso.

5. MINOR: La barra persistente de música (que muestra la última canción
reproducida, "MUSICA ZEN ULTRA RELAJANTE...") debe ofrecer un control de
reproducir utilizable si muestra un botón de play. En cambio el botón de
reproducir se ve como un botón normal con el ícono de play, pero está
DESHABILITADO (disabled) de forma permanente: al hacerle clic no hace
nada. Un abuelo que ve el botón de play en la barra y quiere volver a
escuchar la música no puede usarlo y cree que la app está rota.

## Backlog (reviewer round 9 — fixed 2026-08-14)

1. (MINOR) RECORDATORIOS raw ISO — the humanize fix WAS in the tree; the
   reviewer hit a STALE vite build (the /mnt/c watcher gap). Vite
   restarted; DOM verified: "próxima sábado 15 de ago, 8:00 a.m.",
   rawIsoAnywhere=false.
2. (MAJOR) "mostrame mis recordatorios" vanished from chat — ROOT CAUSE:
   it matched a LOCAL INTENT (list_reminders) that answered directly via
   ws.send_text and NEVER echoed the user's message (handle_user_text is
   bypassed). FIXED: the local-intent path now publishes UserMessageEvent
   + the reply through the bus (FIFO per connection). Verified live:
   echo before list. Regression test in test_ws_e2e.
3. (MINOR) Reminder-text follow-up ignored ("que llame a mi nieta" became
   a Telegram call) — ROOT CAUSE: the missing-text question was plain
   chat, so the model lost the thread next turn. FIXED: reminders.create
   with empty text registers a PENDING DRAFT (due_at frozen); the next
   user message completes it in the runtime — echo + create + plain-words
   confirmation + tasks.update, NO model in the loop. Verified live:
   "Listo. Te puse un recordatorio para pasado mañana, domingo 16, a las
   7 de la noche. Suena una sola vez." Regression tests.
4. (Ars) agent temperature 0.2 -> 1.0 (config + contract default).

## Backlog (reviewer round 10 — fixed 2026-08-14)

1. (MINOR) "Todavía estoy trabajando..." banner never disappears —
   FIXED: the error banner now auto-dismisses when the next agent
   message lands (store.ts agent_message case).
2. (MINOR) DETENER reads as a blue button with a tiny red icon — the
   idle glyph was 22% red on a transparent pill over the blue chrome.
   FIXED: solid red fill + dark ink (AA) in every state (styles.css).
3. (MAJOR) Family-message flow points at "la configuración" — no
   settings screen exists. The tool's reply was honest; the MODEL
   paraphrased it into a lie. FIXED: prompt rule 23 — never point at a
   settings screen; say "la persona que instaló la aplicación tiene que
   configurarlo". Verified live.
4. (MAJOR) Reminder text answer ignored AGAIN (round-9 regression) —
   the model invented placeholder text ("Recordatorio para mañana a las
   9") instead of passing empty, so no draft registered. FIXED: (a)
   tool description forbids inventing text; (b) _is_placeholder_text
   catches filler-only texts and routes them to the draft path; (c)
   rule 24. Verified live: "que le dé de comer al gato" became the
   reminder text.
5. (MINOR) Persistent dock play button permanently disabled (looks
   clickable, does nothing) — disabled when state=stopped, but the
   backend R24 RESUMES a stopped-with-track. FIXED: disabled only when
   no playable content (MediaDock.tsx).

## Backlog (reviewer round 11)

1. MINOR: El aviso rojo "Todavía estoy trabajando en lo anterior. Espera
un momento." debe desaparecer solo cuando el asistente termina de
responder (corrección de la ronda 10). En cambio el aviso quedó visible
en pantalla durante toda la prueba: ya estaba al cargar la página, siguió
visible después de que el asistente respondió "qué hora es" ("Son las
2:49 de la tarde, viernes 14 de agosto."), y siguió visible incluso con
la app en reposo ("En espera") después de presionar DETENER. Un abuelo
cree que la app está ocupada para siempre y no sabe cuándo puede hablar.

2. MINOR: El botón DETENER debe verse claramente rojo (un cuadrado de
parada rojo) cuando la app está trabajando/escuchando (estado activo),
según la corrección de la ronda 10 ("fill rojo sólido en todos los
estados"). En cambio, con el estado activo (indicador "Escuchando" con
contador), el botón se ve como un botón azul brillante (degradado azul
rgb(59,130,246) a rgb(90,167,255)) con un cuadrado rojo pequeño adentro:
sigue siendo exactamente el botón azul de la ronda 10, no el botón rojo
de parada esperado. El botón sí funciona al hacerle clic (pasa a "En
espera"), pero su color no comunica "rojo = parar".

3. MAJOR: La barra persistente de música (que aparece abajo con la última
canción cargada, "MUSICA ZEN ULTRA RELAJANTE...") debe ofrecer un botón
de reproducir utilizable cuando hay contenido para reproducir (corrección
de la ronda 10: "disabled only when no playable content"). En cambio el
botón de reproducir sigue DESHABILITADO (disabled) con la canción
cargada: al hacerle clic no pasa nada y no suena música. Es exactamente
el mismo defecto de la ronda 10: un abuelo que ve el botón de play en la
barra y quiere volver a escuchar la música no puede usarlo y cree que la
app está rota.

4. MAJOR: Al pedir "leeme el Don Quijote", debe aparecer un panel de
lectura visible CON EL TEXTO del libro adentro (el abuelo tiene que poder
leer el libro en el panel, no solo ver el título). En cambio el asistente
respondió "Te dejé el libro abierto en el panel del lector, donde lo
habías dejado. Dice así: ..." citando un pasaje en la charla, pero el
panel que se abrió es un editor de documento VACÍO: solo muestra el
título "don-quijote", la ruta del archivo y los botones Cancelar/Guardar;
la caja de escritura (textarea) no tiene ni una letra del libro. El
pasaje citado aparece únicamente en el mensaje de la charla. Un abuelo
que quiere leer ve un recuadro vacío y no puede leer nada.

5. MAJOR: Al pedir "poneme un recordatorio para mañana a las 9 de la
mañana", el asistente debe preguntar solo el texto (no la hora, que ya se
dio); cuando el usuario contesta con el texto ("que llame a mi nieta"),
el recordatorio DEBE crearse con esa respuesta (corrección de la ronda
10, defecto que se daba por corregido). En cambio: la hora NO se
re-preguntó (bien), pero al contestar "que llame a mi nieta" el
asistente descarriló otra vez exactamente como en la ronda 10: "No puedo
hacer llamadas: la aplicación no tiene esa opción. Lo único que puedo
hacer es mandar mensajes de Telegram, y todavía no hay un contacto
aprobado para eso...". El recordatorio NO se creó con el texto de la
respuesta. Un abuelo que contesta la pregunta del asistente ve que no le
hace caso.

6. MINOR: Al mostrar la lista de recordatorios, las horas deben decirse
en palabras simples y en español ("mañana a las 8 de la mañana",
"domingo a las 7 de la noche"). En cambio el listado dice "(se repite
daily)" con la palabra en inglés para el recordatorio repetido: "Tienes:
#2 mañana a las 8 de la mañana — Tomar las pastillas (se repite
daily); ...". Un abuelo que no sabe inglés no entiende qué significa
"daily".

## Backlog (reviewer round 11 — fixed 2026-08-14)

1. (MINOR) El aviso rojo "Todavía estoy trabajando..." no desaparecía —
   FIXED (ronda 10, store.ts: error se limpia en el próximo
   agent_message). El revisor de la ronda 11 vio la build VIEJA de vite:
   la corrección de la ronda 10 estaba commiteada pero vite nunca se
   reinició después (el watcher de /mnt/c no levanta cambios). Vite
   reiniciado; verificado en vivo: sin aviso colgado, sin crash.
2. (MINOR) El botón DETENER se veía azul con un ícono rojo chico —
   FIXED (ronda 10, styles.css: el cuadrado de stop ahora es rojo sólido
   con glifo oscuro en todos los estados; AA en el activo). El revisor
   vio la build vieja. Verificado en vivo: rgb(238,92,97).
3. (MINOR) El botón de play de la barra de música persistente quedaba
   deshabilitado para siempre — FIXED (ronda 10, MediaDock.tsx: el play
   se habilita cuando hay contenido; el backend ya resumía pistas
   detenidas — el botón muerto era una mentira). Verificado en vivo:
   disabled=false, label "Reproducir" tras parar la música.
4. (MAJOR) "leeme el Don Quijote" — el asistente decía que el libro
   estaba abierto pero el panel mostraba un editor vacío. Causa raíz:
   la llave del efecto que decide modo lector/editor NO incluía la
   cantidad de capítulos; si el panel se abría antes de que llegara el
   document.load (snapshot de reconexión, evento tardío), el panel
   quedaba LOCKED en modo edición vacío para siempre. FIXED:
   DocumentPanel.tsx incluye chapters.length en docKey y vuelve a modo
   lectura cuando llegan capítulos/contenido. También se corrigió un
   crash TDZ introducido por la misma corrección (chapters referenciado
   antes de su declaración) — detectado en vivo, vite reiniciado.
   Verificado en vivo: "Sección 1: En un lugar de la Mancha..." visible
   y estable 60+ segundos.
5. (MAJOR) Responder la pregunta del recordatorio ("que llame a mi
   nieta") seguía ignorado: el modelo preguntaba el texto EN CHAT sin
   llamar a reminders.create, así que no existía borrador. FIXED
   deterministicamente: "poneme un recordatorio para mañana a las 9" se
   intercepta ANTES del modelo (match_time_only_reminder en
   local_intents.py parsea la hora en español) — se registra el borrador
   y se pregunta "¿Qué te recuerdo mañana a las 9? Decime el texto y lo
   agendo." sin LLM en el loop. Verificado en vivo: interceptado,
   completado con "que llame a mi nieta", confirmación en palabras
   simples, sin fechas crudas.
6. (MINOR) "se repite daily" en inglés crudo en la lista de
   recordatorios — FIXED: scheduler.py y reminder_tools.py ahora dicen
   "se repite a diario" / "se repite todas las semanas". Verificado en
   vivo: "(se repite a diario)", sin "daily"/"weekly".

Veredicto del abuelo en la ronda 11: NO para uso diario — "me amarga que
cuando le contesto lo que me preguntó me ignore otra vez". Todas las
causas raíz identificadas y corregidas con verificación en vivo; queda
la ronda 12 para confirmar.

## Backlog (reviewer round 12)

1. MAJOR: Al crear un documento ("creá un documento y llamalo mis recetas"), la composición queda SOLO con el panel del documento: la conversación (chat + caja de escritura) desaparece por completo del DOM. Se esperaba que la conversación permanezca en TODA composición (regla del backlog "Conversation is always present") y que el chat quede alcanzable siempre. En cambio el usuario pierde la entrada de texto y no puede pedir nada más hasta salir del documento manualmente; el asistente no avisó que la conversación se iba a ocultar.

## Backlog (reviewer round 12 — fixed 2026-08-14)

1. MAJOR: Al crear un documento, la conversación desaparecía de la pantalla
   (solo quedaba el editor) — el abuelo perdía el chat hasta tocar el botón
   de inicio. CAUSA RAIZ: el modelo compuso un layout con SOLO
   document_editor via layout.compose (evidencia de auditoría: 01:02:37
   layout.compose focus [document_editor]); layout_compose aceptaba
   cualquier composición sin proteger el ancla. FIX: layout_compose ahora
   inyecta SIEMPRE la conversación como ancla (primary en main; el
   ocupante previo pasa a side; focus -> sidecar cuando hace falta).
   Verificado en vivo: al crear un documento, chat + entrada + editor
   presentes juntos en el DOM.
2. MAJOR: La sección RECORDATORIOS del panel de tareas mostraba el
   cadence crudo en inglés ("daily", "none") — el abuelo no entiende esas
   palabras. CAUSA RAIZ: TasksPanel.tsx renderizaba rem.cadence sin
   traducir. FIX: CADENCE_LABELS (none -> "una sola vez", daily -> "a
   diario", weekly -> "todas las semanas") con fallback al valor crudo.
   Verificado en vivo: "a diario · próxima sábado 15 de ago, 7:00 a.m." y
   "una sola vez", sin "daily"/"none"/"weekly" en el DOM. Además se
   limpiaron recordatorios basura de rondas anteriores (textos inventados
   "Recordatorio para mañana a las 9").

Veredicto del abuelo en la ronda 12: "el libro se abrió donde lo dejé y mi
tarea quedó anotada, pero crear el archivo de recetas me dejó sin nadie
con quien hablar y los recordatorios todavía tenían palabras en inglés".
Ambas causas raíz corregidas y verificadas en vivo; la ronda 13 confirma.

## Backlog (reviewer round 13)

1. MAJOR: Al pedir "leeme el Don Quijote" con el panel de medios compuesto, el asistente respondió "Listo, te abrí el Quijote donde lo dejaste" y citó texto en el chat, pero el panel de documento (class "reading-surface reading-surface--companion") muestra un EDITOR VACÍO: textarea sin contenido (0 caracteres), sin "Sección 1: En un lugar de la Mancha..." y sin superficie de lectura, estable por más de 38 segundos. Se esperaba que el panel mostrara el texto del libro (regresión de la ronda 11, hallazgo 4, supuestamente FIXED con DocumentPanel.tsx docKey + chapters.length). La mentira es doble: el asistente afirma haber abierto el libro y el panel no muestra nada legible.

2. MAJOR: Al pedir "mostrame mis recordatorios", la respuesta del asistente muestra IDs técnicos crudos ("#2 mañana a las 8 de la mañana — Tomar las pastillas (se repite a diario); #4 ...; #9 ...") y el mismo recordatorio repetido con textos casi idénticos ("Llamar a mi nieta" #12 y "que llame a mi nieta" #20 a las 9, más "que llame a mi nieta" #16 a las 10): recordatorios basura de rondas anteriores que la limpieza de la ronda 12 no eliminó. Se esperaba una lista en palabras simples, sin IDs, sin duplicados confusos para el abuelo.

3. MINOR: Al pedir "mostrame mis recordatorios" el panel de tareas NO se abrió (no existe la sección RECORDATORIOS en el DOM, que la ronda 12 verificó mostrando "una sola vez"/"a diario"); el asistente respondió solo en el chat con la lista. Se esperaba que la sección RECORDATORIOS del panel de tareas quedara visible con las cadencias en español. (Verificado aparte con "abrime mis tareas": la sección RECORDATORIOS SÍ muestra "una sola vez"/"a diario" correctamente.)

4. MINOR: El botón DETENER tiene el cuadrado rojo correcto (rgb(238,92,97)) pero alrededor conserva un resplandor AZUL (box-shadow rgba(59,130,246,0.38)) heredado de la regla genérica ".composer button" — el glifo rojo con halo azul desentona; se esperaba que todo el botón de stop se viera rojo, sin halo azul.




## Backlog (fixes round 13)

1. (MAJOR) Libro vacío — FIXED: book_reader NUNCA entra en modo edición (el lector de libros es para leer, no editar; el efecto R6 que abría el editor vacío aplica solo a document_editor) + read_book_text reintenta 4 veces ante fallos transitorios de lectura (drvfs EIO en /mnt/c) para que library.open nunca emita chapters vacíos por un glitch. Verificado en vivo: el panel muestra la superficie de lectura con las secciones; un load vacío ya no produce un editor con Cancelar/Guardar.
2. (MAJOR) Lista de recordatorios con IDs crudos — FIXED: reminders_list ya no antepone "#N"; los duplicados basura ("que llame a mi nieta" x2) se eliminaron de la base. La lista muestra solo palabras simples.
3. (MINOR) "mostrame mis recordatorios" no abría el panel de tareas — FIXED: reminders_list emite panel.open tasks (RECORDATORIOS queda visible).
4. (MINOR) Halo azul en DETENER — FIXED: .stop-button box-shadow: none (el resplandor azul venía de la regla genérica .composer button).

Fixes verificados en vivo (DOM + wire): libro con secciones, lista sin #N, panel de tareas abierto con RECORDATORIOS, stop sin halo. Backend 502 + frontend 828 verdes (ronda 13).

## Backlog (reviewer round 14)

1. MAJOR: Mientras la música está sonando, el botón DETENER debe verse todo rojo sin ningún halo. En vivo, el botón (clase "stop-button") tiene el cuadrado rojo (rgb(238,92,97)) pero su box-shadow COMPUTADO es azul (rgba(59,130,246,0.38) 0px 4px 16px), heredado de la regla genérica ".composer button" (especificidad 0-1-1) que VENCE a ".stop-button { box-shadow: none }" (0-1-0) — el fix declarado en la ronda 13 no tiene efecto. El usuario ve un halo azul alrededor del stop rojo.

2. MINOR: Después de decir "pará la música" (detención total), no queda ningún control de reproducción visible para reanudar: el panel de medios vuelve a la vista de búsqueda y el botón DETENER del compositor permanece en pantalla con el glifo de cuadrado rojo, pero hacer clic en él no reanuda la música (solo quita su clase "active"). Se esperaba que el usuario pudiera reanudar la música con un toque desde la barra persistente (o que el botón cambiara a ▶), no que tuviera que volver a elegir el video. (El botón ▶ del reproductor en estado pausado SÍ funciona: reanuda.)

3. MINOR: Al pedir dos veces "agregá comprar pan a mis tareas", la tarea no se duplica (bien) pero la respuesta del asistente en el chat contiene el ID técnico crudo: "«Comprar pan» ya está en tu lista de tareas (#4)". Se esperaba una respuesta en palabras simples, sin "#4" ni ningún id en pantalla (el abuelo no entiende ids).

4. MAJOR: La sección RECORDATORIOS del panel de tareas muestra la HORA INCORRECTA para todos los recordatorios: una hora antes de la real. El recordatorio "que llame a mi nieta" creado para mañana a las 9 de la mañana aparece en el panel como "próxima sábado 15 de ago, 8:00 a.m."; "Tomar las pastillas (a diario)" de las 8 aparece a las 7:00 a.m.; "que le dé de comer al gato" de las 10 aparece a las 9:00 a.m. La respuesta del chat y la base de datos (due_at 15:00 UTC = 9:00 local) coinciden en 9; el panel descuenta una hora de más. Se esperaba que el panel mostrara la misma hora que el chat ("mañana a las 9 de la mañana", no 8:00).

5. MAJOR: Al crear "que llame a mi nieta" para mañana a las 9, la lista queda con DOS recordatorios que dicen lo mismo a la misma hora: "Llamar a mi nieta" (sábado 15, 9:00) y "que llame a mi nieta" (sábado 15, 9:00) — el registro "Llamar a mi nieta" de rondas anteriores no se tuvo en cuenta al agendar (la diferencia de redacción evita la deduplicación). El abuelo ve dos avisos idénticos y no sabe cuál borrar; es el mismo problema de duplicados de la ronda 13 (hallazgo 2). Se esperaba que la lista no tuviera duplicados.

## Backlog (fixes round 14, 2026-08-14)
1. (MAJOR, finding 1) El botón DETENER debe verse rojo SIN resplandor azul: la regla genérica .composer button (0-1-1) vencía a .stop-button (0-1-0). Ahora .composer .stop-button (0-2-1+) anula el brillo en base, hover y active.
2. (MINOR, finding 2) Después de "pará la música" el usuario debe poder reanudar: el reproductor permanece montado con Reproducir habilitado y las ofertas quedan DEBAJO (media-dock-reoffers), no en lugar del reproductor.
3. (MINOR, finding 3) Las respuestas de tareas no deben mostrar ids crudos "(#4)": "Tarea agregada: {title}." sin id.
4. (MAJOR, finding 4) El panel debe mostrar la hora REAL del usuario: el navegador declara su zona IANA (client.info) y el backend ancla recordatorios a ella (set_tz); antes WSL (Chihuahua UTC-6) y Windows (Pacífico UTC-7) diferían 1 h. Los registros existentes se re-anclaron +1 h.
5. (MAJOR, finding 5) No duplicar recordatorios: al completar un borrador se rechaza si ya existe uno activo con texto similar en la misma hora ("Llamar a mi nieta" vs "que llame a mi nieta" -> "Ya tenés anotado...").

## Backlog (reviewer round 15)

1. MINOR: Cuando el asistente pregunta "¿Qué te recuerdo mañana a las 9 de la mañana? Decime el texto y lo agendo." y el abuelo responde "que llame a mi nieta", el mensaje del abuelo NO aparece en la conversación: el chat pasa directamente de la pregunta del asistente a la respuesta "Ya tenés anotado: Llamar a mi nieta...", sin el "TÚ que llame a mi nieta" intermedio. Se esperaba que el mensaje del usuario quedara visible en el chat como en cualquier otro intercambio (el abuelo debe ver sus propias palabras en pantalla).
