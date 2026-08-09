"""Local media tools (GATE-5 W1-MEDIA-LOCAL): discovery feeds the FROZEN
wire (media.search_results with source=local + local_path) and voice picks
play through the ONE MediaController into the unified player.
"""

import asyncio
import json
from pathlib import Path

from arsvox_contracts import MediaState
from arsvox_contracts.commands import PanelOpen
from arsvox_contracts.config import AppConfig
from arsvox_contracts.enums import MediaKind, MediaSource
from arsvox_contracts.events import MediaSearchResultsEvent, MediaStateEvent, UiCommandEvent

from arsvox_agent.deps import Deps
from arsvox_agent.media import media_controller, reset_media_controller
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.local_media_tools import media_play_local, media_search_local


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


def _write_wav(path: Path) -> None:
    import wave

    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 1600)


def _make_context(tmp_path: Path) -> tuple[ToolContext, _CaptureBus, _FakePanels]:
    library_dir = tmp_path / "library"
    library_dir.mkdir()
    _write_wav(library_dir / "sierra.wav")
    _write_wav(library_dir / "torno.wav")
    (library_dir / "notas.txt").write_text("no", encoding="utf-8")

    config = AppConfig()
    config.memory.library_dir = str(library_dir)
    config.anchor(tmp_path)  # resolved_paths requires an anchor

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


def _media_states(bus) -> list[MediaStateEvent]:
    return [e for e in bus.events if isinstance(e, MediaStateEvent)]


def _panel_opens(bus) -> list[PanelOpen]:
    return [
        e.command
        for e in bus.events
        if isinstance(e, UiCommandEvent) and isinstance(e.command, PanelOpen)
    ]


def test_search_local_emits_media_search_results_with_source_local(tmp_path):
    reset_media_controller()
    tctx, bus, _ = _make_context(tmp_path)

    result = _run(media_search_local(tctx, "sierra"))

    event = next(e for e in bus.events if isinstance(e, MediaSearchResultsEvent))
    assert event.query == "sierra"
    assert len(event.results) == 1
    r = event.results[0]
    # The local-source wire members: source=local + local_path.
    assert r.source == MediaSource.LOCAL
    assert r.kind == MediaKind.AUDIO
    assert r.local_path is not None
    assert Path(r.local_path).name == "sierra.wav"
    assert r.title == "sierra"
    # The JSON the agent sees carries the local_path for the play follow-up.
    payload = json.loads(result)
    assert payload[0]["local_path"] == r.local_path
    assert payload[0]["source"] == "local"


def test_search_local_lists_everything_without_query_and_excludes_decoys(tmp_path):
    reset_media_controller()
    tctx, bus, _ = _make_context(tmp_path)

    result = _run(media_search_local(tctx, ""))

    event = next(e for e in bus.events if isinstance(e, MediaSearchResultsEvent))
    titles = sorted(r.title for r in event.results)
    assert titles == ["sierra", "torno"]
    assert "notas" not in json.dumps(result)


def test_search_local_honest_empty_library(tmp_path):
    reset_media_controller()
    empty = tmp_path / "empty"
    empty.mkdir()
    config = AppConfig()
    config.memory.library_dir = str(empty)
    config.anchor(tmp_path)
    bus = _CaptureBus()
    deps = Deps(
        config=config,
        db=None,
        sessions=None,
        notes=None,
        tasks=None,
        reminders=None,
        notifications=None,
        panels=_FakePanels(),
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
    )
    tctx = ToolContext(deps=deps, run_id="t", session_id="s", bus=bus)

    result = _run(media_search_local(tctx, ""))

    assert result == "[]"
    event = next(e for e in bus.events if isinstance(e, MediaSearchResultsEvent))
    assert event.results == []


def test_play_local_routes_through_the_one_controller_and_opens_the_panel(tmp_path):
    reset_media_controller()
    tctx, bus, panels = _make_context(tmp_path)
    local_path = str(tmp_path / "library" / "sierra.wav")

    result = _run(media_play_local(tctx, local_path))

    assert "Reproduciendo: sierra" in result
    assert panels.upserted == [("media", "sierra")]
    assert len(_panel_opens(bus)) == 1
    states = _media_states(bus)
    assert len(states) == 1
    ev = states[0]
    # The SAME controller YouTube plays through — local members on the wire.
    assert ev.state == MediaState.PLAYING
    assert ev.source == MediaSource.LOCAL
    assert ev.kind == MediaKind.AUDIO
    assert ev.url == local_path
    assert ev.video_id is None
    assert media_controller.title == "sierra"
    assert media_controller.source == MediaSource.LOCAL


def test_play_local_refuses_paths_outside_the_library(tmp_path):
    reset_media_controller()
    tctx, bus, _ = _make_context(tmp_path)

    result = _run(media_play_local(tctx, str(tmp_path / "outside.mp3")))

    assert "No se encontró" in result
    assert _media_states(bus) == []
    assert media_controller.state == MediaState.STOPPED


def test_play_local_refuses_missing_file_inside_library(tmp_path):
    reset_media_controller()
    tctx, bus, _ = _make_context(tmp_path)

    result = _run(media_play_local(tctx, str(tmp_path / "library" / "no-such.mp3")))

    assert "No se encontró" in result
    assert _media_states(bus) == []
