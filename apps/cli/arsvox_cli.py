"""Headless driver for Ars-Vox. This is the primary development surface.

Everything about the voice loop is tested here, without Electron.

    python apps/cli/arsvox_cli.py transcribe clip.m4a --model small
    python apps/cli/arsvox_cli.py say "Hola, soy Ars Vox." --engine windows
    python apps/cli/arsvox_cli.py roundtrip "Ponme un video de los Beatles"
    python apps/cli/arsvox_cli.py listen --seconds 5        # needs a real microphone
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.tts import EdgeTTS, FakeTTS, WindowsTTS  # noqa: E402
from services.arsvox.voice import DEFAULT_LANGUAGE, FasterWhisperSTT  # noqa: E402
from tools.stt_baseline import word_error_rate  # noqa: E402

WORK_DIR = REPO_ROOT / "results" / "cli"


def build_tts(engine: str):
    if engine == "edge":
        return EdgeTTS()
    if engine == "windows":
        return WindowsTTS()
    return FakeTTS()


def cmd_transcribe(args: argparse.Namespace) -> int:
    engine = FasterWhisperSTT(model_size=args.model)
    result = engine.transcribe(args.audio, language=args.language)
    if args.json:
        print(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
    else:
        print(result.text)
        print(
            f"-- {result.duration_s}s audio, {result.elapsed_s}s engine, "
            f"RTF {result.real_time_factor:.2f}, mean logprob {result.mean_logprob:.2f}",
            file=sys.stderr,
        )
    return 0


def cmd_say(args: argparse.Namespace) -> int:
    out = args.out or WORK_DIR / "say.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    path = build_tts(args.engine).synthesize(args.text, out)
    print(path)
    return 0


def cmd_roundtrip(args: argparse.Namespace) -> int:
    """Speak text out loud, listen to it again, compare. The cheapest self-test."""
    audio = WORK_DIR / f"roundtrip-{int(time.time())}.wav"
    audio.parent.mkdir(parents=True, exist_ok=True)
    build_tts(args.engine).synthesize(args.text, audio)
    result = FasterWhisperSTT(model_size=args.model).transcribe(audio)
    error = word_error_rate(args.text, result.text)
    print(f"spoken    {args.text}")
    print(f"heard     {result.text}")
    print(f"WER       {error['wer']}   ({result.elapsed_s}s engine, RTF {result.real_time_factor:.2f})")
    return 0


def cmd_listen(args: argparse.Namespace) -> int:
    """Capture from the real microphone. Runs on the Windows machine, not in WSL."""
    try:
        import sounddevice  # noqa: F401
    except ImportError:
        print("sounddevice is not installed: capture needs the service venv", file=sys.stderr)
        return 2
    import numpy as np
    import sounddevice as sd

    rate = 16_000
    print(f"recording {args.seconds}s ...", file=sys.stderr)
    audio = sd.rec(int(args.seconds * rate), samplerate=rate, channels=1, dtype="float32")
    sd.wait()
    out = WORK_DIR / f"mic-{int(time.time())}.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    _write_wav(out, audio, rate)
    result = FasterWhisperSTT(model_size=args.model).transcribe(out)
    print(result.text)
    return 0


def _write_wav(path: Path, samples, rate: int) -> None:
    import wave

    import numpy as np

    pcm = np.clip(samples, -1.0, 1.0)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((pcm * 32767).astype("<i2").tobytes())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ars-Vox headless driver")
    sub = parser.add_subparsers(dest="command", required=True)

    transcribe = sub.add_parser("transcribe", help="transcribe one audio file")
    transcribe.add_argument("audio", type=Path)
    transcribe.add_argument("--model", default="small")
    transcribe.add_argument("--language", default=DEFAULT_LANGUAGE)
    transcribe.add_argument("--json", action="store_true")
    transcribe.set_defaults(func=cmd_transcribe)

    say = sub.add_parser("say", help="speak text to a wav file")
    say.add_argument("text")
    say.add_argument("--engine", default="windows", choices=["edge", "windows", "fake"])
    say.add_argument("--out", type=Path)
    say.set_defaults(func=cmd_say)

    roundtrip = sub.add_parser("roundtrip", help="speak then listen, and compare")
    roundtrip.add_argument("text")
    roundtrip.add_argument("--engine", default="windows", choices=["edge", "windows", "fake"])
    roundtrip.add_argument("--model", default="small")
    roundtrip.set_defaults(func=cmd_roundtrip)

    listen = sub.add_parser("listen", help="capture from the microphone and transcribe")
    listen.add_argument("--seconds", type=float, default=5.0)
    listen.add_argument("--model", default="small")
    listen.set_defaults(func=cmd_listen)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
