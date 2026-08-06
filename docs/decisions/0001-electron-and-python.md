---
type: adr
title: ADR 0001 — Electron and Python service
description: Electron shell (TypeScript) + separate Python agent service (FastAPI + WebSocket); Electron version pin pending target-machine spike
---
# ADR 0001: Electron and Python service

Status: Accepted (Electron version pin pending the target-machine spike)

## Context

The product is a voice-operated desktop assistant for an older user on
an aging Intel MacBook Air (2014, macOS Big Sur). Two candidate stacks
were considered: a single JavaScript/Electron application with an
in-process agent, or an Electron shell with a separate Python agent
service.

The agent runtime needs robust local memory (SQLite + FTS5), typed
contracts, a policy engine, and a voice pipeline — strengths of the
Python ecosystem (pydantic-ai, SQLite, Whisper bindings). The desktop
shell needs a window, an embedded browser view, native keyboard
shortcuts, audio device permissions, and process control — strengths of
Electron. A hybrid was chosen.

## Decision

- Electron (TypeScript) owns the window, embedded browser views, native
  shortcuts, audio permissions, and process control.
- A separate Python service (FastAPI + WebSocket on 127.0.0.1:8765)
  owns the agent runtime, memory, policy, confirmations, scheduler, and
  voice pipeline.
- The two processes communicate over a typed WebSocket protocol defined
  in `packages/contracts` (ADR 0002).
- The Electron main process starts or connects to the Python service
  and supervises it; the renderer connects over the WebSocket.
- The working Electron version is 33; the FINAL version is pinned only
  after a compatibility spike on the real 2014 MacBook Air (Big Sur,
  x64, limited CPU/RAM, no Apple Silicon acceleration). The spike must
  verify: Electron launch, Python launch without a system Python
  dependency, SQLite WAL, FTS5, microphone permission, STT/TTS latency,
  embedded browser, reconnect after service restart, memory and idle
  CPU, and scheduler survival across restart.

## Consequences

- Two runtimes to ship and supervise; the desktop must handle Python
  service startup, health checks, and reconnects.
- The WebSocket protocol must stay versioned and validated (ADR 0002).
- Python packaging must produce a self-contained executable for the Mac
  (no system Python dependency) — verified only on the real machine.
- The separation keeps the agent testable headlessly (45 pytest tests
  run without Electron).
