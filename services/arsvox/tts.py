"""Text-to-speech for Ars-Vox.

One real provider and one test seam. The Windows system voice (System.Speech /
SAPI) is banned: it was tested on the real machine and rejected by ear. Do not
add it back, in any form, including as a fallback.

Offline capability is still an open item: the chosen voice needs network. See
docs/status.md.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Protocol

DEFAULT_LANGUAGE = "es"
DEFAULT_EDGE_VOICE = "es-MX-DaliaNeural"


class TTSProvider(Protocol):
    name: str

    def synthesize(self, text: str, out_path: str | Path) -> Path: ...


class EdgeTTS:
    """Microsoft neural voices. The chosen voice of the product. Needs network."""

    name = "edge-tts"

    def __init__(self, voice: str | None = None, rate: str = "-4%") -> None:
        self.voice = voice or os.environ.get("ARSVOX_VOICE", DEFAULT_EDGE_VOICE)
        self.rate = rate

    def synthesize(self, text: str, out_path: str | Path) -> Path:
        import edge_tts

        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        wants_wav = out.suffix.lower() == ".wav"
        target = out.with_suffix(".mp3") if wants_wav else out

        async def _run() -> None:
            await edge_tts.Communicate(text, self.voice, rate=self.rate).save(str(target))

        asyncio.run(_run())
        if not wants_wav:
            return target
        return _mp3_to_wav(target, out)


class FakeTTS:
    """Test seam only. Records what would have been spoken."""

    name = "fake"

    def __init__(self) -> None:
        self.spoken: list[str] = []

    def synthesize(self, text: str, out_path: str | Path) -> Path:
        self.spoken.append(text)
        out = Path(out_path)
        out.with_suffix(".txt").write_text(text, encoding="utf-8")
        return out


def _mp3_to_wav(source: Path, target: Path) -> Path:
    """edge-tts returns mp3. The players here take wav, so convert with ffmpeg."""
    import subprocess

    proc = subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
            "-ar", "22050", "-ac", "1", "-c:a", "pcm_s16le", str(target),
        ],
        capture_output=True,
    )
    if proc.returncode != 0 or not target.exists():
        detail = proc.stderr.decode(errors="replace")[:200]
        raise RuntimeError(f"no pude convertir el audio a wav: {detail}")
    source.unlink(missing_ok=True)
    return target
