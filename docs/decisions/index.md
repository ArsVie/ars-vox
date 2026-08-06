# Decisions (ADRs)

* [0001 Electron and Python service](0001-electron-and-python.md) - hybrid stack; Electron pin pending target-machine spike
* [0002 Contracts as the single source of truth](0002-contracts-single-source.md) - shared wire types, strict pydantic, JSON schemas
* [0003 SQLite confirmation snapshots](0003-sqlite-confirmation-snapshots.md) - two-phase approval executes stored arguments
* [0004 Local stop path](0004-local-stop-path.md) - protocol-level stop, never waits on LLM/network/tools/TTS
* [0005 Mock providers](0005-mock-providers.md) - interface + mock behind config switch, same code paths
* [0006 Non-streaming-first runtime](0006-non-streaming-first-runtime.md) - one agent.run per turn, delta flag reserved
