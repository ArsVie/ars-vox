"""H1/C1: client action protocol — fixture conformance + WS end-to-end.

The shared fixture (packages/contracts/fixtures/client_actions.json) is
the cross-language bridge: every TS ClientCommand action (the NARROWED
human-initiated set, C1) has one real frame here, this file proves every
frame parses and round-trips through parse_client_message, and
apps/desktop/tests/client-actions.test.ts proves the TS side enumerates
exactly this set. R39: any declared ClientAction that lacks an
authoritative handler fails here.
"""

import hashlib
import json
from pathlib import Path

import pytest

from arsvox_contracts import parse_client_message
from arsvox_contracts.adaptive import (
    AdaptiveTemplate,
    LayoutAssignment,
    Proportion,
    SurfaceRole,
)
from arsvox_contracts.client_messages import ClientAction
from arsvox_contracts.commands import (
    AudioPlay,
    BrowserBack,
    BrowserForward,
    BrowserNavigate,
    BrowserRefresh,
    DocumentSave,
    LayoutApply,
    LayoutCompose,
    LayoutRestore,
    MediaPlayPause,
    MediaSeek,
    MediaStateChange,
    NotificationShow,
    PanelClose,
    PanelFullscreen,
    PanelOpen,
    PanelSetPrimary,
    TasksToggle,
    TtsSpeak,
    YoutubePlay,
    YoutubeSearch,
)
from arsvox_contracts.enums import LayoutTemplate, MediaState, NotificationKind, PanelType

from arsvox_agent.actions import handle_ui_command, reset_media_state

from tests.python.conftest import ws_collect

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "packages" / "contracts" / "fixtures" / "client_actions.json"

# C1: the NARROWED human-initiated set. Server-originated commands
# (notification.show, media.state, tts.speak, audio.play) are NOT client
# actions — they travel server->client through the full UiCommand union.
# NOTE(g35r-dispatch): when W1-PYCONTRACT adds layout.compose to the
# ClientAction wire union + client_actions.json fixture, add
# "layout.compose" to KNOWN_ACTIONS here (the authoritative handler
# already exists and is pinned by
# test_layout_compose_has_authoritative_handler).
KNOWN_ACTIONS = [
    "layout.apply",
    "panel.open",
    "panel.close",
    "panel.set_primary",
    "panel.fullscreen",
    "layout.restore",
    "media.play_pause",
    "media.seek",
    "media.select_result",
    "youtube.search",
    "youtube.play",
    "browser.navigate",
    "browser.back",
    "browser.forward",
    "browser.refresh",
    "document.save",
    "tasks.toggle",
]

SERVER_ONLY_ACTIONS = ["notification.show", "media.state", "tts.speak", "audio.play"]


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
        "panel.open": ("panel_type", "document_editor"),
        "layout.apply": ("template", "split"),
    }
    for action, (field, expected) in checks.items():
        msg = parse_client_message(json.dumps(fixtures[action]))
        assert getattr(msg.command, field) == expected, action


# --------------------------------------------------------------------- #
# R39 / C1: the union is the NARROWED human-initiated set, and every
# declared ClientAction has an authoritative handler.
# --------------------------------------------------------------------- #


def _client_action_names() -> set[str]:
    """Introspect the ClientAction union (Annotated[Union[...], ...]).
    Handles both `action: Literal["x"] = "x"` and bare
    `action: Literal["x"]` variants."""
    from typing import get_args

    from pydantic_core import PydanticUndefined

    union = get_args(ClientAction)[0]
    names: set[str] = set()
    for variant in get_args(union):
        if not hasattr(variant, "model_fields"):
            continue
        field = variant.model_fields["action"]
        if field.default is not PydanticUndefined:
            names.add(field.default)
        else:
            literal_args = get_args(field.annotation)
            if literal_args and isinstance(literal_args[0], str):
                names.add(literal_args[0])
    return names


def test_client_action_union_is_narrowed_human_initiated_set():
    """R39/C1: ClientAction == the frozen human-initiated set; the full
    UiCommand surface keeps the server-originated commands."""
    union_actions = _client_action_names()
    assert union_actions == set(KNOWN_ACTIONS), (
        f"ClientAction drift: {union_actions ^ set(KNOWN_ACTIONS)}"
    )
    for server_only in SERVER_ONLY_ACTIONS:
        assert server_only not in union_actions, (
            f"{server_only} is server-originated and must not be client-initiable (C1)"
        )


def test_every_declared_client_action_has_authoritative_handler(client):
    """R39: the enumeration guard — each declared ClientAction frame is
    dispatched through the real app and must NEVER come back
    'unsupported' (no backend capability). 'done'/'accepted'/'failed'
    all prove an authoritative handler ran."""
    fixtures = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        ws.receive_json()  # state_snapshot
        for action in KNOWN_ACTIONS:
            ws.send_json(fixtures[action])
            events = ws_collect(
                client=client, ws=ws,
                expected_break=lambda e, a=action: (
                    e["type"] == "action_result" and e.get("action") == a
                ),
                max_events=25,
            )
            verdicts = [e for e in events if e["type"] == "action_result" and e["action"] == action]
            assert verdicts, f"no action_result for {action}"
            assert verdicts[-1]["status"] != "unsupported", (
                f"ClientAction {action} lacks an authoritative handler (R39)"
            )


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


def test_layout_apply_has_authoritative_handler(client):
    """C1: layout.apply is human-initiated — the service applies it
    (panel registry) and re-emits the authoritative ui_command event.
    (Was 'unsupported' before A7; R39 now requires a handler.)"""
    services = client.app.state.services
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
        verdict = _result(events, "layout.apply")
        assert verdict["status"] == "done"
        # service-side registry updated + authoritative event re-emitted
        assert any(p["id"] == "document_editor" for p in services.panels.list())
        echoed = [e for e in events if e["type"] == "ui_command"]
        assert echoed and echoed[-1]["command"]["action"] == "layout.apply"
        assert echoed[-1]["command"]["template"] == "split"


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


def test_media_play_pause_seek_have_authoritative_handlers(client):
    """C1: audio.play is server-originated — a client frame for it is
    rejected honestly (action_result failed, strict union parse), while
    the human media actions (play_pause/seek) keep authoritative
    handlers."""
    from arsvox_agent.actions import reset_media_state

    reset_media_state()
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        # server-originated action sent as a client frame -> parse fails
        ws.send_json({"type": "ui_command", "command": {"action": "audio.play", "asset": "chime.wav"}})
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "audio.play")["status"] == "failed"

        ws.send_json({"type": "ui_command", "command": {"action": "media.play_pause"}})
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        assert _result(events, "media.play_pause")["status"] == "done"

        ws.send_json({"type": "ui_command", "command": {"action": "media.seek", "position_s": 30}})
        events = ws_collect(
            client=client, ws=ws,
            expected_break=lambda e: e["type"] == "action_result",
        )
        # R25: seek with nothing loaded must NOT read as a success — the
        # UI must not believe a position change happened. The verdict is
        # an honest "failed" (understood but could not be applied).
        assert _result(events, "media.seek")["status"] == "failed"
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


# --------------------------------------------------------------------- #
# GATE-3.5 W1: layout.compose (C5/A3) + UiCommand exhaustiveness mirror
# --------------------------------------------------------------------- #


def _valid_compose_command() -> LayoutCompose:
    """A spec that passes the frozen adaptive invariants (LayoutSpec)
    AND the registered-surface gate (browser, conversation,
    document_editor, tasks, media)."""
    return LayoutCompose(
        template=AdaptiveTemplate.SIDECAR,
        assignments=[
            LayoutAssignment(
                surface_id="document_editor", role=SurfaceRole.PRIMARY, slot="main"
            ),
            LayoutAssignment(
                surface_id="conversation", role=SurfaceRole.COMPANION, slot="side"
            ),
        ],
        proportion=Proportion.BALANCED,
    )


def _drain(queue) -> list[dict]:
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    return events


async def test_layout_compose_has_authoritative_handler(client):
    """C5/A3 (W1): layout.compose must be handled authoritatively — the
    service validates it against the frozen adaptive invariants and
    re-emits the ui_command as the authoritative event (mirrors the
    agent-side layout.compose tool). Direct handler call: the client
    wire union does not carry layout.compose yet (W1-PYCONTRACT owns
    that addition; this test pins the handler so the action is never
    silently unsupported again)."""
    services = client.app.state.services
    command = _valid_compose_command()
    verdict = await handle_ui_command(services.deps_base, services.registry, command)
    assert verdict.status == "done"
    assert verdict.detail == "sidecar"
    # service-side audit trail
    assert any(
        r["category"] == "action" and r["action"] == "layout.compose"
        for r in services.audit.recent()
    )
    # authoritative event re-emitted on the bus
    q = services.deps_base.bus.subscribe()
    await handle_ui_command(services.deps_base, services.registry, command)
    echoed = [e for e in _drain(q) if e["type"] == "ui_command"]
    assert echoed and echoed[-1]["command"]["action"] == "layout.compose"
    assert echoed[-1]["command"]["template"] == "sidecar"
    assert echoed[-1]["command"]["assignments"][0]["surface_id"] == "document_editor"


async def test_layout_compose_unregistered_surface_fails(client):
    """The registered-surface gate (validate_layout_spec) runs
    server-side: an unregistered surface must be rejected and never
    re-emitted as an authoritative command."""
    services = client.app.state.services
    command = LayoutCompose(
        template=AdaptiveTemplate.SIDECAR,
        assignments=[
            LayoutAssignment(
                surface_id="telegram_preview", role=SurfaceRole.PRIMARY, slot="main"
            ),
            LayoutAssignment(
                surface_id="conversation", role=SurfaceRole.COMPANION, slot="side"
            ),
        ],
    )
    verdict = await handle_ui_command(services.deps_base, services.registry, command)
    assert verdict.status == "failed"
    assert "unregistered" in verdict.detail
    q = services.deps_base.bus.subscribe()
    await handle_ui_command(services.deps_base, services.registry, command)
    assert not [e for e in _drain(q) if e["type"] == "ui_command"]


async def test_every_ui_command_member_has_a_typed_case(client):
    """Runtime mirror of the type-level exhaustiveness guard in
    handle_ui_command (W1): every UiCommand member must map to a
    verdict; only the server-originated trio may be 'unsupported'. If a
    new member joins the union without a dispatch case, this test
    enumerates it and mypy's _assert_never tail fails at type-check —
    the drift class that produced the layout.compose gap."""
    services = client.app.state.services
    reset_media_state()
    client_initiable = [
        TasksToggle(task_id="1"),
        DocumentSave(panel_type="document_editor", content="x"),
        YoutubeSearch(query="x"),
        BrowserNavigate(url="https://example.com"),
        BrowserBack(),
        BrowserForward(),
        BrowserRefresh(),
        YoutubePlay(video_id="dQw4w9WgXcQ", title="x"),
        AudioPlay(asset="chime.wav"),
        MediaPlayPause(),
        MediaSeek(position_s=1),
        LayoutApply(
            template=LayoutTemplate.SPLIT,
            primary_panel=PanelType.DOCUMENT_EDITOR,
            secondary_panel=PanelType.CONVERSATION,
        ),
        PanelOpen(panel_type=PanelType.DOCUMENT_EDITOR),
        PanelClose(panel_id="no-such-panel"),
        PanelSetPrimary(action="panel.set_primary", panel_type=PanelType.DOCUMENT_EDITOR),
        PanelFullscreen(panel_type=PanelType.DOCUMENT_EDITOR),
        LayoutRestore(),
        _valid_compose_command(),
    ]
    server_only = [
        NotificationShow(
            notification_id="n1", kind=NotificationKind.INFO, title="t", text="x"
        ),
        MediaStateChange(state=MediaState.PAUSED),
        TtsSpeak(text="x"),
    ]
    for command in client_initiable:
        verdict = await handle_ui_command(services.deps_base, services.registry, command)
        assert verdict.status != "unsupported", (
            f"{command.action} lacks an authoritative handler (R39)"
        )
    for command in server_only:
        verdict = await handle_ui_command(services.deps_base, services.registry, command)
        assert verdict.status == "unsupported", (
            f"{command.action} is server-originated and must not be client-handled (C1)"
        )
    reset_media_state()
