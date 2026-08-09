"""Media tools emit the event path the media surface consumes through
the SINGLE MediaController (GATE-3.5, R24-R27).

GATE-5 (W1-YOUTUBE): media.search_youtube is REAL — it searches through
the provider seam (injected fake here; the network is mocked at the
search/youtube.py level, never here) and emits media.search_results with
the real cards. Zero results is an honest empty list. media.play
resolves ids against the results the search last OFFERED — anything
else is an honest refusal (FIXTURE_RESULTS and the sample-video
fallback are retired).

media.play/pause/resume/stop/seek -> full MediaStateEvent carrying
position/duration/source/kind — the same event shape client actions and
the demo tool produce, so agent and user inputs share one authoritative
state.
"""

import asyncio

import pytest

from arsvox_contracts import MediaState
from arsvox_contracts.commands import PanelOpen
from arsvox_contracts.events import (
    MediaSearchResultsEvent,
    MediaStateEvent,
    UiCommandEvent,
)
from arsvox_contracts.config import AppConfig

from arsvox_agent.deps import Deps
from arsvox_agent.media import media_controller, reset_media_controller
from arsvox_agent.search.youtube import YoutubeSearchResult
from arsvox_agent.tools import media_tools
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.media_tools import (
    media_pause,
    media_play,
    media_resume,
    media_search_youtube,
    media_seek,
    media_set_volume,
    media_stop,
    reset_offered_results,
)

REAL_HITS = [
    YoutubeSearchResult(
        id="dQw4w9WgXcQ",
        title="Taller de carpintería para principiantes",
        channel="El Taller de Marta",
        duration_s=742,
        published="hace 3 días",
        thumbnail_url=None,
    ),
    YoutubeSearchResult(
        id="9bZkp7q19f0",
        title="Cómo lijar madera sin errores",
        channel="Bricolaje Fácil",
        duration_s=495,
        published="hace 1 semana",
        thumbnail_url=None,
    ),
]


class _FakeProvider:
    name = "fake"

    def __init__(self, hits=None, error=None) -> None:
        self.hits = hits or []
        self.error = error
        self.queries: list[str] = []

    async def search(self, query: str, limit: int = 10) -> list[YoutubeSearchResult]:
        self.queries.append(query)
        if self.error is not None:
            raise self.error
        return self.hits


class _CaptureBus:
    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


class _FakePanels:
    def __init__(self) -> None:
        self.upserted: list[tuple[str, str]] = []

    def upsert(self, panel_type: str, title: str) -> None:
        self.upserted.append((panel_type, title))


@pytest.fixture(autouse=True)
def _clean_state(monkeypatch):
    reset_media_controller()
    reset_offered_results()
    yield
    reset_media_controller()
    reset_offered_results()


def _make_context() -> tuple[ToolContext, _CaptureBus, _FakePanels]:
    config = AppConfig()
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


def _use_provider(monkeypatch, provider: _FakeProvider) -> None:
    monkeypatch.setattr(media_tools, "get_youtube_search_provider", lambda: provider)


def _run(coro) -> str:
    return asyncio.run(coro)


def seed_offered(
    video_id: str = "dQw4w9WgXcQ",
    title: str = "Taller de carpintería para principiantes",
) -> None:
    """Test helper: seed the offered set — the 'the agent already
    searched' precondition for tests that exercise media.play without
    going through the search path (controller/adversarial suites)."""
    from arsvox_contracts.enums import MediaKind, MediaSource
    from arsvox_contracts.events import MediaSearchResult

    media_tools._last_offered[:] = [
        MediaSearchResult(
            id=video_id,
            title=title,
            source=MediaSource.YOUTUBE,
            kind=MediaKind.VIDEO,
            channel="El Taller de Marta",
            duration_s=742,
            published="hace 3 días",
            thumbnail_url=None,
        )
    ]


def _media_events(bus) -> list[MediaStateEvent]:
    return [e for e in bus.events if isinstance(e, MediaStateEvent)]


def _panel_opens(bus) -> list:
    return [
        e.command
        for e in bus.events
        if isinstance(e, UiCommandEvent) and isinstance(e.command, PanelOpen)
    ]


# ------------------------------------------------------------ search #


def test_search_uses_the_provider_seam_and_emits_media_search_results(monkeypatch):
    tctx, bus, _ = _make_context()
    provider = _FakeProvider(hits=REAL_HITS)
    _use_provider(monkeypatch, provider)

    result = _run(media_search_youtube(tctx, "carpintería"))

    assert provider.queries == ["carpintería"]
    # The GATE-5 wire member: media.search_results with the real cards.
    search = next(e for e in bus.events if isinstance(e, MediaSearchResultsEvent))
    assert search.query == "carpintería"
    assert [c.id for c in search.results] == ["dQw4w9WgXcQ", "9bZkp7q19f0"]
    card = search.results[0]
    assert card.source == "youtube"
    assert card.kind == "video"
    assert card.title == "Taller de carpintería para principiantes"
    assert card.channel == "El Taller de Marta"
    assert card.duration_s == 742
    # The JSON return keeps the offered ids for the follow-up media.play.
    assert '"dQw4w9WgXcQ"' in result
    assert len(search.results) == 2


def test_search_zero_results_is_an_honest_empty_list(monkeypatch):
    tctx, bus, _ = _make_context()
    _use_provider(monkeypatch, _FakeProvider(hits=[]))

    result = _run(media_search_youtube(tctx, "xyz no existe"))

    # Honest empty: a valid empty JSON list (the frozen actions.py turns
    # it into an empty youtube.search event the panel renders as "no
    # encontré nada") — never a fixture.
    assert result == "[]"
    search = next(e for e in bus.events if isinstance(e, MediaSearchResultsEvent))
    assert search.results == []
    assert search.query == "xyz no existe"


def test_search_provider_failure_reports_truthfully_and_emits_nothing(monkeypatch):
    from arsvox_agent.search.youtube import YoutubeSearchError

    tctx, bus, _ = _make_context()
    _use_provider(
        monkeypatch,
        _FakeProvider(error=YoutubeSearchError("no se pudo consultar YouTube: red caída")),
    )

    result = _run(media_search_youtube(tctx, "carpintería"))

    assert "No pude buscar en YouTube" in result
    assert "red caída" in result
    # No results event on failure — a failure is not an empty search.
    assert not [e for e in bus.events if isinstance(e, MediaSearchResultsEvent)]


def test_search_blank_query_is_an_honest_refusal(monkeypatch):
    tctx, bus, _ = _make_context()
    provider = _FakeProvider(hits=REAL_HITS)
    _use_provider(monkeypatch, provider)

    result = _run(media_search_youtube(tctx, "   "))

    assert "Necesito un término" in result
    assert provider.queries == []


# ------------------------------------------------------------- play #


def test_play_offered_video_id_emits_panel_open_and_full_media_state(monkeypatch):
    tctx, bus, panels = _make_context()
    _use_provider(monkeypatch, _FakeProvider(hits=REAL_HITS))
    _run(media_search_youtube(tctx, "carpintería"))

    result = _run(media_play(tctx, "dQw4w9WgXcQ"))

    assert "Taller de carpintería" in result
    assert panels.upserted == [("media", "Taller de carpintería para principiantes")]
    assert len(_panel_opens(bus)) == 1
    states = _media_events(bus)
    assert len(states) == 1
    ev = states[0]
    assert ev.state == MediaState.PLAYING
    assert ev.title == "Taller de carpintería para principiantes"
    # Real 11-char id -> real YouTube watch url; the desktop store
    # derives videoId from it and renders the actual embed.
    assert ev.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert ev.video_id == "dQw4w9WgXcQ"
    assert ev.source == "youtube"
    assert ev.kind == "video"
    # The controller is the single authority: the tool routed through it.
    assert media_controller.title == ev.title
    assert media_controller.state == MediaState.PLAYING


def test_play_id_not_offered_is_an_honest_refusal(monkeypatch):
    tctx, bus, _ = _make_context()
    _use_provider(monkeypatch, _FakeProvider(hits=REAL_HITS))
    _run(media_search_youtube(tctx, "carpintería"))

    result = _run(media_play(tctx, "kJQP7kiw5Fk"))

    assert "No conozco ese resultado" in result
    # Nothing played, no media state emitted, no panel opened.
    assert _media_events(bus) == []
    assert _panel_opens(bus) == []


def test_play_without_a_search_is_an_honest_refusal(monkeypatch):
    tctx, bus, _ = _make_context()
    _use_provider(monkeypatch, _FakeProvider(hits=REAL_HITS))

    result = _run(media_play(tctx, "dQw4w9WgXcQ"))

    assert "No conozco ese resultado" in result
    assert _media_events(bus) == []


def test_pause_resume_stop_emit_full_media_state_events(monkeypatch):
    tctx, bus, _ = _make_context()
    _use_provider(monkeypatch, _FakeProvider(hits=REAL_HITS))
    _run(media_search_youtube(tctx, "carpintería"))

    _run(media_play(tctx, "dQw4w9WgXcQ"))
    assert "pausa" in _run(media_pause(tctx))
    assert "reanudado" in _run(media_resume(tctx))
    assert "detenido" in _run(media_stop(tctx))

    states = _media_events(bus)
    assert [s.state for s in states] == [
        MediaState.PLAYING,
        MediaState.PAUSED,
        MediaState.PLAYING,
        MediaState.STOPPED,
    ]
    # Every event is a FULL state (position/duration/source/kind present),
    # not a partial command — the renderer never has to guess.
    for ev in states:
        assert ev.source == "youtube"
        assert ev.kind == "video"
        assert ev.title == "Taller de carpintería para principiantes"


def test_seek_emits_the_real_target_position(monkeypatch):
    tctx, bus, _ = _make_context()
    _use_provider(monkeypatch, _FakeProvider(hits=REAL_HITS))
    _run(media_search_youtube(tctx, "carpintería"))
    _run(media_play(tctx, "dQw4w9WgXcQ"))

    result = _run(media_seek(tctx, 42))

    # R25: the message reflects a REAL position change...
    assert "42" in result
    states = _media_events(bus)
    assert states[-1].position_s == 42
    # ...and the controller state actually moved (no fake ack).
    assert media_controller.position_s == 42
    assert media_controller.state == MediaState.PLAYING


def test_seek_clamps_negative_positions(monkeypatch):
    tctx, bus, _ = _make_context()
    _use_provider(monkeypatch, _FakeProvider(hits=REAL_HITS))
    _run(media_search_youtube(tctx, "carpintería"))
    _run(media_play(tctx, "dQw4w9WgXcQ"))

    _run(media_seek(tctx, -5))

    states = _media_events(bus)
    assert states[-1].position_s == 0
    assert media_controller.position_s == 0


def test_set_volume_clamps_and_emits(monkeypatch):
    tctx, bus, _ = _make_context()
    _use_provider(monkeypatch, _FakeProvider(hits=REAL_HITS))
    _run(media_search_youtube(tctx, "carpintería"))
    _run(media_play(tctx, "dQw4w9WgXcQ"))

    result = _run(media_set_volume(tctx, 1.7))

    assert "100%" in result
    states = _media_events(bus)
    assert states[-1].volume == 1.0
    assert media_controller.volume == 1.0
