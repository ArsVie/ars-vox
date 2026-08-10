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
| `document_editor` | "a lightweight agent first document editor that can produce docs and both the user and the agent can edit it" | **PASS** | W1-DOC-SHARED + GATE-1 | `probes/doc_shared.py` | `test_document_changed_after_insert` | GATE-1 packaged (real model): "creá un documento…" → `document.load` (kind md, path) forms the renderer bag → editor shows title/path/kind + content; agent `document.insert_text` → `document.changed` → content updates LIVE in the open editor (screenshot gate1-document-editor.png). Create/open emit load (0d157bd). |
| `tasks` | "the task bar should have some to do's but also be able to have some constant/permanent reminders, the agent should get them injected like cronjobs every certain amount of time in context" | **PASS** | W1-TASKS + GATE-1 (wire+probe) | `probes/tasks_cadence.py` | `test_reminder_fire_publishes_once`, `test_reminder_fire_starts_fresh_turn`, `test_context_carries_active_reminders`, `test_tasks_update_frame_shape` | GATE-1 packaged (real model): "programá un recordatorio…" → reminder in `tasks.update` frames; fired → EXACTLY ONE `notification` (kind reminder) → rendered in the UI ("Recordatorio: …") → one-shot consumed (left the list). GATE-5 fix (W1-TASKS): a fired reminder now STARTS a fresh agent turn — scheduler `on_fire` → `runtime.handle_reminder_fire` → turn prompt carries "Recordatorio activado: …" + build_context (active reminders); probe records PASS 4/4; wire pin proves the model's prompt contains the reminder, exactly one turn per fire, no TTS without auto_speak. Snooze path deterministic in suite (r45 `now` seam). |
| `media_local` | "the media panel should be able to host the youtube videos … but also music from either youtube or local, controls and ui for that should be the same" | **PASS** | W1-MEDIA-LOCAL + GATE-1 (wire+probe) | `probes/local_media_probe.py` | `test_media_select_result_local_routes_unified_controller` | Probe records PASS 3/3: wire LOCAL members, select_result(source=local) → action_result done + media.state(source=local), local library discovery real (search/local_library.py). Same dock/controller as YouTube (zero source-local UI branches). Packaged: ask for local music by voice with a populated library dir, screenshot the unified dock — pending. |
| `youtube` | "the LLM searches YouTube and OFFERS the user options (results render as selectable cards). The user picks one (click or voice)" | **PASS** | W1-YOUTUBE + GATE-1 | `probes/youtube_realness.py` | `test_agent_search_emits_youtube_search_offer` | GATE-1 packaged (real model): search → media panel opens → ~10 REAL cards (title/channel/duration); click card → `media.select_result` → ONE controller → iframe plays the picked video; voice "la segunda" → plays second result; play → stop → NEW offer → cards return (reoffer fix 4e12844; screenshots gate1-youtube-offer-cards.png, gate1-reoffer-click.png). REAL provider seam, zero results answered honestly ("no encontré nada", never a fixture). |
| `memory` | "Ideally the agent can know user preferences from memories and query the search accordingly" | **PASS** | W1-MEMORY + GATE-1 | `probes/memory_probe.py` | `test_memory_search_honest_verdict` | GATE-1 packaged (real model): "acordate que me gusta el jazz" → `preferences.set` saved; next turn "buscame música para concentrarme" → agent searched "jazz suave para concentrarse" — the remembered preference SHAPED the query (vision line); media panel opened with real cards. `memory.search` runs `arsvox_memory.search_all` (SQLite + FTS5); honest empty results. |
| `browser` | "an integrated broser that the agent could use the search bar and scroll through it with DOM and user manipulable too, that could be used among other things for news" | **PASS** | W2-VIEW + W2-DRIVE + W2-NAVIGATE + GATE-2 | `probes/browser_probe.py` | `test_browser_navigate_carries_store_nav_state` | GATE-2 packaged (real model, 2026-08-10): WebContentsView browser (ADR 0007 reverses the iframe decision); agent-driven end-to-end — "Navegá a openstreetmap.org" → `browser.navigate` tool → real view load (allowlist passed) → round-trip returned the REAL url/title ("La navegación terminó en https://www.openstreetmap.org/#map=3/23.94/-102.58 — OpenStreetMap") with `can_go_back: true` on the wire; agent scrolled (600px), clicked the Español link (#js-link-box-es) → real navigation to es.wikipedia.org → agent read the new page back in Spanish. User-path navigate also works (same view, one authority). Allowlist blocks non-listed hosts (example.com rejected — hardened view working). Screenshots: gate2-browser-loaded.png, gate2-browser-es-wikipedia.png, gate2-browser-openstreetmap.png, gate2-agent-navigated.png. |

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
- `document_editor` → **PASS** (GATE-1 packaged evidence + doc-fix merge)
- `tasks` → **PASS** (probe 4/4: context injection + single publish + tasks.update + fire→fresh-turn cadence; wire pin proves reminder lands in the model prompt)
- `media_local` → **PASS** (probe 3/3: wire LOCAL + unified route + real discovery)
- `youtube` → **PASS** (GATE-1 packaged evidence: offer cards + click/voice pick + reoffer)
- `memory` → **PASS** (probe 4/4 + GATE-1: preference shapes the search query)
- `browser` → **PASS** (GATE-2, 2026-08-10 — packaged real-model CDP evidence)

## Drift guard

`tests/e2e/test_harness_consistency.py` runs every probe and enforces this
table: PASS rows must record PASS (a regression goes red), NOT_YET rows must
record NOT_YET, PENDING rows accept any honest verdict until the gate flips
them. Keep `PROBE_IDS` (`probe_core.py`), `EXPECTED_STATUS`
(`test_harness_consistency.py`) and this table in sync.
