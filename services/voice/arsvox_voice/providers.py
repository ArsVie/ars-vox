"""Audio provider interfaces and iteration-1 mock implementations."""

from abc import ABC, abstractmethod
from typing import Awaitable, Callable


class WakeWordDetector(ABC):
    """Streams the microphone and calls ``on_wake`` when the wake word fires."""

    @abstractmethod
    async def start(self, on_wake: Callable[[], Awaitable[None]]) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...


class MockWakeWordDetector(WakeWordDetector):
    """No-op detector; wake is simulated (e.g. by the UI connect)."""

    async def start(self, on_wake: Callable[[], Awaitable[None]]) -> None:
        return None

    async def stop(self) -> None:
        return None


class Vad(ABC):
    """Voice activity detection over raw audio chunks."""

    @abstractmethod
    def is_speech(self, audio_chunk: bytes) -> bool: ...


class MockVad(Vad):
    def is_speech(self, audio_chunk: bytes) -> bool:
        return False


class SpeechToText(ABC):
    """Local speech-to-text (faster-whisper behind this interface)."""

    @abstractmethod
    async def transcribe(self, audio_path: str, language: str | None = None) -> str: ...


class MockSpeechToText(SpeechToText):
    async def transcribe(self, audio_path: str, language: str | None = None) -> str:
        return ""


class FasterWhisperSTT(SpeechToText):
    """faster-whisper (CTranslate2) local transcription.

    Model loads lazily on first call; transcribe runs in a worker thread
    so the event loop never blocks. int8 compute keeps CPU usage sane on
    the target (2014 Intel) hardware class.
    """

    name = "faster-whisper"

    def __init__(self, model_size: str = "tiny", device: str = "cpu"):
        self.model_size = model_size
        self.device = device
        self._model = None

    def _ensure_model(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_size, device=self.device, compute_type="int8"
            )
        return self._model

    async def transcribe(self, audio_path: str, language: str | None = None) -> str:
        import asyncio

        model = await asyncio.to_thread(self._ensure_model)
        segments, _ = await asyncio.to_thread(
            model.transcribe, audio_path, language=language
        )
        parts = [seg.text.strip() for seg in segments if seg.text.strip()]
        return " ".join(parts)


def build_stt(config) -> SpeechToText:
    """Build the STT provider from ``config.voice.stt``."""
    provider = getattr(config.voice.stt, "provider", "mock")
    model_size = getattr(config.voice.stt, "model", "tiny") or "tiny"
    if provider == "faster-whisper":
        return FasterWhisperSTT(model_size=model_size)
    return MockSpeechToText()
