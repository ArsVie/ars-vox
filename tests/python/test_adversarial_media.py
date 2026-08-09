"""GATE-3.5 A10 — adversarial integration tests R24/R25: media authority.

R24 — agent play -> human pause -> human seek -> agent resume must route
      through ONE controller: after the agent's media.play tool, a human
      media.play_pause must REALLY pause (a media.state event), never the
      fake "no media loaded" verdict.
R25 — media.seek actually changes position: no fake "Posición cambiada".

Main today (verified 2026-08-08): the agent tool path (media_tools.py)
emits MediaStateChange commands directly and never touches the service
_MediaController (actions.py), so after an agent play the controller is
still STOPPED and human actions answer "done: no media loaded" without
emitting anything (R24 split-brain), and media.seek claims success with
no media loaded (R25 fake success). The tool-level seek also emits no
position at all (MediaStateChange has no position field).

EXPECTED-FAIL markers name the owner: A5 (Media authority) lands the
single controller + real seek.
"""

import asyncio

import pytest

from arsvox_contracts import MediaState
from arsvox_contracts.commands import MediaStateChange, PanelOpen
from arsvox_contracts.events import UiCommandEvent

from arsvox_agent.actions import reset_media_state
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.media_tools import media_play, media_seek

from tests.python.test_media_tools import _make_context
from tests.python.conftest import ws_collect
from tests.python.test_reconnect_snapshot import _scripted


def _media_state_commands(events):
    return [
        e.command
        for e in events
        if isinstance(e, UiCommandEvent) and isinstance(e.command, MediaStateChange)
    ]


# --------------------------------------------------------------------- #
# tool level: the agent's own seek must carry the position
# --------------------------------------------------------------------- #


def test_r25_tool_seek_emits_real_position():
    """Agent media.seek(30) after media.play must emit a media.state whose
    position is 30 — the renderer has no other channel to move the
    player. EXPECTED-FAIL until A5 lands (MediaStateChange carries no
    position today; the tool just says 'Posición cambiada')."""
    tctx, bus, _ = _make_context()
    asyncio.run(media_play(tctx, "dQw4w9WgXcQ"))
    asyncio.run(media_seek(tctx, 30))

    states = _media_state_commands(bus.events)
    assert states, "media.play must emit a media.state command"
    last = states[-1]
    # A5 adds position_s to the media.state command path; today the field
    # does not exist and the seek is a lie.
    assert getattr(last, "position_s", None) == 30, (
        "media.seek claims 'Posición cambiada' but emits no position"
    )


def test_r25_tool_seek_without_media_is_not_success():
    """media.seek with NOTHING loaded must not emit 'playing' nor claim a
    position change. EXPECTED-FAIL until A5 lands (today it emits
    MediaStateChange(PLAYING) and returns 'Posición cambiada a 30
    segundos.')."""
    tctx, bus, _ = _make_context()
    result = asyncio.run(media_seek(tctx, 30))

    states = _media_state_commands(bus.events)
    assert not states, "seek with no media loaded must not fake a playing state"
    assert "cambiado" not in result.lower(), (
        "seek with no media loaded must not claim a position change"
    )


# --------------------------------------------------------------------- #
# e2e over /ws: one controller for agent + human (R24)
# --------------------------------------------------------------------- #


def _media_states(events):
    """Media states observed on the wire, in order, from either the
    MediaStateEvent path (type media.state) or the tool/command path
    (ui_command with action media.state). A5's controller may emit either
    shape; the assertion contract is state-sequence, not shape."""
    out = []
    for e in events:
        if e["type"] == "media.state":
            out.append(("state", e["state"]))
        elif e["type"] == "ui_command":
            cmd = e.get("command") or {}
            if cmd.get("action") == "media.state" and cmd.get("state"):
                out.append(("state", cmd["state"]))
    return [s for _, s in out]


def test_r24_agent_play_then_human_pause_seek_resume(script_client):
    """Agent play -> human pause -> human seek -> human resume must all
    route through ONE controller: every human action emits an
    authoritative media.state. EXPECTED-FAIL until A5 lands (today the
    tool path and the client-action controller are split brains: human
    actions answer 'done: no media loaded' and emit nothing)."""
    reset_media_state()
    c = script_client(_scripted("media.play", {"result_id": "dQw4w9WgXcQ"}))
    try:
        with c.websocket_connect("/ws") as ws:
            ws.receive_json()  # state_update
            ws.receive_json()  # config_update
            ws.send_json({"type": "user_text", "text": "pon música"})
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "state_update"
                and e["voice_state"] == "listening",
            )
            states = _media_states(events)
            assert states and states[-1] == "playing", (
                "agent play must reach the controller (emitted playing)"
            )

            ws.send_json({"type": "ui_command", "command": {"action": "media.play_pause"}})
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "action_result",
            )
            states = _media_states(events)
            assert states and states[-1] == "paused", (
                "human pause after agent play must emit media.state paused "
                "(split-brain: controller answered 'no media loaded')"
            )

            ws.send_json(
                {"type": "ui_command", "command": {"action": "media.seek", "position_s": 30}}
            )
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "action_result",
            )
            # R25: the seek must actually change position on the wire —
            # some media-state shape carrying position_s == 30.
            positioned = [
                e
                for e in events
                if (e["type"] == "media.state" and e.get("position_s") == 30)
                or (
                    e["type"] == "ui_command"
                    and (e.get("command") or {}).get("action") == "media.state"
                    and (e.get("command") or {}).get("position_s") == 30
                )
            ]
            assert positioned, (
                "media.seek must emit the new position (no fake 'Posición cambiada')"
            )

            ws.send_json({"type": "ui_command", "command": {"action": "media.play_pause"}})
            events = ws_collect(
                client=c, ws=ws,
                expected_break=lambda e: e["type"] == "action_result",
            )
            states = _media_states(events)
            assert states and states[-1] == "paused", (
                "resume must toggle back to paused (one controller, no fake acks)"
            )
    finally:
        reset_media_state()


def test_r25_seek_without_media_is_failed_verdict(script_client):
    """media.seek with nothing loaded must be failed/unsupported — the UI
    must not believe a position change happened. EXPECTED-FAIL until A5
    lands (today the verdict is done: 'no media loaded')."""
    reset_media_state()
    c = script_client(_scripted("notes.add", {"text": "nada"}))
    try:
        with c.websocket_connect("/ws") as ws:
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
