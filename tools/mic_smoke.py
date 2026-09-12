"""Smoke-test the silence-terminated recorder without asking for speech."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.audio import write_wav  # noqa: E402
from services.arsvox.mic import record_until_silence  # noqa: E402

capture = record_until_silence(max_seconds=2.0)
print(
    f"captured {capture.seconds:.2f}s  speech {capture.speech_seconds:.2f}s  "
    f"peak {capture.peak:.4f}  has_speech {capture.has_speech}"
)
if len(capture.samples):
    out = REPO_ROOT / "results" / "selftest" / "mic_smoke.wav"
    write_wav(out, capture.samples, 16_000)
    print("wrote", out)
