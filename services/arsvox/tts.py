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
import re
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
        # The product voice comes from config.REGISTERS[register]["voice"]; this default is
        # only for callers that do not have settings at hand.
        self.rate = rate

    def synthesize(self, text: str, out_path: str | Path) -> Path:
        import edge_tts

        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        text = speakable(text)  # digits invite Azure's date trap ("de 471" -> "de abril de 71")
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


# ---- the spoken form of numbers ---------------------------------------------
# Azure's Spanish normalizer reads "13 de 471" as a date — "13 de abril de 71"
# (and "13 de 500" as "13 de mayo de 2000"). Spelling every number removes the
# digit pattern the date heuristic needs. The window keeps digits; only the
# voice spells (hear it through the product's own recogniser: tests/test_tts.py
# pins the words).

_UNITS = (
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
    "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis",
    "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós",
    "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
    "veintiocho", "veintinueve",
)
_TENS = ("", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa")
_HUNDREDS = (
    "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
    "seiscientos", "setecientos", "ochocientos", "novecientos",
)


def _spell_under_hundred(n: int) -> str:
    if n < 30:
        return _UNITS[n]
    tens, units = divmod(n, 10)
    return _TENS[tens] if units == 0 else f"{_TENS[tens]} y {_UNITS[units]}"


def _spell_under_thousand(n: int) -> str:
    if n < 100:
        return _spell_under_hundred(n)
    if n == 100:
        return "cien"
    hundreds, rest = divmod(n, 100)
    head = _HUNDREDS[hundreds]
    return head if rest == 0 else f"{head} {_spell_under_hundred(rest)}"


def _apocope(word: str) -> str:
    if word.endswith("veintiuno"):
        return word[: -len("veintiuno")] + "veintiún"
    if word.endswith("uno"):
        return word[:-3] + "un"
    return word


def _spell(n: int) -> str:
    if n < 1000:
        return _spell_under_thousand(n)
    if n < 1_000_000:
        thousands, rest = divmod(n, 1000)
        head = "mil" if thousands == 1 else f"{_apocope(_spell(thousands))} mil"
        return head if rest == 0 else f"{head} {_spell(rest)}"
    millions, rest = divmod(n, 1_000_000)
    head = "un millón" if millions == 1 else f"{_spell(millions)} millones"
    return head if rest == 0 else f"{head} {_spell(rest)}"


def speakable(text: str) -> str:
    """The same sentence with its numbers spelled: no digit run for Azure to date-ify."""

    def replace(match: re.Match) -> str:
        run = match.group(0)
        start, end = match.span()
        before = text[start - 1] if start else ""
        after = text[end] if end < len(text) else ""
        after_next = text[end + 1] if end + 1 < len(text) else ""
        before_prev = text[start - 2] if start >= 2 else ""
        if after in ",." and after_next.isdigit():
            return run  # 17,20 — a decimal keeps its digits
        if before in ",." and before_prev.isdigit():
            return run  # the tail of 17,20 or the 500 of 1.500
        if len(run) > 9:
            return run  # ids and codes are not read as words
        return _spell(int(run))

    return re.sub(r"\d+", replace, text)
