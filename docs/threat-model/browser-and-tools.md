---
type: threat-model
title: Threat model — embedded browser and tool surface
description: Attack surface of the embedded browser panel and tool execution; deny-by-default policy, two-phase confirmations, local stop path
---
# Threat model: embedded browser and tool surface

Scope: the attack surface created by (a) an embedded browser panel that
renders remote web content and (b) the agent's tool execution surface.
The local voice assistant runs as a desktop app on the user's own
machine and is trusted to act on the user's behalf — but the pages it
opens and the model's tool calls are NOT trusted inputs.

## Assets

- The user's local files (documents, library) and notes/tasks data.
- The single approved Telegram contact's channel.
- The local SQLite database (sessions, audit, pending actions).
- Desktop UI integrity: the user must be able to stop any action.

## Trust boundaries

1. Web content (remote) — untrusted. Must never drive tools or the
   layout except through the agent, and must never change agent rules.
2. The model (LLM) — semi-trusted. It may be prompt-injected via page
   text or user input. Every side effect goes through the policy gate.
3. The user — trusted. Confirmation is the final authority.
4. Local filesystem/SQLite — trusted, protected from 1 and 2.

## Threats and mitigations

### T1. Page instructs the agent to act (prompt injection via web content)

- The system prompt forbids following instructions found in pages
  (`prompts/system.md`, rule 6): web content is untrusted data.
- The context builder does not feed raw page content into the model as
  instructions; page content enters context only through typed tool
  results.
- Tools with side effects are gated by policy regardless of the model's
  intent.

### T2. Model hallucinates or re-orders a dangerous tool call

- Unknown tools are DENIED by the policy engine (deny-by-default).
- External and destructive classes REQUIRE two-phase confirmation.
- The approved action executes the exact SQLite-stored argument snapshot
  (`pending_actions`); the model can never regenerate or modify approved
  arguments (ADR 0003).
- `reminders.create` and `telegram.send_pending` are approval-overridden
  to require confirmation even though their class alone would not.
- Denied-always tools (`shell.exec`, `file.write`, `file.delete`,
  `browser.generic_agent`) can never be enabled.

### T3. Malicious or broken page drives the embedded browser

- PLANNED (before enabling arbitrary remote browsing): navigation
  restricted by a browser allowlist in config (`browser.allowlist`)
  with a curated home URL. NOT enforced today — `browser.allowlist`
  has zero readers and the Electron browser is not shipped yet; the
  web demo renders only same-origin fixture content.
- There is no generic "browser agent" tool; page interaction uses a
  fixed action vocabulary (open, back, forward, reload, scroll, read,
  fill, submit, media controls) — no arbitrary script execution.
- In Electron, remote content renders in a WebContentsView owned by
  the main process, outside the renderer DOM, with
  `contextIsolation: true` and `nodeIntegration: false` (planned
  shape; web demo uses an iframe).

### T4. Prompt injection via documents / library content

- Library and document text enter the model through typed tool results.
- The same policy gate applies; reading content is read-only, and
  writing/executing requires approval or is impossible.

### T5. Confirmation bypass or replay

- Confirmation applies to exactly one pending action.
- New conflicting requests invalidate previous pending actions.
- Confirmations expire (`reminders.confirmation_timeout_s`).
- Editing a message invalidates its previous confirmation.
- The confirmation snapshot is stored in SQLite, not in model memory.

### T6. Stop path fails / runaway turn

- The stop message is handled at the protocol level (ClientMessage
  `stop`) and calls `AgentRuntime.cancel()` directly — it never waits
  for the LLM, a network request, tool completion, or TTS completion.
- Cancel propagates: the active model run is cancelled, the TTS queue is
  cleared, current assistant audio stops, cancelable tools are
  cancelled, late results are ignored, and the app returns to SLEEPING
  (ADR 0004).
- Model timeouts and a hard step cap (`max_steps`) bound runaway turns.

### T7. Credential leakage

- No secrets in the repository: API keys come from environment
  variables (`OPENCODE_GO_API_KEY`, `TELEGRAM_BOT_TOKEN`).
- `configs/.env` is gitignored; runtime databases and `.venv` /
  `node_modules` are gitignored.
- Audit events record tool usage; the UI shows source data, not
  credentials.

### T8. Malformed input / event flooding

- Client messages are validated against the contracts (unknown message
  types rejected); the WebSocket endpoint answers invalid input with a
  recoverable error.
- Event bus queues are capped; slow subscribers drop events instead of
  blocking the service.

### T9. Unauthenticated local WebSocket (127.0.0.1:8765)

- GAP (accepted today, must close before the Electron browser ships):
  the WebSocket endpoint has NO client authentication and NO Origin
  check. Any process on the machine — including a malicious web page
  in the future embedded browser — could connect and send `user_text`,
  `confirm`, `cancel`, or browser commands.
- Current exposure is limited: the service binds loopback only, the
  web demo renders same-origin fixture content, and no remote
  navigation exists yet.
- PLANNED MITIGATION (before enabling arbitrary remote browsing):
  per-launch unguessable session credential required in the WebSocket
  handshake + strict Origin check; alternatively, the Electron main
  process becomes the only WebSocket client and the trusted renderer
  reaches the agent through a narrow IPC API. The embedded remote
  browser must have zero path to the agent channel.
- STATUS: docs/STATUS.md (Security posture) tracks this as the top
  gap.

## Residual risks (accepted)

- A compromised model provider could attempt malicious tool calls; the
  policy gate and confirmation remain the defense, and the user can
  always press stop.
- The embedded browser's security depends on the Electron/Chromium
  version; the target machine is the physical Windows 11 desktop (the
  2014 MacBook Air / Big Sur was an early compatibility eval only —
  ADR 0001 status note), and the final Electron version is pinned
  there before the real browser ships.
- Local alarms cannot alert while the computer is off (accepted product
  limitation).
