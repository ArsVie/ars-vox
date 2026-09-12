"""Score speech-to-text across a folder of clips.

Each clip is an audio file plus an optional caption file (YouTube auto-caption,
used as a weak reference: it is a second engine, not ground truth).

    python tools/stt_set.py data/baseline --models tiny small dropbox-dash/faster-whisper-large-v3-turbo
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.voice import FasterWhisperSTT  # noqa: E402
from tools.stt_baseline import word_error_rate  # noqa: E402

AUDIO_SUFFIXES = (".m4a", ".wav", ".mp3", ".opus", ".webm")


def vtt_to_text(path: Path) -> str:
    """Turn a YouTube VTT caption file into one plain line of text."""
    lines: list[str] = []
    for block in path.read_text(encoding="utf-8").split("\n\n"):
        for line in block.splitlines():
            if "-->" in line or line.startswith(("WEBVTT", "Kind:", "Language:")):
                continue
            text = re.sub(r"<[^>]+>", "", line).strip()
            if not text or re.fullmatch(r"\d+", text):
                continue
            if lines and (text in lines[-1] or lines[-1].endswith(text)):
                continue
            lines.append(text)
    return " ".join(lines)


def find_caption(audio: Path) -> Path | None:
    for suffix in (".es-orig.vtt", ".es.vtt", ".vtt"):
        candidate = audio.with_suffix(suffix)
        if candidate.is_file():
            return candidate
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", type=Path)
    parser.add_argument("--models", nargs="+", default=["small"])
    parser.add_argument("--language", default="es")
    parser.add_argument("--device", default="cpu", help="cpu | cuda")
    parser.add_argument("--compute-type", default="int8", help="int8 | float16 | int8_float16")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "results")
    args = parser.parse_args(argv)

    clips = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in AUDIO_SUFFIXES)
    if not clips:
        print(f"no audio in {args.folder}", file=sys.stderr)
        return 2

    engines = {
        model: FasterWhisperSTT(
            model_size=model,
            language=args.language,
            device=args.device,
            compute_type=args.compute_type,
        )
        for model in args.models
    }
    for engine in engines.values():
        engine.warmup()

    rows: list[dict] = []
    for clip in clips:
        caption = find_caption(clip)
        reference = vtt_to_text(caption) if caption else None
        entry = {"clip": clip.name, "reference": reference, "results": {}}
        for model, engine in engines.items():
            result = engine.transcribe(clip)
            error = word_error_rate(reference, result.text) if reference else {"wer": None}
            entry["results"][model] = {
                "text": result.text,
                "wer": error.get("wer"),
                "duration_s": round(result.duration_s, 2),
                "elapsed_s": round(result.elapsed_s, 2),
                "real_time_factor": round(result.real_time_factor, 3),
            }
        rows.append(entry)
        print(f"\n{clip.name}  ({entry['results'][args.models[0]]['duration_s']}s)")
        for model in args.models:
            data = entry["results"][model]
            wer = data["wer"] if data["wer"] is not None else "n/a"
            print(f"  {model:<44} WER {wer}  RTF {data['real_time_factor']}")
        loudest = args.models[-1]
        print(f"  transcript[{loudest}]: {entry['results'][loudest]['text'][:400]}")

    scored = {
        model: [r["results"][model]["wer"] for r in rows if r["results"][model]["wer"] is not None]
        for model in args.models
    }
    print("\nsummary across clips")
    print(f"  device {args.device} {args.compute_type}")
    summary = {}
    for model, values in scored.items():
        if not values:
            continue
        summary[model] = {
            "clips": len(values),
            "mean_wer": round(statistics.mean(values), 3),
            "median_wer": round(statistics.median(values), 3),
            "worst_wer": max(values),
            "mean_rtf": round(
                statistics.mean(r["results"][model]["real_time_factor"] for r in rows), 3
            ),
        }
        print(
            f"  {model:<44} clips {len(values):>2}  mean WER {summary[model]['mean_wer']}  "
            f"median {summary[model]['median_wer']}  worst {summary[model]['worst_wer']}  "
            f"RTF {summary[model]['mean_rtf']}"
        )

    out = args.out / "sets"
    out.mkdir(parents=True, exist_ok=True)
    (out / "stt_set.json").write_text(
        json.dumps(
            {
                "settings": {"device": args.device, "compute_type": args.compute_type},
                "clips": rows,
                "summary": summary,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {out / 'stt_set.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
