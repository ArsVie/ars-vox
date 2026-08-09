"""GATE-5 W1-CONFORMANCE — probe runner.

Executes every standalone probe and writes its evidence JSON into
--record-dir (default tests/e2e/evidence). Exit code is 0 when every
probe RAN (verdicts are recorded, not enforced — the checklist decides
what a verdict means; test_harness_consistency.py enforces the mapping).

Usage:
    python tests/e2e/probes/run_all_probes.py [--record-dir DIR]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

PROBES = [
    "conversation_time",
    "document_reader",
    "youtube_realness",
    "doc_shared",
    "memory_probe",
    "local_media_probe",
    "tasks_cadence",
    "browser_notyet",
]


def main(record_dir: Path) -> int:
    record_dir = Path(record_dir)
    record_dir.mkdir(parents=True, exist_ok=True)
    probe_dir = Path(__file__).resolve().parent
    failures = []
    for probe in PROBES:
        print(f"== {probe} ==", flush=True)
        r = subprocess.run(
            [sys.executable, str(probe_dir / f"{probe}.py"), "--record-dir", str(record_dir)],
            capture_output=True,
            text=True,
        )
        sys.stdout.write(r.stdout)
        sys.stderr.write(r.stderr)
        if r.returncode != 0:
            failures.append(probe)
    print(f"\n[run_all_probes] {len(PROBES) - len(failures)}/{len(PROBES)} probes ran clean")
    if failures:
        print(f"[run_all_probes] FAILED probes: {failures}")
        return 1
    print(f"[run_all_probes] evidence recorded in {record_dir}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--record-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "evidence",
    )
    args = ap.parse_args()
    raise SystemExit(main(args.record_dir))
