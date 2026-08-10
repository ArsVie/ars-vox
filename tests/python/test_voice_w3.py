"""W3-VOICE (GATE-5): provider wiring, barge-in, and mic-smoke honesty.

Covers:
* provider selection from config — mock stays the default, real
  providers are opt-in (wake_word.provider: openwakeword, vad.provider:
  silero),
* SileroVad windowing/threshold/state logic (stub session — hermetic)
  plus the real ONNX path when the model is available,
* barge-in at the pipeline level: speech during TTS cancels through the
  existing STOP path and arms a fresh LISTENING turn,
* the mic smoke script: honest PASS/FAIL/SKIP per stage, graceful
  no-mic skip (exit 0), never a crash.
"""

import argparse
import asyncio
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
import yaml

from arsvox_contracts import AppConfig, VoiceState
from arsvox_contracts.config import VadSection, VoiceSection, WakeWordSection
from arsvox_voice import VoicePipeline
from arsvox_voice.providers import (
    MockVad,
    MockWakeWordDetector,
    OpenWakeWordDetector,
    SileroVad,
    build_vad,
    build_wake_word_detector,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
_real_sleep = asyncio.sleep

# ------------------------------------------------------------ providers #


def test_vad_section_default_is_mock():
    """The config default for vad.provider is mock — a bare config never
    tries to load a real model."""
    assert VadSection().provider == "mock"


def test_wake_word_section_default_is_mock():
    assert WakeWordSection().provider == "mock"


def test_shipped_config_voice_providers_are_mock():
    """configs/app.yaml (loaded by every fixture) keeps the mock defaults."""
    cfg = yaml.safe_load((REPO_ROOT / "configs" / "app.yaml").read_text(encoding="utf-8"))
    voice = cfg["voice"]
    assert voice["wake_word"]["provider"] == "mock"
    assert voice["vad"]["provider"] == "mock"
    assert voice["wake_word"]["enabled"] is False


def test_build_vad_default_returns_mock():
    assert isinstance(build_vad(AppConfig(voice=VoiceSection())), MockVad)


def test_build_vad_silero_returns_silero():
    cfg = AppConfig(voice=VoiceSection(vad=VadSection(provider="silero")))
    vad = build_vad(cfg)
    assert isinstance(vad, SileroVad)
    assert vad.model_path is None  # resolved lazily at first use


def test_build_wake_default_returns_mock():
    assert isinstance(
        build_wake_word_detector(AppConfig(voice=VoiceSection())), MockWakeWordDetector
    )


def test_build_wake_openwakeword_returns_detector_without_importing_deps():
    """Selecting the real provider must not import openwakeword/sounddevice
    at construction — unit tests and CI stay hermetic."""
    cfg = AppConfig(
        voice=VoiceSection(wake_word=WakeWordSection(provider="openwakeword", model="alexa"))
    )
    detector = build_wake_word_detector(cfg, vad=MockVad(), on_speech_start=lambda: None)
    assert isinstance(detector, OpenWakeWordDetector)
    assert detector.model_name == "alexa"
    assert "openwakeword" not in sys.modules
    assert "sounddevice" not in sys.modules


# --------------------------------------------------------- Silero logic #


class _FakeSession:
    """Stand-in for an onnxruntime InferenceSession: probability driven by
    window RMS, state passed through (identity), calls recorded."""

    def __init__(self, speech_rms: float = 0.05):
        self.speech_rms = speech_rms
        self.calls: list[dict] = []

    def run(self, _output_names, feed):
        self.calls.append(feed)
        rms = float(np.sqrt(np.mean(feed["input"][0] ** 2)))
        prob = np.array([[0.9 if rms > self.speech_rms else 0.1]], dtype=np.float32)
        return [prob, feed["h"] * 1.0, feed["c"] * 1.0]


def _vad_with_fake_session(threshold: float = 0.5) -> SileroVad:
    vad = SileroVad(threshold=threshold)
    vad._session = _FakeSession()  # noqa: SLF001 — test seam
    vad._input_names = ["input", "sr", "h", "c"]
    return vad


def _pcm(amplitude: float, samples: int) -> bytes:
    return (np.full(samples, amplitude) * 32767).astype(np.int16).tobytes()


def test_silero_vad_silence_is_false():
    assert _vad_with_fake_session().is_speech(_pcm(0.0, 512)) is False


def test_silero_vad_loud_window_is_true():
    assert _vad_with_fake_session().is_speech(_pcm(0.3, 512)) is True


def test_silero_vad_threshold_gates_verdict():
    vad = _vad_with_fake_session(threshold=0.95)
    assert vad.is_speech(_pcm(0.3, 512)) is False  # 0.9 < 0.95


def test_silero_vad_ors_across_windows():
    """Any speech window in the chunk wins — silence + loud = True."""
    chunk = _pcm(0.0, 512) + _pcm(0.3, 512)
    assert _vad_with_fake_session().is_speech(chunk) is True


def test_silero_vad_buffers_partial_windows():
    """A short chunk is buffered; the verdict lands when a full 512-sample
    window accumulates — no audio is silently dropped."""
    vad = _vad_with_fake_session()
    assert vad.is_speech(_pcm(0.3, 200)) is False  # no full window yet
    assert vad.is_speech(_pcm(0.3, 824)) is True  # 200 + 824 -> full windows
    assert vad._buf == b""  # remainder consumed exactly


def test_silero_vad_carries_state_across_calls():
    vad = _vad_with_fake_session()
    vad.is_speech(_pcm(0.0, 512))
    vad.is_speech(_pcm(0.3, 512))
    session = vad._session
    assert len(session.calls) == 2
    for feed in session.calls:
        assert "h" in feed and "c" in feed and "sr" in feed
    # state returned by the session becomes the next call's state
    assert np.array_equal(vad._h, session.calls[-1]["h"])
    vad.reset()
    assert vad._buf == b""
    assert np.count_nonzero(vad._h) == 0


@pytest.mark.skipif(
    not SileroVad.availability()[0],
    reason="silero ONNX model unavailable in this environment",
)
def test_silero_vad_real_model_runs_and_is_conservative():
    """The real ONNX model: runs on this machine, returns bools, and —
    honestly — does NOT hallucinate speech from silence or broadband
    noise (silero is trained on real speech)."""
    vad = SileroVad()
    assert vad.is_speech(b"\x00" * (512 * 4)) is False
    rng = np.random.default_rng(7)
    noise = (rng.standard_normal(512 * 4) * 0.3 * 32768).astype(np.int16)
    assert vad.is_speech(noise.tobytes()) is False
    assert isinstance(vad.is_speech(b"\x00" * 512), bool)


# ------------------------------------------------------------- pipeline #


def _make_pipeline(
    enabled: bool = True,
    silence_timeout_s: int = 5,
    wake_provider: str = "mock",
    vad_provider: str = "mock",
):
    states: list[VoiceState] = []
    stop_calls: list[str] = []

    async def on_state(state: VoiceState, activity: str | None = None) -> None:
        states.append(state)

    async def on_user_text(text: str) -> None:
        pass

    async def on_stop() -> None:
        stop_calls.append("stop")

    config = AppConfig(
        voice=VoiceSection(
            enabled=enabled,
            silence_timeout_s=silence_timeout_s,
            wake_word=WakeWordSection(enabled=(wake_provider != "mock"), provider=wake_provider),
            vad=VadSection(provider=vad_provider),
        )
    )
    pipeline = VoicePipeline(config, on_user_text, on_stop, on_state)
    return pipeline, states, stop_calls


async def _flush() -> None:
    await _real_sleep(0)
    await _real_sleep(0)


def test_pipeline_builds_mock_providers_from_default_config():
    """Default config -> MockVad + MockWakeWordDetector: nothing real is
    ever constructed, and start() never opens a mic."""
    pipeline, _, _ = _make_pipeline(enabled=True)
    assert isinstance(pipeline.vad, MockVad)
    assert isinstance(pipeline._wake_word, MockWakeWordDetector)  # noqa: SLF001


@pytest.mark.asyncio
async def test_pipeline_start_stop_with_mock_providers_is_safe():
    pipeline, _, _ = _make_pipeline(enabled=True)
    await pipeline.start()
    await _flush()
    await pipeline.stop()
    await _flush()


def test_pipeline_builds_real_providers_when_configured():
    """Opt-in config -> real provider objects, without importing their deps."""
    pipeline, _, _ = _make_pipeline(enabled=True, wake_provider="openwakeword", vad_provider="silero")
    assert isinstance(pipeline.vad, SileroVad)
    assert isinstance(pipeline._wake_word, OpenWakeWordDetector)  # noqa: SLF001
    assert "openwakeword" not in sys.modules


@pytest.mark.asyncio
async def test_barge_in_speech_during_tts_cancels_and_arms_new_turn():
    """The core barge-in: speech while TTS is playing goes through the
    existing STOP cancel path (on_stop) and lands in a fresh LISTENING
    turn with the silence timer re-armed."""
    pipeline, states, stop_calls = _make_pipeline(enabled=True)
    await pipeline.start()
    await _flush()
    pipeline.set_state(VoiceState.SPEAKING)  # TTS physically playing
    await _flush()
    assert pipeline._silence_deadline is None  # timer disarmed mid-speech

    await pipeline.handle_user_speech_started()

    await _flush()
    assert stop_calls == ["stop"]  # TTS cancelled via the existing path
    assert pipeline.state == VoiceState.LISTENING  # fresh turn armed
    assert pipeline._silence_deadline is not None  # timer re-armed
    assert states == [
        VoiceState.LISTENING,
        VoiceState.SPEAKING,
        VoiceState.STOPPING,
        VoiceState.LISTENING,
    ]


@pytest.mark.asyncio
async def test_barge_in_while_listening_only_resets_silence_timer():
    """Speech while already listening must not cancel anything — the
    utterance is in progress; just keep the silence watcher at bay."""
    pipeline, _, stop_calls = _make_pipeline(enabled=True)
    await pipeline.start()
    await _flush()
    before = pipeline._silence_deadline
    await pipeline.handle_user_speech_started()
    await _flush()
    assert stop_calls == []
    assert pipeline.state == VoiceState.LISTENING
    assert pipeline._silence_deadline is not None
    assert pipeline._silence_deadline >= before


@pytest.mark.asyncio
async def test_barge_in_is_noop_while_thinking():
    pipeline, states, stop_calls = _make_pipeline(enabled=True)
    await pipeline.start()
    await _flush()
    pipeline.set_state(VoiceState.THINKING)
    await _flush()
    await pipeline.handle_user_speech_started()
    await _flush()
    assert stop_calls == []
    assert pipeline.state == VoiceState.THINKING  # model time is not preempted


@pytest.mark.asyncio
async def test_barge_in_is_noop_while_sleeping():
    """SLEEPING is gated by the wake word — bare VAD speech must not wake."""
    pipeline, states, stop_calls = _make_pipeline(enabled=True)
    await pipeline.start()
    await _flush()
    pipeline.set_state(VoiceState.SLEEPING)
    await _flush()
    await pipeline.handle_user_speech_started()
    await _flush()
    assert stop_calls == []
    assert pipeline.state == VoiceState.SLEEPING


@pytest.mark.asyncio
async def test_wake_fires_only_from_sleeping():
    """Wake word: SLEEPING -> LISTENING; a wake hit while a turn is
    active (LISTENING) is debounced to a no-op."""
    pipeline, states, _ = _make_pipeline(enabled=True)
    await pipeline.start()
    await _flush()
    pipeline.set_state(VoiceState.SLEEPING)
    await _flush()
    await pipeline.handle_wake()
    await _flush()
    assert pipeline.state == VoiceState.LISTENING
    assert pipeline._silence_deadline is not None
    await pipeline.handle_wake()  # debounce: already listening
    await _flush()
    # LISTENING published twice: pipeline.start() + the first wake — the
    # second wake hit must NOT re-publish (turn is active)
    assert states.count(VoiceState.LISTENING) == 2


# ------------------------------------------------------------ mic smoke #


class _NoMicBackend:
    @staticmethod
    def availability() -> tuple[bool, str]:
        return False, "PortAudio reports no default input device"

    @staticmethod
    def record(duration_s: float, sample_rate: int) -> bytes:
        raise AssertionError("record must never run without a mic")


class _SilentMicBackend:
    @staticmethod
    def availability() -> tuple[bool, str]:
        return True, "default input device: test"

    @staticmethod
    def record(duration_s: float, sample_rate: int) -> bytes:
        return b"\x00" * int(duration_s * sample_rate * 2)


def _smoke_args(**overrides) -> argparse.Namespace:
    base = dict(
        duration=4.0,
        sample_rate=16000,
        vad="silero",
        vad_model_path=None,
        wake="mock",
        wake_model=None,
    )
    base.update(overrides)
    return argparse.Namespace(**base)


def test_smoke_no_mic_skips_every_stage_with_reason(capsys):
    from scripts.voice_mic_smoke import run_smoke

    exit_code = run_smoke(_smoke_args(), backend=_NoMicBackend)
    out = capsys.readouterr().out
    assert exit_code == 0  # skip is not a failure
    assert "[mic] SKIP" in out
    assert "no default input device" in out
    assert "[record] SKIP" in out and "[vad] SKIP" in out and "[wake] SKIP" in out
    assert "RESULT:" in out


def test_smoke_records_and_runs_mock_vad(capsys):
    from scripts.voice_mic_smoke import run_smoke

    exit_code = run_smoke(
        _smoke_args(vad="mock"),
        backend=_SilentMicBackend,
        vad_builder=lambda args: MockVad(),
    )
    out = capsys.readouterr().out
    assert exit_code == 0
    assert "[mic] PASS" in out
    assert "[record] PASS" in out and "captured 4.00s" in out
    assert "[vad] PASS" in out and "mock" in out
    assert "[wake] SKIP" in out  # wake disabled by default


def test_smoke_unavailable_vad_skips_with_reason(capsys):
    from scripts.voice_mic_smoke import run_smoke

    def broken_vad(args):
        raise RuntimeError("onnxruntime is not installed")

    exit_code = run_smoke(_smoke_args(), backend=_SilentMicBackend, vad_builder=broken_vad)
    out = capsys.readouterr().out
    assert exit_code == 0
    assert "[vad] SKIP" in out and "onnxruntime is not installed" in out
    assert "[wake] SKIP" in out


def test_smoke_unavailable_wake_skips_with_reason(capsys):
    from scripts.voice_mic_smoke import run_smoke

    def broken_wake(args):
        raise RuntimeError("missing dependencies: openwakeword")

    exit_code = run_smoke(
        _smoke_args(wake="openwakeword"),
        backend=_SilentMicBackend,
        vad_builder=lambda args: MockVad(),
        wake_builder=broken_wake,
    )
    out = capsys.readouterr().out
    assert exit_code == 0
    assert "[wake] SKIP" in out and "openwakeword" in out


def test_smoke_vad_failure_is_an_honest_fail(capsys):
    from scripts.voice_mic_smoke import run_smoke

    class _BadVad(MockVad):
        def is_speech(self, audio_chunk: bytes) -> bool:
            raise RuntimeError("vad exploded")

    exit_code = run_smoke(
        _smoke_args(vad="mock"),
        backend=_SilentMicBackend,
        vad_builder=lambda args: _BadVad(),
    )
    out = capsys.readouterr().out
    assert exit_code == 1  # a stage that ran and errored IS a failure
    assert "[vad] FAIL" in out and "vad exploded" in out
    assert "RESULT: FAIL" in out


@pytest.mark.skipif(
    sys.platform == "win32" and sys.version_info < (3, 12),
    reason="subprocess smoke runs against the repo venv",
)
def test_smoke_script_subprocess_is_graceful():
    """The real script, as a user would run it: exit 0 and honest RESULT
    whether the machine has a mic (real record + mock VAD) or not (SKIP)."""
    proc = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "voice_mic_smoke.py"), "--vad", "mock"],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=str(REPO_ROOT),
    )
    assert proc.returncode == 0, proc.stderr
    assert "RESULT:" in proc.stdout
    assert "Traceback" not in proc.stdout + proc.stderr
    # either the machine has a mic (record ran) or it skipped — never a crash
    assert "[record] PASS" in proc.stdout or "[record] SKIP" in proc.stdout
