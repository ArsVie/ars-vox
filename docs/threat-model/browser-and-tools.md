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
- SPIKE IMPLEMENTED (GATE-3.5 A8, 2026-08-08): the hardened remote-content
  foundation is real code — `apps/desktop/electron/security-policy.ts` +
  `hardened-view.ts` (R40/R41): instantiable `WebContentsView` bound to an
  isolated persistent partition (`persist:remote-content`), deny-by-default
  permission handlers, navigation filter (dangerous schemes + local/
  private-network destinations blocked INDEPENDENTLY of the allowlist),
  window-open denial, no privileged preload (isolated world, sandbox,
  contextIsolation), app-only `arsvox-doc:` protocol for local documents
  (roots empty until Wave 2), and IPC sender validation (`isTrustedIpcSender`
  applied to `arsvox:get-token`). Unit-tested (41 tests). The browser UI and
  allowlist enforcement remain PLANNED (Wave 2 B2/B3); the Electron upgrade
  lands BEFORE arbitrary browsing (R42, migration note:
  docs/migration-note-electron-upgrade-2026-08-08.md).
- There is no generic "browser agent" tool; page interaction uses a
  fixed navigation vocabulary (navigate/back/forward/refresh) + media
  controls today — no arbitrary script execution. A richer
  page-interaction vocabulary (open/scroll/read/fill/submit) is PLANNED
  with the Electron browser.
- In Electron, remote content renders in a WebContentsView owned by
  the main process, outside the renderer DOM, with
  `contextIsolation: true` and `nodeIntegration: false`. The hardened
  view module (GATE-3.5 A8 spike, `apps/desktop/electron/hardened-view.ts`)
  makes this shape instantiable and tested; the web demo still uses an
  iframe and the real browser wiring is Wave 2 (B2).

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
- Cancel propagates: the active model run is cancelled, pending
  confirmations are invalidated (a stuck card is never left behind),
  the TTS queue is cleared, current assistant audio stops, cancelable
  tools are cancelled, late results are ignored, and the app returns to
  SLEEPING (ADR 0004).
- The renderer is locally authoritative for stop: mic/STT/TTS capture
  is aborted first (generation guards drop post-STOP transcripts), and
  the voice state machine is the single source of truth (GATE-2.5 H3).
- Model timeouts and a hard step cap (`max_steps`) bound runaway turns.

### T7. Credential leakage

- No secrets in the repository: API keys come from environment
  variables (`OPENCODE_GO_API_KEY`, `TELEGRAM_BOT_TOKEN`).
- `configs/.env` is gitignored; runtime databases and `.venv` /
  `node_modules` are gitignored.
- Audit events record tool usage; the UI shows source data, not
  credentials.
- The per-launch service bearer token is generated at runtime and held
  by the Electron main process (injected via preload) — it is never
  written to disk or committed (GATE-2.5 H4).

### T8. Malformed input / event flooding

- Client messages are validated against the contracts (unknown message
  types rejected); the WebSocket endpoint answers invalid input with a
  recoverable error — `ui_command` frames that fail parse get an
  `action_result failed` verdict so the UI reconciles honestly (H1).
- Event bus queues are capped; slow subscribers drop events instead of
  blocking the service.

### T9. Unauthenticated local WebSocket (127.0.0.1:8765)

- RESOLVED (GATE-2.5 H4, 2026-08-08): the local service now requires a
  per-launch bearer token on every HTTP route except `/health` (probes)
  AND in the WebSocket handshake (query param); CORS is locked to the
  configured origins (no wildcard); uvicorn runs with access logging
  disabled so the WS token never lands in request logs; the Electron
  main process generates the token and the trusted renderer receives it
  via preload IPC.
- Remaining boundary work: the embedded browser must have zero path to
  the agent channel — guaranteed by construction in the A8 hardened-view
  module (remote pages get no preload, no token, no IPC surface; separate
  partition; `arsvox-doc:`/file: unreachable from remote content).
  Allowlist + sandboxing ship before arbitrary remote browsing
  (docs/STATUS.md Known gaps #2; Wave 2 B2/B3).
- STATUS: docs/STATUS.md (Security posture) is authoritative.

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
