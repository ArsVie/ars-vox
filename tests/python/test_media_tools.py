"""Media tools emit the event path the media surface consumes through
the SINGLE MediaController (GATE-3.5, R24-R27): media.search_youtube ->
YoutubeSearchEvent (populates the YouTube panel), media.play/pause/
resume/stop/seek -> full MediaStateEvent carrying position/duration/
source/kind — the same event shape client actions and the demo tool
produce, so agent and user inputs share one authoritative state.

media.play picks a real YouTube watch URL for real video ids (the store
derives videoId from the url and renders the embed) and falls back to
the configured sample video otherwise.
"""

import asyncio

from arsvox_contracts import MediaState
from arsvox_contracts.commands import PanelOpen
from arsvox_contracts.events import MediaStateEvent, UiCommandEvent, YoutubeSearchEvent
from arsvox_contracts.config import AppConfig

from arsvox_agent.deps import Deps
from arsvox_agent.media import media_controller, reset_media_controller
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.media_tools import (
    FIXTURE_RESULTS,
    media_pause,
    media_play,
    media_resume,
    media_search_youtube,
    media_seek,
    media_set_volume,
    media_stop,
)


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


def _run(coro) -> str:
    return asyncio.run(coro)


def _media_events(bus) -> list[MediaStateEvent]:
    return [e for e in bus.events if isinstance(e, MediaStateEvent)]


def _panel_opens(bus) -> list:
    return [
        e.command
        for e in bus.events
        if isinstance(e, UiCommandEvent) and isinstance(e.command, PanelOpen)
    ]


def test_search_emits_youtube_search_event_for_the_panel_surface():
    tctx, bus, _ = _make_context()

    result = _run(media_search_youtube(tctx, "carpintería"))

    search = next(e for e in bus.events if isinstance(e, YoutubeSearchEvent))
    assert search.query == "carpintería"
    assert all(r.id in {r.id for r in FIXTURE_RESULTS} for r in search.results)
    # The JSON return keeps the result ids for the follow-up media.play call.
    assert '"dQw4w9WgXcQ"' in result
    assert len(search.results) >= 1


def test_play_real_video_id_emits_panel_open_and_full_media_state():
    tctx, bus, panels = _make_context()

    result = _run(media_play(tctx, "dQw4w9WgXcQ"))

    assert "Taller de carpintería" in result
    assert panels.upserted == [("media", "Taller de carpintería para principiantes")]
    assert len(_panel_opens(bus)) == 1
    states = _media_events(bus)
    assert len(states) == 1
    ev = states[0]
    assert ev.state == MediaState.PLAYING
    assert ev.title == "Taller de carpintería para principiantes"
    # Real 11-char id -> real YouTube watch url; the desktop store derives
    # videoId from it and renders the actual embed.
    assert ev.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert ev.video_id == "dQw4w9WgXcQ"
    assert ev.source == "youtube"
    assert ev.kind == "video"
    # The controller is the single authority: the tool routed through it.
    assert media_controller.title == ev.title
    assert media_controller.state == MediaState.PLAYING


def test_play_unknown_id_falls_back_to_default_fixture_with_sample_url():
    tctx, bus, _ = _make_context()

    result = _run(media_play(tctx, "not-a-fixture-id"))

    assert "Reproduciendo" in result
    states = _media_events(bus)
    assert states[0].title == FIXTURE_RESULTS[0].title
    # Unknown ids resolve to the default fixture — a REAL 11-char id now, so
    # the media.state event carries the real YouTube watch url (the store
    # derives videoId from it and renders the embed).
    assert states[0].url == f"https://www.youtube.com/watch?v={FIXTURE_RESULTS[0].id}"
    assert states[0].video_id == FIXTURE_RESULTS[0].id


def test_pause_resume_stop_emit_full_media_state_events():
    tctx, bus, _ = _make_context()

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


def test_seek_emits_the_real_target_position():
    tctx, bus, _ = _make_context()

    _run(media_play(tctx, "dQw4w9WgXcQ"))
    result = _run(media_seek(tctx, 42))

    # R25: the message reflects a REAL position change...
    assert "42" in result
    states = _media_events(bus)
    assert states[-1].position_s == 42
    # ...and the controller state actually moved (no fake ack).
    assert media_controller.position_s == 42
    assert media_controller.state == MediaState.PLAYING


def test_seek_clamps_negative_positions():
    tctx, bus, _ = _make_context()

    _run(media_play(tctx, "dQw4w9WgXcQ"))
    _run(media_seek(tctx, -5))

    states = _media_events(bus)
    assert states[-1].position_s == 0
    assert media_controller.position_s == 0


def test_set_volume_clamps_and_emits():
    tctx, bus, _ = _make_context()

    _run(media_play(tctx, "dQw4w9WgXcQ"))
    result = _run(media_set_volume(tctx, 1.7))

    assert "100%" in result
    states = _media_events(bus)
    assert states[-1].volume == 1.0
    assert media_controller.volume == 1.0
