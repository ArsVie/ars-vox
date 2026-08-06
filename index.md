# Ars-Vox

Voice-driven "AI Computer Harness" for one older user (Spanish-first): talk to an
assistant, watch YouTube, read books/documents/news, keep notes and tasks, send a
Telegram message to one approved person.

Current state: **verified agent-service foundation + working desktop vertical
slice + fully wired voice path (TTS, STT, mic capture with energy VAD)**. The only
remaining demo gap: a real-microphone smoke test on the physical Windows machine.

## Quick links

- `docs/HANDOFF.md` — authoritative roadmap + latest session state (read first)
- `docs/` — OKF docs: `architecture/system-overview.md`, `threat-model/`, `decisions/` (ADRs 0001-0006)
- `hey.md` — agent-to-agent message board (read before starting work)

## Key commands

```bash
# python suite (45/45 required)
.venv/bin/python -m pytest tests/python -q
# desktop suite + typecheck + build
cd apps/desktop && npm test && npm run typecheck && npm run build
# mock service (deterministic) then desktop UI against it
.venv/bin/python -m arsvox_agent --mock
cd apps/desktop && npm run dev
# live model proof (needs OPENCODE_GO_API_KEY)
.venv/bin/python scripts/demo_live.py
```

## Stack (repo-relative paths)

- `services/agent/arsvox_agent/` — FastAPI + WebSocket (8765), pydantic-ai 2.25, PolicyEngine, two-phase confirmations
- `services/memory/arsvox_memory/` — SQLite + FTS5
- `services/voice|tts/` — faster-whisper STT, edge-tts TTS, mock fallbacks
- `packages/contracts/` — single source of truth (Python enums/events + JSON schemas)
- `apps/desktop/` — Electron 33 + React 18 + zustand + vite; pure-TS layout engine in `src/layout/engine.ts`
