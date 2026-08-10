#!/usr/bin/env python3
"""Physical-mic smoke: record ~4s, run VAD (+ optional wake detector).

The smoke that has never been run — a real microphone, through the real
providers. CI-safe by construction: it never requires a model download
and never crashes without a mic.

Every stage prints an honest verdict:
    [stage] PASS  — ran and produced a verdict
    [stage] FAIL  — ran and errored (exit code 1)
    [stage] SKIP  — could not run, with the reason (exit code 0)

Usage:
    python scripts/voice_mic_smoke.py                      # silero VAD, no wake
    python scripts/voice_mic_smoke.py --vad mock           # hermetic run
    python scripts/voice_mic_smoke.py --wake openwakeword  # + wake scores
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Protocol

REPO_ROOT = Path(__file__).resolve().parents[1]
for _rel in ("services/voice", "packages/contracts"):
    _p = REPO_ROOT / _rel
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from arsvox_voice.providers import (  # noqa: E402 — sys.path first
    MockVad,
    OpenWakeWordDetector,
    SileroVad,
    Vad,
)


class NoInputDeviceError(RuntimeError):
    """The default microphone does not exist on this machine."""


class MicBackend(Protocol):
    """Anything with ``availability()`` + ``record()`` — the test seam."""

    @staticmethod
    def availability() -> tuple[bool, str]: ...

    @staticmethod
    def record(duration_s: float, sample_rate: int) -> bytes: ...


class SoundDeviceBackend:
    """Thin sounddevice wrapper — the injectable seam for tests."""

    @staticmethod
    def availability() -> tuple[bool, str]:
        try:
            import sounddevice as sd  # noqa: PLC0415
        except ImportError as exc:
            return False, f"sounddevice not importable ({exc})"
        try:
            dev = sd.query_devices(kind="input")
        except Exception as exc:  # noqa: BLE001 — honest reason
            return False, f"no input device queryable ({exc})"
        if dev is None:
            return False, "PortAudio reports no default input device"
        return True, f"default input device: {dev.get('name', '?')}"

    @staticmethod
    def record(duration_s: float, sample_rate: int) -> bytes:
        import sounddevice as sd  # noqa: PLC0415
        import numpy as np  # noqa: PLC0415

        data = sd.rec(
            int(duration_s * sample_rate),
            samplerate=sample_rate,
            channels=1,
            dtype="int16",
        )
        sd.wait()
        return np.ascontiguousarray(data).tobytes()


class _StageResult:
    def __init__(self, name: str, status: str, detail: str):
        self.name = name
        self.status = status  # PASS | FAIL | SKIP
        self.detail = detail

    def __str__(self) -> str:
        return f"[{self.name}] {self.status} — {self.detail}"


def _skip(results: list[_StageResult], names: list[str], reason: str) -> None:
    for name in names:
        results.append(_StageResult(name, "SKIP", reason))


def run_smoke(
    args: argparse.Namespace,
    backend: type[MicBackend] = SoundDeviceBackend,
    vad_builder=None,
    wake_builder=None,
) -> int:
    """Run all stages; returns the process exit code (0 unless a FAIL)."""
    results: list[_StageResult] = []

    # ---- mic --------------------------------------------------------- #
    ok, reason = backend.availability()
    if not ok:
        results.append(_StageResult("mic", "SKIP", reason))
        _skip(results, ["record", "vad", "wake"], f"no microphone: {reason}")
        return _finish(results)

    results.append(_StageResult("mic", "PASS", reason))
    sample_rate = args.sample_rate

    # ---- record ------------------------------------------------------ #
    try:
        recording = backend.record(args.duration, sample_rate)
        seconds = len(recording) / (2 * sample_rate)
        results.append(
            _StageResult("record", "PASS", f"captured {seconds:.2f}s ({len(recording)} bytes)")
        )
    except Exception as exc:  # noqa: BLE001 — honest FAIL
        results.append(_StageResult("record", "FAIL", f"recording failed: {exc}"))
        _skip(results, ["vad", "wake"], "no recording to analyze")
        return _finish(results)

    # ---- vad --------------------------------------------------------- #
    try:
        vad: Vad = vad_builder(args) if vad_builder else _default_vad(args)
    except Exception as exc:  # noqa: BLE001
        results.append(_StageResult("vad", "SKIP", f"VAD unavailable: {exc}"))
        _skip(results, ["wake"], "VAD unavailable")
        return _finish(results)

    if isinstance(vad, MockVad):
        note = "mock provider ran (no real detection — pass --vad silero)"
    else:
        note = "silero VAD verdicts computed"
    try:
        _print_vad_verdicts(vad, recording, sample_rate)
        results.append(_StageResult("vad", "PASS", note))
    except Exception as exc:  # noqa: BLE001
        results.append(_StageResult("vad", "FAIL", f"VAD run failed: {exc}"))

    # ---- wake (optional) --------------------------------------------- #
    if args.wake != "openwakeword":
        results.append(
            _StageResult(
                "wake", "SKIP", "wake word disabled (pass --wake openwakeword to enable)"
            )
        )
        return _finish(results)

    try:
        detector: OpenWakeWordDetector = (
            wake_builder(args) if wake_builder else _default_wake(args)
        )
    except Exception as exc:  # noqa: BLE001
        results.append(_StageResult("wake", "SKIP", f"wake detector unavailable: {exc}"))
        return _finish(results)

    try:
        peaks = detector.detect_clip(recording)
        lines = ", ".join(f"{name}={score:.3f}" for name, score in sorted(peaks.items()))
        fired = any(score > detector.threshold for score in peaks.values())
        note = "wake fired in clip" if fired else "no wake in clip (scores informational)"
        results.append(_StageResult("wake", "PASS", f"peak scores: {lines} — {note}"))
    except Exception as exc:  # noqa: BLE001
        results.append(_StageResult("wake", "FAIL", f"wake run failed: {exc}"))

    return _finish(results)


def _default_vad(args: argparse.Namespace) -> Vad:
    if args.vad == "mock":
        return MockVad()
    available, reason = SileroVad.availability()
    if not available:
        raise RuntimeError(reason)
    return SileroVad(model_path=args.vad_model_path)


def _default_wake(args: argparse.Namespace) -> OpenWakeWordDetector:
    available, reason = OpenWakeWordDetector.availability()
    if not available:
        raise RuntimeError(reason)
    return OpenWakeWordDetector(model_name=args.wake_model)


def _print_vad_verdicts(vad: Vad, recording: bytes, sample_rate: int) -> None:
    """Per-chunk speech/silence verdicts, compact: one char per 32 ms
    chunk ('S' = speech, '.' = silence), one line per second."""
    window = SileroVad.WINDOW
    chunks_per_second = sample_rate // window
    verdicts: list[str] = []
    for i in range(0, len(recording) - len(recording) % (window * 2), window * 2):
        verdicts.append("S" if vad.is_speech(recording[i : i + window * 2]) else ".")
    for second in range(0, len(verdicts), chunks_per_second):
        line = "".join(verdicts[second : second + chunks_per_second])
        print(f"  second {second // chunks_per_second}: {line}")
    speech = sum(1 for v in verdicts if v == "S")
    total = len(verdicts)
    print(f"  speech in {speech}/{total} chunks ({speech / max(total, 1):.0%})")


def _finish(results: list[_StageResult]) -> int:
    for row in results:
        print(row)
    failed = any(r.status == "FAIL" for r in results)
    ran = [r for r in results if r.status != "SKIP"]
    print(f"RESULT: {'FAIL' if failed else 'PASS'} ({len(ran)}/{len(results)} stages ran)")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=float, default=4.0, help="seconds to record")
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument(
        "--vad",
        choices=["silero", "mock"],
        default="silero",
        help="VAD provider (mock is hermetic; silero SKIPs honestly when unavailable)",
    )
    parser.add_argument("--vad-model-path", default=None, help="explicit silero_vad.onnx path")
    parser.add_argument(
        "--wake",
        choices=["openwakeword", "mock"],
        default="mock",
        help="wake detector provider (default mock = stage skipped)",
    )
    parser.add_argument("--wake-model", default=None, help="openwakeword model name or .onnx path")
    args = parser.parse_args(argv)
    return run_smoke(args)


if __name__ == "__main__":
    sys.exit(main())
