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

## Browser

- **Browser must respond.** Asking for news ("noticias de Mexicali")
  fails with "El escritorio no respondió" — the browser surface does
  not show the requested page in the packaged app. The browser panel
  must open and navigate reliably; a failed navigation must be
  reported honestly.

## Status bar

- **Minimal always.** The status bar must be a minimal bar with no
  distracting elements, always near the main view of the user — not a
  separate header region.
- **STOP is a red symbol.** The stop control is a small red symbol,
  nothing more. Reference:
  `docs/screenshots/backlog-minimal-statusbar-example.png`.

## Reminders

- The reminders surface breaks the user flow and wastes vertical and
  horizontal space; a single reminder must not take over the whole
  screen. Reference:
  `docs/screenshots/backlog-reminders-fullscreen-problem.png`.

## Chat input

- **Short replies send.** A simple "si" must be sendable; a minimum
  character restriction currently swallows it.
- **Markdown rendering.** The chat renders markdown: `**`, `__`, `##`
  and friends must display formatted.

## Agent responses

- **No repetition of UI-visible information.** The system prompt tells
  the model not to repeat what is already shown in the UI (e.g. the
  full details returned by the YouTube search tool) unless the user
  needs it restated.
- **User-friendly, human-readable.** Replies are written for a casual
  user, not as tool-output dumps.

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

## Conversation steering

- The user must be able to send SUBSEQUENT messages to steer the agent —
  the first message starts the task, follow-ups ("the second one", "no,
  the other track", "now continue writing") drive the rest. Without
  subsequent messages, conversation cannot happen properly: the agent
  offers options and the user must be able to answer with a follow-up
  turn. Verify this path in the packaged app: offer -> user picks via a
  NEW message -> the agent acts on the pick.
