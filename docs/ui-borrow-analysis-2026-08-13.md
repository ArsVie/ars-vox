---
type: analysis
title: UI borrow analysis — beautiful-ui-five (2026-08-13)
---

# UI borrow analysis — beautiful-ui-five.vercel.app

Night-shift analysis (2026-08-13). Source: https://beautiful-ui-five.vercel.app
(redirects to www.beautifului.dev; the corporate network shows a Trimble
newly-registered-domain warning first — one "I understand" click-through
proceeds to the real page).

## What the site is

A dark-mode gallery of 17 AI-native UI components by the Turbo design
studio: Loading State, Thinking, Streaming Text, Approval Card, Tool
Chips, Task Rows, Chat, Prompt Bar, Recommendation Card, Context Cards,
Diff Table, Records Table, Filter Table, Sidebar Nav, Search, Insight
Cards, Code Block. Each section = numbered header + one-line description
+ a large bordered preview card.

## Borrow now (this branch)

1. **Task Rows → TasksPanel.** Capsule/pill rows: status icon on the
   left (green check circle for done, numbered ring for in progress),
   bold task label, muted quantity ("2 messages"), a green "Completada"
   pill, and a chevron affordance. Status is communicated three ways
   (icon + text + color) — exactly right for the elderly user. Our
   TasksPanel already renders cards with status chips; the borrow is the
   pill row + quantity + redundant done-badge treatment.
2. **Tool Chips → ToolChips.** Compact scannable rows: small icon +
   operation label + a mono-styled chip holding the target (file name or
   command), plus green +N / red −N line-count chips for edits. Our
   ToolChips show tool + args; the borrow is the row compaction and the
   mono chip treatment.
3. **Context Cards → DocumentPanel.** Source chip at the card bottom: a
   colored file-type badge (PDF red, CSV green), the file name, and an
   external-link arrow. Our DocumentPanel lists docs; the borrow is the
   typed source chip styling on the document rows.

## Considered and deferred

- **Approval Card** (option list + free-text answer + pagination dots):
  strong fit for our confirmation panel, but confirmations sit inside
  ConversationPanel with frozen approve/reject semantics — a restyle
  here deserves a design review before touching it. Deferred, not
  dropped.
- **Chat reasoning stages with per-stage durations** ("Sales History ·
  for 4s"): needs per-tool timing from the service; our wire has none
  yet. Visual-only version would lie. Deferred until the service emits
  it.
- **Streaming Text inline sources / Recommendation Card confidence
  meter**: no citation or confidence data exists in the service.
- **Prompt Bar @//-menus, model picker**: complexity the elderly user
  does not want; our composer stays simple (mic + send).
- **Loading State pixel loader**: our TurnTimer already shows elapsed
  time; the pixel-grid variant adds nothing.

## Hard filters (elderly user, backlog directives)

- NOT borrowed: the gallery's muted low-contrast gray body text — it
  fails our high-contrast requirement. Our --av-* tokens stay.
- NOT borrowed: icon-only controls without text labels.
- Any motion (shimmer, chevron animation) must respect
  prefers-reduced-motion.
- All labels stay Spanish; large-text mode must keep working.
