"""W0 gate harness: score speech-to-text on real audio.

This is the only measurement that decides whether Ars-Vox is worth building.
Give it audio files. Optionally give it a reference transcript. It reports, per
model: transcript, latency, real-time factor, engine confidence, and word error
rate against the reference.

The verdict is printed but never auto-judged: the gate number is for a human.

    python tools/stt_baseline.py clip.m4a --models tiny base small
    python tools/stt_baseline.py clip.m4a --reference ref.txt --models small medium
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.voice import DEFAULT_LANGUAGE, Transcript, FasterWhisperSTT  # noqa: E402

PUNCT = re.compile(r"[^\w\sáéíóúüñ]", re.UNICODE)
DIGIT_WORDS = {
    "0": "cero", "1": "uno", "2": "dos", "3": "tres", "4": "cuatro", "5": "cinco",
    "6": "seis", "7": "siete", "8": "ocho", "9": "nueve", "10": "diez",
    "11": "once", "12": "doce", "13": "trece", "14": "catorce", "15": "quince",
}
GATE_SUCCESS = 24
GATE_UTTERANCES = 30


def normalize(text: str, strip_accents: bool = False) -> list[str]:
    """Lowercase, drop punctuation, collapse whitespace. Words as a list.

    Digits become words and "una" becomes "uno", so that a transcript writing
    "las 3" is not counted as an error against "las tres". Recognition errors
    are what we want to measure, not number formatting.
    """
    text = PUNCT.sub(" ", text.lower())
    if strip_accents:
        text = "".join(
            c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
        )
    words = [DIGIT_WORDS.get(w, w) for w in text.split()]
    return ["uno" if w == "una" else w for w in words]


def _align(reference: list[str], hypothesis: list[str]) -> tuple[int, int, int]:
    """Return (substitutions, deletions, insertions) for the best word alignment."""
    rows, cols = len(reference) + 1, len(hypothesis) + 1
    cost = [[0] * cols for _ in range(rows)]
    ops = [[""] * cols for _ in range(rows)]
    for i in range(rows):
        cost[i][0], ops[i][0] = i, "D"
    for j in range(cols):
        cost[0][j], ops[0][j] = j, "I"
    ops[0][0] = ""
    for i in range(1, rows):
        for j in range(1, cols):
            same = reference[i - 1] == hypothesis[j - 1]
            best_cost, best_op = cost[i - 1][j - 1] + (0 if same else 1), "M" if same else "S"
            if cost[i - 1][j] + 1 < best_cost:
                best_cost, best_op = cost[i - 1][j] + 1, "D"
            if cost[i][j - 1] + 1 < best_cost:
                best_cost, best_op = cost[i][j - 1] + 1, "I"
            cost[i][j], ops[i][j] = best_cost, best_op
    subs = dels = ins = 0
    i, j = len(reference), len(hypothesis)
    while i or j:
        op = ops[i][j]
        if op in ("M", "S"):
            subs += op == "S"
            i -= 1
            j -= 1
        elif op == "D":
            dels += 1
            i -= 1
        else:
            ins += 1
            j -= 1
    return subs, dels, ins


def word_error_rate(reference: str, hypothesis: str) -> dict:
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return {"wer": None, "words": 0}
    subs, dels, ins = _align(ref, hyp)
    ref_loose = normalize(reference, strip_accents=True)
    hyp_loose = normalize(hypothesis, strip_accents=True)
    subs_l, dels_l, ins_l = _align(ref_loose, hyp_loose)
    return {
        "wer": round((subs + dels + ins) / len(ref), 3),
        "wer_ignoring_accents": round((subs_l + dels_l + ins_l) / max(len(ref_loose), 1), 3),
        "words": len(ref),
        "substitutions": subs,
        "deletions": dels,
        "insertions": ins,
    }


def load_reference(value: str | None) -> str | None:
    if not value:
        return None
    candidate = Path(value)
    if candidate.is_file():
        return candidate.read_text(encoding="utf-8").strip()
    return value


def run(audio: Path, model: str, language: str, reference: str | None, beam: int) -> dict:
    import time

    engine = FasterWhisperSTT(model_size=model, beam_size=beam, language=language)
    load_started = time.perf_counter()
    engine.warmup()
    load_s = time.perf_counter() - load_started
    result: Transcript = engine.transcribe(audio, language=language)
    row = {"audio": audio.name, "model": model, **result.as_dict()}
    row["load_and_warmup_s"] = round(load_s, 2)
    if reference:
        row["reference"] = reference
        row["error"] = word_error_rate(reference, result.text)
    return row


def print_row(row: dict) -> None:
    print(f"\n  model      {row['model']}")
    print(f"  language   {row['language']} ({row['language_probability']})")
    print(f"  audio      {row['duration_s']}s    engine time {row['elapsed_s']}s    RTF {row['real_time_factor']}")
    print(f"  confidence mean logprob {row['mean_logprob']}    weak segments {row['weak_segments']}")
    print(f"  load+warm  {row.get('load_and_warmup_s', 'n/a')}s")
    print(f"  text       {row['text']}")
    if "error" in row:
        err = row["error"]
        print(
            f"  WER        {err['wer']}  (accents ignored {err['wer_ignoring_accents']})"
            f"  S{err['substitutions']} D{err['deletions']} I{err['insertions']} of {err['words']} words"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("audio", nargs="+", type=Path)
    parser.add_argument("--models", nargs="+", default=["small"])
    parser.add_argument("--language", default=DEFAULT_LANGUAGE)
    parser.add_argument("--reference", help="reference transcript: file path or literal text")
    parser.add_argument("--beam", type=int, default=5)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "results")
    args = parser.parse_args(argv)

    missing = [a for a in args.audio if not a.is_file()]
    if missing:
        print(f"missing audio: {', '.join(str(m) for m in missing)}", file=sys.stderr)
        return 2

    reference = load_reference(args.reference)
    rows: list[dict] = []
    for audio in args.audio:
        for model in args.models:
            print(f"\n[{audio.name}] model={model}")
            row = run(audio, model, args.language, reference, args.beam)
            print_row(row)
            rows.append(row)

    run_id = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    out_dir = args.out / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "run_id": run_id,
        "language": args.language,
        "reference": reference,
        "rows": rows,
        "gate": {"utterances": GATE_UTTERANCES, "success_threshold": GATE_SUCCESS},
    }
    (out_dir / "baseline.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if reference:
        print("\nsummary (word error rate against the reference)")
        for row in rows:
            print(f"  {row['model']:<16} WER {row['error']['wer']:<6} RTF {row['real_time_factor']}")
    print(f"\nwrote {out_dir / 'baseline.json'}")
    print(
        f"gate: {GATE_SUCCESS} of {GATE_UTTERANCES} real utterances must succeed "
        "(this run is a single-clip sanity check, not the gate)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
