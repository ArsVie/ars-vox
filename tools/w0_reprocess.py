"""Re-process the recorded microphone session offline. No new recording.

The session's audio was quiet and padded with silence. This runs the same 30
clips through the recogniser three ways and scores all three with the tolerant
matcher, so the session yields the best number it can:

  A raw          exactly as recorded
  B normalised   lifted to peak 0.7
  C trimmed      leading and trailing silence removed, then normalised

    python tools/w0_reprocess.py
    python tools/w0_reprocess.py --model small --device cpu --compute-type int8
"""

from __future__ import annotations

import argparse
import glob
import json
import statistics
import sys
import time
import wave
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.mic import normalize_gain  # noqa: E402
from services.arsvox.voice import FasterWhisperSTT  # noqa: E402
from tools.w0_session import load_sheet, missing_terms  # noqa: E402

VARIANTS = ("raw", "normalised", "trimmed")


def read_wav(path: Path, rate: int = 16_000) -> np.ndarray:
    with wave.open(str(path)) as handle:
        assert handle.getframerate() == rate, f"{path} is not {rate} Hz"
        raw = handle.readframes(handle.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def trim_silence(samples: np.ndarray, rate: int = 16_000, pad: float = 0.2) -> np.ndarray:
    frame = max(int(0.02 * rate), 1)
    levels = np.array(
        [
            float(np.sqrt(float((samples[i : i + frame] ** 2).mean())))
            for i in range(0, max(len(samples) - frame, 1), frame)
        ]
        or [0.0]
    )
    if not len(levels) or levels.max() <= 0:
        return samples
    threshold = max(float(levels.max()) * 0.10, 0.002)
    voiced = np.where(levels > threshold)[0]
    if not len(voiced):
        return samples
    start = max(int(voiced[0] * 0.02 - pad) * rate, 0)
    end = min(int((voiced[-1] * 0.02 + pad + 0.02) * rate), len(samples))
    return samples[start:end]


def build_variants(samples: np.ndarray) -> dict[str, np.ndarray]:
    return {
        "raw": samples,
        "normalised": normalize_gain(samples),
        "trimmed": normalize_gain(trim_silence(samples)),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--session", default=None, help="ledger to process (default: newest)")
    parser.add_argument("--model", default="dropbox-dash/faster-whisper-large-v3-turbo")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "results" / "w0-reprocess")
    args = parser.parse_args(argv)

    ledgers = sorted(glob.glob(str(REPO_ROOT / "results" / "w0-mic" / "session-*.json")))
    if not ledgers:
        print("no session ledger found", file=sys.stderr)
        return 2
    ledger_path = Path(args.session) if args.session else Path(ledgers[-1])
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    clips = ledger_path.parent / "clips"

    sheet = {item["id"]: item for item in load_sheet()["utterances"]}
    stt = FasterWhisperSTT(
        model_size=args.model, device=args.device, compute_type=args.compute_type, language="es"
    )
    print(f"engine {args.model} on {args.device} {args.compute_type}; warming up ...", flush=True)
    print(f"warmup {stt.warmup():.1f}s", flush=True)

    rows = []
    for row in ledger["rows"]:
        clip = clips / f"{row['id']:02d}.wav"
        if not clip.is_file():
            continue
        item = sheet[row["id"]]
        samples = read_wav(clip)
        entry = {"id": row["id"], "ability": item["ability"], "said": item["text"],
                 "key_terms": item["key_terms"], "recorded_heard": row["heard"], "variants": {}}
        for name, audio in build_variants(samples).items():
            started = time.perf_counter()
            result = stt.transcribe(audio if len(audio) else samples)
            elapsed = time.perf_counter() - started
            missing = missing_terms(result.text, item["key_terms"])
            entry["variants"][name] = {
                "heard": result.text,
                "missing": missing,
                "ok": not missing,
                "seconds": round(elapsed, 2),
                "audio_seconds": round(len(audio) / 16_000, 2),
                "real_time_factor": round(elapsed / max(len(audio) / 16_000, 0.01), 3),
            }
        rows.append(entry)
        flags = " ".join(f"{n}={'ok' if entry['variants'][n]['ok'] else 'X'}" for n in VARIANTS)
        print(f"{row['id']:>2} [{item['ability']:<9}] {flags}")
        print(f"     heard[{VARIANTS[-1]}]: {entry['variants'][VARIANTS[-1]]['heard']}")

    summary = {}
    for name in VARIANTS:
        oks = [r["variants"][name]["ok"] for r in rows]
        scores = [v["variants"][name]["seconds"] for v in rows]
        summary[name] = {
            "understood": sum(oks),
            "of": len(rows),
            "median_seconds": round(statistics.median(scores), 2) if scores else 0.0,
        }
    recovered = [
        r["id"]
        for r in rows
        if missing_terms(r["recorded_heard"], r["key_terms"])
        and any(r["variants"][name]["ok"] for name in VARIANTS)
    ]

    print("\n=== score by variant (same audio, no new recording) ===")
    for name, data in summary.items():
        print(f"  {name:<11} {data['understood']} of {data['of']}   median {data['median_seconds']}s")
    for name in VARIANTS:
        missed = [r["id"] for r in rows if not r["variants"][name]["ok"]]
        print(f"  {name:<11} still missed: {missed}")

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "reprocess.json").write_text(
        json.dumps({"session": ledger_path.name, "summary": summary, "recovered": recovered,
                    "rows": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nwrote {args.out / 'reprocess.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
