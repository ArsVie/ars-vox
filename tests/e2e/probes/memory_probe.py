"""GATE-5 W1-CONFORMANCE — probe: memory/agent-behavior line (W1-MEMORY).

Vision line (panel-vision.md): "the agent should know user preferences from
memories and query the search accordingly."

Charter finding (orchestration plan): two memory systems — arsvox_memory
(SQLite + FTS5, search_all()) has ZERO consumers in services/agent, and the
agent's only memory tools (memory.remember/memory.recall) are exact-key
k/v lookups against the PreferenceStore. "Knows preferences from memories"
cannot be built on memory.recall(key).

This probe records: the frozen wire member exists (PASS), the tool is not
wired (FAIL), the authoritative store is unreached (FAIL), the k/v second
authority is still live (FAIL). Row status: PENDING (W1-MEMORY).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Bootstrap: probes run as standalone scripts (sys.path[0] = probes/); the
# worktree root must be importable for tests.e2e.probe_core.
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from tests.e2e.probe_core import (
    WORKTREE,
    ensure_worktree_paths,
    frames_of,
    make_app,
    record_verdict,
    run_client_command,
)

AGENT_DIR = WORKTREE / "services" / "agent"
TOOLS_DIR = AGENT_DIR / "arsvox_agent" / "tools"


def _grep(path: Path, needle: str) -> list[str]:
    hits: list[str] = []
    for p in sorted(path.rglob("*.py")):
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        if needle in text:
            hits.append(str(p.relative_to(WORKTREE)))
    return hits


def main(record_dir: Path) -> int:
    ensure_worktree_paths()
    checks: list[dict] = []

    # c1 — the frozen wire member exists (memory.search + memory.search_results)
    from arsvox_contracts.commands import MemorySearch
    from arsvox_contracts.events import MemorySearchResultsEvent

    c1 = MemorySearch is not None and MemorySearchResultsEvent is not None
    checks.append(
        {
            "id": "wire_member",
            "label": "memory.search command + memory.search_results event on the frozen wire",
            "pass": c1,
            "evidence": "packages/contracts (W0-CONTRACT) — read-only reference",
        }
    )

    # c2 — the command has a real handler (not the honest no-op verdict)
    app, _ = make_app()
    events = run_client_command(
        app,
        {"action": "memory.search", "query": "preferencias musicales"},
        wait_for=lambda e: e["type"] == "action_result",
    )
    results = frames_of(events, "action_result")
    wired = bool(results) and results[-1]["status"] == "done"
    checks.append(
        {
            "id": "tool_wired",
            "label": "memory.search executes (action_result done, not an honest no-op)",
            "pass": wired,
            "evidence": (
                f"action_result status={results[-1]['status']!r} — memory.search is "
                "server-originated; a client frame today gets an honest 'failed' verdict "
                "(parse rejects it), never a fake recall"
                if results
                else "no action_result frame"
            ),
        }
    )

    # c3 — the authoritative memory (arsvox_memory.search_all) has consumers
    consumers = _grep(AGENT_DIR, "search_all")
    c3 = bool(consumers)
    checks.append(
        {
            "id": "authoritative_store_reached",
            "label": "services/agent consumes arsvox_memory.search_all (SQLite + FTS5 authority)",
            "pass": c3,
            "evidence": (
                ", ".join(consumers)
                if consumers
                else "ZERO consumers of search_all in services/agent — every turn is indexed and unreadable"
            ),
        }
    )

    # c4 — the k/v second authority is retired or demoted
    kv_tools = _grep(TOOLS_DIR, "memory.remember") + _grep(TOOLS_DIR, "memory.recall")
    c4 = not kv_tools
    checks.append(
        {
            "id": "kv_authority_retired",
            "label": "memory.remember/memory.recall (PreferenceStore k/v) are gone or demoted",
            "pass": c4,
            "evidence": (
                "no memory.remember/memory.recall definitions"
                if c4
                else "still defined: " + ", ".join(sorted(set(kv_tools)))
            ),
        }
    )

    verdict = "PASS" if all(c["pass"] for c in checks) else "FAIL"
    record_verdict(
        record_dir,
        "memory",
        verdict,
        "Wire member present; tool not wired; authoritative memory unreached; k/v second "
        "authority still live — W1-MEMORY owns all three fixes.",
        checks,
        evidence=["tests/e2e/probes/memory_probe.py", "docs/plans/gate-5-vision-conformance-orchestration-2026-08-09.md"],
    )
    print(f"[memory] {verdict}")
    for c in checks:
        print(f"  {'PASS' if c['pass'] else 'FAIL'}  {c['id']}: {c['label']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--record-dir", type=Path, default=Path(__file__).resolve().parent.parent / "evidence")
    args = ap.parse_args()
    raise SystemExit(main(args.record_dir))
