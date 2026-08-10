"""Canonical voice state machine tests — GATE-2.5 H3.

Covers the two P0 voice-ownership fixes:

* WS connect state derives from config (voice.enabled) + the pipeline's
  actual state — never hardcoded LISTENING, so a fresh UI with voice
  disabled does not claim "Escuchando".
* One state owner (the pipeline): runtime/ws publish transitions into it,
  and the silence timer is disarmed while a request is in flight — a long
  model turn can never flip the UI to sleeping.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import yaml
from fastapi.testclient import TestClient

from arsvox_agent.app import create_app
from arsvox_contracts import AppConfig, VoiceState
from arsvox_contracts.config import VoiceSection
from arsvox_voice import VoicePipeline
from tests.python.harness_fixtures import base_config

_real_sleep = asyncio.sleep


async def _instant_sleep(_seconds: float) -> None:
    """Yield once instead of sleeping: lets the silence watcher observe a
    fake clock without real delays. (Patched per-test via monkeypatch.)"""
    await _real_sleep(0)


class _FakeClock:
    """Stand-in for datetime in arsvox_voice.pipeline: a clock that only
    moves when the test advances it."""

    def __init__(self) -> None:
        self._now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def now(self, tz=None):  # noqa: ARG002 — datetime.now signature
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)


def _make_pipeline(enabled: bool = True, silence_timeout_s: int = 5):
    states: list[VoiceState] = []

    async def on_state(state: VoiceState, activity: str | None = None) -> None:
        states.append(state)

    async def on_user_text(text: str) -> None:
        pass

    async def on_stop() -> None:
        pass

    config = AppConfig(
        voice=VoiceSection(enabled=enabled, silence_timeout_s=silence_timeout_s)
    )
    pipeline = VoicePipeline(config, on_user_text, on_stop, on_state)
    return pipeline, states


# ------------------------------------------------------------ ws connect #


def test_ws_connect_state_respects_voice_disabled(client):
    """voice.enabled=false (the shipped config): the first state_update is
    SLEEPING — the UI must not claim "Escuchando" on a fresh connect."""
    with client.websocket_connect("/ws") as ws:
        ev = ws.receive_json()
        assert ev["type"] == "state_update"
        assert ev["voice_state"] == "sleeping"


@pytest.fixture
def voice_client(tmp_path):
    cfg = base_config(tmp_path)
    cfg["voice"]["enabled"] = True
    path = tmp_path / "app-voice.yaml"
    path.write_text(
        yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    app = create_app(str(path))
    with TestClient(app) as c:
        yield c


def test_ws_connect_state_listening_when_voice_enabled(voice_client):
    with voice_client.websocket_connect("/ws") as ws:
        ev = ws.receive_json()
        assert ev["type"] == "state_update"
        assert ev["voice_state"] == "listening"


# ------------------------------------------------------- state machine #


@pytest.mark.asyncio
async def test_pipeline_initial_state_derives_from_config():
    enabled, _ = _make_pipeline(enabled=True)
    await enabled.start()
    assert enabled.state == VoiceState.LISTENING

    disabled, _ = _make_pipeline(enabled=False)
    await disabled.start()
    assert disabled.state == VoiceState.SLEEPING


@pytest.mark.asyncio
async def test_silence_timeout_returns_to_sleeping(monkeypatch):
    """The timer still works: LISTENING + silence past the deadline -> SLEEPING."""
    monkeypatch.setattr("arsvox_voice.pipeline.asyncio.sleep", _instant_sleep)
    clock = _FakeClock()
    monkeypatch.setattr("arsvox_voice.pipeline.datetime", clock)
    pipeline, states = _make_pipeline(enabled=True, silence_timeout_s=5)
    await pipeline.start()
    assert pipeline.state == VoiceState.LISTENING
    await _real_sleep(0)  # watcher's first iteration parks on sleep(1)
    clock.advance(60)  # past the 5s deadline
    await _real_sleep(0)  # watcher wakes, deadline expired -> SLEEPING
    await _real_sleep(0)  # flush the state callback task
    assert pipeline.state == VoiceState.SLEEPING
    assert states[-1] == VoiceState.SLEEPING


@pytest.mark.asyncio
async def test_long_model_turn_does_not_flip_to_sleeping(monkeypatch):
    """A request in flight (THINKING) disarms the silence timer: even with
    the clock far past the deadline the state stays THINKING."""
    monkeypatch.setattr("arsvox_voice.pipeline.asyncio.sleep", _instant_sleep)
    clock = _FakeClock()
    monkeypatch.setattr("arsvox_voice.pipeline.datetime", clock)
    pipeline, states = _make_pipeline(enabled=True, silence_timeout_s=5)
    await pipeline.start()
    pipeline.set_state(VoiceState.THINKING)
    clock.advance(3600)
    await _real_sleep(0)  # deliver cancellation to the parked watcher
    await _real_sleep(0)
    assert pipeline.state == VoiceState.THINKING
    assert VoiceState.SLEEPING not in states


@pytest.mark.asyncio
async def test_stop_publishes_stopping_then_sleeping():
    """STOP is a local, LLM-free path: the machine goes STOPPING -> SLEEPING
    and never yields a post-stop user turn."""
    pipeline, states = _make_pipeline(enabled=True)
    await pipeline.start()
    pipeline.set_state(VoiceState.THINKING)
    await pipeline.handle_stop()
    await _real_sleep(0)
    await _real_sleep(0)
    assert pipeline.state == VoiceState.SLEEPING
    assert states == [
        VoiceState.LISTENING,
        VoiceState.THINKING,
        VoiceState.STOPPING,
        VoiceState.SLEEPING,
    ]


@pytest.mark.asyncio
async def test_thinking_publish_carries_activity(monkeypatch):
    """The THINKING transition keeps the activity hint (what the model is
    working on) end-to-end through the canonical machine."""
    seen: list[tuple[VoiceState, str | None]] = []

    async def on_state(state: VoiceState, activity: str | None = None) -> None:
        seen.append((state, activity))

    async def on_user_text(text: str) -> None:
        pass

    async def on_stop() -> None:
        pass

    pipeline = VoicePipeline(
        AppConfig(voice=VoiceSection(enabled=True)),
        on_user_text,
        on_stop,
        on_state,
    )
    pipeline.set_state(VoiceState.THINKING, activity="cuéntame un chiste")
    await _real_sleep(0)
    await _real_sleep(0)
    assert seen == [(VoiceState.THINKING, "cuéntame un chiste")]
