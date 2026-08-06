# ADR 0006: Non-streaming-first runtime

Status: Accepted

## Context

The agent could stream assistant text token by token for a chat-like
feel. Streaming complicates the turn lifecycle: cancellation boundaries,
tool-call interleaving, partial-message persistence, and test
determinism all get harder. For a voice-first assistant that speaks
complete phrases, streaming adds latency risk (choppy audio) and
complexity without a first-iteration benefit.

## Decision

- The runtime executes one `agent.run(prompt)` per turn and emits the
  final assistant message as a single `agent_message` event with
  `delta: false`.
- Tool calls are typed and executed inside the same run; every tool
  emits `tool_call` (running/done/error) and `ui_command` events.
- The `delta` flag already exists in the contract (`agent_message`
  supports `delta: true`) so streaming can be added later without a
  protocol break; the renderer store already concatenates delta
  messages.
- The model never emits free-text UI control; the only interface channel
  is typed `ui_command` (ADR 0002).
- Tool names exposed to the provider are flattened to
  `^[a-zA-Z0-9_-]+$` (dots to underscores) because the live provider
  (Console Go / opencode-go) rejects dotted names; internal dotted names
  (policy, confirmations, audit, events) are preserved.

## Consequences

- Deterministic turn semantics: one model run, one final message,
  bounded by timeout and step cap — easy to test and to cancel (ADR
  0004).
- The UI shows complete assistant replies rather than a stream; TTS
  playback (when wired) will speak from the complete phrase.
- The mock and live model paths share the same turn machinery; the live
  proof (demo_live.py) exercises multi-step behavior with two typed tool
  calls in one turn.
