# Vision conformance checklist — GATE-5 W1-CONFORMANCE

> Acceptance authority: `docs/panel-vision.md` (FROZEN — Ars's words are the
> spec; this file quotes them, it never edits them).
> Program contract: `docs/plans/gate-5-vision-conformance-orchestration-2026-08-09.md`.
> Owner: W1-CONFORMANCE. This checklist is the artifact GATE-1 is judged on.
> Statuses: **PASS** = closed by evidence; **PENDING** = another lane owns the
> line, the gate closes it (this lane never closes another lane's line);
> **NOT_YET** = Wave 2, not merged.

## How the harness produces evidence

Two execution modes share one assertion core (`tests/e2e/probe_core.py`):

- **CI / mock mode (deterministic, no live model)** — the entrypoint is
  `pytest tests/e2e` from the worktree with the shared PYTHONPATH
  (`packages/contracts:services/agent:services/memory:services/tts:services/voice`).
  `tests/e2e/conftest.py` reuses the `tests/python` fixtures (real app,
  mock config, scripted `FunctionModel` — no network, no model). Every probe
  below runs here and records a verdict JSON; `test_harness_consistency.py`
  enforces probe↔row drift (a PASS row whose probe goes red FAILS the suite).
- **Packaged mode (GATE-1)** — the same assertion core runs against the
  packaged build's service over a real WebSocket (Bearer token) via
  `tests/e2e/wire_probe_live.py` (planned, added with the packaged run), plus
  CDP snippets under `tests/e2e/cdp/` that assert the rendered DOM, plus the
  store vitest mirrors in `apps/desktop/tests/*`. The GATE-1 voice script
  (orchestration plan) is the live, out-loud proof; the probes are the
  deterministic record.

Standalone evidence recorder: `python tests/e2e/probes/run_all_probes.py`
writes `tests/e2e/evidence/<probe>.json` (one verdict file per row).

## Checklist — one row per panel-vision.md line

| Row id | Vision line (verbatim anchor, panel-vision.md) | Status | Owner | Probe (CI mode) | Wire probe (CI mode) | Evidence consumed at GATE-1 |
|---|---|---|---|---|---|---|
| `conversation_time` | "for the agent, messages should have time appeneded to it for context" | **PASS** | W1-CONFORMANCE (verified) | `probes/conversation_time.py` | `test_context_first_line_is_time` | Turn context first line = time line (Spanish + ISO local + UTC), matches wall clock; live turn: agent answers a time question correctly |
| `document_reader` | "the documents panel should be pdfs, epubs and txt reader" | **PASS** | W1-CONFORMANCE (verified) | `probes/document_reader.py` | `test_document_kind_wire` | DocumentKind wire covers txt/md/pdf/epub; real renderers (pdf.js v6, epub.js 0.3.x, text) behind ReaderView; packaged CDP: open a PDF, an EPUB and a TXT, screenshot the reader |
| `document_editor` | "a lightweight agent first document editor that can produce docs and both the user and the agent can edit it" | PENDING | W1-DOC-SHARED | `probes/doc_shared.py` (FAIL today: `document_insert_text` writes store without emitting `document.changed`) | — | Scripted `document.create` opens the editor (PASS half); agent edit emits `document.changed` and the open editor updates live; user edit is visible to the agent next turn |
| `tasks` | "the task bar should have some to do's but also be able to have some constant/permanent reminders, the agent should get them injected like cronjobs every certain amount of time in context" | PENDING | W1-TASKS | `probes/tasks_cadence.py` (FAIL today: fire → fresh turn missing) | `test_reminder_fire_publishes_once`, `test_context_carries_active_reminders`, `test_tasks_update_frame_shape` | Context carries active reminders every turn (PASS half); one `notification` per fired reminder — GATE-3.5 double-publish VERIFIED fixed; fired reminder STARTS a fresh agent turn (cadence injection); packaged: set a reminder, let it fire, watch the chat |
| `media_local` | "the media panel should be able to host the youtube videos … but also music from either youtube or local, controls and ui for that should be the same" | PENDING | W1-MEDIA-LOCAL | `probes/local_media_probe.py` (FAIL today: no local-library discovery in services/) | `test_media_select_result_local_routes_unified_controller` | MediaSource.LOCAL + `local_path` on the frozen wire; `media.select_result` routes BOTH sources through one MediaController (same UI/controls seam); local files reach the same dock; packaged: ask for local music by voice, screenshot the unified dock |
| `youtube` | "the LLM searches YouTube and OFFERS the user options (results render as selectable cards). The user picks one (click or voice)" | PENDING | W1-YOUTUBE | `probes/youtube_realness.py` | `test_agent_search_emits_youtube_search_offer` | OFFER channel verified (agent tool → `media.search_results` with selectable cards, unified wire member); REAL provider seam, zero results answered honestly ("no encontré nada", never a fixture); packaged: ask for a video, pick one by voice, it plays in the media panel |
| `memory` | "Ideally the agent can know user preferences from memories and query the search accordingly" | PENDING | W1-MEMORY | `probes/memory_probe.py` (FAIL today: `search_all` has zero consumers; k/v `memory.remember`/`memory.recall` still a second authority) | `test_memory_search_honest_verdict` | `memory.search` on the frozen wire answers honestly until wired; agent consumes `arsvox_memory.search_all` (SQLite + FTS5); a stated preference shapes a later search query; packaged: state a preference, ask something that requires remembering it |
| `browser` | "an integrated broser that the agent could use the search bar and scroll through it with DOM and user manipulable too, that could be used among other things for news" | NOT_YET | W2-VIEW + W2-DRIVE | `probes/browser_notyet.py` (records current gap: iframe renderer, `can_go_back=False` hardcoded, no WebContentsView) | `test_browser_navigate_can_go_back_false` | Wave 2 not merged → row stays NOT_YET; when W2 lands: CDP — agent drives search bar/scroll/DOM, user manipulates the same surface; real `can_go_back`/`can_go_forward` |

## Packaged checks the harness mirrors (P1–P6)

The brief lists six packaged checks; each has a deterministic wire part in
`tests/e2e/test_wire_probe.py` and a store mirror in `apps/desktop/tests/*`
(consumed at GATE-1 as vitest + CDP evidence):

| Check | Wire part (CI mode) | Store/render mirror |
|---|---|---|
| P1 cold start = central-mic hero | `test_snapshot_stashes_history` (snapshot carries history, no restore directive) | `tests/conversation-surface.test.tsx` (hero), `tests/r43-visual-cleanup.test.tsx` (i) |
| P2 compose | — | `tests/r43-visual-cleanup.test.tsx` (`aria-label="Escribe una petición"`) |
| P3 reconnect (snapshot authority) | `test_snapshot_stashes_history` | `tests/adversarial-reconnect.test.ts`, `tests/ws-client.test.ts` (forceReconnect/R29) |
| P4 resize | — | `tests/adaptive-geometry.test.ts` (ResizeObserver, viewport re-evaluation) |
| P5 confirm in chat | `test_confirm_flow_roundtrip` | `src/state/confirmation.ts` + store mirror tests |
| P6 template-selector absence | — | `tests/r43-visual-cleanup.test.tsx` (a) — no DEMO_TOGGLE_ENABLED, no select |

## Row inventory (line → status)

- `conversation_time` → **PASS** (verified by W1-CONFORMANCE, evidence in tree)
- `document_reader` → **PASS** (verified by W1-CONFORMANCE, evidence in tree)
- `document_editor` → PENDING (W1-DOC-SHARED; probe honestly FAIL today)
- `tasks` → PENDING (W1-TASKS; probe honestly FAIL today)
- `media_local` → PENDING (W1-MEDIA-LOCAL; probe honestly FAIL today)
- `youtube` → PENDING (W1-YOUTUBE; probe honestly FAIL today)
- `memory` → PENDING (W1-MEMORY; probe honestly FAIL today)
- `browser` → NOT_YET (Wave 2, not merged)

## Drift guard

`tests/e2e/test_harness_consistency.py` runs every probe and enforces this
table: PASS rows must record PASS (a regression goes red), NOT_YET rows must
record NOT_YET, PENDING rows accept any honest verdict until the gate flips
them. Keep `PROBE_IDS` (`probe_core.py`), `EXPECTED_STATUS`
(`test_harness_consistency.py`) and this table in sync.
