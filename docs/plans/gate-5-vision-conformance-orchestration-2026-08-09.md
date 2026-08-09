# GATE-5 — Vision conformance: orchestration contract

**Status:** proposed, not started
**Reviewer:** architectural review lane
**Orchestrator capacity:** up to 10 subagents
**Acceptance authority:** `docs/panel-vision.md` (FROZEN — Ars's words are the spec)

---

## Why this program exists

GATE-3.5, GATE-4 and the seam remediation were all **architecture** programs.
They deleted a second layout engine, collapsed duplicate authorities, hardened
the transport, and made the packaged build trustworthy. That work is real and
it is done.

None of it added a single thing Ars asked for.

His sentence in the frozen vision document is still true today:

> "I have yet to see the panels populated by anything useful."

GATE-5 is the first program whose acceptance criterion is that sentence
becoming false. Its lanes are judged against `docs/panel-vision.md` line by
line, in the packaged build, with a real model — not against suite counts.

---

## Verified gap: vision vs. source

Each row was checked against source, not against `STATUS.md`.

| Vision line (`panel-vision.md`) | State | Evidence |
|---|---|---|
| **conversation** — messages carry TIME for agent context | **DONE** | `context.py` `now_line()` puts Spanish + ISO + UTC at the top of every turn, including reminder injections |
| **tasks** — reminders injected into agent context on a cadence | **MOSTLY DONE** | `build_context()` carries active reminders; scheduler fires; notification→panel integration is the remainder |
| **document** — PDF/EPUB/TXT reader | **DONE** | `ReaderView.tsx` (pdf.js, epub.js) |
| **document** — agent-first editor, BOTH user and agent edit the same doc | **HALF** | `document_insert_text` (`document_tools.py:105`) writes the store and **never emits** — contrast `document_create:36` and `document_open:76`, which do. The agent can edit a document the user is looking at and the user sees nothing. |
| **media** — one player, YouTube *and* local music, same UI | **HALF** | one `MediaController` authority ✅; `MediaSource.LOCAL` is an enum value with no local library, no file access, no discovery |
| **youtube** — agent searches for real, OFFERS selectable options | **NOT DONE** | `media_tools.py:30 FIXTURE_RESULTS`, filtered at `:68`. The most visible untruth in the product: the agent appears to search and returns a hardcoded list. |
| **browser** — integrated, agent drives search bar / scroll / DOM, user manipulates | **NOT DONE** | renderer `<iframe>` only. `hardened-view.ts` + `security-policy.ts` deleted at `8d1fb3f`. `actions.py:319-320` hardcodes `can_go_back=False`, which is why the nav buttons were removed. |
| **agent behavior** — knows preferences from MEMORIES, queries accordingly | **NOT STARTED** | see the finding below |

### The memory finding (charter-level: two sources of truth)

There are **two memory systems**, and the agent can only reach the wrong one.

- `arsvox_memory` is the authoritative store: SQLite + FTS5, `search.py:6
  search_all()` unifies notes and conversation turns. **Zero consumers in
  `services/agent`.** Every turn Ars has ever spoken is indexed and unreadable.
- What the agent actually has is `memory.remember` / `memory.recall`
  (`notes_tasks_tools.py:56-63`) — exact-key lookups against the
  `PreferenceStore` k/v table with a `memory:` prefix. To recall a fact the
  model must already know the key it invented.

"Agent knows the user's preferences from memories and queries searches
accordingly" cannot be built on `memory.recall(key)`. This is not a missing
feature, it is a duplicate authority where the weaker one won.

### User directives still violated in code

Flagged honestly in `STATUS.md`, still unfixed:

| Directive | Violation |
|---|---|
| no template selector anywhere, dev included | `StatusBar.tsx:69` `DEMO_TOGGLE_ENABLED`, `:121-125` `<select className="status-demo-select">` |
| fresh start = central-mic hero ONLY; history stashed, never auto-restored | `store.ts:1060` `messages: snap.history.map(...)` |
| persistent home affordance (logo/home → mic hero) | no such control exists |
| close X on every panel header | only `ErrorPanel.tsx:17` has one |
| confirmation as a popup inside the chat, or a voice ask | not built |
| state panel MINIMAL, not a header, where the eyes land | still a status bar |

### Unwired capability

`WakeWordDetector` and `Vad` have **zero consumers** outside
`services/voice/__init__.py` and `providers.py`. The wake phrase is still
UNDECIDED by Ars. The product has never been driven by a physical microphone
in a packaged build.

---

## The structural problem this plan has to solve

GATE-4's safety mechanism was **disjoint file ownership per wave**. It worked
because those lanes were mostly independent.

It does not transfer unchanged, because every product lane in GATE-5 wants the
same four things:

1. a new tool + a new wire event (`packages/contracts`, `contracts.ts`)
2. a dispatcher case (`actions.py`)
3. content state (`store.ts` — still 1,420 lines and still the god object)
4. vocabulary in `prompts/system.md`

Six lanes editing that spine concurrently reproduces GATE-3.5 exactly: a merge
conflict resolution silently dropping one branch's change.

**The answer is to invert the order.** Land the entire program's wire surface
and the store decomposition FIRST, in one owner each, as no-op scaffolding.
Then freeze both. Every product lane afterwards builds behind a frozen contract
in files it exclusively owns.

The precondition for the store decomposition is now met: the review deferred it
until the legacy layout half was deleted, and `layout/engine.ts` + `PanelHost`
are gone. If it is skipped, this program ends with a 2,000-line `store.ts`.

---

## Standing rules (all waves, no exceptions)

1. **`store.ts` has exactly one owner for the entire program** — `W0-SLICE`.
   After GATE-0 it is frozen. Product lanes register a slice; they do not edit
   the store. A lane that believes it must edit `store.ts` escalates.
2. **The wire is frozen after GATE-0.** A lane that discovers it needs a new
   event, command or tool signature escalates to the orchestrator. It does not
   add one, and it does not smuggle data through an existing field.
3. **`docs/panel-vision.md` is read-only.** Agents must never modify, ratify,
   correct, extend or reinterpret it. It is the acceptance criterion, quoted
   into each lane's brief verbatim.
4. **No fixtures shipped as features.** If a lane cannot do the real thing, it
   reports honest failure and stops. It does not ship a hardcoded list that
   looks like a working feature. `FIXTURE_RESULTS` is the reason this rule
   exists.
5. **Green suites do not close a lane.** A lane closes on the packaged Electron
   build demonstrating the vision line it claims, with a real model.
6. **`prompts/system.md` and `docs/STATUS.md` are orchestrator-owned.** Lanes
   submit their vocabulary text; the orchestrator writes the file.
7. **Compatibility code carries an expiration at the moment it is written** —
   `TODO(lane, delete-when: <condition>)`. A lane that leaves an unexpiring
   adapter does not close.
8. **Every lane names the authority it creates and the authority it retires.**
   A lane that adds an authority without retiring one must justify it in the
   merge note.

---

## Prerequisite (before W0 starts)

`apps/desktop/src/store.ts` and `apps/desktop/tests/one-choke.test.ts` carry an
uncommitted change from the GATE-4 review (the `recordLayoutRejection` single
writer + its regression test). Commit or discard it before W0 begins — it
touches the file `W0-SLICE` will own exclusively.

---

## Wave 0 — spine (3 lanes, parallel; blocks everything)

Nothing in W1–W3 may start until GATE-0 passes.

### `W0-CONTRACT` — land the whole program's wire surface, then freeze it
**Owns:** `packages/contracts/arsvox_contracts/{commands,events,client_messages,enums}.py`,
`packages/contracts/schemas/*`, `apps/desktop/src/contracts.ts`,
`services/agent/arsvox_agent/actions.py`

Adds every member W1–W3 will need, with handlers that are explicit no-ops
returning an honest "not implemented" — never a fake success (R25):

- `media.search_results` (real result cards the user picks by click or voice)
- `media.select_result`
- local-source members for the unified player
- `document.changed` (so agent edits reach an open editor)
- `browser.dom_action` + real `can_go_back`/`can_go_forward` in the state shape
- `memory.search` (semantic/FTS recall, distinct from `memory.recall`)

Also: narrow the `actions.py` union properly, and regenerate + diff schemas in
CI. **Done when** a lane can implement its feature without touching any wire
file.

### `W0-SLICE` — decompose `store.ts`; retire the last two store-level directives
**Owns:** `apps/desktop/src/store.ts` and the new `src/state/` slices

- Carve the per-surface content bag into slices with **one registration seam**.
  The store keeps the choke points (`applyAdaptiveSpec`, `applyEvent`,
  `dispatchCommand`); it stops holding five panels' payloads.
- Delete the history auto-restore at `store.ts:1060`. Fresh start is the
  central-mic hero; snapshot history is stashed for an explicit resume.
- **Acceptance signal:** `store.ts` must lose at least a third of its 1,420
  lines. If it does not, the decomposition did not happen — this is the same
  signal W2-STORE failed at GATE-4, and this time it is a gate condition, not
  an observation.

### `W0-DIRECTIVE` — the outstanding UI directives (pure components)
**Owns:** `StatusBar.tsx`, `PanelHeader.tsx`, `MicHero.tsx`, `App.tsx`,
`ConfirmationPanel.tsx`, `src/styles/*`

- Delete `DEMO_TOGGLE_ENABLED` and the template `<select>` outright. Not
  gated — deleted. "No template selector anywhere, dev included."
- Persistent home affordance (ARS·VOX logo / home icon → mic hero).
- Close X on every panel header.
- Confirmation as a popup **inside the chat**, not a separate panel.
- State panel reduced to minimal, placed where the eyes land, not a header bar.

### GATE-0 (orchestrator, packaged build)
Cold start; compose a layout; reconnect; resize; restart with a confirmation
pending. Then declare the wire and `store.ts` frozen for the program. Any lane
that later needs either is an escalation.

---

## Wave 1 — populate the panels (6 lanes, fully parallel)

This is the wave that answers Ars's complaint. Disjoint ownership throughout.

### `W1-YOUTUBE` — real search, offered as selectable options
**Owns:** `services/agent/arsvox_agent/tools/media_tools.py`, a new
`services/agent/arsvox_agent/search/youtube.py`, `YoutubePanel.tsx`

Delete `FIXTURE_RESULTS`. Behind a provider seam so a hosted API key can
replace the default without touching callers. The agent **offers** options; the
user picks by click or by voice ("el segundo", "el de la guitarra"). Zero
results is an honest "no encontré nada", never a fixture.

### `W1-MEDIA-LOCAL` — one player, two sources
**Owns:** `src/media/*`, `MediaDock.tsx`, local-library discovery in the
service

Local audio files reach the same controller, the same UI, the same controls.
Ars's line is explicit: *"controls and UI the same regardless of source."* Any
`if (source === 'local')` in the UI layer fails this lane.

### `W1-DOC-SHARED` — both the user and the agent edit the same document
**Owns:** `document_tools.py`, `DocumentPanel.tsx`

`document_insert_text` must emit, like `document_create` and `document_open`
already do. Agent edits appear live in the open editor; user edits are visible
to the agent on the next turn. One document, one authority — not an agent copy
and a user copy.

### `W1-MEMORY` — the agent reaches the authoritative memory
**Owns:** `notes_tasks_tools.py`, a new `memory_tools.py`, `context.py`
(memory section only)

Wire `search_all()` to a real tool. Retire `memory.remember`/`memory.recall`
against `PreferenceStore`, or demote them to explicit preference-setting with
an expiration marker — **the k/v path must not remain a second memory
authority**. Then close the vision line: preferences recalled from memory shape
the queries `W1-YOUTUBE` issues.

### `W1-TASKS` — reminders as cronjobs the agent actually feels
**Owns:** `scheduler.py`, `reminder_tools.py`, `TasksPanel.tsx`,
`NotificationRegion.tsx`

Cadence injection into turns; notification→panel integration; snooze/dismiss
emit `tasks.update`; one event per fired reminder (the double-publish at
`scheduler.py:83`/`:92` produces duplicate chat lines).

### `W1-CONFORMANCE` — the acceptance harness
**Owns:** `docs/vision-conformance.md`, `tests/e2e/*`

Turns `panel-vision.md` into a runnable checklist against the packaged build:
one row per vision line, each row PASS/FAIL with the evidence that proved it.
This lane produces the artifact GATE-1 is judged on, and it is the only lane
permitted to declare another lane's line closed.

### GATE-1 (orchestrator, packaged build, real model, out loud in Spanish)
Ask for a video. Pick one by voice. Play it. Ask for local music. Ask the agent
to add a paragraph to the open document. Set a reminder, let it fire. Ask
something that requires remembering a stated preference. Every one of those is
a line in the frozen vision document.

---

## Wave 2 — the browser (2 lanes, SERIAL — do not parallelize)

The largest and riskiest lane, and the one that requires reversing a decision.
`8d1fb3f` deleted `hardened-view.ts` + `security-policy.ts` on the grounds that
"browser story = renderer iframe". The vision requires an integrated browser
the **agent can drive**, which an iframe cannot provide.

That ADR must be re-decided explicitly before any code is written. Reversing it
without a written decision is how the repo grows a third browser story.

### `W2-VIEW` — Electron upgrade + `WebContentsView` reinstated
Upgrade first (STATUS records it as a precondition for arbitrary browsing),
then the isolated partition and the allowlist, then real
`can_go_back`/`can_go_forward` replacing the hardcoded `False` at
`actions.py:319-320`, then the nav controls come back.

### `W2-DRIVE` — the agent DOM bridge
Search bar, scroll, click, read. The user manipulates the same view. One
browser state, one authority — the store's `content.browser`, the view, and the
agent's model of the page must not become three.

**Recommended sequencing: run W2 after GATE-1, not alongside it.** It is the
biggest lane, it carries an Electron major upgrade, and it is the least of what
Ars actually complained about.

---

## Wave 3 — voice on real hardware (1–2 lanes)

### `W3-VOICE`
Wire `WakeWordDetector` and `Vad` behind config; barge-in during TTS; then the
smoke test that has never been run: a physical microphone, in the packaged
build, in Spanish, with STOP interrupting mid-speech.

**Partially blocked on Ars** — see the decisions below. The wiring is not
blocked; the phrase choice and the benchmark are.

---

## Merge protocol (carried forward from GATE-4, unchanged)

- One lane, one branch, one merge, verified by the orchestrator against the
  **union** of both sides' concerns, in the packaged build.
- **Two owners on one file is an orchestrator escalation, not a conflict
  resolution.** GATE-3.5's headline defect was a conflict resolution that
  silently deleted a security fix and shipped a mute assistant past a 19-item
  checklist.
- A lane's merge note states: the authority it created, the authority it
  retired, and the expiration on any compatibility code it left behind.

---

## Decisions needed from Ars (do not guess these)

1. **The wake phrase.** Still UNDECIDED in `STATUS.md` ("Lily" as a candidate).
   `W3-VOICE` can wire the detector behind config without it, but cannot tune
   or benchmark. This is the only true external blocker in the program.
2. **YouTube: scraped or keyed.** The plan defaults to a provider seam with a
   scraping implementation so nothing blocks, and a hosted API key drops in
   without touching callers. Worth confirming, because a key changes the
   robustness story and the terms it operates under.
3. **Browser now, or after the panels are populated.** The plan recommends
   after. Say so if the browser matters more than media and documents — it
   changes the whole wave order, not just its position.

---

## What this program deliberately does not do

- It does not add new panels. Seven are specified; five are half-built.
- It does not revisit the adaptive layout contract. That system is finished and
  it works; leave it alone.
- It does not chase suite counts. 567 vitest and 322 pytest were green through
  every defect this repo has shipped.
