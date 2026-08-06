---
type: adr
title: ADR 0003 — SQLite confirmation snapshots
description: Two-phase confirmations execute the exact SQLite-stored argument snapshot, not regenerated model arguments
---
# ADR 0003: SQLite confirmation snapshots

Status: Accepted

## Context

Two-phase confirmation protects the user from surprising side effects
(Telegram sends, reminder creation, external actions). The naive design
asks the model to re-perform the action after approval — but by then the
model's arguments may have changed (regeneration, context drift, prompt
injection between phases). The approved action must execute exactly
what the user approved.

## Decision

- When a tool requires approval, the confirmation coordinator stores the
  full argument snapshot in SQLite (`pending_actions`) with a unique
  `pending_id`, the tool name, the exact args, a human-readable title
  and detail, and an expiry timestamp.
- The model's turn returns `PENDING_APPROVAL:<pending_id>` and ends;
  the model never executes the action itself.
- The user confirms or cancels through the protocol (`confirm` /
  `cancel` with `pending_id`).
- On approval, `ToolRegistry.execute_direct` runs the STORED snapshot —
  the gate is bypassed by design because the approval already happened,
  but the stored arguments are what execute.
- Rules enforced by the coordinator:
  - new conflicting requests invalidate previous pending actions,
  - confirmations expire,
  - confirmation applies to only one pending action,
  - editing a message invalidates its previous confirmation,
  - external actions remain auditable,
  - unknown tools remain denied.
- `telegram.send_pending` exists only as an approval-executed tool; the
  model-facing path is `telegram_prepare_message`, which shows a preview,
  reads it back, and requests confirmation.

## Consequences

- The model cannot modify approved arguments after the fact — enforced
  by the storage boundary, not by prompting.
- The audit trail records both the request and the execution
  (`audit_events`).
- The snapshot boundary is tested (confirmation flow, cancel, expiry,
  supersede) in the Python suite.
