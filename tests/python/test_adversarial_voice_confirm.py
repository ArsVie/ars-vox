"""GATE-3.5 A10 + W1-VOICE — adversarial integration tests: spoken STOP,
spoken confirmations across the full path, and the spoken-confirmation ×
TTS races around the unified terminal-state derivation.

A10 (R01/R35/R36):
R01 — spoken STOP during a running turn cancels generation and returns
      to SLEEPING with no partial reply (the utterance is consumed as a
      command, never delivered to the model).
R35 — spoken approval ("confirmar"/"sí") executes the frozen pending
      confirmation (wire: confirmation_resolved status executed, DB row
      resolved); spoken rejection cancels it. A7 wired the confirm/
      reject vocabulary into the same confirmation funnel as the UI
      buttons.
R36 — ambiguous "sí"/"no" OUTSIDE confirmation mode is ignored
      (conservative): the utterance is consumed — no resolve, no model
      turn starts (audited + ignored).

W1-VOICE (GATE-3.5 C4/R05 through the SPOKEN path):
* A spoken confirmation resolved while TTS is pending (THINKING) or
  playing (SPEAKING) must NOT move the voice state — only the
  renderer's tts.finished ack settles, with the fresh pending state
  (the spoken path previously lacked the ws.py guard).
* Settle semantics: with nothing pending the machine settles LISTENING;
  with a pending confirmation it settles WAITING_FOR_CONFIRMATION.
* The public API: is_speech_pending() tracks both the dispatched-but-
  unacked flag and pipeline SPEAKING; settle_to_terminal() returns None
  when the guard refuses.
* Renderer disconnect while speech is pending force-settles (the ws
  finally block uses the public API — no private access).

The button-confirm guard (ws._sync_state_after_resolve) is covered by
test_voice_tts_lifecycle.py::test_confirm_during_tts_does_not_settle_to_listening.
"""

import asyncio
import time

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from arsvox_agent.app import create_app
from arsvox_agent.local_intents import match_intent
from arsvox_contracts import VoiceState

from tests.python.harness_fixtures import base_config, ws_collect
from tests.python.test_reconnect_snapshot import _scripted


# --------------------------------------------------------------------- #
# R01 — spoken STOP (utterance-level vocabulary, end to end)
# --------------------------------------------------------------------- #


def _slow_scripted(delay=5.0):
    async def handler(messages, info):
        await asyncio.sleep(delay)
        return ModelResponse(parts=[TextPart(content="Listo.")])

    return FunctionModel(handler)


def test_r01_spoken_stop_cancels_running_turn(script_client):
    """'detente' mid-turn: the utterance must be consumed as the STOP
    command (stopping -> sleeping), never reach the model, and no
    agent_message may follow the stop."""
    c = script_client(_slow_scripted(delay=5))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        ws.send_json({"type": "user_text", "text": "cuéntame un chiste largo"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "user_message",
        )
        ws.send_json({"type": "user_text", "text": "detente"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "sleeping",
        )
        states = [e["voice_state"] for e in events if e["type"] == "state_update"]
        assert "stopping" in states, states
        assert states[-1] == "sleeping", states
        # the spoken STOP is a command, not a message: no partial reply
        assert not any(e["type"] == "agent_message" for e in events)


def test_r01_other_stop_utterances_are_commands(script_client):
    """The remaining vocabulary (stop, alto, basta, detén, detente por
    favor) must behave identically: consumed locally, state sleeping."""
    for utterance in ("alto", "basta", "detén", "detente por favor"):
        c = script_client(_slow_scripted(delay=5))
        with c.websocket_connect("/ws") as ws:
            ws.receive_json()
            ws.receive_json()
            ws.send_json({"type": "user_text", "text": "cuéntame algo"})
            ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "user_message",
            )
            ws.send_json({"type": "user_text", "text": utterance})
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "state_update"
                and e["voice_state"] == "sleeping",
            )
            states = [e["voice_state"] for e in events if e["type"] == "state_update"]
            assert states[-1] == "sleeping", (utterance, states)
            assert not any(e["type"] == "agent_message" for e in events), utterance


# --------------------------------------------------------------------- #
# R36 — ambiguous sí/no outside confirmation mode is ignored
# --------------------------------------------------------------------- #


def test_r36_ambiguous_si_no_never_match_intent():
    """The conservative rule: bare 'sí'/'no' (and common variants) are
    NOT commands outside confirmation mode — they are normal messages."""
    for text in ("sí", "no", "si", "sí, gracias", "no, gracias"):
        assert match_intent(text) is None, text


def test_r36_bare_si_ignored_without_pending(script_client):
    """With NO pending confirmation, a bare 'sí'/'no' is IGNORED
    (conservative, R35/R36): the utterance is consumed — it must not
    resolve anything and must not start a model turn (no agent_message,
    no confirmation_resolved). A ping synchronizes the assertion (the
    ignore path emits nothing)."""
    c = script_client(_scripted("telegram_prepare_message", {"text": "hola"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        ws.receive_json()  # state_snapshot
        for utterance in ("sí", "no"):
            ws.send_json({"type": "user_text", "text": utterance})
            ws.send_json({"type": "ping"})
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "pong",
                max_events=12,
            )
            assert not [e for e in events if e["type"] == "agent_message"], (
                f"bare '{utterance}' outside confirmation mode must not start a turn"
            )
            assert not [e for e in events if e["type"] == "confirmation_resolved"]


# --------------------------------------------------------------------- #
# R35 — spoken approval executes the frozen pending args
# --------------------------------------------------------------------- #


def test_r35_spoken_confirmar_approves_pending(script_client):
    """'confirmar' with a pending confirmation must execute the frozen
    pending args (approve): the wire reports confirmation_resolved with
    status executed and the DB row resolves. Break ONLY on the resolved
    event for THIS pending_id — turn-1 leftovers (tool_call,
    agent_message) arrive after confirmation_requested, so a loose break
    on agent_message would terminate on the stale turn-1 reply."""
    c = script_client(_scripted("telegram_prepare_message", {"text": "hola"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "envía un mensaje"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_requested",
        )
        pending_id = [e for e in events if e["type"] == "confirmation_requested"][-1][
            "pending_id"
        ]
        services = c.app.state.services

        ws.send_json({"type": "user_text", "text": "confirmar"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: (
                e["type"] == "confirmation_resolved"
                and e["pending_id"] == pending_id
                and e["status"] in ("executed", "cancelled", "failed")
            ),
        )
        resolved = [e for e in events if e["type"] == "confirmation_resolved"][-1]
        assert resolved["pending_id"] == pending_id
        assert resolved["status"] == "executed"
        assert "Mensaje enviado" in resolved["message"]
        row = services.pending.get(pending_id)
        assert row is not None and row["status"] == "executed"


# --------------------------------------------------------------------- #
# fixture: script_client (same pattern as test_reconnect_snapshot.py)
# --------------------------------------------------------------------- #


@pytest.fixture
def script_client(client, monkeypatch):
    def _patch(model_builder):
        monkeypatch.setattr("arsvox_agent.runtime.build_model", lambda cfg: model_builder)
        return client

    return _patch


# ===================================================================== #
# W1-VOICE — spoken confirmation × TTS races (unified settle derivation)
# ===================================================================== #


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


def _patch_model(client, monkeypatch, model):
    monkeypatch.setattr("arsvox_agent.runtime.build_model", lambda cfg: model)
    return client


def _open_confirmation_then_speak(client, ws):
    """Drive one scripted turn that raises a confirmation AND dispatches
    the final auto-speak; returns (pending_id, events collected through
    the final tts.speak). The machine is THINKING with speech pending."""
    ws.send_json({"type": "user_text", "text": "prepara un mensaje"})
    events = ws_collect(
        client=client,
        ws=ws,
        expected_break=lambda e: e["type"] == "confirmation_requested",
    )
    reqs = [e for e in events if e["type"] == "confirmation_requested"]
    assert reqs, "expected a confirmation request"
    pending_id = reqs[-1]["pending_id"]
    # The telegram tool emits its own priority tts.speak before the
    # confirmation; the FINAL auto-speak arrives after it. Collect until
    # that final dispatch so _speech_pending is set (GATE-3.5 C4).
    events += ws_collect(
        client=client, ws=ws,
        expected_break=lambda e: e["type"] == "ui_command"
        and e["command"].get("action") == "tts.speak",
    )
    return pending_id, events


def test_spoken_approve_during_pending_tts_does_not_settle(tts_client, monkeypatch):
    """The core GATE-3.5 W1 bug: a spoken 'sí' resolved while TTS is
    dispatched-but-unacked (THINKING) must NOT settle the machine —
    previously runtime._handle_confirmation_utterance re-derived
    LISTENING mid-speech (no guard). Only the tts.finished ack settles,
    with the fresh (now empty) pending state."""
    c = _patch_model(
        tts_client, monkeypatch,
        _tool_then_text_model("telegram_prepare_message", {"text": "Hola, confirma esto"}),
    )
    runtime = c.app.state.services.runtime
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        ws.receive_json()  # state_snapshot
        pending_id, events = _open_confirmation_then_speak(c, ws)
        assert not any(
            e["type"] == "state_update" and e["voice_state"] == "listening"
            for e in events
        ), "LISTENING before speech ended (R05)"
        assert runtime.pipeline.state == VoiceState.THINKING
        assert runtime.is_speech_pending() is True

        # Spoken approve while speech is pending: the confirmation
        # resolves, the voice state must NOT move.
        ws.send_json({"type": "user_text", "text": "sí"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_resolved"
            and e["pending_id"] == pending_id
            and e["status"] in ("executed", "cancelled", "failed"),
        )
        resolved = [e for e in events if e["type"] == "confirmation_resolved"][-1]
        assert resolved["status"] == "executed"
        assert not any(
            e["type"] == "state_update" for e in events
        ), "spoken confirm mid-pending-speech must not move the voice state (R05)"
        assert runtime.pipeline.state == VoiceState.THINKING
        assert runtime.is_speech_pending() is True

        # The acks drive the machine home: started -> SPEAKING, then the
        # finished ack settles — to LISTENING (pending cleared).
        ws.send_json({"type": "tts.started"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "speaking",
        )
        assert events[-1]["voice_state"] == "speaking"
        ws.send_json({"type": "tts.finished"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "listening",
        )
        assert events[-1]["voice_state"] == "listening"
        assert runtime.is_speech_pending() is False


def test_spoken_approve_after_speech_ends_settles_with_fresh_pending(
    tts_client, monkeypatch
):
    """When speech fully ends BEFORE the spoken confirmation, the
    tts.finished ack settles to WAITING_FOR_CONFIRMATION (the pending
    row still exists), and the spoken 'sí' then settles LISTENING with
    the fresh pending state."""
    c = _patch_model(
        tts_client, monkeypatch,
        _tool_then_text_model("telegram_prepare_message", {"text": "Hola, confirma esto"}),
    )
    runtime = c.app.state.services.runtime
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        pending_id, _ = _open_confirmation_then_speak(c, ws)

        # Playback completes while the confirmation is still pending.
        ws.send_json({"type": "tts.started"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "speaking",
        )
        ws.send_json({"type": "tts.finished"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "waiting_for_confirmation",
        )
        assert events[-1]["voice_state"] == "waiting_for_confirmation"
        assert runtime.is_speech_pending() is False

        # No speech in flight: the spoken approve settles immediately,
        # with the fresh (now empty) pending state -> LISTENING.
        ws.send_json({"type": "user_text", "text": "sí"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "listening",
        )
        assert [e for e in events if e["type"] == "confirmation_resolved"], (
            "expected the spoken approval to resolve"
        )
        assert events[-1]["voice_state"] == "listening"


def test_is_speech_pending_tracks_flag_and_pipeline_speaking(tts_client, monkeypatch):
    """The public accessor covers both windows: dispatched-but-unacked
    (THINKING) and physically playing (pipeline SPEAKING); settle_to_terminal
    returns None while the guard refuses, and the published state once it
    passes."""
    c = _patch_model(tts_client, monkeypatch, _text_model())
    runtime = c.app.state.services.runtime
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        assert runtime.is_speech_pending() is False

        ws.send_json({"type": "user_text", "text": "dime algo"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "ui_command"
            and e["command"].get("action") == "tts.speak",
        )
        # dispatched but unacked: guard refuses the settle
        assert runtime.pipeline.state == VoiceState.THINKING
        assert runtime.is_speech_pending() is True
        assert runtime.settle_to_terminal() is None
        assert runtime.pipeline.state == VoiceState.THINKING

        # physically playing: still pending
        ws.send_json({"type": "tts.started"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "speaking",
        )
        assert runtime.is_speech_pending() is True
        assert runtime.settle_to_terminal() is None
        assert runtime.pipeline.state == VoiceState.SPEAKING

        # speech ended: the guard passes and the finished ack settles
        # (server-side publish — asserted over the wire; direct calls
        # from the test thread would need the portal's event loop).
        ws.send_json({"type": "tts.finished"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "listening",
        )
        assert runtime.is_speech_pending() is False
        assert runtime.pipeline.state == VoiceState.LISTENING


def test_disconnect_with_pending_speech_force_settles(tts_client, monkeypatch):
    """The renderer (the only playback authority) disconnects while a
    turn's speech is pending: no ack can ever arrive, so the ws finally
    block force-settles through the public API — the machine must not
    hang in THINKING with the silence timer disarmed."""
    c = _patch_model(tts_client, monkeypatch, _text_model())
    runtime = c.app.state.services.runtime
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "dime algo"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "ui_command"
            and e["command"].get("action") == "tts.speak",
        )
        assert runtime.pipeline.state == VoiceState.THINKING
        assert runtime.is_speech_pending() is True
        # exit the with block -> disconnect -> finally force-settles
    for _ in range(200):
        if runtime.pipeline.state == VoiceState.LISTENING:
            break
        time.sleep(0.01)
    assert runtime.pipeline.state == VoiceState.LISTENING, (
        "machine hung after renderer disconnect with pending speech"
    )
    assert runtime.is_speech_pending() is False
