---
type: plan
title: "GATE-3.5 remediation — orchestration contract (10 agents, disjoint file ownership)"
description: "Reopens GATE-3.5. Four production defects live in the seams between individually-correct Wave-1 branches. This is the work breakdown, the file-ownership map that prevents a repeat, and the merge protocol. 4 waves, max 10 parallel agents."
date: 2026-08-09
status: proposed
---

# GATE-3.5 remediation — orchestration contract

## Why this exists

GATE-3.5 closed on 308 pytest / 601 vitest green plus a 19-item acceptance
checklist. The suites are green and every Wave-1 branch is individually
defensible. The merged system is still broken in four ways, and **every one of
them lives in the seam between two branches, not inside either branch**:

| # | Defect | Branch seam |
|---|---|---|
| 1 | TTS is unauthenticated → the assistant is mute in the packaged build, silently | A1 rewrote `TtsPlayer.tsx` from a pre-A2 base; the A2 merge (`3d74afb`) resolved in favour of A1 and dropped A2's `authenticatedFetch` fix |
| 2 | `layout.compose` is emitted by the server and understood by no one | A3 shipped the tool, A4 shipped the reducer, neither shipped the wire member or the store case |
| 3 | `forceReconnect()` builds `new WebSocket("")` in a 2 s retry loop under Electron | A6 wrote the resync against the vite-dev transport; A2 owned the bridge transport |
| 4 | Adaptive geometry runs on a frozen viewport | A4 made `PanelHost` conditional; `PanelHost` is the only `setViewport` writer |

Full evidence, the source-of-truth inventory, and the duplicate-implementation
list are in the review that precedes this plan. This document is the execution
side only.

**The process lesson is the plan's primary constraint.** Wave 1 ran ten agents
against a shared file surface and reconciled by hand — there are 17 commits in
`main` whose only purpose is resolving a `hey.md` conflict, and one of the real
conflict resolutions silently deleted a security fix. So this program assigns
**disjoint file ownership per wave** and forbids the orchestrator from
resolving a two-owner conflict at all.

---

## Standing rules for every agent

1. **You own the files listed in your lane. You may not edit any other file.**
   If your task appears to require a file you do not own, stop and report it to
   the orchestrator. Do not edit it "just a little".
2. **`hey.md` is deleted in Wave 0 and does not come back.** Coordination goes
   through the orchestrator, not through a file 10 agents append to.
3. **`docs/STATUS.md` is written by the orchestrator only**, at gate close.
   Agents report state in their final message; they do not edit STATUS.
4. **No new `⛔ NON-AUTHORITATIVE` / `DELETION TASK` prose markers.** If you
   leave debt, leave `TODO(<lane>, <removal condition>):` so it is greppable.
   A `grep -rn "TODO\|FIXME"` over this repo currently returns one false
   positive while five parallel legacy systems are live; that ends here.
5. **Every lane ships its own test.** A lane whose defect class was invisible to
   the existing suite must add the test that would have caught it — not a test
   that merely exercises the new code.
6. **Green suites do not close a lane.** All four defects above were green.
   Lanes marked `PKG` must be verified in the **packaged Electron build**, not
   `npm run dev`, because all four are invisible in vite dev.

---

## Wave 0 — stop the bleeding (4 agents, fully parallel)

No two lanes share a file. Nothing here depends on anything else. Ship this
wave before the build goes in front of the user again.

### `W0-TTS` — restore the authenticated TTS transport `PKG`

Owns: `apps/desktop/src/components/TtsPlayer.tsx`,
`apps/desktop/tests/tts-transport.test.ts` (new),
`apps/desktop/eslint.config.*`

- Replace the raw `fetch(TTS_URL, { headers: { ...authHeaders(), … } })` at
  `TtsPlayer.tsx:102` with `authenticatedFetch(TTS_URL, { method: "POST", body,
  contentType: "application/json" })` — the exact call A2 shipped at `5d7007d`.
- **Make the failure loud.** The `catch` at `TtsPlayer.tsx:124` currently acks
  `tts.finished` and returns, so a 401 renders as silence with no diagnostic. A
  non-OK response must reach `setError` before the ack. In a voice product,
  silent muteness is worse than a crash.
- New test: with `window.arsvox` present, TTS must go through the bridge. The
  existing `tts-player-acks.test.ts` stubs global `fetch` and passes either way
   — that is exactly why this shipped.
- Durable guard: an eslint rule banning bare `fetch` in `apps/desktop/src/`
  outside `endpoints.ts`. This defect class recurs otherwise.

Do **not** touch `endpoints.ts` — `authenticatedFetch` is already correct.

### `W0-RECONNECT` — bridge-mode `forceReconnect` `PKG`

Owns: `apps/desktop/src/ws/client.ts`, `apps/desktop/tests/reconnect.test.ts`

- `client.ts:46` sets `this.url = ""` under `bridgeMode`; `forceReconnect()`
  (`:148`) has no bridge guard and calls `open()` → `new WebSocket("")` throws →
  `scheduleReconnect()` → repeat every 2 s forever.
- In bridge mode, `forceReconnect()` must tear down the IPC subscriptions and
  re-issue `wsConnect()`. The server sends a fresh `state_snapshot` on connect,
  which is the actual resync mechanism.
- Test with `hasBridge()` true. Every existing reconnect test runs the direct
  path only.
- While here: `hasConnected` (`store.ts:420`) and `connectRequested` /
  `closedByUser` (`main.ts:136-137`) are written and never read — **report
  them, do not delete them** (not your files).

### `W0-VIEWPORT` — move viewport ownership to the app shell

Owns: `apps/desktop/src/App.tsx`, `apps/desktop/src/components/PanelHost.tsx`,
`apps/desktop/tests/adaptive-geometry.test.ts`

- The only `setViewport` writer is the `ResizeObserver` in `PanelHost.tsx:141`.
  `PanelHost` mounts only when `adaptive.spec == null` (`App.tsx:117`), so the
  observer disconnects the moment a composition lands and `viewport` freezes at
  the boot size — while `App.tsx:110` keeps feeding it to
  `computeAdaptiveGeometry`.
- Move the observer to the app shell, which is mounted in both branches. Remove
  `setViewport` from `PanelHost` entirely.
- Test: resize in the adaptive path changes geometry.
- Note for the orchestrator: `PanelHost.tsx` is **deleted** in Wave 2. This lane
  is deliberately small so the Wave 2 deletion is a clean removal, not a merge.

### `W0-HYGIENE` — repo and documentation

Owns: `.gitignore`, `hey.md`, `index.md`, everything under `docs/` **except**
`docs/STATUS.md` and `docs/panel-vision.md` (frozen — never edit)

- Add `*.zip` to `.gitignore`; delete the untracked 171 MB `index.zip` from the
  working tree. `README.zip` was previously tracked; one `git add -A` recommits
  this class of file.
- Untrack `hey.md`. It is an agent message board, not documentation, and it is
  the single largest source of merge noise in the program's history.
  Before deleting, copy its A2 entry into this plan's tracking notes — it lists
  `TtsPlayer.tsx` and `mic.ts` as A2-owned files and is direct evidence for
  defect #1.
- Delete `index.md` at repo root (a stale 29-line duplicate of `README.md`'s
  header; README is 235 lines and current).
- **Delete as history, superseded by git:** `docs/handoff-epub-reader-debug-2026-08-07.md`
  (status: resolved), `docs/review-2026-08-07/advisor-round1.md`,
  `docs/demo-e2e-2026-08-08.md` (a runbook whose "verified" numbers are now
  false), `docs/taste-skill-analysis-2026-08-07.md` (an adoption report for a
  decision already made).
- **Prune to guidance, keep the file:**
  `docs/plans/adaptive-ui-redesign-execution-2026-08-07.md` (697 lines — keep
  the frozen contract, drop the wave/gate narrative that has already run);
  `docs/audit-modularity-2026-08-07.md` (snapshot — keep only still-true
  findings); `docs/migration-note-electron-upgrade-2026-08-08.md` (references
  `arsvox:get-token`, a channel that no longer exists).
- Update `docs/plans/index.md`: GATE-3.5 is **reopened**, not closed.
- Rule to apply throughout: a doc is *guidance* (what to do, still true) or
  *state* (what is true now) or it is history. History belongs in git.

### GATE-0 — orchestrator, packaged build only

Not a test run. Build the Electron package and:
1. Speak. Confirm audio plays. (Defect #1)
2. Kill the Python service mid-session. Confirm reconnect recovers and the
   console shows no repeating `WebSocket` construction error. (Defect #3)
3. Resize the window after a layout has landed. Confirm geometry follows.
   (Defect #4)

If any of the three fails, the wave is not done. Suites being green is not the
gate.

---

## Wave 1 — contracts and boundaries (5 agents, parallel)

### `W1-STORE` — the long pole, single owner `PKG`

Owns: `apps/desktop/src/store.ts`, `apps/desktop/src/contracts.ts`,
`apps/desktop/tests/store.test.ts`

**`store.ts` has exactly one owner for the entire program.** It is 1,429 lines
holding both layout authorities, three switches (18 + 10 + 10 cases), and six
`Legacy boot path` forks. It is the file most likely to reproduce defect #1.
This lane continues into Wave 2 — do not reassign it.

Wave 1 scope (small, deliberately):
- Add the `LayoutCompose` member to the TS `UiCommand` union (`contracts.ts:204`)
  and the `layout.compose` case to `applyUiCommand` (`store.ts:684`), routing
  straight into `applyAdaptiveSpec`. It is already adaptive-native — it does not
  need the planner, which is the legacy `layout.apply` adapter that
  `planner.ts:123` marks `Do NOT extend`.
- Normalize `surface_id` → `surfaceId` **once**, at the wire boundary. Today
  `snapshot.py:85` reads `a.get("surface_id") or a.get("surfaceId")` — two
  serialization conventions in one parser. Do not add a third site.
- Add a `default:` clause to `applyUiCommand` recording the unhandled action.
  The absence of one is why defect #2 was silent for the whole gate.
- Test: a `layout.compose` frame changes the rendered composition.

### `W1-PYCONTRACT` — make the contracts enforce themselves

Owns: `packages/contracts/**`, `services/agent/arsvox_agent/snapshot.py`,
`tests/python/test_contracts.py`, `tests/python/test_tools_api.py`,
`apps/desktop/tests/conformance.test.ts`, CI config

- `snapshot.py:159` records only `layout.apply`, so a composed layout never
  enters the reconnect snapshot. Record `layout.compose` too.
- **Regenerate schemas in CI and fail on diff:** run `export_schemas.py` then
  `git diff --exit-code packages/contracts/schemas`. The checked-in schemas are
  stale — `"news"` survives in `ui-commands.schema.json:564`,
  `agent-events.schema.json:983`, `client-messages.schema.json:526` after
  removal from `enums.py`.
- Then delete the assertion that **codifies** the drift:
  `test_tools_api.py:52` asserts `model_values == wire_values - {"news"}`, and
  `conformance.test.ts:144` passes *because* the schema is stale.
- **Parity tests for the four hand-mirrored cross-language tables**, each
  currently guarded only by a comment: `_LEGACY_TEMPLATE_MAP` ↔
  `LEGACY_TEMPLATE_MAP`, `REGISTERED_SURFACES` ↔ `PRODUCT_SURFACES`,
  `DEFAULT_REMOTE_ALLOWLIST` ↔ `browser.allowlist`, and the spoken vocabularies
  in `local_intents.py` ↔ `spokenOverrides.ts`. A test that parses the TS
  literal from disk is ugly and correct; a comment is neither.
- Report (do not fix) that `AdaptiveSnapshot.overrides` is unreachable — no
  client message can carry it, so user layout constraints never survive a
  reload despite R33's claim.
- `"news"` also survives in `apps/desktop/src/layout/engine.ts:59`. That file is
  deleted in Wave 2 — report it, do not edit it.

### `W1-VOICE` — one exit from the voice state machine

Owns: `services/agent/arsvox_agent/runtime.py`,
`services/agent/arsvox_agent/ws.py`,
`services/voice/arsvox_voice/pipeline.py`, matching `tests/python/`

- `runtime.py:171` claims `_settle()` is "the ONLY place the machine may leave
  THINKING/SPEAKING". Two other sites contradict it: `runtime.py:143` (spoken
  confirmation) and `ws.py:187` (`_sync_state_after_resolve`). All three
  re-derive `WAITING_FOR_CONFIRMATION` from `pending.list_pending()`, with
  different guards — `ws.py:182` has a "don't settle while speaking" check that
  `runtime.py:143` lacks, so a spoken confirmation resolved during TTS playback
  settles mid-speech.
- One derivation function, called from all three sites. Make the claim true or
  delete the claim.
- `ws.py:88` and `ws.py:183` reach `runtime._speech_pending` across the module
  boundary (`# noqa: SLF001`) — the transport is driving the state machine's
  privates. Give `runtime` a public API and delete both noqas.
- Report: `pipeline.set_state` only broadcasts on change (`pipeline.py:119`)
  while `SnapshotTracker.last_voice` only sees broadcasts, and `snapshot.py:274`
  prefers the tracker over the pipeline. Those can disagree.

### `W1-ELECTRON` — apply the security work that was already written

Owns: `apps/desktop/electron/**`, `apps/desktop/tests/electron-*.test.ts`

- `isTrustedIpcSender` is imported at `main.ts:39` and **never called**. Every
  handler uses the local `isTrustedSender` (`main.ts:191`), which omits the
  `isDestroyed()` and `frame === event.sender.mainFrame` checks — a subframe of
  the app window passes. Apply `isTrustedIpcSender` in every handler; delete
  `isTrustedSender`. Fix the docstring at `hardened-view.ts:219`, which still
  references the removed `arsvox:get-token` channel.
- **Add a CSP.** There is none anywhere in the app (grep returns nothing).
- **Decide the browser story and write the decision down.** `main.ts:302`
  creates the hardened remote-content partition and `main.ts:303` discards it
  (`void remoteSession`); real browsing happens in a renderer `<iframe>`, so
  `security-policy.ts` governs nothing the user visits. Either wire the
  `WebContentsView` or delete `hardened-view.ts` + `security-policy.ts`. Do not
  leave a security module that governs nothing — that is worse than having none,
  because the threat model claims it works.
- Your decision blocks `W2-BROWSER`. Report it at gate, not at the end.

### `W1-DISPATCH` — narrow the client-action dispatcher

Owns: `services/agent/arsvox_agent/actions.py`, matching `tests/python/`

- 20 `# type: ignore[attr-defined]` in one file, all of the form
  `command.<field>  # type: ignore[attr-defined]` — the entire dispatcher runs
  unnarrowed over a discriminated union. Narrow properly and delete all 20.
- This is not cosmetic: it silences exactly the class of drift that produced
  defect #2. A `layout.compose` arriving here would fail at type-check with the
  ignores removed.
- Also here: `actions.py:254` hardcodes `can_go_back=False` / `can_go_forward=False`
  and `title=""` on every `BrowserNavigateEvent`, which is why three browser
  controls are permanently dead. Fix the event or report it to `W2-BROWSER` —
  your call, but say which.

### GATE-1

Suites green, plus packaged build: ask the assistant for something that should
compose a workspace and confirm the layout actually changes (defect #2), then
reload and confirm it is restored.

---

## Wave 2 — one layout system (3 agents, partly serial)

### `W2-STORE` — delete the legacy layout authority `PKG`

Same owner and same files as `W1-STORE`, plus
`apps/desktop/src/layout/**`, `apps/desktop/tests/layout.test.ts`.

`layout/engine.ts`'s own header says its deletion precondition is **already
met**: "the config-driven default now lands an adaptive composition at connect,
so the legacy boot path is already vestigial."

- Land the default composition before first paint so `adaptive.spec` is never
  `null`.
- Delete `layout/engine.ts` (485 lines), `PanelHost.tsx`, `store.spec`,
  `store.layout`, `store.history`, `store.panelMeta`, `store.fullscreenPanel`,
  `recompute()`, and the six `Legacy boot path` branches in `store.ts`.
- `fullscreenPanel` is a hand-mirror that already desyncs: the `panel.fullscreen`
  case writes it, `handleSpokenText` (`store.ts:1431`) applies the same
  fullscreen and restore intents and never does. Derive it in `PanelHeader`
  from `adaptive.overrides`. **Do not keep a mirror.**
- This removes the `TEMPLATE_SLOTS` name collision that forces
  `store.ts:43` to alias an import to compile.
- Move `adaptive/harness/geometry.ts` into `tests/` or delete it. It is an
  expired "TEST-ONLY STUB" shipping in `src/` whose proportion constants
  (.4/.55/.7) differ from the real engine's (.62/.72/.82) and which lacks the
  `equalSplit` branch — workflow tests currently validate against geometry the
  app does not produce.
- **Acceptance signal: `store.ts` should lose roughly a third of its lines.**
  If it does not, the consolidation did not happen.

### `W2-SURFACES` — remove the dual-mount forks `blocked by W2-STORE`

Owns: `apps/desktop/src/components/{TasksPanel,ConversationPanel,MediaDock,DocumentPanel,BrowserPanel}.tsx`,
`apps/desktop/src/roles/host.tsx`, and the six matching surface tests

Every content component carries a `legacy PanelHost mount` codepath, and the
tests pin them (`media-surface.test.tsx:148`, `reading-surface.test.tsx:129`,
`tasks-surface.test.tsx:115`, `conversation-surface.test.tsx:191`). Delete the
forks and the tests that pin them.

### `W2-REMINDERS` — one event per reminder

Owns: `services/agent/arsvox_agent/tools/scheduler.py`,
`services/memory/arsvox_memory/repos/{reminders,notifications}.py`,
`apps/desktop/src/components/NotificationRegion.tsx`, matching tests

- `scheduler.py:83` and `:92` publish **both** a `NotificationEvent` and a
  `UiCommandEvent(NotificationShow)` for the same reminder. `pushNotification`
  dedupes by id, but both paths also append a chat message with a freshly
  generated id — so every reminder produces two identical system chat lines.
  Publish once.
- `snooze_top` / `dismiss_top` write both stores but publish only an
  `AgentMessageEvent`, so `content.tasks.reminders` and `store.notifications`
  both go stale until something else triggers `_emit_tasks_update`. Emit it.
- `store.notifications` is only ever added to and capped; there is no dismiss
  affordance, so a dismissed reminder stays on screen until reconnect.

Coordinate with `W2-STORE` if you need a store field — you do not own `store.ts`.

### GATE-2

Cold start and confirm `PanelHost` never renders. Say "pantalla completa" and
confirm the header icon agrees with the actual layout.

---

## Wave 3 — remaining duplicate authorities (3 agents)

Each is independently shippable; none blocks a release.

- **`W3-MEDIA`** (store lane) — derive `store.content.media` from
  `mediaController` via subscription instead of eight hand-written mirror
  writes, two of which use a stale `state` captured before the mutation. Drop
  `MediaDock`'s `stateRef` / `positionRef` / `readyRef` shadow copies, and key
  `initialAutoplay` per video (it is frozen at first mount today, so a second
  video inherits the first's autoplay decision).
- **`W3-BROWSER`** `blocked by W1-ELECTRON` — implement back/forward/refresh
  against whatever browser engine W1-ELECTRON decided on, or hide the three
  controls. Do not ship dead buttons.
- **`W3-TRANSPORT`** — one outbox, not two stacked 200-item queues
  (`store.ts:421` and `electron/wsclient.ts:61`, each silently shifting off the
  oldest). Validate inbound frames once at the renderer boundary
  (`ws/client.ts:125` is a bare cast today). Share the reconnect/backoff policy
  between the two `WsClient` classes — the duplication is partly justified (main
  has no global `WebSocket`), the policy duplication is not.

---

## Merge protocol — this is the part that failed last time

1. **One integration branch.** Lanes rebase onto it; they do not merge into each
   other. A lane that has drifted rebases and re-runs its own tests before it is
   eligible to land.
2. **Two owners on one file is an orchestrator escalation, not a conflict
   resolution.** If a rebase produces a conflict in a file the lane does not own,
   the lane stops and reports. The orchestrator reassigns scope. Defect #1 was a
   hand-resolved conflict in a file two lanes had both edited.
3. **A resolution that discards either side's hunk must say so in the commit
   body**, naming what was dropped and why. `3d74afb` discarded a security fix
   and its message says "reconcile A8 IPC hardening".
4. **After each landing, run the *other* lanes' tests, not just the landing
   lane's.** Both suites were green through every one of these defects because
   each lane's tests only looked at its own concern.
5. **After each landing that touches a `PKG` lane, run the packaged smoke.** All
   four defects are invisible in vite dev, which is where the gate was verified.
6. No lane edits `docs/STATUS.md`. The orchestrator writes it at gate close,
   from lane reports, against the source — not from lane claims.

## Suite commands

```bash
.venv/Scripts/python -m pytest tests/python -q
```

```bash
cd apps/desktop && npm test && npm run typecheck && npm run build
```

## Adversarial pass — run once, after Wave 2

The charter's runtime audit has evidently never been done, and it is where the
remaining authority duplicates will surface. In the packaged build: interrupt
mid-speech with STOP; spam the mic button; disconnect and reconnect the service
under load; restart the app with a confirmation pending; open and close panels
faster than the inertia gate settles. Any state that disagrees with itself is a
Wave 3 or Wave 4 item, not a bug fix.

## Not in scope

Splitting `store.ts` into slices — do it after Wave 2 deletes the legacy half,
or you will carefully modularize code that should not exist. Also deferred: the
`local_intents` / `spokenOverrides` vocabulary unification, `AdaptiveSnapshot.overrides`
reachability (fix the doc now, the feature later), and the reader/EPUB polish
parked in `wip/advisor-round2-reader-polish`.

## What is not recommended

Nothing needs to be un-merged or reverted. The Wave-1 branches are sound. The
failure was in reconciliation and in a gate that accepted green suites as proof
of a working system — a 19-item checklist passed over a voice assistant that
cannot speak.

---

## Tracking notes

### hermes (GATE-3.5 Wave 1 — A2 secure launch, wip/g35-a2-launch, 2026-08-08)
- task: R09-R15 process/auth lifecycle owner — Electron generates one per-launch token, spawns Python service, authenticated health handshake; renderer loses token access (R14); pre-first-connect buffering (R11); visible startup failure (R12); child kill on exit (R13); PATCH auth guards (R15).
- files: apps/desktop/electron/{main,preload,service,wsclient}.ts, apps/desktop/src/{endpoints,store,main.tsx,ws/client.ts,arsvox-bridge.d.ts}, TtsPlayer.tsx, mic.ts, packages/contracts/arsvox_contracts/config.py, services/agent/arsvox_agent/app.py, tests (python + desktop).
- status: RESOLVED 2026-08-08 — R09-R15 complete; desktop 468 tests (incl. launch-integration real-spawn suite), pytest 212, typecheck+build clean. Committed wip/g35-a2-launch.
