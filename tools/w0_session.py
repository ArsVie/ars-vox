"""W0 gate session: run the 30-request sheet and record the number.

Two modes:

    # dry run — speak each request with the Windows voice, then recognise it.
    # proves the whole harness without a human and without a microphone.
    python tools/w0_session.py --dry

    # the real gate — the speaker reads each request into the microphone.
    python tools/w0_session.py --mic --seconds 6

A request counts as understood when every key term survives recognition.
The operator can override any verdict: Enter accepts, c marks correct,
i marks incorrect, q ends the session.

Recognition is only part of a turn. The turn budget (median under 3 s) also
contains the model call, which does not exist yet at W0; this session reports
recognition seconds separately and labels them.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.audio import write_wav  # noqa: E402
from services.arsvox.tts import FakeTTS, WindowsTTS  # noqa: E402
from services.arsvox.voice import FasterWhisperSTT  # noqa: E402
from tools.stt_baseline import normalize  # noqa: E402

SHEET = REPO_ROOT / "tools" / "w0_utterances.json"
RATE = 16_000


def load_sheet() -> dict:
    return json.loads(SHEET.read_text(encoding="utf-8"))


def missing_terms(heard: str, key_terms: list[str]) -> list[str]:
    """Key terms that did not survive recognition.

    A term counts as heard when it appears as a word, or - for terms of five
    characters or more - inside a merged token ("volviparaatras" contains
    "atras"). Short terms are not searched inside other words, so "ana" cannot
    match "ganas".
    """
    words = set(normalize(heard, strip_accents=True))
    joined = "".join(normalize(heard, strip_accents=True))
    missing = []
    for term in key_terms:
        if term in words:
            continue
        if len(term) >= 5 and term in joined:
            continue
        missing.append(term)
    return missing


def print_sheet(sheet: dict) -> None:
    print(f"W0 sheet — {len(sheet['utterances'])} requests, gate {sheet['gate']['success_threshold']}"
          f" of {sheet['gate']['utterances']}\n")
    ability = None
    for item in sheet["utterances"]:
        if item["ability"] != ability:
            ability = item["ability"]
            print(f"\n[{ability}]")
        print(f"  {item['id']:>2}. {item['text']}")


def record(seconds: float, input_device: int | None = None) -> tuple:
    import sounddevice as sd

    print(f"     recording {seconds:.0f}s ...", flush=True)
    started = time.perf_counter()
    samples = sd.rec(
        int(seconds * RATE), samplerate=RATE, channels=1, dtype="float32", device=input_device
    )
    sd.wait()
    return samples, time.perf_counter() - started


def probe_mic(input_device: int | None, seconds: float = 3.0) -> int:
    """Record briefly and report the level, so a muted or dead microphone is caught first."""
    import numpy as np

    samples, _ = record(seconds, input_device)
    peak = float(np.abs(samples).max()) if len(samples) else 0.0
    rms = float(np.sqrt((samples**2).mean())) if len(samples) else 0.0
    print(f"peak {peak:.4f}   rms {rms:.5f}")
    if peak < 0.005:
        print("VERDICT: silent — check the microphone choice, mute state, and Windows privacy setting")
        return 1
    print("VERDICT: audio captured")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry", action="store_true", help="speak the sheet, then recognise it")
    parser.add_argument("--mic", action="store_true", help="the real gate: read the sheet aloud")
    parser.add_argument("--probe-mic", action="store_true", help="record 3 s and report the level")
    parser.add_argument("--input-device", type=int, default=None, help="sounddevice input index")
    parser.add_argument("--auto", action="store_true", help="no prompts; score every request automatically")
    parser.add_argument("--reuse", action="store_true", help="dry mode: reuse existing clips instead of speaking again")
    parser.add_argument("--sheet", action="store_true", help="print the printable sheet and exit")
    parser.add_argument("--seconds", type=float, default=6.0)
    parser.add_argument("--model", default=str(REPO_ROOT / ".." / "models" / "whisper" / "large-v3-turbo"))
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--engine", default="windows", choices=["windows", "fake"])
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "results" / "w0")
    args = parser.parse_args(argv)

    sheet = load_sheet()
    if args.probe_mic:
        return probe_mic(args.input_device)
    if args.sheet or not (args.dry or args.mic):
        print_sheet(sheet)
        return 0

    engine = FakeTTS() if args.engine == "fake" else WindowsTTS()
    stt = FasterWhisperSTT(
        model_size=args.model, device=args.device, compute_type=args.compute_type, language="es"
    )
    load = stt.warmup()
    print(f"engine ready in {load:.1f}s ({args.model} on {args.device} {args.compute_type})\n")

    clips = args.out / "clips"
    clips.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []

    for item in sheet["utterances"]:
        audio = clips / f"{item['id']:02d}.wav"
        if args.dry:
            if not (args.reuse and audio.is_file()):
                engine.synthesize(item["text"], audio)
        else:
            print(f"\n{item['id']:>2} [{item['ability']}] READ: {item['text']}")
            if not args.auto:
                input("   press Enter when you are ready, then read the phrase aloud")
            try:
                samples, _ = record(args.seconds, args.input_device)
            except KeyboardInterrupt:
                break
            write_wav(audio, samples, RATE)

        started = time.perf_counter()
        result = stt.transcribe(audio)
        recognition_s = time.perf_counter() - started
        missing = missing_terms(result.text, item["key_terms"])
        auto = "correct" if not missing else "incorrect"

        print(f"\n{item['id']:>2} [{item['ability']}] said: {item['text']}")
        print(f"   heard: {result.text}")
        print(f"   keys missing: {missing or 'none'}   auto: {auto}   recognition {recognition_s:.2f}s")

        verdict = auto
        if args.mic and not args.auto:
            answer = input("   verdict [Enter] accept, c correct, i incorrect, q quit: ").strip().lower()
            if answer == "q":
                rows.append({**item, "heard": result.text, "missing": missing, "auto": auto,
                             "verdict": auto, "recognition_s": round(recognition_s, 2),
                             "aborted_after": True})
                break
            if answer == "c":
                verdict = "correct"
            elif answer == "i":
                verdict = "incorrect"

        rows.append(
            {**item, "heard": result.text, "missing": missing, "auto": auto, "verdict": verdict,
             "recognition_s": round(recognition_s, 2)}
        )

    correct = sum(1 for r in rows if r["verdict"] == "correct")
    total = len(rows)
    by_ability: dict[str, list[bool]] = {}
    for row in rows:
        by_ability.setdefault(row["ability"], []).append(row["verdict"] == "correct")
    recognition = [r["recognition_s"] for r in rows]

    print("\n" + "=" * 60)
    print(f"mode: {'dry (synthetic voice)' if args.dry else 'real microphone'}")
    print(f"understood: {correct} of {total}   gate {sheet['gate']['success_threshold']} of {sheet['gate']['utterances']}")
    for ability, results in by_ability.items():
        print(f"  {ability:<10} {sum(results)}/{len(results)}")
    if recognition:
        print(f"recognition seconds: median {statistics.median(recognition):.2f}, max {max(recognition):.2f}")
    print("recognition is not the whole turn: the model call is not in this number")

    args.out.mkdir(parents=True, exist_ok=True)
    ledger = {
        "ran_at": datetime.now().isoformat(timespec="seconds"),
        "mode": "dry" if args.dry else "microphone",
        "model": args.model,
        "device": args.device,
        "compute_type": args.compute_type,
        "correct": correct,
        "total": total,
        "gate": sheet["gate"],
        "rows": rows,
    }
    path = args.out / f"session-{datetime.now().strftime('%Y-%m-%d-%H%M%S')}.json"
    path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {path}")
    return 0 if correct >= sheet["gate"]["success_threshold"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
