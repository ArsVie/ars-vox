"""Audio provider interfaces and iteration-1 mock implementations."""

import asyncio
import importlib.util
import logging
import os
import time
import warnings
from abc import ABC, abstractmethod
from collections import deque
from collections.abc import Coroutine
from pathlib import Path
from typing import Any, Callable

import numpy as np

log = logging.getLogger(__name__)


class WakeWordDetector(ABC):
    """Streams the microphone and calls ``on_wake`` when the wake word fires."""

    @abstractmethod
    async def start(
        self, on_wake: Callable[[], Coroutine[Any, Any, None]]
    ) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...


class MockWakeWordDetector(WakeWordDetector):
    """No-op detector; wake is simulated (e.g. by the UI connect)."""

    async def start(
        self, on_wake: Callable[[], Coroutine[Any, Any, None]]
    ) -> None:
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


# --------------------------------------------------------------------------- #
# W3-VOICE (GATE-5): real providers behind config. Both are opt-in — the
# mock stays the default — and both degrade loudly (clear error) when the
# operator configured a real provider whose dependencies are missing.
# --------------------------------------------------------------------------- #

_SILERO_VAD_URL = (
    "https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx"
)


def _cache_dir() -> Path:
    """Per-user cache dir for downloaded model files (XDG-aware)."""
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    d = Path(base) / "arsvox"
    d.mkdir(parents=True, exist_ok=True)
    return d


class SileroVad(Vad):
    """Silero VAD v5 via ONNX Runtime — no torch required.

    ``is_speech(bytes)`` consumes 16 kHz mono int16 PCM and returns True
    when any full 512-sample window (32 ms, the standard silero window)
    scores above ``threshold``. Window state (h/c) carries across calls so
    a stream of chunks behaves exactly like silero's streaming protocol;
    ``reset()`` clears buffer + state (new utterance / new recording).

    Model resolution order (first hit wins):
      1. ``model_path`` passed to the constructor (explicit, must exist),
      2. the silero_vad.onnx bundled inside openwakeword (if installed),
      3. a one-time download of the canonical snakers4/silero-vad ONNX
         into the user cache dir.
    """

    WINDOW = 512  # samples @16 kHz — the standard silero window (32 ms)

    def __init__(
        self,
        model_path: str | None = None,
        threshold: float = 0.5,
        sample_rate: int = 16000,
    ):
        self.model_path = model_path
        self.threshold = threshold
        self.sample_rate = sample_rate
        self._session = None
        self._input_names: list[str] = []
        self._h = np.zeros((2, 1, 64), dtype=np.float32)
        self._c = np.zeros((2, 1, 64), dtype=np.float32)
        self._sr_value = np.array(sample_rate, dtype=np.int64)
        self._buf = b""

    # ---------------------------------------------------------- plumbing #
    @staticmethod
    def availability() -> tuple[bool, str]:
        """Can this process run the real VAD right now? (deps + model)"""
        if importlib.util.find_spec("onnxruntime") is None:
            return False, "onnxruntime is not installed"
        try:
            SileroVad.resolve_model_path(None)
        except Exception as exc:  # noqa: BLE001 — honest reporting
            return False, str(exc)
        return True, "onnxruntime + silero_vad.onnx available"

    @staticmethod
    def resolve_model_path(model_path: str | None = None) -> str | None:
        """Resolve a silero ONNX model file, downloading once if needed."""
        if model_path:
            p = Path(model_path)
            if not p.exists():
                raise FileNotFoundError(
                    f"silero VAD model path does not exist: {model_path}"
                )
            return str(p)
        # openwakeword bundles the canonical silero_vad.onnx in its wheel.
        ow = importlib.util.find_spec("openwakeword")
        if ow is not None and ow.origin:
            bundled = (
                Path(ow.origin).parent / "resources" / "models" / "silero_vad.onnx"
            )
            if bundled.exists():
                return str(bundled)
        # Last resort: one-time download of the canonical model.
        target = _cache_dir() / "silero_vad.onnx"
        if target.exists():
            return str(target)
        import urllib.request

        log.info("downloading silero VAD model from %s", _SILERO_VAD_URL)
        try:
            urllib.request.urlretrieve(_SILERO_VAD_URL, target)  # noqa: S310 — pinned https URL
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                f"silero VAD model unavailable: download failed ({exc}); "
                "install openwakeword or place silero_vad.onnx in the cache dir"
            ) from exc
        return str(target)

    def reset(self) -> None:
        self._buf = b""
        self._h = np.zeros((2, 1, 64), dtype=np.float32)
        self._c = np.zeros((2, 1, 64), dtype=np.float32)

    def _ensure_model(self) -> None:
        if self._session is not None:
            return
        import onnxruntime as ort

        path = self.resolve_model_path(self.model_path)
        self._session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self._input_names = [i.name for i in self._session.get_inputs()]
        self._sr_value = np.array(self.sample_rate, dtype=np.int64)

    # ------------------------------------------------------------- Vad #
    def is_speech(self, audio_chunk: bytes) -> bool:
        if not audio_chunk:
            return False
        self._ensure_model()
        self._buf += audio_chunk
        samples = np.frombuffer(self._buf, dtype=np.int16)
        n_full = len(samples) - (len(samples) % self.WINDOW)
        if n_full == 0:
            return False
        # keep the trailing partial window for the next call
        self._buf = self._buf[(n_full * 2) :]
        windows = samples[:n_full].reshape(-1, self.WINDOW).astype(np.float32)
        audio_in = next(
            (n for n in self._input_names if n != "sr" and n not in ("h", "c")),
            "input",
        )
        any_speech = False
        for window in windows:
            feed: dict[str, object] = {audio_in: window[None, :] / 32768.0}
            if "sr" in self._input_names:
                feed["sr"] = self._sr_value
            if "h" in self._input_names:
                feed["h"] = self._h
                feed["c"] = self._c
            outs = self._session.run(None, feed)
            prob = float(outs[0][0][0])
            if "h" in self._input_names:
                self._h = outs[1]
                self._c = outs[2]
            if prob > self.threshold:
                any_speech = True
        return any_speech


class OpenWakeWordDetector(WakeWordDetector):
    """Real wake-word detector: openwakeword (ONNX) over the live mic.

    Owns the single microphone stream (sounddevice, 16 kHz mono int16):
    every 80 ms chunk runs through the openwakeword model and — when a
    ``Vad`` and ``on_speech_start`` are wired — through the VAD, so the
    same stream feeds both the wake path and the barge-in path (speech
    during TTS). ``on_wake`` is debounced: a cooldown suppresses
    re-fires inside one phrase, and the pipeline-level callback only
    acts from SLEEPING (never while a turn is active).

    The model is lazy: constructing this class never imports openwakeword
    or sounddevice (unit tests / CI stay hermetic). ``start()`` fails
    loud with a clear error when the configured provider's deps are
    missing.
    """

    CHUNK_FRAMES = 1280  # 80 ms @16 kHz — openwakeword's inference window
    DEFAULT_THRESHOLD = 0.5
    _WAKE_COOLDOWN_S = 2.0

    def __init__(
        self,
        model_name: str | None = None,
        threshold: float = DEFAULT_THRESHOLD,
        vad: Vad | None = None,
        on_speech_start: Callable[[], Coroutine[Any, Any, None]] | None = None,
        sample_rate: int = 16000,
        wake_cooldown_s: float = _WAKE_COOLDOWN_S,
    ):
        self.model_name = model_name
        self.threshold = threshold
        self.vad = vad
        self.on_speech_start = on_speech_start
        self.sample_rate = sample_rate
        self.wake_cooldown_s = wake_cooldown_s
        self._model = None
        self._stream = None
        self._loop = None
        self._on_wake: Callable[[], Coroutine[Any, Any, None]] | None = None
        self._chunks: deque[bytes] = deque()
        self._wake_event: asyncio.Event | None = None
        self._stopped: asyncio.Event | None = None
        self._worker: asyncio.Task | None = None
        self._wake_lockout_until = 0.0
        self._was_speech = False

    # ---------------------------------------------------------- plumbing #
    @staticmethod
    def availability() -> tuple[bool, str]:
        """Can this process run the real detector right now?"""
        missing = [
            name
            for name in ("openwakeword", "sounddevice")
            if importlib.util.find_spec(name) is None
        ]
        if missing:
            return False, f"missing dependencies: {', '.join(missing)}"
        return True, "openwakeword + sounddevice available"

    def _resolve_model_paths(self) -> list[str] | None:
        """Config model name -> onnx path(s). None = library default set."""
        if self.model_name is None:
            return None
        import openwakeword

        registry = openwakeword.models
        if self.model_name in registry:
            return [registry[self.model_name]["model_path"]]
        p = Path(self.model_name)
        if p.exists():
            return [str(p)]
        raise ValueError(
            f"unknown wake word model {self.model_name!r}: not a bundled "
            f"openwakeword name ({sorted(registry)}) and not an existing .onnx path"
        )

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        from openwakeword import Model

        # openwakeword 0.4 warns about CUDA providers it can't use on CPU
        # boxes; the fallback IS CPU, so the warning is noise here.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            self._model = Model(
                wakeword_model_paths=self._resolve_model_paths() or [],
                enable_speex_noise_suppression=False,
            )

    def detect_clip(self, pcm_int16: bytes) -> dict[str, float]:
        """Max per-model scores over a whole recorded clip (no mic needed).

        Used by the mic smoke script: chunk the clip exactly like the
        streaming path (80 ms windows) and keep the peak score per model.
        """
        self._ensure_model()
        samples = np.frombuffer(pcm_int16, dtype=np.int16)
        n_full = len(samples) - (len(samples) % self.CHUNK_FRAMES)
        peaks: dict[str, float] = {}
        for chunk in samples[:n_full].reshape(-1, self.CHUNK_FRAMES):
            for name, score in self._model.predict(chunk).items():
                peaks[name] = max(peaks.get(name, 0.0), float(score))
        return peaks

    # ------------------------------------------------- WakeWordDetector #
    async def start(
        self, on_wake: Callable[[], Coroutine[Any, Any, None]]
    ) -> None:
        self._on_wake = on_wake
        self._ensure_model()
        if self.on_speech_start is not None and self.vad is None:
            log.warning("wake detector: on_speech_start wired without a Vad — barge-in feed disabled")
        import sounddevice as sd  # noqa: PLC0415 — lazy; fails loud here

        if sd.query_devices(kind="input") is None:
            raise RuntimeError("no default input (microphone) device available")
        self._loop = asyncio.get_running_loop()
        self._wake_event = asyncio.Event()
        self._stopped = asyncio.Event()
        self._stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
            blocksize=self.CHUNK_FRAMES,
            callback=self._audio_callback,
        )
        self._stream.start()
        self._worker = asyncio.create_task(self._run())
        try:
            await self._stopped.wait()
        finally:
            self._close_stream()

    async def stop(self) -> None:
        if self._stopped is not None:
            self._stopped.set()
        if self._worker is not None:
            self._worker.cancel()
            self._worker = None
        self._close_stream()

    def _close_stream(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:  # noqa: BLE001 — best-effort teardown
                pass
            self._stream = None

    def _audio_callback(self, indata, _frames, _time_info, _status) -> None:
        """PortAudio thread -> event loop (never block here)."""
        if self._loop is None or self._stopped is None or self._stopped.is_set():
            return
        data = np.ascontiguousarray(indata).tobytes()
        self._loop.call_soon_threadsafe(self._enqueue, data)

    def _enqueue(self, data: bytes) -> None:
        self._chunks.append(data)
        if self._wake_event is not None:
            self._wake_event.set()

    async def _run(self) -> None:
        while True:
            if self._wake_event is not None:
                await self._wake_event.wait()
                self._wake_event.clear()
            while self._chunks:
                chunk = self._chunks.popleft()
                self._process_chunk(chunk)

    def _process_chunk(self, chunk: bytes) -> None:
        scores = self._model.predict(np.frombuffer(chunk, dtype=np.int16))
        peak = max(float(s) for s in scores.values())
        now = time.monotonic()
        if (
            peak > self.threshold
            and now > self._wake_lockout_until
            and self._on_wake is not None
        ):
            self._wake_lockout_until = now + self.wake_cooldown_s
            asyncio.create_task(self._on_wake())
        if self.vad is not None and self.on_speech_start is not None:
            speech = self.vad.is_speech(chunk)
            if speech and not self._was_speech:
                asyncio.create_task(self.on_speech_start())
            self._was_speech = speech


# --------------------------------------------------------------------------- #
# Config-driven builders — the ONLY entry points the rest of the app uses.
# --------------------------------------------------------------------------- #


def build_vad(config) -> Vad:
    """Build the VAD provider from ``config.voice.vad`` (mock default)."""
    provider = getattr(config.voice.vad, "provider", "mock")
    if provider == "silero":
        return SileroVad(model_path=getattr(config.voice.vad, "model_path", None))
    return MockVad()


def build_wake_word_detector(
    config,
    vad: Vad | None = None,
    on_speech_start: Callable[[], Coroutine[Any, Any, None]] | None = None,
) -> WakeWordDetector:
    """Build the wake-word provider from ``config.voice.wake_word`` (mock default).

    ``vad`` + ``on_speech_start`` wire the barge-in feed: the real
    detector streams the mic and reports VAD speech-start through
    ``on_speech_start`` so the pipeline can cancel in-flight TTS.
    """
    provider = getattr(config.voice.wake_word, "provider", "mock")
    if provider == "openwakeword":
        return OpenWakeWordDetector(
            model_name=getattr(config.voice.wake_word, "model", None),
            vad=vad,
            on_speech_start=on_speech_start,
        )
    return MockWakeWordDetector()


def build_stt(config) -> SpeechToText:
    """Build the STT provider from ``config.voice.stt``."""
    provider = getattr(config.voice.stt, "provider", "mock")
    model_size = getattr(config.voice.stt, "model", "tiny") or "tiny"
    if provider == "faster-whisper":
        return FasterWhisperSTT(model_size=model_size)
    return MockSpeechToText()
