"""H5: reconnect recovery — state snapshot, one-pending confirmation
policy, cancel invalidation, explicit lifecycle, _turn context fix."""

import json

import pytest
from pydantic import TypeAdapter
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from arsvox_contracts import AgentEvent, VoiceState
from arsvox_contracts.events import (
    MediaStateEvent,
    PendingConfirmationSnapshot,
    StateSnapshotEvent,
)

from tests.python.conftest import ws_collect


@pytest.fixture
def script_client(client, monkeypatch):
    """Patch the model builder with a scripted FunctionModel (same pattern
    as test_ws_e2e.py — module-local there, so this file carries its own)."""

    def _patch(model_builder):
        monkeypatch.setattr("arsvox_agent.runtime.build_model", lambda cfg: model_builder)
        return client

    return _patch


def _scripted(tool_name: str, args: dict, text: str = "Listo."):
    """FunctionModel that calls one tool, then answers with text."""
    state = {"step": 0}

    def handler(messages, info):
        if state["step"] == 0:
            state["step"] += 1
            return ModelResponse(parts=[ToolCallPart(tool_name=tool_name, args=args)])
        return ModelResponse(parts=[TextPart(content=text)])

    return FunctionModel(handler)


def _text_only(text: str = "Listo."):
    def handler(messages, info):
        return ModelResponse(parts=[TextPart(content=text)])

    return FunctionModel(handler)


# --------------------------------------------------------------------- #
# snapshot event shape


def test_state_snapshot_event_shape_parses():
    snap = StateSnapshotEvent(
        sequence=7,
        voice_state=VoiceState.WAITING_FOR_CONFIRMATION,
        config={"ui": {"reduced_motion": True}},
        layout={
            "panels": [
                {"panel_type": "document_editor", "title": "Doc", "content_reference": "doc-1"}
            ]
        },
        pending_confirmation=PendingConfirmationSnapshot(
            pending_id="p1",
            tool="telegram.send_pending",
            title="Enviar",
            detail="hola",
            expires_in_s=30,
            expires_at="2026-01-01T00:00:00+00:00",
        ),
        media=MediaStateEvent(state="playing", source="youtube", kind="video", video_id="abc"),
        notifications=[{"notification_id": "1", "kind": "reminder", "title": "Alarma", "text": "x", "due_at": None}],
        content_keys=["doc-1"],
    )
    dumped = snap.model_dump(mode="json")
    parsed = StateSnapshotEvent.model_validate_json(json.dumps(dumped))
    assert parsed.sequence == 7
    assert parsed.voice_state == VoiceState.WAITING_FOR_CONFIRMATION
    assert parsed.pending_confirmation is not None
    assert parsed.pending_confirmation.pending_id == "p1"
    assert parsed.pending_confirmation.expires_in_s == 30
    assert parsed.media is not None and parsed.media.video_id == "abc"
    assert parsed.layout["panels"][0]["content_reference"] == "doc-1"
    assert parsed.content_keys == ["doc-1"]
    # discriminated union: parses as an AgentEvent (TypeAdapter — the
    # union is a plain Annotated alias, no model_validate on it)
    ev = TypeAdapter(AgentEvent).validate_python(dumped)
    assert ev.type == "state_snapshot"
    assert ev.sequence == 7


def test_snapshot_event_accepts_empty_state():
    snap = StateSnapshotEvent(
        sequence=0,
        voice_state=VoiceState.LISTENING,
        config={},
        layout={"panels": []},
    )
    assert snap.pending_confirmation is None
    assert snap.media is None
    assert snap.notifications == []
    assert snap.content_keys == []


# --------------------------------------------------------------------- #
# reconnect recovery (e2e over the real /ws endpoint)


def test_reconnect_recovers_pending_confirmation(script_client):
    c = script_client(_scripted("telegram_prepare_message", {"text": "hola"}))
    # connection 1: request a confirmation, then drop the socket
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        ws.receive_json()  # state_snapshot (H5)
        ws.send_json({"type": "user_text", "text": "envía un mensaje"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_requested",
        )
        pending_id = [e for e in events if e["type"] == "confirmation_requested"][-1]["pending_id"]
        assert pending_id
    # connection 2: the reconnect snapshot must replay the pending card
    with c.websocket_connect("/ws") as ws2:
        first = ws2.receive_json()
        second = ws2.receive_json()
        snap = ws2.receive_json()
        assert first["type"] == "state_update"
        assert second["type"] == "config_update"
        assert snap["type"] == "state_snapshot"
        assert snap["pending_confirmation"]["pending_id"] == pending_id
        assert snap["pending_confirmation"]["tool"] == "telegram.send_pending"
        assert snap["voice_state"] == "waiting_for_confirmation"
        # sequence: the snapshot is the current bus sequence; the next bus
        # event continues seamlessly at +1. The stale pending (never
        # resolved on connection 1) SURVIVES the reconnect: the turn still
        # runs, but the app settles back to WAITING_FOR_CONFIRMATION —
        # the card is never silently dropped.
        seq = snap["sequence"]
        ws2.send_json({"type": "user_text", "text": "cuéntame algo"})
        events2 = ws_collect(
            client=c, ws=ws2,
            expected_break=lambda e: e["type"] == "state_update"
            and e["voice_state"] == "waiting_for_confirmation",
        )
        assert events2[0]["type"] == "user_message"
        assert events2[0]["sequence"] == seq + 1
        settled = [e for e in events2 if e["type"] == "state_update"][-1]
        assert settled["voice_state"] == "waiting_for_confirmation"


def test_reconnect_snapshot_includes_layout_panels(script_client):
    c = script_client(
        _scripted(
            "ui_apply_layout",
            {"template": "split", "primary_panel": "document_editor", "side": "conversation"},
        )
    )
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "abre el documento"})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update" and e["voice_state"] == "listening",
        )
    with c.websocket_connect("/ws") as ws2:
        ws2.receive_json()
        ws2.receive_json()
        snap = ws2.receive_json()
        assert snap["type"] == "state_snapshot"
        panel_types = [p["panel_type"] for p in snap["layout"]["panels"]]
        assert "document_editor" in panel_types


def test_stop_cancels_pending_confirmation(script_client):
    """H5: the stop path invalidates pending confirmations — the row is
    cancelled and a cancelled event is emitted (documented semantic:
    stop/cancel aborts the action)."""
    c = script_client(_scripted("telegram_prepare_message", {"text": "x"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "prepara un mensaje"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_requested",
        )
        pending_id = [e for e in events if e["type"] == "confirmation_requested"][-1]["pending_id"]
        ws.send_json({"type": "stop"})
        events2 = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update" and e["voice_state"] == "sleeping",
        )
        services = c.app.state.services
        row = services.pending.get(pending_id)
        assert row["status"] == "cancelled"
        cancelled = [e for e in events2 if e["type"] == "confirmation_resolved"]
        assert cancelled and cancelled[-1]["status"] == "cancelled"


# --------------------------------------------------------------------- #
# _turn context duplication (P2 bonus)


def test_turn_context_does_not_duplicate_current_text(script_client):
    """The current user text must reach the model exactly once: it is the
    prompt header, and the recent-turn history is built BEFORE the turn is
    persisted (H5)."""
    seen = {}

    def handler(messages, info):
        for m in messages:
            for part in getattr(m, "parts", []):
                if type(part).__name__ == "UserPromptPart":
                    seen["prompt"] = str(part.content)
        return ModelResponse(parts=[TextPart(content="Listo.")])

    c = script_client(FunctionModel(handler))
    unique = "instrucción única de prueba h5-xyz"
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": unique})
        ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "state_update" and e["voice_state"] == "listening",
        )
    assert seen.get("prompt") is not None
    assert seen["prompt"].count(unique) == 1
    # the turn is still persisted for history (only the context is fixed)
    services = c.app.state.services
    assert services.sessions.get(services.runtime.session_id)["turn_count"] >= 2
