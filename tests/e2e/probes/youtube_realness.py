"""GATE-5 W1-CONFORMANCE — probe: youtube vision line (W1-YOUTUBE owns it).

Vision line (panel-vision.md): "agent-integrated search. The LLM searches
YouTube and OFFERS the user options (results render as selectable cards)."

The OFFER channel itself is verified by test_wire_probe.py
(test_agent_search_emits_youtube_search_offer). This probe decides the
REALNESS half: no FIXTURE_RESULTS, a real provider seam, and honest
zero-result answers ("no encontré nada", never a fixture fallback).

Row status today: PENDING (W1-YOUTUBE). Verdict: FAIL until the lane lands.
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
    run_scripted_turn,
)

MEDIA_TOOLS = WORKTREE / "services" / "agent" / "arsvox_agent" / "tools" / "media_tools.py"
SEARCH_DIR = WORKTREE / "services" / "agent" / "arsvox_agent" / "search"


def main(record_dir: Path) -> int:
    ensure_worktree_paths()
    checks: list[dict] = []

    # c1 — the fixture list is gone (a docstring mention is fine; the
    # constant must not be DEFINED anywhere in the tool module)
    import re as _re

    src = MEDIA_TOOLS.read_text(encoding="utf-8") if MEDIA_TOOLS.exists() else ""
    c1 = not _re.search(r"FIXTURE_RESULTS\s*=", src)
    checks.append(
        {
            "id": "fixture_results_gone",
            "label": "media_tools.py no longer defines FIXTURE_RESULTS",
            "pass": c1,
            "evidence": f"source scan of {MEDIA_TOOLS.relative_to(WORKTREE)} (definition check)",
        }
    )

    # c2 — a real provider seam exists (search module or provider indirection)
    c2 = SEARCH_DIR.exists() or "provider" in src.lower()
    checks.append(
        {
            "id": "provider_seam",
            "label": "a provider seam (search/youtube.py or provider indirection) exists",
            "pass": c2,
            "evidence": (
                "services/agent/arsvox_agent/search/youtube.py"
                if SEARCH_DIR.exists()
                else "no search/ module; media_tools.py has no provider indirection"
            ),
        }
    )

    # c3 — zero results is an honest empty list (no fixture fallback).
    # Stub the provider to return NO hits: the invariant is the TOOL's
    # behavior when the provider yields nothing (a live nonsense query is
    # NOT a reliable zero — the real engine matches substrings, e.g.
    # "zzzz-no-existe-nada" -> "Aquel Nap ZzZz").
    import arsvox_agent.tools.media_tools as media_tools_mod

    class _EmptyProvider:
        async def search(self, query: str):
            return []

    media_tools_mod.get_youtube_search_provider = lambda: _EmptyProvider()
    app, _ = make_app()
    events = run_scripted_turn(app, "media_search_youtube", {"query": "zzzz-no-existe-nada"})
    offers = frames_of(events, "media.search_results")
    empty = bool(offers) and offers[-1]["results"] == []
    checks.append(
        {
            "id": "zero_results_honest",
            "label": "a query with no matches yields an EMPTY results list (never a fixture fallback)",
            "pass": empty,
            "evidence": (
                f"stubbed provider (0 hits) -> media.search_results with "
                f"{len(offers[-1]['results']) if offers else 'no event'} results"
            ),
        }
    )

    verdict = "PASS" if all(c["pass"] for c in checks) else "FAIL"
    record_verdict(
        record_dir,
        "youtube",
        verdict,
        "Agent OFFER channel verified; REAL search pending W1-YOUTUBE (fixture list still present).",
        checks,
        evidence=[
            "tests/e2e/test_wire_probe.py::test_agent_search_emits_youtube_search_offer",
            "tests/e2e/probes/youtube_realness.py",
        ],
    )
    print(f"[youtube] {verdict}")
    for c in checks:
        print(f"  {'PASS' if c['pass'] else 'FAIL'}  {c['id']}: {c['label']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--record-dir", type=Path, default=Path(__file__).resolve().parent.parent / "evidence")
    args = ap.parse_args()
    raise SystemExit(main(args.record_dir))
