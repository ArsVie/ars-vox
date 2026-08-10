"""GATE-5 W1-CONFORMANCE — probe↔checklist consistency test.

Runs every standalone probe (subprocess, isolated) and enforces the
mapping between probe verdicts and the checklist rows in
docs/vision-conformance.md:

- Rows this lane verified (expected PASS): the probe MUST record PASS.
- Rows owned by other lanes (expected PENDING): any honest verdict is
  accepted — the gate closes the row with the harness evidence.
- Wave-2 browser (expected NOT_YET): the probe must record NOT_YET.

When a W1 lane lands its work, its probe verdict flips to PASS while the
checklist row is still PENDING — the mapping still accepts it, and the
GATE-1 gate (or this lane's next pass) flips the row. When a verified
row's probe starts failing, THIS TEST GOES RED — the harness is the
acceptance artifact, not a demo.

KEEP THE TABLE IN SYNC WITH docs/vision-conformance.md.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

E2E = Path(__file__).resolve().parent
PROBES = E2E / "probes"

# probe id (as recorded in the evidence JSON, matches probe_core.PROBE_IDS)
# -> probe script name (probe_core.PROBE_IDS and file names differ for
# document_editor: the script is doc_shared.py, the recorded id is
# document_editor — the checklist row id).
PROBE_FILES = {
    "conversation_time": "conversation_time",
    "document_reader": "document_reader",
    "document_editor": "doc_shared",
    "tasks": "tasks_cadence",
    "media_local": "local_media_probe",
    "youtube": "youtube_realness",
    "memory": "memory_probe",
    "browser": "browser_notyet",
}

# probe id -> checklist row status (docs/vision-conformance.md)
EXPECTED_STATUS = {
    # L1 — this lane verified DONE (PASS enforced)
    "conversation_time": "PASS",
    # L3 (reader half) — verified by this lane; the probe is the wire part
    "document_reader": "PASS",
    # GATE-1 closed rows (probes + packaged evidence; PASS enforced)
    "document_editor": "PASS",
    "media_local": "PASS",
    "youtube": "PASS",
    "memory": "PASS",
    # W1-TASKS: fire → notification verified; fresh-turn cadence injection
    # STILL MISSING (probe FAIL on fire_triggers_turn) — leaf dispatched
    "tasks": "PENDING",
    # Wave 2 — NOT_YET enforced
    "browser": "NOT_YET",
}

VERDICTS = ("PASS", "FAIL", "NOT_YET")


def _run_probe(record_dir: Path, probe: str) -> dict:
    r = subprocess.run(
        [sys.executable, str(PROBES / f"{PROBE_FILES[probe]}.py"), "--record-dir", str(record_dir)],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if r.returncode != 0:
        return {
            "probe": probe,
            "verdict": "ERROR",
            "summary": f"probe crashed (rc={r.returncode})\nstdout: {r.stdout[-800:]}\nstderr: {r.stderr[-800:]}",
        }
    return json.loads((record_dir / f"{probe}.json").read_text(encoding="utf-8"))


def test_every_probe_records_and_matches_the_checklist(tmp_path):
    record_dir = tmp_path / "evidence"
    record_dir.mkdir()
    results = {probe: _run_probe(record_dir, probe) for probe in EXPECTED_STATUS}

    # every probe ran and produced a verdict (never ERROR)
    for probe, res in results.items():
        assert res["verdict"] in VERDICTS, f"{probe}: probe did not record a verdict: {res['summary']}"

    # the checklist mapping holds
    for probe, expected in EXPECTED_STATUS.items():
        verdict = results[probe]["verdict"]
        if expected == "PASS":
            assert verdict == "PASS", (
                f"[{probe}] checklist row is PASS but the probe records {verdict} — "
                f"evidence regressed: {results[probe]['summary']}"
            )
        elif expected == "NOT_YET":
            assert verdict == "NOT_YET", (
                f"[{probe}] checklist row is NOT_YET (Wave 2) but the probe records {verdict}"
            )
        # PENDING: accept any honest verdict (the gate flips the row)

    # every recorded probe id is a KNOWN checklist row (no orphans)
    recorded_ids = set(results)
    assert recorded_ids == set(EXPECTED_STATUS), (
        f"probe/checklist drift: {recorded_ids ^ set(EXPECTED_STATUS)}"
    )
