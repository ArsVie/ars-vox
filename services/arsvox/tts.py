"""Text-to-speech for Ars-Vox.

Real providers only, plus one test seam. The assistant must be audible offline,
so the Windows system voice is a first-class provider, not a fallback curiosity.
"""

from __future__ import annotations

import asyncio
import base64
import subprocess
import sys
from pathlib import Path
from typing import Protocol

DEFAULT_LANGUAGE = "es"
DEFAULT_EDGE_VOICE = "es-MX-DaliaNeural"


class TTSProvider(Protocol):
    name: str

    def synthesize(self, text: str, out_path: str | Path) -> Path: ...


class EdgeTTS:
    """Microsoft Edge voices. Needs network. Sounds best of the three."""

    name = "edge-tts"

    def __init__(self, voice: str = DEFAULT_EDGE_VOICE, rate: str = "+0%") -> None:
        self.voice = voice
        self.rate = rate

    def synthesize(self, text: str, out_path: str | Path) -> Path:
        import edge_tts

        out = Path(out_path)

        async def _run() -> None:
            await edge_tts.Communicate(text, self.voice, rate=self.rate).save(str(out))

        asyncio.run(_run())
        return out


class WindowsTTS:
    """Offline Spanish voice through the Windows speech stack. No network.

    Runs on Windows directly, and from WSL through powershell.exe interop.
    The script is sent as an encoded command, so accents survive the trip.
    """

    name = "windows-sapi"

    def __init__(self, voice_hint: str = "es", rate: int = -2) -> None:
        self.voice_hint = voice_hint
        self.rate = rate

    def synthesize(self, text: str, out_path: str | Path) -> Path:
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            exe, win_out = "powershell", str(out.resolve())
        else:
            exe, win_out = "powershell.exe", _to_windows_path(out)
        literal = text.replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$v = $s.GetInstalledVoices() | Where-Object "
            f"{{ $_.VoiceInfo.Culture.Name -like '{self.voice_hint}*' }} | Select-Object -First 1; "
            "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; "
            f"$s.Rate = {self.rate}; "
            f"$s.SetOutputToWaveFile('{win_out}'); "
            f"$s.Speak('{literal}'); $s.Dispose()"
        )
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        proc = subprocess.run(
            [exe, "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
            capture_output=True,
        )
        if proc.returncode != 0 or not out.exists():
            detail = proc.stderr.decode(errors="replace")[:400] or proc.stdout.decode(errors="replace")[:400]
            raise RuntimeError(f"windows tts failed: {detail}")
        return out


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


def _to_windows_path(path: Path) -> str:
    resolved = str(Path(path).resolve())
    if resolved.startswith("/mnt/") and len(resolved) > 7:
        drive = resolved[5].upper()
        return f"{drive}:{resolved[6:]}".replace("/", "\\")
    return resolved
