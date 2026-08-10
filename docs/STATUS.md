---
type: status
title: Ars-Vox current state
description: Single authority for current implementation state. Supersedes all current-state claims in ADRs, audits, and HANDOFF.md. Updated 2026-08-10.
timestamp: 2026-08-10T03:10:00Z
---

# Ars-Vox — current state (2026-08-10)
THIS FILE IS THE SINGLE AUTHORITY for current implementation state.
HANDOFF.md is the roadmap (guidance, not history); ADRs are historical
decisions; audits are snapshots. If any other doc contradicts this file,
this file wins.

## GATE-5 Wave 0 (MERGED + PACKAGED-VERIFIED 2026-08-09; wire and store.ts FROZEN)

Program: docs/plans/gate-5-vision-conformance-orchestration-2026-08-09.md.
Wave 0 landed the spine: the full wire surface and the store
decomposition, in one owner each, then froze both. All three lanes merged
with ancestry verified; post-merge suites green; packaged GATE-0 smoke
passed (cold start / compose / reconnect / resize / restart with pending
confirmation — screenshots 29–33).

- W0-CONTRACT (8b1c6b9): media.search_results + media.select_result,
  local-source media members, document.changed, browser.dom_action +
  real can_go_back/can_go_forward in state shape, memory.search_results
  (semantic/FTS recall, distinct from memory.recall); actions.py union
  narrowed; schemas regenerated + diffed. Handlers are honest no-ops
  ("not implemented"), never fake success. THE WIRE IS FROZEN.
- W0-SLICE (f782d7f): store.ts 1,485 → 971 lines (−36.2% of the 1,420
  baseline — the one-third gate signal, MET this time). Content bags
  carved into state/ slices with ONE registration seam
  (contentRegistry.register); store keeps the choke points
  (applyAdaptiveSpec / applyEvent / dispatchCommand / applyUiCommand).
  History auto-restore DELETED: fresh start = central-mic hero; snapshot
  history stashed for an explicit resume; in-memory chat survives
  same-tab reconnects (R31 chat-clear retired; reconnect tests
  reconciled at merge, 8e4a509). STORE.TS IS FROZEN (single owner:
  W0-SLICE).
- W0-DIRECTIVE (26b2f9b): template selector deleted outright (dev
  included — DEMO_TOGGLE_ENABLED gone), ARS·VOX wordmark = home button
  (layout.restore → panel.open → panel.set_primary, C1 seam only),
  close X on every panel header, confirmation as a card INSIDE the chat
  (overlay wrapper retired), minimal state pill in the shell chrome.
- GATE-0 packaged (real model, mock off): cold start → hero only;
  compose split (document_editor + media, 640x800 each); resize
  1280→1500 → slots 640→750 (geometry through the choke); service kill
  → 20s zero WS errors → restart → recovery turn (Spanish, TTS spoke,
  voice machine cycled); restart with telegram confirmation pending →
  card cleared (server-side in-memory), layout + chat survived, no
  error panel.

## GATE-5 Wave 1 (MERGED 2026-08-09; all six lanes landed, post-merge suites green)

Program: docs/plans/gate-5-vision-conformance-orchestration-2026-08-09.md.
Wave 1 populated the panels against the frozen wire + store: each lane owns
its slice content, no lane touched the wire or store except the ONE
orchestrator-approved routing case (document.changed). Two lanes went
through takeover after connection losses; the conformance lane's checklist
+ harness are in (its summary timed out, work verified by orchestrator).

- W1-MEMORY: memory.remember/memory.recall RETIRED (exact-key k/v against
  PreferenceStore was a second memory authority). New memory.search runs
  the real arsvox_memory search_all (FTS5 over notes + turns) through
  Deps.db — previously unused; emits memory.search_results; honest empty
  results. Preferences surface as context line + preferences.set. system.md
  rule 9 added; registry count 44 → 46 (memory_tools, local_media_tools).
- W1-TASKS: double-publish VERIFIED already fixed (one NotificationEvent
  per reminder); new pins: fire → tasks.update + notification region, fired
  one-shot leaves the list, snooze/dismiss paths, cadence injection into
  build_context (tests only — production was already correct).
- W1-YOUTUBE: FIXTURE_RESULTS deleted; real search behind a provider seam
  (search/youtube.py; hosted key can replace the default without touching
  callers). Result cards selectable by click (media.select_result, full
  frozen payload) and by voice (agent play). Zero results = honest message.
- W1-MEDIA-LOCAL: local library discovery (search/local_library.py,
  local_media_tools: media.search_local / media.play_local) feeding the
  SAME unified player/controller/UI as YouTube; zero `source === 'local'`
  branches in the UI layer; HTML5 element driven by the one MediaController
  (localPlayer.ts mirror of useYoutubePlayer).
- W1-DOC-SHARED: document_insert_text + document_save now emit
  document.changed (full content); store routing case added (approved
  one-line change, df89cee); documentSlice reduces it preserving reader
  fields; bus-spy pytest + panel vitest pin the live reconcile.
- W1-CONFORMANCE: docs/vision-conformance.md (one row per panel-vision
  line, PASS/PENDING/NOT_YET with evidence paths) + tests/e2e harness
  (deterministic wire probes, scripted model, no live model needed);
  consistency gate ties checklist rows to probe verdicts.
- Orchestrator reconciliation at merge: registry pins 44→46, policy
  TOOL_KINDS + media.search_local/play_local, system.md word-safe prompt
  (preferences.set contains the substring 'reference' — drift guard now
  word-boundary), launch-integration timeouts 60s/120s → 180s/200s (cold
  /mnt/c imports measure 2m10s), store.test.ts youtube pin → unified card.

## GATE-5 GATE-1 (PACKAGED VERIFICATION 2026-08-10; three seam fixes merged)

STATUS: **CLOSED** — closing suite 2026-08-10: pytest 372/372 + e2e
harness 14/14 (EXPECTED_STATUS enforces PASS on document_editor,
media_local, youtube, memory, tasks), vitest 627/627, typecheck + build
clean.

GATE-1 = the built app + real model (deepseek-v4-flash, mock:false,
edge TTS, auto_speak, CDP 9222) exercising every panel-vision row with
screenshots. Packaged verification FOUND three real product defects
living in the seams between merged lanes — the exact GATE-4 failure
class the program exists to catch. Each was dispatched to a lane leaf
(never orchestrator surgery), merged with ancestry verified, then the
gate re-ran.

- SEAM 1 (offer cards never mounted): YoutubePanel was dead code — the
  media surface only mounted MediaDock, whose idle state was an empty
  span. MediaDock idle now renders the embedded selectable-card search
  surface (YoutubePanel embedded prop + 2 layout CSS rules);
  `media.search_results` routes to content.youtube (ONE insertion in the
  frozen store switch, same class as the authorized document.changed
  case); system.md rule 10: after a search, open the media panel, list
  options, never auto-play. Verified live: 10 real cards, click →
  media.select_result → ONE controller → iframe.
- SEAM 2 (document editor blind): document.create/open emitted
  panel.open + document.changed but NEVER document.load — the renderer
  bag never formed, editor showed "No hay documento abierto" forever.
  document_tools.py now emits DocumentLoadEvent (content from the file,
  kind from suffix) after panel.open; the changed merge lands live.
  Verified live: create → editor shows title/path/kind + content;
  insert → content updates in place.
- SEAM 3 (offer once per session): after a stop, the dock kept hasTrack=true
  (stopped events retain title/videoId/url), so the search surface only
  ever rendered for the FIRST offer; click-picking died after any
  playback (voice still worked). Fixed by leaf (4e12844, option A:
  `showSearchSurface = !hasTrack || (m.state === "stopped" && results
  .length > 0)`); merged + verified live: play → stop → NEW offer → 10
  cards again → click pick → iframe (screenshot gate1-reoffer-click.png).
- Also fixed at gate: r45 snooze test was wall-clock dependent
  (snooze_top now accepts a deterministic `now`), launch-integration
  beforeAll hook cap 150s → 240s (the hook, not the probe, was the
  binding constraint under contention).
- Verified live at GATE-1: cold start (hero only), OFFER flow (search →
  cards → click pick → play; multi-turn voice steering "la segunda,
  por favor" → plays second result — backlog requirement), memory
  (preference saved → recall shapes search query "jazz suave para
  concentrarse"), tasks (reminder scheduled → exactly ONE notification
  event → notification in UI → one-shot consumed; fresh-turn cadence
  injection STILL MISSING — leaf dispatched 2026-08-10), document
  editor (create → live content; change → live merge). Screenshots:
  docs/screenshots/gate1-{cold-start,youtube-offer-cards,
  document-editor,reoffer-click}.png.
- Conformance rows closed at GATE-1: document_editor, youtube, memory,
  media_local → PASS (probes + packaged evidence; EXPECTED_STATUS
  tightened so regressions go red); tasks → PENDING (partial).

## Target hardware

- Physical Windows 11 desktop (mic + speakers), WSL for dev, Windows
  git/gh. The 2014 MacBook Air / Big Sur was an early compatibility
  eval only (ADR 0001 status note).

## Test gates (last full run, 2026-08-10, post GATE-1 seam fixes)

- vitest: 621 passed (50 files) — apps/desktop (incl. launch-integration
  booting the real service; hook cap 240s)
- pytest: 370 passed — tests/python (incl. deterministic r45 snooze)
- e2e harness (tests/e2e): 13 passed (probes boot the real app with a
  scripted model — deterministic, no live model)
- typecheck: clean (tsconfig.json + tsconfig.electron.json)
- build: clean (vite build + tsc electron)
- OKF docs validator: 23 concepts validated (2026-08-09)

## GATE-4 remediation (CLOSED 2026-08-09)

Program: docs/plans/gate-4-remediation-orchestration-2026-08-09.md.
GATE-3.5 closed on green suites alone and four production defects were
later found living in the seams between individually-correct branches.
GATE-4 reopened the system: four waves of lane-parallel work, packaged
gates after every wave (the packaged build is the proof, suites are the
floor), plus a read-only adversarial seam audit.

Defects found and fixed (7 + 5 advisory):
- D1 TTS auth (renderer fetch had no token) — W0-TTS.
- D2 reconnect spin (server sent snapshot before the client's connect
  ack; client acked, server already listening) — W0-RECONNECT.
- D3 resize geometry — W0-VIEWPORT.
- D4 layout.compose wire+store never landed — W1-STORE/PYCONTRACT/
  DISPATCH.
- D5 packaged app never opened a window (scheme registered inside
  app.whenReady) — gate fix 433c707.
- D6 boot white-screen: a split composition with two primaries in
  "main" passed the frozen validator and crashed the geometry engine
  at render (snapshot restore) — gate fix 80f750d (second primary →
  side, never-crash choke + render net).
- D7 fullscreen restore lost the composition (preFullscreen captured
  but never consumed; restore based on the fullscreen-constrained
  spec) — gate fix 50e0e38, caught by the packaged GATE-2 spoken check.
- ADV F1–F6 (adversarial audit, commit 0fb7c0e): button-confirm
  published a stale WAITING_FOR_CONFIRMATION and disarmed the silence
  timer (blocking — fixed); reminder fires never refreshed content.tasks;
  geometry rejections were silent; snapshot restore didn't latch the
  config-default guard; dead dismiss shim; stale docstring.

Wave map (all merged, zero unresolved conflicts):
- W0: TTS / RECONNECT / VIEWPORT / HYGIENE.
- W1: STORE (LayoutCompose wire member + one-choke routing + default
  clause) / PYCONTRACT (snapshot mapping + schemas regen + parity
  tests) / VOICE (settle paths) / ELECTRON (CSP, hardened-view) /
  DISPATCH (layout_compose tool, validators, authoritative events).
- W2: SURFACES (legacy dual-mount forks removed from all five
  components) / REMINDERS (one publish per reminder, tasks-update
  emission, dismiss affordance) / STORE (legacy layout authority
  deleted: engine.ts, PanelHost, legacy store fields, six legacy boot
  branches — net −1,095 lines; default composition before first paint;
  fullscreen derived from adaptive.overrides).
- W3: MEDIA (single media authority — controller subscribe/emit, the
  store derives content.media, MediaDock hand mirrors gone) / BROWSER
  (dead back/forward/refresh buttons removed — the iframe sandbox
  cannot navigate cross-origin content) / TRANSPORT (one outbox — the
  store's send is a pass-through, the transport buffers in both modes;
  one validation file; one shared exponential-jitter backoff).
- GATE-2 reconciliation: 10-item foreign-file checklist (imports
  re-homed from the deleted engine, panelhost test deleted, conformance
  parity, provider wraps, reconnect/adaptive tests pinned to the new
  reality, dismiss seam flipped).

Packaged gate evidence: GATE-0 TTS speaks / reconnect recovers /
geometry follows; GATE-1 compose changes the layout and reload restores
it; GATE-2 cold start is clean with PanelHost gone and the spoken
fullscreen→restore round trip works; final smoke (2026-08-09): cold
start clean, compose split → fullscreen → restore returns the 50/50
split.

## GATE-3.5 consolidation (CLOSED 2026-08-09)

Program: docs/plans/consolidation-program-2026-08-08.md (two-stage:
consolidation → MVP backlog). Frozen contract:
docs/consolidation-contract-2026-08-08.md — 8 invariants
(VOICE/STOP/LAYOUT/MEDIA/CONFIRMATION/SERVICE/RECONNECT/CLIENT-ACTIONS),
C1–C8 semantic deltas, R01–R47 regression freeze. All 10 wave-1 branches
are on main (S0 doc df48da6; gate fixes 14e36e0/c0f0526/3006b13/dbb5e5d).

- VOICE (A1, R01–R08): tts.started/finished/cancelled acks; the renderer is
  physical-playback authority; the turn stays THINKING until tts.started and
  only tts.finished settles to LISTENING (or WAITING_FOR_CONFIRMATION);
  silence timer anchored to speech end (SPEAKING is timer-free); late acks
  after STOP are state-guarded no-ops; WS disconnect settles pending speech.
- SERVICE (A2, R09–R15, the P0): Electron main generates ONE per-launch
  token, spawns the Python service, completes an authenticated
  /health→/config handshake; a foreign service holding the port returns 401
  → "failed" (never silently adopted); pre-connect user input is buffered
  and delivered exactly once (R11); startup failures surface as clear UI
  errors (R12); desktop quit kills the child tree (R13); the renderer never
  holds the token (R14 — token-exposing IPC retired); wildcard/empty origins
  and PATCH-persisted auth.enabled=false are rejected (R15).
- LAYOUT (A3+A4, R16–R23): the model speaks the native adaptive LayoutSpec
  (focus/sidecar/stack/split/triple + primary/companion/support/persistent +
  narrow/balanced/wide) through layout.compose; news is gone from every
  model-visible surface incl. PanelType.NEWS (R18); every layout
  mutation enters ONE applyAdaptiveSpec choke; user overrides (pin/stick/
  position/size/remove/fullscreen/showBoth) apply AFTER planner output and
  beat later agent preferences; spoken override intents are deterministic.
- MEDIA (A5, R24–R27): ONE MediaController for agent tools + human client
  actions + player events; media.seek really changes position (position_s on
  the wire) and answers honestly when nothing is loaded (failed verdict, no
  "Posición cambiada" lie); media=null in the snapshot is authoritative
  absence (player cleared through the controller); snapshot restore routes
  through the same controller.
- RECONNECT (A6, R28–R34): SnapshotTracker holds current state continuously
  (listener-based; the 1000-cap starvation class is gone); authoritative
  null/empty snapshot fields clear stale state; adaptive composition
  (template/assignments/proportion/overrides) rides the snapshot and is
  restored through the ONE choke; client-side sequence-gap detection fires
  resyncHook → WsClient.forceReconnect (R29 — Known gaps 5).
  START STATE (user directive): fresh start shows ONLY the central-mic
  hero; snapshot history is stashed for explicit resume, never
  auto-rendered; same-tab reconnect keeps the in-memory conversation.
  NOTE: the code currently auto-restores history + composition on connect
  — fix pending.
- CONFIRMATION + CLIENT ACTIONS (A7, R35–R39, C1): spoken approve/reject
  vocabulary (confirmar/confirmo/sí/sí enviar/aprobar · cancelar/rechazar/
  no/no enviar) resolves the one global pending against its FROZEN SQLite
  args; ambiguous sí/no with NO pending is ignored (no turn starts);
  executing approved actions carry cancellation tokens + points of no
  return; ClientAction is the narrowed human-initiated union (16 members,
  all with authoritative handlers; tts.speak is server-originated and NOT a
  client action).
- ELECTRON SECURITY (A8, R40–R42): hardened remote-content foundation
  (isolated persistent partition, deny-by-default permissions, navigation
  filter, window-open denial, custom local-doc protocol, IPC sender
  validation) — not wired to UI yet; Electron major upgrade lands BEFORE
  arbitrary real browsing (migration-note-electron-upgrade-2026-08-08.md).
- VISUAL (A9, R43): one status pill (role="status", STATUS_VOCABULARY),
  no redundant connection text, no fake suggestion chips, STOP ≥48px,
  Spanish aria labels. TEMPLATE SELECTOR (user directive): none anywhere,
  dev included — NOTE: dev builds still render a dev-gated combobox,
  removal pending.
- ADVERSARIAL (A10, R44–R47): cold secure startup, spoken STOP during TTS,
  spoken confirmation, persistent override vs later agent layout, agent
  media → human pause/seek → agent resume, restart with media=null,
  notification reconnect, sequence-gap resync, tracker >1000 events, voice
  disabled on fresh reconnect, client-action completeness, no-news surface.
  20-item gate acceptance: PASSED.

Seam lessons + test-discipline pitfalls (flattened-vs-dotted tool names,
singleton pollution, R11 buffering test channels, merge-marker hygiene):
skill reference gate35-merge-lessons-2026-08.md.

## Adaptive UI (state)

- Contract (UI-000): SurfaceRole / AdaptiveTemplate / Proportion /
  LayoutSpec, registration interface, token catalog, placeholder fixtures,
  deterministic validation. Docs: docs/adaptive-ui-contract.md,
  docs/plans/adaptive-ui-redesign-execution-2026-08-07.md.
- Shell + geometry + roles + tokens + harness (UI-101..105), product
  surfaces (UI-201..207: browser, conversation, reading, tasks, media,
  motion, spatial inertia), planner + overrides + a11y (UI-301..303):
  all on main, green.
- Product surfaces register in the surface registry and render through the
  adaptive stage via LayoutSpec with the role host
  (src/adaptive/surfaces.ts + AdaptiveStage; legacy PanelHost remains for
  the non-adaptive path). Motion: 240ms slot transitions keyed by
  surfaceId, reduced-motion gated. Inertia: pure layout-change scorer +
  store guard in applyAdaptiveSpec (equivalent layouts never churn; user
  signal always applies).
- Planner (UI-301): semantic composition authority — the agent says WHAT,
  never HOW; invalid model output is rejected with structured reasons;
  legacy wire layout.apply routes through the planner.
- Overrides (UI-302): persistent constraint set (pin/stick/position/size/
  remove/fullscreen/showBoth) applied AFTER planner output; user-initiated
  signal bypasses inertia damping, agent-initiated stays damped; invalid
  arrangements degrade deterministically.
- A11y (UI-303): hit-target floor, focus-visible rings + tab order,
  reduced-motion coverage, status icons + Spanish aria labels, STOP
  accessibility, 12px text floor, contrast fixes (token catalog only).

## Documents

- TXT/MD: text renderer with chapters; MD editable (Editar → Guardar →
  document.save).
- PDF: pdf.js v6 real renderer (lazy-loaded, worker via vite asset).
- EPUB: epub.js 0.3.x real renderer (paginated, CFI locations, themes,
  A−/A+).
- READERS: EPUB theme styles are nested objects ({selector:{prop:value}})
  with theme + font re-applied after display() resolves; PDF render()
  passes canvasContext with device-pixel transform, fit-width base scale,
  deterministic error wrapping. PITFALL: epub display() stalls silently in
  backgrounded CDP tabs (rAF-throttled queue) — activate the tab first.
- Local-file access in Electron (custom protocol): PLANNED.
- Book position persistence: backend library.get_position/set_position
  exists; UI resume wiring PLANNED.

## Voice

- Voice state machine, silence timer, wake/listen/speak/interrupt
  semantics: implemented (real code, provider-agnostic).
- WAKE-WORD / VAD PROVIDERS ARE NOT WIRED: `WakeWordDetector`,
  `MockWakeWordDetector`, `Vad` exist in services/voice but have ZERO
  consumers, and `voice.wake_word.*` / `voice.vad.provider` config has
  zero readers. Wiring is IMPLEMENTATION WORK, not just verification.
- STT / TTS providers: real (faster-whisper / edge-tts) with mock
  fallback; verified end to end with a fake audio device
  (scripts/demo_voice.py VOICE_OK, CDP TTS playback). Wake-word/VAD
  providers remain unwired (above).
- STOP vocabulary (utterance-level, accent-stripped): stop, detente,
  deten, alto, basta. "para" is excluded — common mid-sentence Spanish
  word (Ars's decision).
- Physical microphone smoke test: NOT DONE (blocked on being at the
  physical machine). The wake → ask → interrupt → continue → sleep →
  wake loop is NOT yet proven on real hardware.

## Browser

- Web demo: BrowserPanel with address bar + iframe viewport, driven by
  user and agent (local demo page — not a news panel).
- Electron: WebContentsView owned by main process is the DESIGNED
  shape; NOT yet implemented (iframe is web-demo-only).
- Allowlist (`browser.allowlist`) and home URL: NOT enforced anywhere
  (zero readers) — PLANNED before enabling arbitrary remote browsing.

## Wire (contracts)

- Events: youtube.search, browser.navigate, document.load (carries url),
  tasks.update, media.state + layout/panel/status/overlay events +
  action_result (H1) + state_snapshot (H5).
- User commands: ServerCommand = the full UiCommand surface (browser nav,
  document.save, tasks.toggle, media.play_pause/seek, youtube.search,
  layout.apply, panel.* — model + UI both) with authoritative handlers and
  action_result verdicts. ClientAction (GATE-3.5 C1/R39) = the NARROWED
  human-initiated union (16 members: browser.back/forward/navigate/refresh,
  document.save, layout.apply/restore, media.play_pause/seek,
  panel.close/fullscreen/open/set_primary, tasks.toggle, youtube.play/search)
  — tts.speak and other server-originated commands are NOT client actions;
  every declared ClientAction has an authoritative handler (enumeration
  guard test).
- Cross-language conformance: every TS UiCommand action has a Python-
  parseable fixture (packages/contracts/fixtures/); the bridge test
  fails if one side drifts.
- Python models + TS mirrors + JSON schemas; conformance tests green.

## Security posture

- Local STOP path: implemented, LLM-independent (ADR 0004); now locally
  authoritative in the renderer (mic/STT/TTS aborted first, generation
  guards) + one canonical voice state machine (GATE-2.5 H3).
- Confirmation snapshots: SQLite-stored frozen args, executed directly
  (ADR 0003); approval copy is deterministic (tool-specific formatter,
  never model-generated). Explicit lifecycle pending → approved →
  executing → executed | failed (H5); global one-pending policy
  (new confirmable supersedes the old, reported on the wire); stop
  invalidates pendings.
- Policy gate: deny-by-default; denied-always tools (shell.exec,
  file.write, file.delete, browser.generic_agent).
- Local service boundary (GATE-2.5 H4 + GATE-3.5 A2): per-launch bearer
  token on HTTP + WS (query param for WS), CORS locked to configured
  origins (no wildcard), /tts is POST-only, STT upload capped, config
  validation constrains model base_url (https / localhost-http only) and
  system_prompt_file (repo docs/configs only). Electron main GENERATES the
  token, spawns the service with it, and owns the authenticated handshake;
  the renderer NEVER holds the token (preload token IPC retired, R14);
  wildcard/empty origins and PATCH-persisted auth.enabled=false are
  rejected (R15). Dev/mock mode can disable auth via config
  (auth.enabled=false).

## Known gaps (next work — WAVE 2 of the consolidation program, prioritized)

0. GATE-3.5 is CLOSED (see above). Wave 2 = MVP backlog (program doc
   `docs/plans/consolidation-program-2026-08-08.md`):
   A real wake word / VAD physical voice loop (phrase UNDECIDED — "Ars" is
   the family prefix, NOT the wake word; "Lily" is a candidate; no
   training/benchmarking until Ars selects it),
   B real browser WebContentsView (allowlist enforced, hardened partition,
   Electron major upgrade FIRST),
   C browser DOM interaction bridge (snapshot/find/click/fill/submit/scroll;
   page content = untrusted),
   D real media discovery/playback (real YouTube search + accurate metadata,
   no fake fixtures),
   E reminder/task notification integration (repeated snooze/dismiss/
   restart reliability),
   F reader persistence (book progress resume, PDF page/zoom restore),
   G context timestamps + durable user state (time/activity/tasks in
   runtime context, never dump the DB),
   H memory-informed search with provenance (user/agent/web/document),
   I telegram/notes/tasks end-to-end polish (no tool names visible to the
   user), plus UI: confirmation popup-in-chat / voice-ask, minimal state
   panel embedded near the gaze, media-player progress bar tied to the
   YouTube iframe (R26), exit/home affordance + panel close X (backlog).
1. Voice loop proof on the physical machine (wake/VAD/STT/TTS/barge-in/
   sleep/STOP) + latency + recovery measurements.
2. Browser as security boundary: WebContentsView, allowlist enforced,
   remote content sandboxed (no Node), page text treated as untrusted.
   (WS auth + Origin are DONE — GATE-2.5 H4; hardened-view module exists
   — GATE-3.5 A8 — wiring is Wave 2 B.)
3. Product loops: reminder cron context injection, message timestamps
   in agent context, memory-informed search, book progress resume,
   unified media pipeline (real YouTube/local playback).
4. Real-user observation pass — design polish is deferred until
   interaction problems are observed.
5. (implemented) client-side sequence-gap detection fires resyncHook →
   WsClient.forceReconnect on sequence jumps.
6. (implemented, GATE-5 W0) fresh start = central-mic hero ONLY; snapshot
   history stashed for explicit resume, never auto-restored. (Explicit
   resume consumer is a future conversation-seam lane.)
7. (implemented, GATE-5 W0) no template selector anywhere, dev included.
