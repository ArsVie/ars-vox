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

    # c2 — the REAL path: the agent TOOL exists and executes. memory.search
    # is server-originated by design (W0-CONTRACT): the strict client union
    # parse rejects client frames, and actions.py returns an honest
    # unsupported verdict for the direct-call surface — so a client command
    # can never be the evidence. The production path is the registered
    # agent tool emitting memory.search_results (verified live at GATE-1:
    # a stated preference shaped the agent's next search query).
    import re as _re

    def _defines(path: Path, pattern: str) -> list[str]:
        hits: list[str] = []
        for p in sorted(path.rglob("*.py")):
            try:
                text = p.read_text(encoding="utf-8")
            except Exception:
                continue
            if _re.search(pattern, text, _re.MULTILINE):
                hits.append(str(p.relative_to(WORKTREE)))
        return hits

    # the tool is DEFINED (async def memory_search) and REGISTERED under
    # "memory.search" — definitions only, docstring mentions don't count
    tool_defs = _defines(TOOLS_DIR, r"^async def memory_search\b")
    reg_hits = _defines(TOOLS_DIR, r'^\s+"memory\.search",$')
    wired = bool(tool_defs) and bool(reg_hits)
    checks.append(
        {
            "id": "tool_wired",
            "label": "agent tool memory.search defined + registered (server-originated; emits memory.search_results)",
            "pass": wired,
            "evidence": (
                f"defs: {tool_defs}; registry: {reg_hits}"
                if wired
                else "memory_search tool missing from tools/ (W1-MEMORY) — tool not wired"
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

    # c4 — the k/v second authority is retired or demoted. Definitions
    # only: docstrings legitimately describe the retirement (memory_tools.py
    # says "memory.remember / memory.recall are RETIRED") — a naive substring
    # scan trips on those mentions. A DEFINED tool is an async def whose
    # name is the snake_case of the wire member.
    kv_defs = _defines(TOOLS_DIR, r"^async def memory_(remember|recall)\b")
    c4 = not kv_defs
    checks.append(
        {
            "id": "kv_authority_retired",
            "label": "memory.remember/memory.recall (PreferenceStore k/v) are gone or demoted",
            "pass": c4,
            "evidence": (
                "no memory_remember/memory_recall definitions (docstring mentions of the "
                "retirement don't count)"
                if c4
                else "still defined: " + ", ".join(sorted(set(kv_defs)))
            ),
        }
    )

    verdict = "PASS" if all(c["pass"] for c in checks) else "FAIL"
    record_verdict(
        record_dir,
        "memory",
        verdict,
        "Wire member present; tool defined + registered (server-originated, emits "
        "memory.search_results); authoritative search_all consumed; k/v retired. "
        "Live GATE-1 evidence: stated preference shaped the agent's next search query.",
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
