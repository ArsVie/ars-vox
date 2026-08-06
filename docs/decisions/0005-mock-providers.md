---
type: adr
title: ADR 0005 — Mock providers
description: Every provider has an interface + mock behind a config switch; mocks run the same runtime, policy, confirmation, WS, and SQLite paths
---
# ADR 0005: Mock providers

Status: Accepted

## Context

Development and demos cannot depend on live services: the model
provider, TTS, voice/STT, and Telegram may be unavailable, slow, or
costly. But mocks that diverge from real behavior create false
confidence — the mock path must exercise the same code paths as the
live path.

## Decision

- Every provider has an interface with a mock implementation behind a
  config switch (`agent.mock`, `tts.provider: mock`, `stt.provider:
  mock`, `telegram.mock: true`).
- The mock model is a scripted pydantic-ai FunctionModel that replays a
  script of typed tool calls and text; the script LOOPS so a
  long-running demo service replays the full tool -> text flow on every
  turn (the agent instance is cached across turns).
- Mocks run through the same runtime, policy, confirmation, WebSocket,
  and SQLite paths as the live providers — only the last-mile I/O is
  faked.
- Live provider paths are proven separately: `scripts/demo_live.py`
  boots the real opencode-go provider and asserts the typed `ui_command`
  path end to end.
- The mock Telegram send simulates the network call but still writes the
  audit record, so confirmation flows are exercised for real.

## Consequences

- Deterministic demos and tests (45 pytest, zero network).
- The mock model's tool names must stay in sync with the real schema
  (sanitized names, ADR 0006 / provider constraints) or the mock drifts
  from live behavior — the live proof script guards this.
- A real voice path (microphone, VAD, STT, interruptible TTS, barge-in)
  remains outstanding; the pipeline state machine and provider
  interfaces are in place and mocked.
