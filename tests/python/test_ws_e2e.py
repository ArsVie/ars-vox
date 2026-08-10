"""End-to-end WebSocket tests against the real app (scripted model)."""

import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from tests.python.conftest import ws_collect


def _scripted(tool_name: str, args: dict, text: str = "Listo."):
    """FunctionModel that calls one tool, then answers with text."""
    state = {"step": 0}

    def handler(messages, info):
        if state["step"] == 0:
            state["step"] += 1
            return ModelResponse(parts=[ToolCallPart(tool_name=tool_name, args=args)])
        return ModelResponse(parts=[TextPart(content=text)])

    return FunctionModel(handler)


def _slow_scripted(delay: float):
    async def handler(messages, info):
        await asyncio.sleep(delay)
        return ModelResponse(parts=[TextPart(content="Listo.")])

    return FunctionModel(handler)


@pytest.fixture
def script_client(client, monkeypatch):
    def _patch(model_builder):
        monkeypatch.setattr("arsvox_agent.runtime.build_model", lambda cfg: model_builder)
        return client

    return _patch


def test_turn_emits_typed_ui_command(script_client):
    c = script_client(
        _scripted(
            "layout_compose",
            {
                "template": "sidecar",
                "assignments": [
                    {"surface": "document_editor", "role": "primary"},
                    {"surface": "conversation", "role": "companion"},
                ],
            },
        )
    )
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        ws.send_json({"type": "user_text", "text": "abre el documento"})
        # inject_text wakes the pipeline (sleeping -> listening) and emits one
        # state_update; the turn's final state_update emits the second one.
        # Break on the SECOND listening so the whole turn is captured.
        seen_listening = {"n": 0}

        def _break(e):
            if e["type"] == "state_update" and e["voice_state"] == "listening":
                seen_listening["n"] += 1
                return seen_listening["n"] >= 2
            return False

        events = ws_collect(client=c, ws=ws, expected_break=_break)
        errors = [e for e in events if e["type"] == "error"]
        assert not errors, f"error events received: {errors}"
        commands = [e["command"] for e in events if e["type"] == "ui_command"]
        assert commands, "expected a ui_command event"
        assert commands[0]["action"] == "layout.compose"
        assert commands[0]["template"] == "sidecar"
        assignments = commands[0]["assignments"]
        assert assignments == [
            {"surface_id": "document_editor", "role": "primary", "slot": "main"},
            {"surface_id": "conversation", "role": "companion", "slot": "side"},
        ]
        # the run ends listening (no pending confirmations)
        states = [e for e in events if e["type"] == "state_update"]
        assert states[-1]["voice_state"] == "listening"
        # session persisted
        services = c.app.state.services
        assert services.sessions.get(services.runtime.session_id)["turn_count"] >= 2


def test_slots_bearing_layout_survives_wire(script_client):
    """A3: a native layout.compose call emits the layout.compose command
    with the full derived assignments over the WS (triple template:
    primary + companion + support)."""
    c = script_client(
        _scripted(
            "layout_compose",
            {
                "template": "triple",
                "assignments": [
                    {"surface": "document_editor", "role": "primary"},
                    {"surface": "conversation", "role": "companion"},
                    {"surface": "tasks", "role": "support"},
                ],
                "proportion": "wide",
            },
        )
    )
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        ws.send_json({"type": "user_text", "text": "abre el documento con música"})
        seen_listening = {"n": 0}

        def _break(e):
            if e["type"] == "state_update" and e["voice_state"] == "listening":
                seen_listening["n"] += 1
                return seen_listening["n"] >= 2
            return False

        events = ws_collect(client=c, ws=ws, expected_break=_break)
        assert not [e for e in events if e["type"] == "error"], "error events received"
        commands = [e["command"] for e in events if e["type"] == "ui_command"]
        assert commands and commands[0]["action"] == "layout.compose"
        cmd = commands[0]
        assert cmd["template"] == "triple"
        assert cmd["proportion"] == "wide"
        assignments = cmd["assignments"]
        assert assignments == [
            {"surface_id": "document_editor", "role": "primary", "slot": "main"},
            {"surface_id": "conversation", "role": "companion", "slot": "side"},
            {"surface_id": "tasks", "role": "support", "slot": "rail"},
        ]


def test_telegram_confirmation_flow(script_client):
    c = script_client(_scripted("telegram_prepare_message", {"text": "Hola, necesito ayuda"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "envía un mensaje a ars"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_requested",
        )
        reqs = [e for e in events if e["type"] == "confirmation_requested"]
        assert reqs, "expected a confirmation request"
        pending_id = reqs[-1]["pending_id"]
        assert reqs[-1]["tool"] == "telegram.send_pending"
        assert "Hola, necesito ayuda" in reqs[-1]["detail"]

        # confirm -> executes the stored snapshot; H5: the terminal event
        # reports the execution outcome (executed), not the approval.
        ws.send_json({"type": "confirm", "pending_id": pending_id})
        events2 = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_resolved" and e["status"] == "executed",
        )
        resolved = [e for e in events2 if e["type"] == "confirmation_resolved"][0]
        assert "enviado" in resolved["message"].lower()
        # audit trail has the send
        services = c.app.state.services
        rows = services.audit.recent()
        assert any(r["category"] == "telegram" and r["action"] == "sent" for r in rows)


def test_cancel_aborts_pending(script_client):
    c = script_client(_scripted("telegram_prepare_message", {"text": "no enviar"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "prepara un mensaje"})
        events = ws_collect(client=c, ws=ws, expected_break=lambda e: e["type"] == "confirmation_requested")
        pending_id = [e for e in events if e["type"] == "confirmation_requested"][-1]["pending_id"]
        ws.send_json({"type": "cancel", "pending_id": pending_id})
        events2 = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_resolved" and e["status"] == "cancelled",
        )
        services = c.app.state.services
        rows = services.audit.recent()
        assert not any(r["category"] == "telegram" and r["action"] == "sent" for r in rows)


def test_stop_cancels_running_turn(script_client):
    c = script_client(_slow_scripted(delay=5))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "cuéntame un chiste largo"})
        ws_collect(client=c, ws=ws, expected_break=lambda e: e["type"] == "user_message")
        ws.send_json({"type": "stop"})
        events = ws_collect(client=c, ws=ws, expected_break=lambda e: e["type"] == "state_update" and e["voice_state"] == "sleeping")
        assert not any(e["type"] == "agent_message" for e in events)
        states = [e["voice_state"] for e in events if e["type"] == "state_update"]
        assert "stopping" in states
        assert states[-1] == "sleeping"


def test_local_intents_snooze_dismiss(script_client):
    c = script_client(_scripted("notes.add", {"text": "nada"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        services = c.app.state.services
        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)
        services.reminders.create(
            "Alarma de prueba", (now - timedelta(seconds=1)).isoformat(timespec="seconds"), "daily"
        )
        # wait for the scheduler to fire it (interval 1s)
        import time

        deadline = time.time() + 5
        while not services.notifications.list_active() and time.time() < deadline:
            time.sleep(0.2)
        assert services.notifications.list_active()
        # W1-TASKS (GATE-5): the fire ALSO starts a fresh agent turn
        # (cadence injection) — drain its frames (until the turn settles
        # back to listening) so the exchange below starts at the exchange.
        for _ in range(60):
            ev = ws.receive_json()
            if ev["type"] == "state_update" and ev["voice_state"] == "listening":
                break
        ws.send_json({"type": "user_text", "text": "posponer diez minutos"})
        events = ws_collect(client=c, ws=ws, expected_break=lambda e: e["type"] == "agent_message")
        texts = [e["text"] for e in events if e["type"] == "agent_message"]
        assert any("pospuesto" in t for t in texts)
        # notification resolved (snoozed)
        assert not services.notifications.list_active()
        # reminder still active with later due_at
        active = services.reminders.list_active()
        assert active and active[0]["due_at"] > now.isoformat(timespec="seconds")


def test_list_reminders_intent(script_client):
    c = script_client(_scripted("notes.add", {"text": "nada"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "¿qué alarmas tengo?"})
        events = ws_collect(client=c, ws=ws, expected_break=lambda e: e["type"] == "agent_message")
        texts = [e["text"] for e in events if e["type"] == "agent_message"]
        assert any("No tienes recordatorios" in t for t in texts)
