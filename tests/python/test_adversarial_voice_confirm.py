"""GATE-3.5 A10 — adversarial integration tests R01/R35/R36: spoken STOP
and spoken confirmations across the full path.

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
"""

import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel

from arsvox_agent.local_intents import match_intent

from tests.python.conftest import ws_collect
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
