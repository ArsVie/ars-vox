# System overview

## Components

```
┌──────────────────────────┐        WebSocket (8765)        ┌─────────────────────────────┐
│  Electron desktop (TS)   │ ◄────────────────────────────► │  Agent service (Python)     │
│  ────────────────        │   typed events / messages     │  ────────────────────       │
│  React renderer          │                               │  FastAPI + Uvicorn          │
│  Zustand store           │                               │  PydanticAI AgentRuntime    │
│  Layout engine (pure TS) │                               │  Tool registry + policy     │
│  WS client (reconnect)   │                               │  Confirmation coordinator   │
└──────────────────────────┘                               │  Reminder scheduler         │
                                                           │  Voice pipeline (mock)      │
                                                           └──────────────┬──────────────┘
                                                                          │ SQLite (WAL + FTS5)
                                                                          ▼
                                                           ┌─────────────────────────────┐
                                                           │  Memory service             │
                                                           │  sessions, turns (FTS5),    │
                                                           │  notes, tasks, reminders,   │
                                                           │  pending actions, audit,    │
                                                           │  panels, preferences        │
                                                           └─────────────────────────────┘
```

## Responsibilities

| Layer | Responsibility | Owns |
|-------|---------------|------|
| Electron main | window, process lifecycle | `apps/desktop/electron/` |
| React renderer | rendering, input, overlays | `apps/desktop/src/components/` |
| Layout engine | geometry from template + panels (pure functions) | `apps/desktop/src/layout/` |
| Zustand store | event application, layout state, history | `apps/desktop/src/store.ts` |
| WS client | connection, reconnect, framing | `apps/desktop/src/ws/` |
| Agent service | turn orchestration, model calls, cancellation | `services/agent/` |
| Policy engine | side-effect classification, approval gates | `services/agent/arsvox_agent/policy.py` |
| Tool registry | registration, gated execution, ui_command emission | `services/agent/arsvox_agent/tools/` |
| Confirmation coordinator | two-phase approval with stored snapshots | `services/agent/arsvox_agent/confirmations.py` |
| Memory service | SQLite repos, FTS5 search, migrations | `services/memory/` |
| Voice pipeline | voice state machine, silence timer (providers mocked) | `services/voice/` |
| TTS | provider interface + queue (providers mocked) | `services/tts/` |
| Contracts | single source of truth for wire types | `packages/contracts/` |

## The turn path (verified live)

```
client message (user_text)
  → WebSocket endpoint
  → local intent matcher (reminders vocabulary, LLM-free)
  → VoicePipeline.inject_text (wake + silence timer)
  → AgentRuntime._run_turn
  → context builder (state + panels + memory + skills)
  → model call (scripted mock or opencode-go live)
  → typed tool call
  → ToolRegistry.execute_gated
  → PolicyEngine.decide (unknown tools denied; approval classes gated)
  → handler(ToolContext, **args)
  → typed UiCommand event on the bus
  → WebSocket fan-out
  → Zustand store applyEvent
  → layout engine recompute
  → panels render (position/size/z/animation from the engine)
  → final state_update (listening | waiting_for_confirmation)
```

## Event bus

An in-process `EventBus` with per-connection subscriber queues. Every
agent event is a pydantic model from `arsvox_contracts.events`; the
WebSocket endpoint subscribes at connect, pumps queued events, and fans
them out as JSON. Slow subscribers drop events with a warning (queue cap
1000) rather than blocking the turn.

## Layout engine

The model NEVER sends pixel coordinates. The `ui_command` vocabulary is:

- `layout.apply` — template (focus | split) + primary/secondary panels
- `panel.open` / `panel.close` — mount/unmount panels
- `panel.set_primary` — promote a panel
- `panel.fullscreen` — one panel full-bleed
- `layout.restore` — pop the history stack

The engine (`apps/desktop/src/layout/engine.ts`) computes geometry as
viewport fractions, z-order (primary 30, secondary 20), enter animations
(fade for new panels, slide for role changes), and disables all
animation under reduced motion. Deterministic rules:

- invalid panel ids fall back to the conversation panel
- the conversation panel is always mounted; in split it fills the
  secondary slot when the model names only a primary panel
- panels referenced by the spec are mounted by the layout command itself

## Data model (SQLite)

Single database (`memory.db_path`), WAL mode, FTS5 tables for turns and
notes. Migrations in `services/memory/arsvox_memory/migrations/`.

Core tables: `sessions`, `turns` (+ `turns_fts`), `notes` (+ `notes_fts`),
`tasks`, `reminders`, `reminder_occurrences`, `notification_events`,
`pending_actions` (confirmation snapshots), `panel_instances`,
`preferences`, `content_progress`, `documents`, `audit_events`,
`explicit_memories`, `users`, `contacts`.

## Configuration

One validated YAML file (`configs/app.yaml`). The service loads it at
startup, resolves relative paths against the file's directory, and
rejects unknown keys. `GET /config` returns the active config;
`PATCH /config` validates, persists, and live-reloads (the runtime
rebuilds its agent lazily on the next turn).
