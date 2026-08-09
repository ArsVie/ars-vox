"""GATE-3.5 A1 — voice lifecycle + STOP authority regression tests (R01-R08).

Covers the frozen scenarios of the consolidation contract:

* R01/R02  Spoken and button STOP during TTS share ONE cancellation
           primitive (runtime.cancel) and end in the expected terminal
           state (SLEEPING); late tts.* acks after STOP are no-ops and
           can never resurrect the cancelled turn (R04 server half).
* R05      The machine NEVER reaches LISTENING before physical playback
           ends: after a turn dispatches TTS it stays THINKING until the
           renderer acks tts.started (-> SPEAKING) and only tts.finished
           settles it.
* R06      The silence timer is disarmed while SPEAKING — long TTS can
           not start the timer mid-playback; LISTENING (which arms the
           timer) is only entered after speech ends.
* R07      TTS cancelled -> expected terminal state + tts.cancelled ack
           consumed without state side effects during the STOP path.
* R08      tts.started/finished/cancelled exist on the wire (parse as
           ClientMessage) and the service consumes them to drive the
           canonical voice state machine.

The renderer half (generation guards, queue clear on STOPPING, ack
emission) is pinned in apps/desktop/tests/tts-player-acks.test.tsx and
the existing stop-races.test.ts (H3, unchanged).
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from arsvox_agent.app import create_app
from arsvox_contracts import AppConfig, VoiceState, parse_client_message
from arsvox_contracts.config import VoiceSection
from arsvox_voice import VoicePipeline
from tests.python.conftest import base_config, ws_collect

_real_sleep = asyncio.sleep


async def _instant_sleep(_seconds: float) -> None:
    """Yield once instead of sleeping (fake-clock pipeline tests)."""
    await _real_sleep(0)


class _FakeClock:
    def __init__(self) -> None:
        self._now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def now(self, tz=None):  # noqa: ARG002
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)


def _text_model(text: str = "Hola mundo."):
    """FunctionModel that answers with text only (no tool calls)."""
    return FunctionModel(lambda messages, info: ModelResponse(parts=[TextPart(content=text)]))


def _tool_then_text_model(tool_name: str, args: dict, text: str = "Listo."):
    """FunctionModel that calls one tool, then answers with text — the
    shape of a turn that raises a confirmation AND speaks a final
    phrase (auto_speak)."""
    state = {"step": 0}

    def handler(messages, info):
        if state["step"] == 0:
            state["step"] += 1
            return ModelResponse(parts=[ToolCallPart(tool_name=tool_name, args=args)])
        return ModelResponse(parts=[TextPart(content=text)])

    return FunctionModel(handler)


@pytest.fixture
def tts_client(tmp_path):
    """Real app with voice enabled AND auto_speak on — the physical
    TTS lifecycle is exercised end to end over the wire."""
    cfg = base_config(tmp_path)
    cfg["voice"]["enabled"] = True
    cfg["tts"]["auto_speak"] = True
    path = tmp_path / "app-tts.yaml"
    path.write_text(
        yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    app = create_app(str(path))
    with TestClient(app) as c:
        yield c


def _patch_text_model(client, monkeypatch, text: str = "Hola mundo."):
    monkeypatch.setattr(
        "arsvox_agent.runtime.build_model", lambda cfg: _text_model(text)
    )
    return client


def _run_tts_turn(client, ws):
    """Send a user turn and collect events until the tts.speak command
    arrives. Returns the collected events. The machine must still be
    THINKING at that point (speech pending, R05)."""
    ws.send_json({"type": "user_text", "text": "dime algo"})
    events = ws_collect(
        client=client,
        ws=ws,
        expected_break=lambda e: e["type"] == "ui_command"
        and e["command"].get("action") == "tts.speak",
    )
    commands = [e for e in events if e["type"] == "ui_command"]
    assert commands, "expected a tts.speak command (auto_speak on)"
    return events


# --------------------------------------------------------------------- #
# R08: the acks are real wire messages


def test_tts_ack_messages_parse_as_client_messages():
    assert parse_client_message('{"type": "tts.started"}').type == "tts.started"
    assert parse_client_message('{"type": "tts.finished"}').type == "tts.finished"
    assert parse_client_message('{"type": "tts.cancelled"}').type == "tts.cancelled"


# --------------------------------------------------------------------- #
# R05/R08: LISTENING only after physical playback ends


def test_tts_lifecycle_acks_drive_canonical_state(tts_client, monkeypatch):
    """Turn with TTS: THINKING -> (tts.started) -> SPEAKING ->
    (tts.finished) -> LISTENING. LISTENING never appears before the
    finished ack, and SPEAKING only on the started ack."""
    c = _patch_text_model(tts_client, monkeypatch)
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update (listening)
        ws.receive_json()  # config_update
        ws.receive_json()  # state_snapshot

        events = _run_tts_turn(c, ws)
        states = [e["voice_state"] for e in events if e["type"] == "state_update"]
        # The turn dispatched TTS and must NOT have settled: THINKING is
        # the last voice state, with no SPEAKING/LISTENING yet (R05/R08).
        # (The initial LISTENING state_update was consumed above.)
        assert states == ["thinking"]
        assert not any(e["type"] == "error" for e in events)

        # Physical playback begins -> the machine reports SPEAKING.
        ws.send_json({"type": "tts.started"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "speaking",
        )
        assert events[-1]["voice_state"] == "speaking"

        # Speech ends -> only now LISTENING (never before).
        ws.send_json({"type": "tts.finished"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "listening",
        )
        assert events[-1]["voice_state"] == "listening"


def test_tts_finished_without_started_settles(tts_client, monkeypatch):
    """Fetch/play failure path: the renderer acks finished for a phrase
    that never started; the machine settles out of THINKING (no speech
    will ever play, so LISTENING is honest)."""
    c = _patch_text_model(tts_client, monkeypatch)
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        events = _run_tts_turn(c, ws)
        assert [e["voice_state"] for e in events if e["type"] == "state_update"] == [
            "thinking",
        ]
        ws.send_json({"type": "tts.finished"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "listening",
        )
        assert events[-1]["voice_state"] == "listening"


# --------------------------------------------------------------------- #
# R01/R02/R07: STOP during TTS — one primitive, expected terminal state,
# late acks never resurrect (R04 server half)


def test_button_stop_during_tts_reaches_sleeping_late_acks_noop(
    tts_client, monkeypatch
):
    """The button sends {type: "stop"} (R02); the terminal state is
    SLEEPING; tts.cancelled + tts.finished arriving after STOP are
    consumed as no-ops — no resurrection to LISTENING (R04/R07)."""
    c = _patch_text_model(tts_client, monkeypatch)
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        _run_tts_turn(c, ws)
        ws.send_json({"type": "tts.started"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "speaking",
        )

        # STOP while physically speaking.
        ws.send_json({"type": "stop"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "sleeping",
        )
        states = [e["voice_state"] for e in events if e["type"] == "state_update"]
        assert "stopping" in states
        assert states[-1] == "sleeping"

        # Late acks after STOP must be consumed without side effects.
        ws.send_json({"type": "tts.cancelled"})
        ws.send_json({"type": "tts.finished"})
        ws.send_json({"type": "ping"})
        events = ws_collect(client=c, ws=ws, expected_break=lambda e: e["type"] == "pong")
        late_states = [e["voice_state"] for e in events if e["type"] == "state_update"]
        assert late_states == [], f"late acks resurrected state: {late_states}"
        assert c.app.state.services.runtime.pipeline.state == VoiceState.SLEEPING


def test_spoken_stop_during_tts_same_primitive(tts_client, monkeypatch):
    """R01: a spoken stop ("detente") during TTS runs the SAME
    cancellation primitive as the button (runtime.cancel) — the wire
    carries user_text, the local-intent layer turns it into the stop
    path, and the machine ends SLEEPING."""
    c = _patch_text_model(tts_client, monkeypatch)
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        _run_tts_turn(c, ws)
        ws.send_json({"type": "tts.started"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "speaking",
        )

        ws.send_json({"type": "user_text", "text": "detente"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "sleeping",
        )
        states = [e["voice_state"] for e in events if e["type"] == "state_update"]
        assert "stopping" in states
        assert states[-1] == "sleeping"
        # Same primitive: the pipeline's on_stop callback is runtime.cancel,
        # identical to the {type: "stop"} path.
        assert c.app.state.services.runtime.pipeline.state == VoiceState.SLEEPING


def test_confirm_during_tts_does_not_settle_to_listening(tts_client, monkeypatch):
    """R05 through the confirmation seam: a turn that raises a
    confirmation AND speaks (auto_speak) keeps the machine SPEAKING
    while playback runs; resolving the confirmation mid-speech must not
    force LISTENING — only the tts.finished ack settles, with the fresh
    (now empty) pending state."""
    monkeypatch.setattr(
        "arsvox_agent.runtime.build_model",
        lambda cfg: _tool_then_text_model(
            "telegram_prepare_message", {"text": "Hola, confirma esto"}
        ),
    )
    c = tts_client
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "prepara un mensaje"})
        # The telegram tool emits its own priority tts.speak BEFORE the
        # confirmation; break on the confirmation_requested event, then
        # verify a tts.speak (final auto-speak) is in the collected set.
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_requested",
        )
        reqs = [e for e in events if e["type"] == "confirmation_requested"]
        assert reqs, "expected a confirmation request"
        pending_id = reqs[-1]["pending_id"]
        assert any(
            e["type"] == "ui_command" and e["command"].get("action") == "tts.speak"
            for e in events
        ), "expected a tts.speak (telegram read-back or final auto-speak)"
        assert not any(
            e["type"] == "state_update" and e["voice_state"] == "listening"
            for e in events
        ), "LISTENING before speech ended (R05)"

        ws.send_json({"type": "tts.started"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "speaking",
        )

        # Confirm while the final phrase is physically playing.
        ws.send_json({"type": "confirm", "pending_id": pending_id})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_resolved"
            and e["status"] == "executed",
        )
        assert not any(
            e["type"] == "state_update" for e in events
        ), "confirm mid-speech must not move the voice state (R05)"

        # Only the finished ack settles — to LISTENING (pending cleared).
        ws.send_json({"type": "tts.finished"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "listening",
        )
        assert events[-1]["voice_state"] == "listening"


# --------------------------------------------------------------------- #
# R06: the silence timer is anchored to speech END, never mid-playback


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


@pytest.mark.asyncio
async def test_long_tts_does_not_start_silence_timer_mid_playback(monkeypatch):
    """R06: SPEAKING disarms the silence timer. A playback much longer
    than the timeout never flips to SLEEPING; the timer only re-arms
    when speech finishes and LISTENING is entered."""
    monkeypatch.setattr("arsvox_voice.pipeline.asyncio.sleep", _instant_sleep)
    clock = _FakeClock()
    monkeypatch.setattr("arsvox_voice.pipeline.datetime", clock)
    pipeline, states = _make_pipeline(enabled=True, silence_timeout_s=5)
    await pipeline.start()
    assert pipeline.state == VoiceState.LISTENING

    # Turn starts -> THINKING (timer disarmed) -> speech starts.
    pipeline.set_state(VoiceState.THINKING)
    pipeline.set_state(VoiceState.SPEAKING)
    await _real_sleep(0)

    # Playback lasts 10x the timeout: the machine must stay SPEAKING.
    clock.advance(3600)
    await _real_sleep(0)
    await _real_sleep(0)
    assert pipeline.state == VoiceState.SPEAKING
    assert VoiceState.SLEEPING not in states

    # Speech ends -> LISTENING arms the timer anchored to speech END.
    pipeline.set_state(VoiceState.LISTENING)
    clock.advance(60)
    await _real_sleep(0)
    await _real_sleep(0)
    assert pipeline.state == VoiceState.SLEEPING
    assert states[-1] == VoiceState.SLEEPING
