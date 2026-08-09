"""GATE-3.5 A10 — adversarial integration tests R01/R35/R36: spoken STOP
and spoken confirmations across the full path.

R01 — spoken STOP during a running turn cancels generation and returns
      to SLEEPING with no partial reply (the utterance is consumed as a
      command, never delivered to the model).
R35 — spoken approval ("confirmar") executes the frozen pending
      confirmation; spoken rejection cancels it. EXPECTED-FAIL until A7
      lands (the confirm/reject vocabulary exists in the contract but is
      NOT wired: match_intent has no confirm/reject patterns and the
      utterance falls through to the model).
R36 — ambiguous "sí"/"no" OUTSIDE confirmation mode is ignored
      (conservative): the utterance is a normal message, the pending
      card is untouched.
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


def test_r36_si_does_not_resolve_pending(script_client):
    """With a pending confirmation, a bare 'sí' must NOT resolve it — the
    card survives and the utterance is a normal turn."""
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

        ws.send_json({"type": "user_text", "text": "sí"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "agent_message",
        )
        assert not any(e["type"] == "confirmation_resolved" for e in events), (
            "bare 'sí' must not resolve the pending confirmation"
        )
        row = services.pending.get(pending_id)
        assert row is not None and row["status"] == "pending"


# --------------------------------------------------------------------- #
# R35 — spoken approval executes the frozen pending args
# --------------------------------------------------------------------- #


def test_r35_spoken_confirmar_approves_pending(script_client):
    """'confirmar' with a pending confirmation must execute the frozen
    pending args (approve). EXPECTED-FAIL until A7 lands — today the
    confirm/reject vocabulary is not wired into match_intent/ws.py, so
    the utterance falls through to the model and the card survives."""
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
        # Break on whichever arrives first: today the utterance falls to
        # the model (agent_message); at the gate A7 resolves the card
        # (confirmation_resolved). Either way the collection terminates.
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_resolved"
            or e["type"] == "agent_message",
        )
        resolved = [e for e in events if e["type"] == "confirmation_resolved"]
        assert resolved and resolved[-1]["status"] == "approved", (
            "spoken approval must resolve the pending confirmation as approved "
            "(R35 — A7 wires the confirm vocabulary)"
        )
        row = services.pending.get(pending_id)
        assert row is None or row["status"] in ("approved", "executed")


# --------------------------------------------------------------------- #
# fixture: script_client (same pattern as test_reconnect_snapshot.py)
# --------------------------------------------------------------------- #


@pytest.fixture
def script_client(client, monkeypatch):
    def _patch(model_builder):
        monkeypatch.setattr("arsvox_agent.runtime.build_model", lambda cfg: model_builder)
        return client

    return _patch
