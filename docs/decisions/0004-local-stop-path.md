---
type: adr
title: ADR 0004 — Local stop path
description: stop is handled at protocol level; AgentRuntime.cancel() never waits on the LLM, network, tools, or TTS
---
# ADR 0004: Local stop path

Status: Accepted

## Context

The user is an older person operating the computer by voice. When the
assistant is mid-turn (thinking, speaking, running tools), the user must
be able to interrupt immediately. If "stop" depended on the LLM, a
network request, tool completion, or TTS completion, the user could be
stuck for many seconds — or the stop itself could fail when the model is
unresponsive. The stop path must be local and instantaneous.

## Decision

- `stop` is a protocol-level client message handled before any model
  routing; local intent matching also recognizes spoken stop vocabulary
  (`stop`, `detente`, `alto`, `basta`).
- `AgentRuntime.cancel()`:
  1. cancels the active model run (task cancel),
  2. clears the TTS queue,
  3. stops current assistant audio,
  4. cancels cancelable tools,
  5. ignores late results from cancelled work,
  6. emits the correct voice-state events (`stopping` then `sleeping`),
  7. keeps the application usable afterwards (busy flag cleared).
- The voice pipeline owns the state transitions and the silence timer;
  after 60 seconds of user silence the state returns to `sleeping`.
- The stop path never waits for the LLM, a network request, tool
  completion, or TTS completion.

## Consequences

- The protocol stop is deterministic and testable without any model
  (ws e2e test `test_stop_cancels_running_turn`).
- The always-visible stop button in the desktop UI sends the same
  protocol message; stopping mid-turn returns the app to sleeping and
  the service remains responsive.
- Stopping a turn does not dismiss alarms or reminders — it silences
  active work only.
