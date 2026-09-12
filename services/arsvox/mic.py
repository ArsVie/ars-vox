"""Microphone capture for Ars-Vox.

Records until the speaker stops talking, instead of for a fixed window. A fixed
window cuts an unhurried speaker mid-sentence, which looks like a recognition
failure when it is a recording failure.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

RATE = 16_000
BLOCK = 1024
ENERGY_FLOOR = 0.004


@dataclass(slots=True)
class Capture:
    samples: np.ndarray
    seconds: float
    speech_seconds: float
    peak: float

    @property
    def has_speech(self) -> bool:
        return self.speech_seconds >= 0.4


def normalize_gain(samples: np.ndarray, target_peak: float = 0.7) -> np.ndarray:
    """Lift a quiet recording to a level the recogniser expects."""
    peak = float(np.abs(samples).max()) if len(samples) else 0.0
    if peak < 0.01:
        return samples
    return np.clip(samples * (target_peak / peak), -1.0, 1.0)


def record_until_silence(
    max_seconds: float = 15.0,
    silence_seconds: float = 1.2,
    device: int | None = None,
    rate: int = RATE,
    on_block=None,
) -> Capture:
    """Record one request. Stop after `silence_seconds` of quiet following speech."""
    import sounddevice as sd

    blocks: list[np.ndarray] = []
    total = 0.0
    speech = 0.0
    quiet_run = 0.0
    noise_floor = 0.0
    with sd.InputStream(
        samplerate=rate, channels=1, dtype="float32", blocksize=BLOCK, device=device
    ) as stream:
        while total < max_seconds:
            data, _ = stream.read(BLOCK)
            block = data[:, 0].astype("float32").copy()
            seconds = len(block) / rate
            level = float(np.sqrt(float((block**2).mean())))
            if total < 0.3:
                noise_floor = max(noise_floor, level)
            threshold = max(ENERGY_FLOOR, noise_floor * 3.0)
            blocks.append(block)
            total += seconds
            if level > threshold:
                speech += seconds
                quiet_run = 0.0
            else:
                quiet_run += seconds
            if on_block:
                on_block(level)
            if speech >= 0.3 and quiet_run >= silence_seconds:
                break

    samples = np.concatenate(blocks) if blocks else np.zeros(0, dtype="float32")
    peak = float(np.abs(samples).max()) if len(samples) else 0.0
    return Capture(samples=samples, seconds=total, speech_seconds=speech, peak=peak)
