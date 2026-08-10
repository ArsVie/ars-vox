"""Ars-Vox voice gateway.

Iteration 1 keeps the pipeline contract real and the audio providers
stubbed: openWakeWord, Silero VAD, and faster-whisper plug in behind
these interfaces without touching the agent runtime.
"""

from arsvox_voice.pipeline import VoicePipeline
from arsvox_voice.providers import (
    MockSpeechToText,
    MockVad,
    MockWakeWordDetector,
    OpenWakeWordDetector,
    SileroVad,
    SpeechToText,
    Vad,
    WakeWordDetector,
    build_stt,
    build_vad,
    build_wake_word_detector,
)

__all__ = [
    "MockSpeechToText",
    "MockVad",
    "MockWakeWordDetector",
    "OpenWakeWordDetector",
    "SileroVad",
    "SpeechToText",
    "Vad",
    "VoicePipeline",
    "WakeWordDetector",
    "build_stt",
    "build_vad",
    "build_wake_word_detector",
]
