"""H1: client action protocol — fixture conformance + WS end-to-end.

The shared fixture (packages/contracts/fixtures/client_actions.json) is
the cross-language bridge: every TS UiCommand action has one real frame
here, this file proves every frame parses and round-trips through
parse_client_message, and apps/desktop/tests/client-actions.test.ts
proves the TS side enumerates exactly this set.
"""

import hashlib
import json
from pathlib import Path

import pytest

from arsvox_contracts import parse_client_message

from tests.python.conftest import ws_collect

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "packages" / "contracts" / "fixtures" / "client_actions.json"

KNOWN_ACTIONS = [
    "layout.apply",
    "panel.open",
    "panel.close",
    "panel.set_primary",
    "panel.fullscreen",
    "layout.restore",
    "notification.show",
    "media.state",
    "media.play_pause",
    "media.seek",
    "youtube.search",
    "youtube.play",
    "browser.navigate",
    "browser.back",
    "browser.forward",
    "browser.refresh",
    "document.save",
    "tasks.toggle",
    "tts.speak",
    "audio.play",
]


@pytest.fixture(scope="module")
def fixtures() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


# --------------------------------------------------------------------- #
# Fixture conformance (parse side)
# --------------------------------------------------------------------- #


def test_fixture_covers_every_action(fixtures):
    actions = sorted(k for k in fixtures if not k.startswith("_"))
    assert actions == sorted(KNOWN_ACTIONS), (
        f"fixture drift: {set(actions) ^ set(KNOWN_ACTIONS)}"
    )


def test_every_fixture_frame_parses_and_roundtrips(fixtures):
    for action, frame in fixtures.items():
        if action.startswith("_"):
            continue
        msg = parse_client_message(json.dumps(frame))
        assert msg.type == "ui_command", action
        assert msg.command.action == action, action


def test_fixture_payloads_roundtrip_exactly(fixtures):
    checks = {
        "browser.navigate": ("url", "https://example.com/docs"),
        "tasks.toggle": ("task_id", "1"),
        "document.save": ("panel_type", "document_editor"),
        "media.seek": ("position_s", 42),
        "youtube.search": ("query", "carpintería"),
        "audio.play": ("asset", "chime.wav"),
        "panel.open": ("panel_type", "document_editor"),
        "notification.show": ("kind", "info"),
        "layout.apply": ("template", "split"),
    }
    for action, (field, expected) in checks.items():
        msg = parse_client_message(json.dumps(fixtures[action]))
        assert getattr(msg.command, field) == expected, action


def test_unknown_action_raises():
    with pytest.raises(Exception):
        parse_client_message(
            json.dumps({"type": "ui_command", "command": {"action": "bogus.nope"}})
        )


def test_legacy_client_messages_still_parse():
    for raw in (
        '{"type": "user_text", "text": "hola"}',
        '{"type": "confirm", "pending_id": "p1"}',
        '{"type": "cancel", "pending_id": "p1"}',
        '{"type": "stop"}',
        '{"type": "ping"}',
    ):
        parse_client_message(raw)


def test_ui_command_requires_command():
    with pytest.raises(Exception):
        parse_client_message('{"type": "ui_command"}')


# --------------------------------------------------------------------- #
# WS end-to-end: authoritative effects + action_result verdicts
# --------------------------------------------------------------------- #


def _connect(ws):
    ws.receive_json()  # state_update
    ws.receive_json()  # config_update


def _result(events, action):
    hits = [e for e in events if e["type"] == "action_result" and e["action"] == action]
    assert hits, f"no action_result for {action} in {events}"
    return hits[-1]


def test_unknown_action_replies_failed_and_loop_survives(client):
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json({"type": "ui_command", "command": {"action": "bogus.nope"}})
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        verdict = _result(events, "bogus.nope")
        assert verdict["status"] == "failed"
        # the receive loop is still alive: ping still answers
        ws.send_json({"type": "ping"})
        got = ws.receive_json()
        while got["type"] != "pong":
            got = ws.receive_json()
        assert got["type"] == "pong"


def test_unsupported_action_replies_unsupported(client):
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json(
            {
                "type": "ui_command",
                "command": {
                    "action": "layout.apply",
                    "template": "split",
                    "primary_panel": "document_editor",
                    "secondary_panel": "conversation",
                },
            }
        )
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "layout.apply")["status"] == "unsupported"


def test_tasks_toggle_persists_and_emits_tasks_update(client):
    services = client.app.state.services
    task_id = services.tasks.add("Comprar pan")
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json(
            {"type": "ui_command", "command": {"action": "tasks.toggle", "task_id": str(task_id)}}
        )
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        verdict = _result(events, "tasks.toggle")
        assert verdict["status"] == "done"
        # persisted in the real store
        assert services.tasks.get(task_id)["status"] == "done"
        # authoritative tasks.update emitted with the new state
        updates = [e for e in events if e["type"] == "tasks.update"]
        assert updates, "expected a tasks.update event"
        todo = next(t for t in updates[-1]["todos"] if t["id"] == str(task_id))
        assert todo["done"] is True
    # toggle back -> pending
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json(
            {"type": "ui_command", "command": {"action": "tasks.toggle", "task_id": str(task_id)}}
        )
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "tasks.toggle")["status"] == "done"
        assert services.tasks.get(task_id)["status"] == "pending"


def test_tasks_toggle_unknown_task_fails(client):
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json(
            {"type": "ui_command", "command": {"action": "tasks.toggle", "task_id": "99999"}}
        )
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "tasks.toggle")["status"] == "failed"


def test_document_save_persists(client):
    services = client.app.state.services
    doc_dir = Path(services.config.memory.documents_dir)
    path = doc_dir / "mi-doc.md"
    path.write_text("v1", encoding="utf-8")
    doc_id = services.documents.create("Mi doc", str(path))
    services.panels.upsert("document_editor", "Mi doc", str(doc_id))
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json(
            {
                "type": "ui_command",
                "command": {
                    "action": "document.save",
                    "panel_type": "document_editor",
                    "content": "## v2\n\ncontenido nuevo",
                },
            }
        )
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        verdict = _result(events, "document.save")
        assert verdict["status"] == "done"
        # real persistence: file bytes + DB content hash
        assert path.read_text(encoding="utf-8") == "## v2\n\ncontenido nuevo"
        digest = hashlib.sha256("## v2\n\ncontenido nuevo".encode("utf-8")).hexdigest()
        assert services.documents.get(doc_id)["content_hash"] == digest
        # audit trail has the save (tool handler logs it)
        rows = services.audit.recent()
        assert any(r["category"] == "document" and r["action"] == "saved" for r in rows)


def test_document_save_without_open_document_fails(client):
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json(
            {
                "type": "ui_command",
                "command": {
                    "action": "document.save",
                    "panel_type": "document_editor",
                    "content": "huérfano",
                },
            }
        )
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "document.save")["status"] == "failed"


def test_browser_navigate_emits_authoritative_event(client):
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json(
            {
                "type": "ui_command",
                "command": {"action": "browser.navigate", "url": "https://example.com/docs"},
            }
        )
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "browser.navigate")["status"] == "done"
        navs = [e for e in events if e["type"] == "browser.navigate"]
        assert navs and navs[-1]["url"] == "https://example.com/docs"
        assert navs[-1]["loading"] is True


def test_browser_local_actions_acknowledged(client):
    for action in ("browser.back", "browser.forward", "browser.refresh"):
        with client.websocket_connect("/ws") as ws:
            _connect(ws)
            ws.send_json({"type": "ui_command", "command": {"action": action}})
            events = ws_collect(
                client=client, ws=ws,
                expected_break=lambda e: e["type"] == "action_result",
            )
            assert _result(events, action)["status"] == "done"


def test_youtube_play_acknowledged_client_local(client):
    # YoutubePanel plays the selected video locally (MediaDock iframe); the
    # backend acknowledges receipt (done) — never a spurious error banner.
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json({
            "type": "ui_command",
            "command": {"action": "youtube.play", "video_id": "dQw4w9WgXcQ", "title": "x"},
        })
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        verdict = _result(events, "youtube.play")
        assert verdict["status"] == "done"


def test_audio_play_play_pause_seek_emit_media_state(client):
    from arsvox_agent.actions import reset_media_state

    reset_media_state()
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json({"type": "ui_command", "command": {"action": "audio.play", "asset": "chime.wav"}})
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "audio.play")["status"] == "done"
        media = [e for e in events if e["type"] == "media.state"]
        assert media and media[-1]["state"] == "playing"
        assert media[-1]["kind"] == "audio"
        assert media[-1]["title"] == "chime.wav"

        ws.send_json({"type": "ui_command", "command": {"action": "media.play_pause"}})
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "media.play_pause")["status"] == "done"
        media = [e for e in events if e["type"] == "media.state"]
        assert media and media[-1]["state"] == "paused"

        ws.send_json({"type": "ui_command", "command": {"action": "media.seek", "position_s": 30}})
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "media.seek")["status"] == "done"
        media = [e for e in events if e["type"] == "media.state"]
        assert media and media[-1]["position_s"] == 30
    reset_media_state()


def test_youtube_search_emits_results_event(client):
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        ws.send_json(
            {"type": "ui_command", "command": {"action": "youtube.search", "query": "carpintería"}}
        )
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        verdict = _result(events, "youtube.search")
        assert verdict["status"] == "done"
        searches = [e for e in events if e["type"] == "youtube.search"]
        assert searches and searches[-1]["query"] == "carpintería"
        assert searches[-1]["results"], "expected fixture results"
        # H7: fixture ids are real playable YouTube ids now (the media
        # surface derives videoId from the url and renders the embed)
        assert searches[-1]["results"][0]["id"] == "dQw4w9WgXcQ"
