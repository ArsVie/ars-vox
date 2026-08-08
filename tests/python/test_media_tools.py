"""H7 (GATE-2.5) — media tools emit the event path the media surface
consumes: media.search_youtube -> YoutubeSearchEvent (populates the
YouTube panel), media.play/pause/resume/stop -> UiCommandEvent with
MediaStateChange (media.state command) that the desktop store merges
into the same surface the MediaStateEvent path feeds. media.play picks
a real YouTube watch URL for real video ids (the store derives videoId
from the url and renders the embed) and falls back to the configured
sample video otherwise.
"""

import asyncio

from arsvox_contracts import MediaState
from arsvox_contracts.commands import MediaStateChange, PanelOpen
from arsvox_contracts.events import UiCommandEvent, YoutubeSearchEvent
from arsvox_contracts.config import AppConfig

from arsvox_agent.deps import Deps
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.media_tools import (
    FIXTURE_RESULTS,
    media_pause,
    media_play,
    media_resume,
    media_search_youtube,
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


def test_search_emits_youtube_search_event_for_the_panel_surface():
    tctx, bus, _ = _make_context()

    result = _run(media_search_youtube(tctx, "carpintería"))

    search = next(e for e in bus.events if isinstance(e, YoutubeSearchEvent))
    assert search.query == "carpintería"
    assert all(r.id in {r.id for r in FIXTURE_RESULTS} for r in search.results)
    # The JSON return keeps the result ids for the follow-up media.play call.
    assert '"dQw4w9WgXcQ"' in result
    assert len(search.results) >= 1


def test_play_real_video_id_emits_panel_open_and_media_state_with_youtube_url():
    tctx, bus, panels = _make_context()

    result = _run(media_play(tctx, "dQw4w9WgXcQ"))

    assert "Taller de carpintería" in result
    assert panels.upserted == [("media", "Taller de carpintería para principiantes")]
    opens = [e for e in bus.events if isinstance(e, UiCommandEvent) and isinstance(e.command, PanelOpen)]
    assert len(opens) == 1
    states = [e.command for e in bus.events if isinstance(e, UiCommandEvent) and isinstance(e.command, MediaStateChange)]
    assert len(states) == 1
    cmd = states[0]
    assert cmd.state == MediaState.PLAYING
    assert cmd.title == "Taller de carpintería para principiantes"
    # Real 11-char id -> real YouTube watch url; the desktop store derives
    # videoId from it and renders the actual embed.
    assert cmd.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def test_play_unknown_id_falls_back_to_default_fixture_with_youtube_url():
    tctx, bus, _ = _make_context()

    result = _run(media_play(tctx, "not-a-fixture-id"))

    assert "Reproduciendo" in result
    states = [e.command for e in bus.events if isinstance(e, UiCommandEvent) and isinstance(e.command, MediaStateChange)]
    assert states[0].title == FIXTURE_RESULTS[0].title
    # Unknown ids resolve to the default fixture — a REAL 11-char id now, so
    # the media.state command carries the real YouTube watch url (the store
    # derives videoId from it and renders the embed).
    assert states[0].url == f"https://www.youtube.com/watch?v={FIXTURE_RESULTS[0].id}"


def test_pause_resume_stop_emit_media_state_commands():
    tctx, bus, _ = _make_context()

    assert "pausa" in _run(media_pause(tctx))
    assert "reanudado" in _run(media_resume(tctx))
    assert "detenido" in _run(media_stop(tctx))

    states = [e.command for e in bus.events if isinstance(e, UiCommandEvent) and isinstance(e.command, MediaStateChange)]
    assert [s.state for s in states] == [
        MediaState.PAUSED,
        MediaState.PLAYING,
        MediaState.STOPPED,
    ]
