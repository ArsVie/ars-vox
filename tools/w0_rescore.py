"""Re-score a saved session ledger with the current matcher, and flag cut recordings.

No new audio is recorded. This turns a session into a fairer number without
asking the speaker to repeat anything, and marks the samples that a fixed
recording window cut short (those are invalid samples, not recognition errors).

    python tools/w0_rescore.py                       # newest microphone session
    python tools/w0_rescore.py results/w0-mic/session-....json
"""

from __future__ import annotations

import glob
import json
import sys
import wave
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tools.w0_session import missing_terms  # noqa: E402


def voiced_end_seconds(path: Path) -> tuple[float, float]:
    """Return (duration, last moment with speech energy)."""
    with wave.open(str(path)) as handle:
        rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())
    audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    duration = len(audio) / rate
    frame = max(int(0.05 * rate), 1)
    levels = np.array(
        [
            float(np.sqrt(float((audio[i : i + frame] ** 2).mean())))
            for i in range(0, max(len(audio) - frame, 1), frame)
        ]
        or [0.0]
    )
    if not len(levels):
        return duration, 0.0
    threshold = max(float(levels.max()) * 0.08, 0.002)
    voiced = np.where(levels > threshold)[0]
    return duration, float(voiced[-1]) * 0.05 if len(voiced) else 0.0


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    ledgers = argv or sorted(glob.glob(str(REPO_ROOT / "results" / "w0-mic" / "session-*.json")))
    if not ledgers:
        print("no ledger found", file=sys.stderr)
        return 2
    ledger_path = Path(ledgers[-1])
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    clips = ledger_path.parent / "clips"

    strict = correct = invalid = 0
    failures: list[dict] = []
    for row in ledger["rows"]:
        if row["verdict"] == "no_speech":
            invalid += 1
            continue
        strict += row["verdict"] == "correct"
        cut = False
        clip = clips / f"{row['id']:02d}.wav"
        if clip.is_file():
            duration, end = voiced_end_seconds(clip)
            cut = duration - end < 0.35 and end > 0.5
        missing = missing_terms(row["heard"], row["key_terms"])
        operator_corrected = row.get("verdict") == "correct" and row.get("auto") == "incorrect"
        verdict = "correct" if (not missing or operator_corrected) else "incorrect"
        if cut and verdict == "incorrect":
            invalid += 1
        elif verdict == "correct":
            correct += 1
        else:
            failures.append({**row, "missing_now": missing, "cut": cut})

    total = len(ledger["rows"])
    print(f"ledger {ledger_path.name}   ({ledger.get('power', {}).get('source', '?')} power)")
    print(f"strict score as recorded:      {strict} of {total}")
    print(f"fair score, tolerant matching: {correct} of {total}")
    print(f"invalid samples:               {invalid} (cut recording window or no speech)")
    print(f"real failures:                 {len(failures)}")
    for row in failures:
        print(f"\n  {row['id']:>2} [{row['ability']}] said: {row['text']}")
        print(f"      heard: {row['heard']}")
        print(f"      still missing: {row['missing_now']}{' (cut)' if row['cut'] else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
