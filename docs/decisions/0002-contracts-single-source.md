---
type: adr
title: ADR 0002 — Contracts as the single source of truth
description: packages/contracts owns all wire types; strict pydantic models, exported JSON schemas, ui_command as discriminated union
---
# ADR 0002: Contracts as the single source of truth

Status: Accepted

## Context

Two processes (Electron renderer, Python service) exchange events,
messages, and UI commands. Without a shared definition, the wire format
drifts: the UI renders fields the service never sends, or the service
emits events the UI cannot parse. A dedicated contracts package keeps
both sides honest.

## Decision

- `packages/contracts` (Python package `arsvox_contracts`) is the single
  source of truth for wire types: client messages, agent events, UI
  commands, configuration, and enums.
- Every type is a strict pydantic model; unknown keys and unknown
  discriminators are rejected.
- JSON schemas are exported from the models by
  `packages/contracts/scripts/export_schemas.py` into
  `packages/contracts/schemas/*.json` and committed.
- The service validates every inbound client message and emits only
  validated event objects.
- `ui_command` is a discriminated union on `action` — the model never
  controls the interface through free text (ADR 0006).

## Consequences

- The renderer mirrors the contract types by hand in TypeScript
  (`apps/desktop/src/contracts.ts`); this mirror is a known duplication
  risk and the committed JSON schemas are the basis for future code
  generation.
- Adding a tool, event, or command touches one package and its tests;
  the ws e2e suite (45 tests) guards the wire format.
- Config is validated by the same package: unknown config keys are
  rejected at startup.
