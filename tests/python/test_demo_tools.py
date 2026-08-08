"""demo_populate: full event emission sequence + mock-only guard.

The tool is the demo harness: it emits the typed content events exactly as
the real tools will. These tests pin the emitted sequence (event types and
payloads) and the guard that keeps it inert outside mock mode. Events are
captured at the bus boundary (ToolContext.emit -> bus.publish) so the typed
objects are asserted, mirroring what the WebSocket broadcaster fans out.
"""

import asyncio

from arsvox_contracts import AppConfig, PanelType
from arsvox_contracts.events import (
    BrowserNavigateEvent,
    DocumentLoadEvent,
    MediaStateEvent,
    TasksUpdateEvent,
    UiCommandEvent,
    YoutubeSearchEvent,
)

from arsvox_agent.deps import Deps
from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.demo_tools import DEMO_NEWS_URL, demo_populate
from arsvox_agent.tools.register import register_all

MOCK_ONLY_ERROR = "demo_populate solo está disponible en modo mock."


class _CaptureBus:
    """EventBus stand-in: records the typed event objects publish() gets."""

    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


class _FakePanels:
    """PanelStore stand-in: only touch() is exercised by demo_populate."""

    def __init__(self) -> None:
        self.touched: list[str] = []

    def touch(self, panel_type: str) -> None:
        self.touched.append(panel_type)


def _make_context(mock: bool) -> tuple[ToolContext, _CaptureBus, _FakePanels]:
    config = AppConfig()
    config.agent.mock = mock
    bus = _CaptureBus()
    panels = _FakePanels()
    deps = Deps(
        config=config,
        db=None,
        sessions=None,
        notes=None,
        tasks=None,
        reminders=None,
        notifications=None,
        panels=panels,
        preferences=None,
        progress=None,
        pending=None,
        documents=None,
        audit=None,
        bus=bus,  # type: ignore[arg-type]
        policy=None,
        confirmations=None,
        tts=None,
        telegram=None,
        run_id="test-run",
        session_id="test-session",
    )
    tctx = ToolContext(deps=deps, run_id="test-run", session_id="test-session", bus=bus)
    return tctx, bus, panels


def _run(tctx: ToolContext) -> str:
    return asyncio.run(demo_populate(tctx))


def test_demo_populate_emits_full_event_sequence_in_order():
    tctx, bus, _ = _make_context(mock=True)

    result = _run(tctx)

    assert result == "Demo: paneles poblados."
    assert len(bus.events) == 10
    assert [type(e).__name__ for e in bus.events] == [
        "UiCommandEvent",
        "UiCommandEvent",
        "UiCommandEvent",
        "UiCommandEvent",
        "UiCommandEvent",
        "YoutubeSearchEvent",
        "BrowserNavigateEvent",
        "DocumentLoadEvent",
        "TasksUpdateEvent",
        "MediaStateEvent",
    ]
    # wire discriminators: ui_command x5, then the content events
    assert [e.type for e in bus.events] == [
        "ui_command",
        "ui_command",
        "ui_command",
        "ui_command",
        "ui_command",
        "youtube.search",
        "browser.navigate",
        "document.load",
        "tasks.update",
        "media.state",
    ]


def test_first_five_events_are_panel_opens_then_dashboard_layout():
    tctx, bus, _ = _make_context(mock=True)

    _run(tctx)

    ui = [e for e in bus.events if isinstance(e, UiCommandEvent)]
    assert len(ui) == 5
    opens = [e.command for e in ui[:4]]
    assert [o.action for o in opens] == ["panel.open"] * 4
    assert [o.panel_type for o in opens] == [
        PanelType.YOUTUBE,
        PanelType.BROWSER,
        PanelType.DOCUMENT_EDITOR,
        PanelType.TASKS,
    ]
    layout = ui[4].command
    assert layout.action == "layout.apply"
    assert layout.template == "dashboard"
    assert layout.primary_panel == PanelType.BROWSER


def test_youtube_search_event_carries_query_and_three_results():
    tctx, bus, _ = _make_context(mock=True)

    _run(tctx)

    ev = next(e for e in bus.events if isinstance(e, YoutubeSearchEvent))
    assert ev.query == "cocina italiana fácil"
    assert len(ev.results) == 3
    ids = [r.id for r in ev.results]
    assert ids == ["dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk"]
    for r in ev.results:
        assert r.id and r.title and r.channel
        assert isinstance(r.duration_s, int) and r.duration_s > 0


def test_document_load_event_kind_epub_with_url():
    tctx, bus, _ = _make_context(mock=True)

    _run(tctx)

    ev = next(e for e in bus.events if isinstance(e, DocumentLoadEvent))
    assert ev.kind == "epub"
    assert ev.path == "biblioteca/don-quijote-fragmento.epub"
    assert ev.url and ev.url.startswith("http://127.0.0.1:5173/")
    assert ev.title == "Don Quijote de la Mancha (fragmento)"
    assert ev.chapters == []
    assert ev.content == ""


def test_tasks_update_event_three_todos_two_reminders():
    tctx, bus, _ = _make_context(mock=True)

    _run(tctx)

    ev = next(e for e in bus.events if isinstance(e, TasksUpdateEvent))
    assert len(ev.todos) == 3
    assert [t.id for t in ev.todos] == ["t1", "t2", "t3"]
    assert all(t.title for t in ev.todos)
    assert len(ev.reminders) == 2
    assert [r.id for r in ev.reminders] == ["r1", "r2"]
    assert all(r.title and r.cadence and r.next_fire for r in ev.reminders)


def test_media_state_event_playing_local_audio():
    tctx, bus, _ = _make_context(mock=True)

    _run(tctx)

    ev = next(e for e in bus.events if isinstance(e, MediaStateEvent))
    assert ev.state == "playing"
    assert ev.source == "local"
    assert ev.kind == "audio"
    assert ev.position_s == 142
    assert ev.duration_s == 642


def test_browser_navigate_event_uses_demo_news_url():
    tctx, bus, _ = _make_context(mock=True)

    _run(tctx)

    ev = next(e for e in bus.events if isinstance(e, BrowserNavigateEvent))
    assert ev.url == DEMO_NEWS_URL
    assert ev.title == "El Diario — Noticias locales"


def test_mock_guard_blocks_when_mock_disabled():
    tctx, bus, panels = _make_context(mock=False)

    result = _run(tctx)

    assert result == MOCK_ONLY_ERROR
    assert bus.events == []
    assert panels.touched == []


def test_demo_populate_registered_in_registry():
    registry = ToolRegistry()
    n = register_all(registry)
    assert n == 44
    spec = registry.get("demo_populate")
    assert spec is not None
    assert spec.handler is demo_populate
