# Ars-Vox

A local voice assistant that helps an older user operate a computer:
talk to an assistant, watch YouTube, read books and documents, read the
news, keep notes and tasks, and send a Telegram message to one approved
person.

Current state: **a verified agent-service foundation with a working
desktop vertical slice and a partially wired real voice path**. TTS
synthesis (edge provider) and STT (faster-whisper) work end to end;
microphone capture is not wired yet, so the full user-facing product
(voice capture, all panels) is not complete.

## Current scope

Working end to end (verified live):

- Agent service (FastAPI + WebSocket on port 8765) with a PydanticAI
  runtime, typed tool calls, a policy engine, two-phase confirmations
  with SQLite argument snapshots, a reminder scheduler, and an audit
  trail.
- Electron vertical slice: one window, one React renderer, one WebSocket
  client, one Zustand store, a persistent status bar, an always-visible
  stop button, a conversation panel, a document panel, a confirmation
  panel, an error panel, and two layout templates (focus, split).
- Deterministic layout engine: the model selects template + panels, the
  engine computes position, size, z-order, animation, and reduced-motion
  behavior. Pure TypeScript, covered by Vitest.
- Live model path: `scripts/demo_live.py` proves an opencode-go model
  (`deepseek-v4-flash`) produces typed tool calls and `ui_command`
  events end to end.
- Local stop path: the protocol `stop` message cancels the running turn
  without ever involving the LLM.

- Voice path start: `GET /tts?text=...` synthesizes Spanish speech
  (edge-tts) and `POST /api/stt` transcribes uploaded audio
  (faster-whisper, es); `auto_speak` emits a real `tts.speak` and the
  renderer plays it (Electron disables the autoplay policy; plain
  browsers get a muted-then-unmute fallback). Verified live: a real
  click on Send produced `GET /tts` with 200 and playback started.

Not yet done: microphone capture (the renderer must record mic audio
and POST it to `/api/stt`), the remaining panels (browser, media,
news, notes, tasks, settings), Electron version pinning for the target
2014 Intel MacBook Air, and the product documentation listed under
`docs/`.

## Repository structure

```
apps/desktop/            Electron + React renderer (TypeScript, Vite)
  electron/main.ts       main process: one window
  src/layout/engine.ts   deterministic layout engine (pure TS)
  src/store.ts           Zustand store (vanilla, node-testable)
  src/ws/client.ts       WebSocket client with reconnect
  src/components/        panels, status bar, stop button, overlays
  tests/                 Vitest coverage (engine + store)
packages/contracts/      single source of truth for wire contracts
  arsvox_contracts/      Python event/command/message models
  schemas/               exported JSON schemas
  scripts/export_schemas.py
services/agent/          FastAPI service: runtime, policy, tools, ws
  arsvox_agent/tools/    tool registry + handlers
  arsvox_agent/prompts/  system prompt
services/memory/         SQLite + FTS5: repos, migrations, search
services/voice/          voice pipeline state machine (mock providers)
services/tts/            TTS providers + queue (mock providers)
configs/app.yaml         configuration (single file, validated)
scripts/smoke_mock.py    boot mock service + one turn, assert events
scripts/demo_live.py     boot LIVE service + assert typed ui_command
tests/python/            pytest suite (45 tests)
docs/                    architecture, threat model, ADRs
```

## Setup

Python service:

```bash
cd /mnt/c/dev/ars-vox
python -m venv .venv
.venv/bin/pip install -e packages/contracts -e services/memory \
  -e services/tts -e services/voice -e services/agent
```

Desktop:

```bash
cd apps/desktop
npm install
```

## Run — mock (no network, deterministic)

```bash
# one-shot smoke: boots a mock service, drives one turn, asserts events
.venv/bin/python scripts/smoke_mock.py

# long-running mock service (scripted model repeats tool -> text every turn)
.venv/bin/python -m arsvox_agent --mock

# desktop UI against the mock service (second terminal):
cd apps/desktop && npm run dev        # or: npm run build && npm start
```

Mock demo scenario: type `Open a document.` in the UI. The scripted
model emits `ui_apply_layout(split, document_editor)`, the layout
changes to split, the document panel appears, and the assistant answers.

## Run — live model

```bash
export OPENCODE_GO_API_KEY=...        # see Required environment variables
.venv/bin/python -m arsvox_agent      # configs/app.yaml, mock: false

# live proof: boots the service, sends "Open YouTube.", asserts
# tool_call -> ui_command -> tool_result -> agent_message
.venv/bin/python scripts/demo_live.py
```

## Test

```bash
.venv/bin/python -m pytest tests/python -q      # 45 tests
cd apps/desktop && npm test                     # 20 Vitest tests
cd apps/desktop && npm run typecheck && npm run build
```

## Configuration

Single YAML file: `configs/app.yaml` (template: `configs/app.example.yaml`).
The service validates it with a strict pydantic model — unknown keys are
rejected. The UI receives a copy through `GET /config` and can persist
changes through `PATCH /config`.

Key sections: `agent` (model provider, timeout, max steps),
`voice` (enabled, VAD/STT providers, silence timeout), `tts` (provider,
auto-speak), `ui` (templates, reduced motion, large text),
`telegram` (mock, token env, one approved chat id), `memory` (db path,
library/documents dirs), `reminders` (scheduler interval, snooze,
confirmation timeout), `browser` (allowlist, home url).

Relative paths in the config resolve against the config file's directory.

## Required environment variables

- `OPENCODE_GO_API_KEY` — API key for the model provider (required for
  live model runs; the mock path does not need it).
- `TELEGRAM_BOT_TOKEN` — Telegram bot token (only when
  `telegram.mock: false`; mock mode simulates the send locally).

## WebSocket protocol (summary)

`ws://127.0.0.1:8765/ws`

Client → server: `user_text`, `confirm`, `cancel`, `stop`, `ping`.

Server → client (typed events): `state_update`, `user_message`,
`agent_message` (with `delta` flag), `tool_call`, `ui_command`,
`confirmation_requested`, `confirmation_resolved`, `notification`,
`error`, `config_update`, `pong`.

`ui_command` is a discriminated union on `action`: `layout.apply`,
`panel.open`, `panel.close`, `panel.set_primary`, `panel.fullscreen`,
`layout.restore`, `notification.show`, `media.state`, `tts.speak`,
`audio.play`. The model never sends coordinates; it selects template and
panels, and the UI computes geometry.

## Known limitations

- Microphone capture is not wired: the voice pipeline state machine and
  STT/TTS provider interfaces exist and STT/TTS work via file/URL
  paths, but the renderer does not record mic audio yet.
- TS types in the renderer are hand-mirrored from the Python contracts;
  the JSON schemas in `packages/contracts/schemas/` exist for future
  code generation.
- Electron 33 is the working build; compatibility with the target 2014
  Intel MacBook Air (macOS Big Sur) is NOT verified — a spike on the
  real machine is required before pinning the final version.
- Local alarms cannot alert while the computer is off.
- The `--mock` service flag writes a temporary config file (it never
  modifies `configs/app.yaml`).

## Security boundaries

- Every tool has a policy classification (read-only, reversible,
  user-visible, external, destructive, privileged). Unknown tools are
  DENIED.
- External and destructive actions require two-phase confirmation; the
  approved action executes the exact SQLite-stored argument snapshot —
  the model cannot modify arguments after approval.
- Confirmations expire, apply to one pending action, and are invalidated
  by new conflicting requests or message edits.
- The local stop path never depends on the LLM, network, or tool
  completion.
- Embedded web content is untrusted: the system prompt forbids following
  page instructions, and the browser allowlist restricts navigation.
- No credentials are stored in the repository; API keys come from
  environment variables.

## Implementation status

- Python suite: 45/45 passing.
- Desktop: 20/20 Vitest, typecheck clean, renderer + Electron build.
- Live model: verified (`demo_live.py` LIVE_OK with two typed tool calls
  in one turn).
- End-to-end UI: verified in a real Chromium against the mock service —
  user text → tool call → policy → `ui_command` → split layout →
  document panel → agent response; stop button returns the app to
  sleeping and the service stays responsive.
- TTS playback: verified in a real Chromium against the mock service
  with edge TTS — a real CDP click on Send issued `GET /tts` (200) and
  playback started (unmuted, resolved). Autoplay-safe: Electron ships
  with `autoplay-policy=no-user-gesture-required`; plain browsers fall
  back to muted-then-unmute when no user activation exists yet.
- This project is NOT a complete demo yet; it is a verified agent-service
  foundation with a working desktop vertical slice and a partially wired
  real voice path (TTS/STT work; microphone capture pending).
