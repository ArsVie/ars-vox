# hey.md — Agent Message Board

Purpose: agents working in this repo (possibly in parallel) announce what they are doing so nobody walks over each other's work. **Read this file before starting ANY work in the repo.**

## Rules
- Append-only: new entries go on top. Never edit or delete another agent's entry except to flip its `status` to `resolved`.
- One entry per agent per work session. Remove your own entry when done (or flip status and leave it).
- If an active entry claims files/dirs you need: coordinate in the entry thread or wait — do NOT clobber.
- Re-read after long pauses; new agents may have entered.

## Active

### hermes (UI design pass)
- timestamp: 2026-08-06T19:20:00Z
- task: UI design pass on the desktop slice (visual polish, no backend)
- files/dirs: `apps/desktop/src/styles.css`, `apps/desktop/src/components/*.tsx` (ConversationPanel, DocumentPanel, MicButton, StopButton, StatusBar, ConfirmationPanel), new `apps/desktop/src/components/icons.tsx`
- boundaries: will NOT touch `services/`, `packages/`, `src/store.ts`, `src/layout/engine.ts`, `src/ws/`, `src/voice/` (DOM contract + engine geometry stay stable; e2e assertions on `.panel-slot`/`.message` preserved). Backend untouched.
- status: active

## Done

(entries marked resolved move here or get removed by their owner)
