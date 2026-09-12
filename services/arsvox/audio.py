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


def play_wav(path: str | Path) -> bool:
    """Play a wav file out loud. Windows only, which is where the product lives."""
    import sys

    out = Path(path)
    if not out.is_file():
        return False
    if sys.platform == "win32":
        import winsound

        winsound.PlaySound(str(out), winsound.SND_FILENAME)
        return True
    import subprocess

    win_path = str(out.resolve())
    if win_path.startswith("/mnt/") and len(win_path) > 7:
        win_path = f"{win_path[5].upper()}:{win_path[6:]}".replace("/", "\\")
    proc = subprocess.run(
        ["powershell.exe", "-NoProfile", "-Command", f"(New-Object Media.SoundPlayer '{win_path}').PlaySync()"],
        capture_output=True,
    )
    return proc.returncode == 0
