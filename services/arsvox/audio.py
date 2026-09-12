"""Small audio helpers shared by the CLI and the measurement tools."""

from __future__ import annotations

import wave
from pathlib import Path


def write_wav(path: str | Path, samples, rate: int) -> Path:
    """Write float samples in [-1, 1] as a 16-bit mono wav file."""
    import numpy as np

    out = Path(path)
    pcm = np.clip(samples, -1.0, 1.0)
    with wave.open(str(out), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((pcm * 32767).astype("<i2").tobytes())
    return out
