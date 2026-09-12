"""Speech-to-text for Ars-Vox.

Real engine: faster-whisper (CTranslate2). VAD: silero, bundled inside
faster_whisper's own assets, so no extra dependency.

One fake seam exists: `FakeSpeechToText` reads text from a file. It exists so the
runtime and the tests can run without the engine. It never contains product
content.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

DEFAULT_LANGUAGE = "es"
LOW_CONFIDENCE_LOGPROB = -1.0
NO_SPEECH_PROB = 0.6


@dataclass(slots=True)
class Transcript:
    """Result of one transcription, with the numbers we need to judge it."""

    text: str
    language: str
    language_probability: float
    duration_s: float
    elapsed_s: float
    segments: list[dict] = field(default_factory=list)

    @property
    def real_time_factor(self) -> float:
        return self.elapsed_s / self.duration_s if self.duration_s else 0.0

    @property
    def mean_logprob(self) -> float:
        if not self.segments:
            return 0.0
        return sum(s["avg_logprob"] for s in self.segments) / len(self.segments)

    @property
    def weak_segments(self) -> list[dict]:
        """Segments the engine itself doubts. These are what the user will notice."""
        return [
            s
            for s in self.segments
            if s["avg_logprob"] < LOW_CONFIDENCE_LOGPROB
            or s["no_speech_prob"] > NO_SPEECH_PROB
        ]

    def as_dict(self) -> dict:
        return {
            "text": self.text,
            "language": self.language,
            "language_probability": round(self.language_probability, 3),
            "duration_s": round(self.duration_s, 2),
            "elapsed_s": round(self.elapsed_s, 2),
            "real_time_factor": round(self.real_time_factor, 3),
            "mean_logprob": round(self.mean_logprob, 3),
            "weak_segments": len(self.weak_segments),
            "segments": self.segments,
        }


class SpeechToText(Protocol):
    name: str

    def transcribe(self, audio_path: str | Path, language: str | None = None) -> Transcript: ...


class FasterWhisperSTT:
    """The real engine. Models are loaded lazily and cached per instance."""

    def __init__(
        self,
        model_size: str = "small",
        device: str = "cpu",
        compute_type: str = "int8",
        beam_size: int = 5,
        use_vad: bool = True,
        min_silence_ms: int = 500,
        language: str = DEFAULT_LANGUAGE,
    ) -> None:
        self.name = f"faster-whisper:{model_size}"
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.beam_size = beam_size
        self.use_vad = use_vad
        self.min_silence_ms = min_silence_ms
        self.language = language
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_size, device=self.device, compute_type=self.compute_type
            )
        return self._model

    def warmup(self) -> float:
        """Pay the first-inference cost now, not on the user's first request.

        One second of silence. A cold process adds several seconds to the first
        real turn, which would otherwise look like engine slowness.
        """
        import numpy as np

        model = self._load()
        started = time.perf_counter()
        segments, _ = model.transcribe(np.zeros(16_000, dtype="float32"), language=self.language)
        list(segments)
        return time.perf_counter() - started


    def transcribe(self, audio_path: str | Path, language: str | None = None) -> Transcript:
        model = self._load()
        started = time.perf_counter()
        segments, info = model.transcribe(
            str(audio_path),
            language=language or DEFAULT_LANGUAGE,
            beam_size=self.beam_size,
            vad_filter=self.use_vad,
            vad_parameters={"min_silence_duration_ms": self.min_silence_ms},
            condition_on_previous_text=False,
        )
        rows = [
            {
                "start": round(s.start, 2),
                "end": round(s.end, 2),
                "text": s.text.strip(),
                "avg_logprob": round(s.avg_logprob, 3),
                "no_speech_prob": round(s.no_speech_prob, 3),
            }
            for s in segments
        ]
        elapsed = time.perf_counter() - started
        return Transcript(
            text=" ".join(r["text"] for r in rows).strip(),
            language=info.language,
            language_probability=info.language_probability,
            duration_s=info.duration,
            elapsed_s=elapsed,
            segments=rows,
        )


class FakeSpeechToText:
    """Test seam only. Returns text from a file. Never used for product content."""

    name = "fake"

    def transcribe(self, audio_path: str | Path, language: str | None = None) -> Transcript:
        text = Path(audio_path).read_text(encoding="utf-8").strip()
        return Transcript(
            text=text,
            language=language or DEFAULT_LANGUAGE,
            language_probability=1.0,
            duration_s=0.0,
            elapsed_s=0.0,
            segments=[],
        )
