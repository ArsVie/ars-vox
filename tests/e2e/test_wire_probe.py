"""GATE-5 W1-CONFORMANCE — CI-mode wire probes (deterministic, no live model).

Every assertion here is one row (or one sub-part of a row) of
docs/vision-conformance.md. The same wire facts are collected against the
packaged build by tests/e2e/wire_probe_live.py at GATE-1; this file is the
mock/offline proof that the probes are sound.

Rows covered (checklist ids in parentheses):
- L1 conversation-time ............ test_context_first_line_is_time
- L2 tasks cadence ................ test_reminder_fire_publishes_once,
                                   test_context_carries_active_reminders,
                                   test_tasks_update_frame_shape
- L3 document reader wire ......... test_document_kind_wire
- L5 media one player ............. test_media_select_result_local_routes_unified_controller
- L8 agent behavior/memory ........ test_memory_search_honest_verdict
- L7 browser (NOT_YET evidence) ... test_browser_navigate_can_go_back_false
- P1 fresh-start hero (wire part) . test_snapshot_stashes_history
- P5 confirm-in-chat (wire part) .. test_confirm_flow_roundtrip
- wire surface (all rows) ......... test_frozen_wire_surface_present
"""

from __future__ import annotations

import json
import time

import pytest

from tests.e2e.probe_core import frames_of, run_scripted_turn

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def collect_for(ws, seconds: float, max_events: int = 200) -> list[dict]:
    """Receive frames for a wall-clock duration (scheduler-fire probes)."""
    events: list[dict] = []
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline and len(events) < max_events:
        try:
            events.append(ws.receive_json())
        except Exception:  # pragma: no cover — socket closed mid-collect
            break
    return events


def _ui_command(command: dict) -> dict:
    return {"type": "ui_command", "command": command}


# --------------------------------------------------------------------------- #
# L1 — conversation: messages carry TIME for agent context (DONE — verify)
# --------------------------------------------------------------------------- #


def test_context_first_line_is_time():
    """now_line() sits at the TOP of every turn's context with Spanish +
    ISO local + UTC — the model always knows the time (panel-vision:
    "messages should have time appeneded to it for context")."""
    from datetime import datetime

    from arsvox_agent.context import build_context, now_line

    from tests.e2e.probe_core import make_deps

    deps = make_deps()
    text = build_context(deps.config, deps)
    first = text.splitlines()[0]
    assert first.startswith("Hora actual: "), f"time line missing: {first!r}"
    assert "ISO local:" in first and "UTC:" in first
    # the wall clock must match the injected line (not a stale fixture)
    assert datetime.now().astimezone().isoformat(timespec="seconds") in now_line()


# --------------------------------------------------------------------------- #
# L2 — tasks: reminders injected into agent context on a cadence (W1-TASKS)
# --------------------------------------------------------------------------- #


def test_context_carries_active_reminders():
    """Sub-part (verified): active reminders ride EVERY turn's context —
    the 'constant/permanent reminders' half of the vision line."""
    from arsvox_agent.context import build_context

    from tests.e2e.probe_core import make_deps

    class _Reminders:
        def list_active(self):
            return [
                {"id": 7, "due_at": "2026-08-09T12:00:00+00:00", "text": "tomar la medicina"},
                {"id": 8, "due_at": "2026-08-09T12:00:00+00:00", "text": "regar las plantas"},
            ]

    deps = make_deps(reminders=_Reminders())
    text = build_context(deps.config, deps)
    assert "Recordatorios activos:" in text
    assert "tomar la medicina" in text and "regar las plantas" in text
    # time line still first — reminders are injected AFTER the clock
    assert text.splitlines()[0].startswith("Hora actual: ")


def test_reminder_fire_publishes_once(client):
    """Common-brief VERIFY: the scheduler double-publish (duplicate chat
    lines, GATE-3.5) is fixed — one `notification` event per fired
    reminder, plus the tasks.update content refresh."""
    from datetime import datetime, timedelta, timezone

    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        services = client.app.state.services
        now = datetime.now(timezone.utc)
        services.reminders.create(
            "Alarma de prueba W1", (now - timedelta(seconds=1)).isoformat(timespec="seconds"), "none"
        )
        # drain until the fire lands (scheduler interval 1s)
        events: list[dict] = []
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and not any(
            e["type"] == "notification" for e in events
        ):
            events.extend(collect_for(ws, 1.0))
        # the fire's tasks.update refresh is published right AFTER the
        # notification in the same tick — drain a little more
        events.extend(collect_for(ws, 2.0))
        notifications = frames_of(events, "notification")
        assert notifications, "expected a notification event for the fired reminder"
        assert len(notifications) == 1, (
            f"double-publish regression: {len(notifications)} notification events for one reminder"
        )
        assert notifications[0]["text"] == "Alarma de prueba W1"
        # the renderer's content.tasks refresh (ADV-F2) rides the same fire
        tasks_updates = frames_of(events, "tasks.update")
        assert tasks_updates, "expected a tasks.update frame after the fire (content refresh)"
        # the scheduler itself never fabricates an agent chat line for the
        # fire — one notification event == exactly one chat line (renderer).
        agent_lines = [e for e in events if e["type"] == "agent_message"]
        assert not any("Alarma de prueba W1" in e.get("text", "") for e in agent_lines)


def test_tasks_update_frame_shape():
    """tasks.update carries todos + reminders (the tasks panel's content
    bag on the wire — W0-CONTRACT surface)."""
    from arsvox_contracts.events import ReminderItem, TasksUpdateEvent, TodoItem

    ev = TasksUpdateEvent(
        todos=[TodoItem(id="t1", title="comprar leche", done=False, priority="normal", due=None)],
        reminders=[ReminderItem(id="r1", title="tomar la medicina", cadence="daily", next_fire="2026-08-10T08:00:00+00:00")],
    )
    data = ev.model_dump()
    assert data["todos"][0]["title"] == "comprar leche"
    assert data["reminders"][0]["cadence"] == "daily"


# --------------------------------------------------------------------------- #
# L6 — youtube: agent searches, OFFERS selectable options (W1-YOUTUBE)
# --------------------------------------------------------------------------- #


def test_agent_search_emits_youtube_search_offer(client):
    """The OFFER channel works end to end: when the agent runs its search
    tool, a youtube.search event lands with the results as selectable
    cards data (youtubeSlice reduces it into content.youtube.results).
    Realness of the results is W1-YOUTUBE's row (probe: youtube_realness)."""
    events = run_scripted_turn(
        client.app, "media_search_youtube", {"query": "carpintería"}
    )
    offers = frames_of(events, "youtube.search")
    assert offers, "expected a youtube.search event from the agent's search tool"
    assert offers[-1]["query"] == "carpintería"
    assert offers[-1]["results"], "the offer must carry result cards"
    card = offers[-1]["results"][0]
    for field in ("id", "title", "channel", "duration_s"):
        assert field in card, f"result card missing {field}"


# --------------------------------------------------------------------------- #
# L3 — document: PDF/EPUB/TXT reader (DONE — verify)
# --------------------------------------------------------------------------- #


def test_document_kind_wire():
    """The reader's wire vocabulary: DocumentKind txt|md|pdf|epub and the
    DocumentLoadEvent payload the readers render from."""
    from arsvox_contracts.enums import DocumentKind
    from arsvox_contracts.events import DocumentLoadEvent

    assert {k.value for k in DocumentKind} == {"txt", "md", "pdf", "epub"}
    # DocumentLoadEvent carries title/path + kind + content/chapters (frozen W0 shape)
    ev = DocumentLoadEvent(
        title="libro",
        path="/tmp/libro.epub",
        url="https://example.com/libro.epub",
        kind=DocumentKind.EPUB,
        content="",
        chapters=[],
    )
    assert ev.kind == "epub"


# --------------------------------------------------------------------------- #
# L5 — media: one player, YouTube AND local, same UI/controls (W1-MEDIA-LOCAL)
# --------------------------------------------------------------------------- #


def test_media_select_result_local_routes_unified_controller(client):
    """media.select_result with source=local reaches the SAME
    MediaController as a youtube pick — the 'same UI/controls' seam on the
    wire. The user click/voice pick is the same command for both sources."""
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.send_json(
            _ui_command(
                {
                    "action": "media.select_result",
                    "result_id": "",
                    "source": "local",
                    "kind": "audio",
                    "title": "Mi canción local",
                    "url": None,
                    "local_path": "file:///tmp/mi-cancion.mp3",
                }
            )
        )
        events = []
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline and not any(
            e["type"] == "action_result" and e.get("action") == "media.select_result"
            for e in events
        ):
            events.extend(collect_for(ws, 0.5))
        results = frames_of(events, "action_result")
        assert results, "expected an action_result for media.select_result"
        verdict = results[-1]
        assert verdict["action"] == "media.select_result"
        assert verdict["status"] == "done", f"unexpected verdict: {verdict}"
        # the controller published the unified media state with source=local
        media = frames_of(events, "media.state")
        assert media, "expected a media.state frame from the unified controller"
        assert media[-1]["source"] == "local"
        assert media[-1]["kind"] == "audio"
        # the media panel opens so the unified player is visible
        opens = [
            e["command"]
            for e in frames_of(events, "ui_command")
            if e.get("command", {}).get("action") == "panel.open"
        ]
        assert opens and opens[-1]["panel_type"] == "media"


# --------------------------------------------------------------------------- #
# L7 — browser: integrated, agent drives, user manipulates (Wave 2 — NOT_YET)
# --------------------------------------------------------------------------- #


def test_browser_navigate_can_go_back_false(client):
    """Records the Wave-2 gap on the wire: browser.navigate exists but the
    service has no browser-state source — can_go_back/can_go_forward stay
    False (actions.py hardcodes them). The checklist row stays NOT_YET."""
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.send_json(_ui_command({"action": "browser.navigate", "url": "https://example.com"}))
        events = []
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline and not frames_of(events, "browser.navigate"):
            events.extend(collect_for(ws, 0.5))
        navs = frames_of(events, "browser.navigate")
        assert navs, "expected a browser.navigate event"
        assert navs[-1]["can_go_back"] is False
        assert navs[-1]["can_go_forward"] is False


# --------------------------------------------------------------------------- #
# L8 — agent behavior: preferences from MEMORIES shape searches (W1-MEMORY)
# --------------------------------------------------------------------------- #


def test_memory_search_honest_verdict(client):
    """memory.search is on the frozen wire but NOT wired (W1-MEMORY owns
    it) — the handler must answer honestly, never a fake recall. Records
    the current evidence for the PENDING row."""
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.send_json(_ui_command({"action": "memory.search", "query": "preferencias musicales"}))
        events = []
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline and not frames_of(events, "action_result"):
            events.extend(collect_for(ws, 0.5))
        results = frames_of(events, "action_result")
        assert results, "expected an action_result for memory.search"
        verdict = results[-1]
        assert verdict["action"] == "memory.search"
        assert verdict["status"] != "done", (
            "memory.search must answer honestly until W1-MEMORY wires it — "
            "never a fake recall"
        )


# --------------------------------------------------------------------------- #
# P1 — packaged check: cold start = central-mic hero (wire part)
# --------------------------------------------------------------------------- #


def test_snapshot_stashes_history(client):
    """The state_snapshot carries conversation history (server-side stash
    for an explicit resume) — the renderer never auto-restores it (the
    no-auto-restore half is the store mirror, store.test.ts)."""
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        snap = ws.receive_json()  # config_update
        snap2 = None
        for _ in range(4):
            snap2 = ws.receive_json()
            if snap2["type"] == "state_snapshot":
                break
        assert snap2 is not None and snap2["type"] == "state_snapshot"
        assert "history" in snap2, "snapshot must carry the stashed history"
        assert "adaptive" in snap2 and "voice_state" in snap2
        # history stash is a server-side artifact, not a render directive:
        # the wire carries NO flag telling the renderer to restore it
        assert snap2.get("restore_history") is not True
        assert snap["type"] == "config_update"


# --------------------------------------------------------------------------- #
# P5 — packaged check: confirmation as a popup INSIDE the chat (wire part)
# --------------------------------------------------------------------------- #


def test_confirm_flow_roundtrip(client, monkeypatch):
    """confirmation_requested → confirm → confirmation_resolved(executed).
    The store mirror (store.test.ts) proves the resolved verdict becomes a
    system line inside the chat; this proves the wire round trip that the
    packaged restart-with-pending check exercises."""
    import arsvox_agent.runtime as runtime

    from tests.python.conftest import ws_collect
    from tests.e2e.probe_core import scripted_model

    monkeypatch.setattr(
        runtime,
        "build_model",
        lambda cfg: scripted_model("telegram_prepare_message", {"text": "Hola, necesito ayuda"}),
    )
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.send_json({"type": "user_text", "text": "envía un mensaje a ars"})
        events = ws_collect(
            client=client, ws=ws, expected_break=lambda e: e["type"] == "confirmation_requested"
        )
        reqs = [e for e in events if e["type"] == "confirmation_requested"]
        assert reqs, "expected a confirmation request"
        pending_id = reqs[-1]["pending_id"]
        assert reqs[-1]["tool"] == "telegram.send_pending"
        ws.send_json({"type": "confirm", "pending_id": pending_id})
        events2 = ws_collect(
            client=client,
            ws=ws,
            expected_break=lambda e: e["type"] == "confirmation_resolved"
            and e["status"] == "executed",
        )
        resolved = [e for e in events2 if e["type"] == "confirmation_resolved"][0]
        assert resolved["status"] == "executed"


# --------------------------------------------------------------------------- #
# Frozen wire surface (all rows) — W0-CONTRACT members must not vanish
# --------------------------------------------------------------------------- #


def test_frozen_wire_surface_present():
    """The entire GATE-5 wire surface, asserted member by member. If a W1
    lane removes or renames a member, this probe fails with the exact
    missing name — the checklist rows keep their evidence path."""
    from arsvox_contracts.commands import UiCommand
    from arsvox_contracts.enums import DocumentKind, MediaSource
    from arsvox_contracts.events import (
        BrowserDomActionEvent,
        BrowserNavigateEvent,
        DocumentChangedEvent,
        MediaSearchResultsEvent,
        MediaStateEvent,
        MemorySearchResultsEvent,
        TasksUpdateEvent,
        YoutubeSearchEvent,
    )

    # events — every vision line's event exists
    for cls in (
        YoutubeSearchEvent,
        MediaSearchResultsEvent,
        MediaStateEvent,
        DocumentChangedEvent,
        BrowserDomActionEvent,
        BrowserNavigateEvent,
        MemorySearchResultsEvent,
        TasksUpdateEvent,
    ):
        assert cls is not None

    # media unified player: local source + local_path member (W0)
    assert MediaSource.LOCAL.value == "local"
    fields = MediaStateEvent.model_fields
    assert "local_path" in fields, "MediaStateEvent.local_path missing (unified player)"
    assert "source" in fields and "kind" in fields
    assert DocumentKind.EPUB.value == "epub"

    # browser: real can_go_back/can_go_forward in the state shape
    nav_fields = BrowserNavigateEvent.model_fields
    assert "can_go_back" in nav_fields and "can_go_forward" in nav_fields

    # commands: media.select_result / memory.search / browser.navigate in
    # the UiCommand union (dispatchable from the client)
    from arsvox_contracts.commands import (
        BrowserNavigate,
        MediaSelectResult,
        MemorySearch,
    )

    allowed = UiCommand.__args__[0].__args__ if hasattr(UiCommand, "__args__") else []
    names = {c.model_fields.get("action").default for c in allowed}
    for wanted in ("media.select_result", "memory.search", "browser.navigate"):
        assert wanted in names, f"{wanted} missing from the UiCommand union"
