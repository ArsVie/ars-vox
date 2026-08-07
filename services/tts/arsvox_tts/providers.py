"""TTS provider interface and implementations.

Provider selection comes from ``config.tts.provider``. Spanish baseline
for the first user iteration is Piper or Edge; KittenTTS 0.8 stays an
optional English/experimental provider behind the same interface (see
docs/decisions/ADR-0004-voice-tts-stubs.md).
"""

import asyncio
import logging
import shutil
import subprocess
from abc import ABC, abstractmethod

from arsvox_contracts import AppConfig

log = logging.getLogger(__name__)

#: Spanish voice used when config.tts.es_voice is not set (Edge provider).
DEFAULT_EDGE_VOICE = "es-MX-DaliaNeural"


class TTSProvider(ABC):
    name: str = "abstract"
    media_type: str = "application/octet-stream"

    @abstractmethod
    async def synthesize(self, text: str, voice: str | None = None) -> bytes | None:
        """Return encoded audio bytes (wav/mp3) or None when not available."""
        ...

    def cancel(self) -> None:
        """Cancel any in-flight synthesis (used by the stop path)."""


class MockTTS(TTSProvider):
    """Logs intent, returns no audio. Default provider for iteration 1."""

    name = "mock"

    async def synthesize(self, text: str, voice: str | None = None) -> bytes | None:
        log.info("tts[mock] would speak: %s", text[:120])
        return None


class EdgeTTS(TTSProvider):
    """Microsoft Edge neural voices (free, no key). Spanish voices available."""

    name = "edge"
    media_type = "audio/mpeg"

    def __init__(self, voice: str | None = None):
        self.default_voice = voice or DEFAULT_EDGE_VOICE

    async def synthesize(self, text: str, voice: str | None = None) -> bytes | None:
        try:
            import edge_tts
        except ImportError:
            log.warning("edge-tts not installed; pip install 'arsvox-tts[edge]'")
            return None
        communicate = edge_tts.Communicate(text, voice or self.default_voice)
        chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks) or None


class PiperTTS(TTSProvider):
    """Piper (low-latency local Spanish baseline). Needs the piper binary.

    Configure through env: ARSVOX_PIPER_BIN and ARSVOX_PIPER_VOICE, or
    pass paths at construction.
    """

    name = "piper"
    media_type = "audio/wav"

    def __init__(self, binary: str | None = None, voice: str | None = None):
        self.binary = binary or shutil.which("piper") or ""
        self.default_voice = voice or ""

    async def synthesize(self, text: str, voice: str | None = None) -> bytes | None:
        if not self.binary or not (voice or self.default_voice):
            log.warning(
                "piper not configured (binary=%r voice=%r); install piper and set"
                " ARSVOX_PIPER_BIN / ARSVOX_PIPER_VOICE",
                self.binary,
                self.default_voice,
            )
            return None
        cmd = [
            self.binary,
            "--model",
            voice or self.default_voice,
            "--output-raw",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate(text.encode("utf-8"))
        if proc.returncode != 0 or not out:
            log.warning("piper failed rc=%s", proc.returncode)
            return None
        return out


class KittenTTS(TTSProvider):
    """Optional provider. KittenTTS 0.8 is English-focused; multilingual is
    on its roadmap, so it is NOT the Spanish default. Reuses the wheel and
    voice conventions from the Hermes stack when installed."""

    name = "kittentts"

    async def synthesize(self, text: str, voice: str | None = None) -> bytes | None:
        log.warning("kittentts provider not wired in iteration 1 (see ADR-0004)")
        return None


def build_tts(config: AppConfig) -> TTSProvider:
    provider = config.tts.provider
    if provider == "edge":
        return EdgeTTS(config.tts.es_voice)
    if provider == "piper":
        return PiperTTS(voice=config.tts.es_voice)
    if provider == "kittentts":
        return KittenTTS()
    return MockTTS()
