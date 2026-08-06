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
