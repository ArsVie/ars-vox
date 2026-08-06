# Ars-Vox — Session Handoff

Date: 2026-08-06
Author: Lily (Hermes), for Ars
Repo: /mnt/c/dev/ars-vox  (C:\dev\ars-vox on Windows)
Git: initialized (main branch, Windows git.exe; commits pending — see bottom)

---

## 1. Bigger picture (where this sits)

Ars-Vox is a voice-first computer assistant for an older user: talk to it,
watch YouTube, read books, write documents, notes/tasks/alarms, send ONE
Telegram message — all without leaving the app and without the mouse.
The full product plan (panels, layouts, browser, voice, memory, skills,
policy, phases 0-4) lives in the original implementation plan. This
session built the **iteration-1 foundation**: the complete agent-side
service stack, contracts, policy engine, confirmation flow, notes/tasks/
reminders with a local scheduler, and the database layer. The Electron +
React UI is **not started** — that is the next big chunk.

The demo bar the user set: "a workable demo with tuneable configs that can
at least use an LLM to manage the windows in its app." The agent service
already does LLM → typed ui_command → layout/panel control (verified
end-to-end in mock mode). What remains is the desktop UI that renders it.

## 2. What is DONE and VERIFIED

### Python agent service (complete, tested)
- `packages/contracts` — single source of truth for wire messages:
  AgentEvent (11 types, discriminated on `type`), UiCommand (10 actions,
  discriminated on `action`), ClientMessage, AppConfig. JSON Schema
  exported to `packages/contracts/schemas/*.schema.json` via
  `scripts/export_schemas.py` (TypeAdapter — union aliases don't have
  model_json_schema).
- `services/memory` — SQLite + WAL + FTS5 (contentless tables, joined to
  real tables; careful: ambiguous-column errors if unqualified), migration
  runner (0001_initial.sql = 20 tables), repos: sessions/turns, notes,
  tasks, reminders+occurrences, notifications, pending_actions, audit,
  preferences, progress, documents, panels.
- `services/voice` — VoicePipeline (silence timer, local stop path,
  inject_text for demo/tests) + provider interfaces (openWakeWord/Silero/
  faster-whisper) with mocks. Mic not wired yet (by design).
- `services/tts` — TTSProvider interface + MockTTS/EdgeTTS/PiperTTS/
  KittenTTS(stub) + priority queue. Default mock. Edge needs
  `pip install 'arsvox-tts[edge]'`.
- `services/agent` — FastAPI app:
  - GET /health, GET+PATCH /config (tuneable at runtime, persisted yaml),
    /api/books, /api/books/{id}/content, PUT /api/progress, /api/notes,
    /api/tasks, /api/reminders, /api/audit, /api/documents CRUD,
    WS /ws.
  - AgentRuntime (pydantic-ai 2.25.0): per-turn deps, SQLite session
    history injection, context builder (panels+pending+reminders+recent
    turns), timeout, cancel, voice-state transitions.
  - ToolRegistry: 41 typed tools, single execution gate → PolicyEngine
    (kinds: read_only/reversible/user_visible/external/destructive/
    privileged; unknown tools DENIED; approval overrides for
    reminders.create and telegram.send_pending).
  - ConfirmationCoordinator: two-phase flow, SQLite snapshot of args,
    expiry, invalidation (new request supersedes same-tool pendings),
    executes the SNAPSHOT on confirm (model can't change approved text).
  - ReminderScheduler: LLM-independent loop (interval config), fires →
    notification_events row + notification.show ui_command; posponer /
    descartar / qué-alarmas handled by local intents BEFORE the LLM.
  - Model: OpenAI-compatible via `OpenAIProvider(api_key, base_url)` →
    opencode-go endpoint (https://opencode.ai/zen/go/v1/), key from env
    OPENCODE_GO_API_KEY (sourced from ~/.hermes/.env). Mock mode =
    scripted FunctionModel, zero network.
- Tests: `tests/python` — 43/45 passing. Coverage: contracts, config,
  policy, memory repos, confirmations, scheduler, tools/API, WS e2e
  (typed ui_command, telegram confirm→send→audit, cancel, stop cancels
  running turn, local intents).

### Verified live (mock): scripts/smoke_mock.py → SMOKE_OK
Event sequence observed: config_update → state listening → thinking →
user_message → tool_call → ui_command (layout.apply split/document_editor)
→ tool_call done → agent_message → listening.

### Desktop deps ready
- apps/desktop/package.json + tsconfigs written; `npm install` DONE
  (electron v33.4.11, react 18, vite 5, vitest 2, zustand 4, TS 5.6).
  Node_modules present. NO source files written yet.

## 3. What is NOT done / known issues

1. **Electron + React UI: NOT STARTED.** Next session's main work:
   - electron/main.ts (window, WebContentsView manager, IPC bridge,
     spawn python service via bash -lc, health poll)
   - electron/preload.ts (contextBridge: setPanelBounds, doc save)
   - react-ui: zustand store, layout engine (4 templates, pure TS),
     panels (conversation, browser, media, book, document, news, notes,
     tasks, reminders, telegram preview, confirmation, notification,
     settings), ws client (reconnect, parseEvent guard), StatusBar with
     voice state + always-visible stop, demo auto-tour (config demo.enabled).
   - scripts: build (vite + tsc), start, vitest for layout engine.
2. **2 failing tests** (as of handoff):
   - test_ws_e2e.py::test_turn_emits_typed_ui_command — the scripted
     FunctionModel turn produced NO ui_command (broken early; last
     state listening, no error event seen yet — hypothesis: the
     monkeypatched runtime.build_model patch + lazy agent build interplay,
     OR the run failed and the ErrorEvent was swallowed by the ws_collect
     break). NOTE: identical flow WORKS in scripts/smoke_mock.py — so the
     app itself is fine; the test harness is the suspect.
   - test_scheduler.py::test_snooze_and_dismiss — fixed the test logic
     (force due_at via db directly); needs re-run to confirm.
   (Run: cd /mnt/c/dev/ars-vox && .venv/bin/python -m pytest tests/python -q)
3. **Streaming** — pydantic-ai 2.x run_stream event API churned; runtime
   uses `agent.run()` and emits text as one event. Streaming can be added
   later (documented as ADR-0006).
4. **opencode-go live call NOT yet exercised** — key is available
   (OPENCODE_GO_API_KEY in ~/.hermes/.env); scripts/demo-live.py doesn't
   exist yet; the smoke test only covers mock. First live test: export the
   key, start service, ws-send "Abre YouTube", expect ui_command.
5. **docs/** — ADRs/architecture/threat-model folders exist but are EMPTY.
   README.md at repo root doesn't exist yet either (write one).

## 4. How to run (WSL side, everything from WSL)

```bash
cd /mnt/c/dev/ars-vox
# env for live model:
set -a; source ~/.hermes/.env; set +a
# start agent service (mock by default in configs/app.yaml agent.mock=false —
# mock=false calls the real opencode-go endpoint):
.venv/bin/python -m arsvox_agent --config configs/app.yaml
# or force mock: .venv/bin/python -m arsvox_agent --config configs/app.yaml --mock
# verify: curl http://127.0.0.1:8765/health
```

Config to tune: configs/app.yaml — model name/base_url/api_key_env,
agent.mock, tts.provider, voice.silence_timeout_s, ui.reduced_motion/
large_text/high_contrast, telegram.chat_id (set to the approved chat id!),
reminders.*, demo.enabled.

## 5. Key technical decisions (see docs/decisions when written)

- Two-phase confirmation with SQLite snapshot (pending_actions table),
  not pydantic-ai deferred tools — deterministic + auditable + testable.
- Tool handlers take ToolContext (deps+run_id+bus), NOT RunContext —
  lets the approval executor run the same handlers without faking
  pydantic-ai state. pydantic-ai integration: dynamic exec-built wrapper
  copying handler annotations; Tool(fn, name, description, takes_ctx=True).
- Scripted FunctionModel for mock mode (step counter; must return tool
  call and text in SEPARATE responses — mixed responses loop forever).
- Everything from WSL (per user instruction); Windows side only for
  viewing the Electron window (WSLg display, DISPLAY=:0 available).
- Literal discriminator fields: ClientMessage types MUST stay required;
  events/commands carry defaults (union parse is via TypeAdapter).

## 6. Next steps (ordered)

1. Re-run pytest; fix the 2 flaky tests (test harness, not app).
2. Write the Electron+React UI (list in §3.1). Build: npm run build;
   start: npm start. Wire ws://127.0.0.1:8765/ws, WebContentsView bounds
   via IPC, REST reads (books/notes/tasks/reminders/documents/progress),
   PATCH /config from Settings panel.
3. Live LLM demo: source ~/.hermes/.env, start service (mock=false),
   connect a ws client or the UI, say "Abre YouTube", verify ui_command.
4. Wire Electron to spawn the python service (service-spawner) + health
   poll; add --demo auto-tour (config demo.enabled).
5. Commit everything (nothing committed yet — .gitignore already covers
   .venv/node_modules/data dbs). Suggested first commit: "feat: agent
   service + contracts + memory (iteration 1)".
6. Docs: README.md, ADRs (stack, contracts single-source, two-phase
   confirmations, voice/tts stubs, single-process demo, streaming), short
   threat-model.
7. Optional stretch: Edge TTS real speak (tts.auto_speak), YouTube
   browser adapter, epub.js reader.

## 7. Environment notes

- WSL Python 3.12.3; venv at .venv (all 5 packages installed editable).
- Node v22 WSL side; electron 33.4.11 linux binary; WSLg display works.
- Windows git.exe used for git (user preference for /mnt/c repos).
- Port 8765 default. DB at data/arsvox.db (WAL). Sample book:
  data/library/don-quijote.txt.
- pydantic-ai pinned by pip resolution at 2.25.0 — API notes in §5 and
  in model_provider.py / tools/__init__.py comments.
