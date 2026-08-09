"""GATE-5 W1-CONFORMANCE — probe: conversation time line (verified PASS).

Vision line (panel-vision.md): "for the agent, messages should have time
appeneded to it for context."

Verified: now_line() is injected at the TOP of every turn's context —
Spanish local time + ISO local + UTC — so the model always knows the
time (context.py, "do NOT replace with a clock tool"). This lane marks
the row PASS; the packaged GATE-1 turn re-proves it live (wire_probe_live).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Bootstrap: probes run as standalone scripts (sys.path[0] = probes/); the
# worktree root must be importable for tests.e2e.probe_core.
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from tests.e2e.probe_core import ensure_worktree_paths, record_verdict


def main(record_dir: Path) -> int:
    ensure_worktree_paths()
    checks: list[dict] = []

    from datetime import datetime

    from arsvox_agent.context import build_context, now_line

    from tests.e2e.probe_core import make_deps

    deps = make_deps()
    ctx = build_context(deps.config, deps)
    first = ctx.splitlines()[0]

    c1 = first.startswith("Hora actual: ")
    checks.append(
        {
            "id": "time_line_first",
            "label": "the turn context's FIRST line is the time line",
            "pass": c1,
            "evidence": f"first line: {first[:90]!r}",
        }
    )

    c2 = "ISO local:" in first and "UTC:" in first
    checks.append(
        {
            "id": "iso_and_utc",
            "label": "unambiguous ISO local + UTC present (not just a wall-clock string)",
            "pass": c2,
            "evidence": first[:140],
        }
    )

    c3 = datetime.now().astimezone().isoformat(timespec="seconds") in now_line()
    checks.append(
        {
            "id": "matches_wall_clock",
            "label": "the injected time matches the wall clock (not a stale fixture)",
            "pass": c3,
            "evidence": "datetime.now().isoformat(timespec='seconds') in now_line()",
        }
    )

    verdict = "PASS" if all(c["pass"] for c in checks) else "FAIL"
    record_verdict(
        record_dir,
        "conversation_time",
        verdict,
        "Time is injected at the top of every turn's context (Spanish + ISO local + UTC).",
        checks,
        evidence=[
            "services/agent/arsvox_agent/context.py now_line()/build_context() (read-only reference)",
            "tests/e2e/test_wire_probe.py::test_context_first_line_is_time",
        ],
    )
    print(f"[conversation_time] {verdict}")
    for c in checks:
        print(f"  {'PASS' if c['pass'] else 'FAIL'}  {c['id']}: {c['label']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--record-dir", type=Path, default=Path(__file__).resolve().parent.parent / "evidence")
    args = ap.parse_args()
    raise SystemExit(main(args.record_dir))
