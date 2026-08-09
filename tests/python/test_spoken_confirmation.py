"""R35/R36: spoken confirmation semantics.

- R35: approve/reject utterances (whole-utterance, accent-stripped)
  resolve the single global pending confirmation and execute the FROZEN
  stored args.
- R36: a confirmation utterance with NO pending confirmation is IGNORED
  (conservative — never approves random things, never starts a turn on
  a bare sí/no).

Vocabulary tests are pure; behavior tests run through the real app over
the WS with a scripted model (pending confirmation created via
telegram.prepare_message).
"""

import json

import pytest

from arsvox_agent.local_intents import match_confirmation_utterance

from tests.python.conftest import ws_collect

APPROVE_UTTERANCES = [
    "sí",
    "Sí",
    "SI",
    "si",
    "sí,",
    "sí.",
    "sí por favor",
    "sí, por favor",
    "confirmar",
    "Confirmar",
    "confirmo",
    "confirmo.",
    "aprobar",
    "aprobar por favor",
    "sí enviar",
    "sí, enviar",
    "SÍ ENVIAR",
    # accent-stripped forms arrive from the matcher regardless of input
    # accentuation (STT often drops diacritics)
    "si enviar",
]

REJECT_UTTERANCES = [
    "no",
    "No",
    "NO",
    "no,",
    "no.",
    "no por favor",
    "cancelar",
    "Cancelar",
    "cancelar por favor",
    "rechazar",
    "rechazar.",
    "no enviar",
    "no, enviar",
    "no enviar por favor",
]

# Must NEVER resolve a confirmation (R35 negative set + R36): either the
# word appears mid-sentence, or it is a longer phrasing outside the
# frozen vocabulary. These fall through to the normal model turn.
NON_CONFIRMATION_UTTERANCES = [
    "sí quiero",
    "sí, claro",
    "sí, envíalo",
    "sí, adelante",
    "sí pero espera",
    "dime que sí",
    "si lo prefieres",
    "no sé",
    "no quiero",
    "no, gracias",
    "no es para tanto",
    "no me molestes",
    "cancelar la acción",
    "cancelar el envío",
    "confirmar el envío",
    "confirma el mensaje",
    "aprobar la solicitud",
    "enviar el mensaje",
    "sí, por favor, pero luego",
]


def test_approve_utterances_recognized():
    for utterance in APPROVE_UTTERANCES:
        assert match_confirmation_utterance(utterance) == "approve", utterance


def test_reject_utterances_recognized():
    for utterance in REJECT_UTTERANCES:
        assert match_confirmation_utterance(utterance) == "reject", utterance


def test_non_confirmation_utterances_never_match():
    for utterance in NON_CONFIRMATION_UTTERANCES:
        assert match_confirmation_utterance(utterance) is None, utterance


def test_confirmation_vocabulary_does_not_shadow_stop():
    # "no" must not be treated as a stop command and stop is not a
    # confirmation utterance — the vocabularies stay disjoint.
    from arsvox_agent.local_intents import match_intent

    assert match_confirmation_utterance("no") == "reject"
    assert match_intent("no") is None
    assert match_confirmation_utterance("stop") is None
    assert match_intent("stop").kind == "stop"


# --------------------------------------------------------------------- #
# Behavior through the real app (WS + scripted model)
# --------------------------------------------------------------------- #


def _scripted(tool_name: str, args: dict, text: str = "Listo."):
    """FunctionModel that calls one tool, then answers with text (same
    helper as test_ws_e2e)."""
    from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    state = {"step": 0}

    def handler(messages, info):
        if state["step"] == 0:
            state["step"] += 1
            return ModelResponse(parts=[ToolCallPart(tool_name=tool_name, args=args)])
        return ModelResponse(parts=[TextPart(content=text)])

    return FunctionModel(handler)


@pytest.fixture
def script_client(client, monkeypatch):
    def _patch(model_builder):
        monkeypatch.setattr("arsvox_agent.runtime.build_model", lambda cfg: model_builder)
        return client

    return _patch


def _open_pending(ws, client):
    """Drive one scripted turn that prepares a telegram message; returns
    the pending_id from the confirmation_requested event."""
    ws.send_json({"type": "user_text", "text": "prepara un mensaje"})
    events = ws_collect(
        expected_break=lambda e: e["type"] == "confirmation_requested",
        client=client,
        ws=ws,
    )
    reqs = [e for e in events if e["type"] == "confirmation_requested"]
    assert reqs, "expected a confirmation request"
    return reqs[-1]["pending_id"]


def test_spoken_approve_executes_frozen_pending(script_client):
    """R35 approve: the utterance 'sí' resolves the pending confirmation
    and the FROZEN stored args execute (never model-supplied)."""
    c = script_client(_scripted("telegram_prepare_message", {"text": "Hola, necesito ayuda"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        pending_id = _open_pending(ws, c)
        ws.send_json({"type": "user_text", "text": "sí"})
        events = ws_collect(
            expected_break=lambda e: (
                e["type"] == "confirmation_resolved"
                and e["pending_id"] == pending_id
                and e["status"] in ("executed", "cancelled", "failed")
            ),
            client=c,
            ws=ws,
        )
        resolved = [e for e in events if e["type"] == "confirmation_resolved"][-1]
        assert resolved["pending_id"] == pending_id
        assert resolved["status"] == "executed"
        assert "Mensaje enviado" in resolved["message"]


def test_spoken_reject_cancels_pending(script_client):
    """R35 reject: the utterance 'no' cancels the pending confirmation —
    nothing executes."""
    c = script_client(_scripted("telegram_prepare_message", {"text": "Hola"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        pending_id = _open_pending(ws, c)
        ws.send_json({"type": "user_text", "text": "no"})
        events = ws_collect(
            expected_break=lambda e: (
                e["type"] == "confirmation_resolved"
                and e["pending_id"] == pending_id
                and e["status"] in ("executed", "cancelled", "failed")
            ),
            client=c,
            ws=ws,
        )
        resolved = [e for e in events if e["type"] == "confirmation_resolved"][-1]
        assert resolved["status"] == "cancelled"
        # no telegram send may have happened
        rows = c.app.state.services.audit.recent()
        assert not any(
            r["category"] == "telegram" and r["action"] == "sent" for r in rows
        )


def test_spoken_cancelar_vocabulary_rejects(script_client):
    c = script_client(_scripted("telegram_prepare_message", {"text": "Hola"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        pending_id = _open_pending(ws, c)
        ws.send_json({"type": "user_text", "text": "cancelar"})
        events = ws_collect(
            expected_break=lambda e: (
                e["type"] == "confirmation_resolved"
                and e["pending_id"] == pending_id
                and e["status"] in ("executed", "cancelled", "failed")
            ),
            client=c,
            ws=ws,
        )
        resolved = [e for e in events if e["type"] == "confirmation_resolved"][-1]
        assert resolved["status"] == "cancelled"


def test_ambiguous_si_no_outside_confirmation_mode_ignored(script_client):
    """R36: a bare 'sí'/'no' with NO pending confirmation is ignored —
    no model turn starts (the scripted model would answer 'Listo.' and
    emit an agent_message; none may appear), nothing executes. A ping
    synchronizes the assertion (the ignore path emits nothing)."""
    c = script_client(_scripted("telegram_prepare_message", {"text": "Hola"}))
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


def test_longer_phrasing_still_reaches_the_model(script_client):
    """R36 boundary: 'sí quiero' is NOT a confirmation utterance — it is
    a normal turn the model answers."""
    c = script_client(_scripted("notes.add", {"text": "nada"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        ws.send_json({"type": "user_text", "text": "sí quiero"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "agent_message",
        )
        msgs = [e for e in events if e["type"] == "agent_message"]
        assert msgs and msgs[-1]["text"] == "Listo."
