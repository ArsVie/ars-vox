"""GATE-3.5 A10 — adversarial integration tests R24/R25: media authority.

Landed A5 behavior (verified 2026-08-09):
  * ONE service-side MediaController (arsvox_agent/media.py) serves the
    agent media tools, client actions and the demo tool. Every transition
    publishes ONE full MediaStateEvent — wire type "media.state" with
    state/source/kind/title/video_id/url/position_s/duration_s/volume.
    There is NO MediaStateChange ui_command path anymore.
  * media.seek really moves the position: the emitted media.state carries
    position_s == target (R25). With nothing loaded it is an honest
    failed/unsupported verdict — never a fake success or a lying
    "Posición cambiada" message.
  * Scripted-model turns call tools by their MODEL-VISIBLE name:
    build_pydantic_tools flattens dotted registry names (media.play ->
    media_play) because the live provider (Console Go / opencode-go)
    rejects dots. A scripted model that emits the internal dotted name
    hits pydantic-ai's unknown-tool retry (ModelRetry) and the tool
    silently never runs — no tool_call event, no error, the model's next
    text response is taken. That was the root cause of the G1 media.play
    probe gap; test_scripted_media_play_emits_tool_call_and_media_state
    locks the fixed path (tool_call events + media.state playing on the
    WS + ToolCallStore rows).
"""

import asyncio

import pytest

from arsvox_contracts import MediaState
from arsvox_contracts.events import MediaStateEvent

from arsvox_agent.actions import reset_media_state
from arsvox_agent.media import media_controller
from arsvox_agent.tools.media_tools import media_play, media_seek

from tests.python.test_media_tools import _make_context, seed_offered
from tests.python.conftest import ws_collect
from tests.python.test_reconnect_snapshot import _scripted


def _media_states(events):
    """Wire media.state events, in order, as (state, position_s) tuples."""
    return [
        (e["state"], e.get("position_s"))
        for e in events
        if e["type"] == "media.state"
    ]


def _tool_calls(events, tool=None):
    """tool_call wire events, optionally filtered by tool name."""
    return [
        e for e in events
        if e["type"] == "tool_call" and (tool is None or e["tool"] == tool)
    ]


def _collect_turn(ws, text):
    """Send user text and collect until the SECOND listening state_update
    (the post-turn settle).

    The FIRST listening is the WAKE (sleeping -> listening) that arrives
    BEFORE the turn events; the connect-time state_update + config_update
    + state_snapshot trio must be consumed before calling. Breaking on
    the second listening guarantees the whole turn (tool execution,
    media.state events, final agent_message) has landed.
    """
    ws.send_json({"type": "user_text", "text": text})
    events = []
    listening = 0
    for _ in range(80):
        ev = ws.receive_json()
        events.append(ev)
        if ev["type"] == "state_update" and ev["voice_state"] == "listening":
            listening += 1
            if listening >= 2:
                break
    return events


# --------------------------------------------------------------------- #
# tool level: the agent's own seek must carry the position
# --------------------------------------------------------------------- #


def test_r25_tool_seek_emits_real_position():
    """Agent media.seek(30) after media.play must emit a media.state whose
    position is 30 — the renderer has no other channel to move the
    player."""
    reset_media_state()
    # GATE-5 (W1-YOUTUBE): play resolves against the OFFERED set — the
    # scripted agent already searched, so seed that precondition.
    seed_offered()
    tctx, bus, _ = _make_context()

    asyncio.run(media_play(tctx, "dQw4w9WgXcQ"))
    result = asyncio.run(media_seek(tctx, 30))

    states = [e for e in bus.events if isinstance(e, MediaStateEvent)]
    assert states, "media.play must emit a media.state event"
    assert states[-1].state == MediaState.PLAYING
    assert states[-1].position_s == 30, (
        "media.seek must emit the real target position (no fake "
        "'Posición cambiada' without a position)"
    )
    # The controller really moved — the message is not a lie.
    assert "30" in result
    assert media_controller.position_s == 30


def test_r25_tool_seek_without_media_is_not_success():
    """media.seek with NOTHING loaded must not emit 'playing' nor claim a
    position change — the result must be an honest no-op verdict."""
    reset_media_state()
    tctx, bus, _ = _make_context()

    result = asyncio.run(media_seek(tctx, 30))

    states = [e for e in bus.events if isinstance(e, MediaStateEvent)]
    assert not states, "seek with no media loaded must not fake a media.state"
    assert "posición cambiada" not in result.lower(), (
        "seek with no media loaded must not claim a position change"
    )


# --------------------------------------------------------------------- #
# e2e over /ws: one controller for agent + human (R24)
# --------------------------------------------------------------------- #


def test_r24_agent_play_then_human_pause_seek_resume(script_client):
    """Agent play -> human pause -> human seek -> human resume must all
    route through ONE controller: every human action emits an
    authoritative media.state and the seek really moves the position."""
    reset_media_state()
    # GATE-5 (W1-YOUTUBE): the scripted agent's media.play resolves
    # against the OFFERED set — seed the 'already searched' precondition.
    seed_offered()
    c = script_client(_scripted("media_play", {"result_id": "dQw4w9WgXcQ"}))
    try:
        with c.websocket_connect("/ws") as ws:
            ws.receive_json()  # state_update
            ws.receive_json()  # config_update
            ws.receive_json()  # state_snapshot
            events = _collect_turn(ws, "pon música")
            states = _media_states(events)
            assert states and states[-1][0] == "playing", (
                "agent play must reach the controller (emitted playing)"
            )

            # human pause: the controller holds the agent's track
            ws.send_json({"type": "ui_command", "command": {"action": "media.play_pause"}})
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "action_result",
            )
            states = _media_states(events)
            assert states and states[-1][0] == "paused", (
                "human pause after agent play must emit media.state paused "
                "(split-brain: controller answered 'no media loaded')"
            )

            # human seek: R25 — the wire must carry the real position
            ws.send_json(
                {"type": "ui_command", "command": {"action": "media.seek", "position_s": 30}}
            )
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "action_result",
            )
            assert any(pos == 30 for _, pos in _media_states(events)), (
                "media.seek must emit the new position (no fake 'Posición cambiada')"
            )

            # resume toggles back to playing through the same controller
            ws.send_json({"type": "ui_command", "command": {"action": "media.play_pause"}})
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "action_result",
            )
            states = _media_states(events)
            assert states and states[-1][0] == "playing", (
                "resume must toggle back to playing (one controller, no fake acks)"
            )
    finally:
        reset_media_state()


def test_r25_seek_without_media_is_failed_verdict(script_client):
    """media.seek with nothing loaded must be failed/unsupported — the UI
    must not believe a position change happened."""
    reset_media_state()
    c = script_client(_scripted("notes_add", {"text": "nada"}))
    try:
        with c.websocket_connect("/ws") as ws:
            ws.receive_json()
            ws.receive_json()
            ws.receive_json()
            ws.send_json(
                {"type": "ui_command", "command": {"action": "media.seek", "position_s": 30}}
            )
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "action_result",
            )
            verdict = [e for e in events if e["type"] == "action_result"][-1]
            assert verdict["status"] in ("failed", "unsupported"), (
                f"seek with no media loaded must not be a fake success (got {verdict['status']})"
            )
            assert not [pos for _, pos in _media_states(events) if pos == 30], (
                "seek with no media loaded must not emit a position"
            )
    finally:
        reset_media_state()


# --------------------------------------------------------------------- #
# regression (G1): the scripted media.play turn must really execute
# --------------------------------------------------------------------- #


def test_scripted_media_play_emits_tool_call_and_media_state(script_client):
    """REGRESSION for the G1 root cause: a scripted media.play turn must
    emit tool_call events, a media.state playing event on the WS, and
    ToolCallStore rows.

    The probe gap: the scripted model emitted the INTERNAL dotted name
    "media.play", but build_pydantic_tools registers the model-facing
    tool under the FLATTENED wire name "media_play" (the live provider
    rejects dots). pydantic-ai's unknown-tool retry swallowed the call
    silently — no tool_call event, no error, the model's next text
    response was taken. This test uses the model-visible name and locks
    the whole path: execute_gated runs, ToolCallEvent lands, the
    controller emits media.state playing."""
    reset_media_state()
    # GATE-5 (W1-YOUTUBE): the scripted agent's media.play resolves
    # against the OFFERED set — seed the 'already searched' precondition.
    seed_offered()
    c = script_client(_scripted("media_play", {"result_id": "dQw4w9WgXcQ"}))
    try:
        with c.websocket_connect("/ws") as ws:
            ws.receive_json()  # state_update
            ws.receive_json()  # config_update
            ws.receive_json()  # state_snapshot
            events = _collect_turn(ws, "pon música")

        calls = _tool_calls(events, tool="media.play")
        assert calls, "scripted media_play turn must emit tool_call events"
        assert calls[-1]["status"] == "done", "the media.play call must finish done"

        states = _media_states(events)
        assert states and states[-1][0] == "playing", (
            "media.state playing must land on the wire"
        )
        assert states[-1][1] == 0  # fresh play starts at position 0

        # ToolCallStore (first diagnostic): the row exists — the tool
        # really executed through execute_gated, not just claimed.
        services = c.app.state.services
        rows = services.tool_calls.for_run(calls[0]["run_id"])
        assert any(
            r["tool"] == "media.play" and r["status"] == "done" for r in rows
        ), "ToolCallStore must record the executed media.play row"

        assert not [e for e in events if e["type"] == "error"], (
            "the turn must not surface error events"
        )
    finally:
        reset_media_state()


# --------------------------------------------------------------------- #
# fixture: script_client (same pattern as test_reconnect_snapshot.py)
# --------------------------------------------------------------------- #


@pytest.fixture
def script_client(client, monkeypatch):
    def _patch(model_builder):
        monkeypatch.setattr("arsvox_agent.runtime.build_model", lambda cfg: model_builder)
        return client

    return _patch
