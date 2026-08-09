"""GATE-3.5 A5 — single media authority (R24-R27).

The service-side MediaController (arsvox_agent/media.py) is the ONE
controller: agent media tools, client actions (media.play_pause /
media.seek / audio.play) and the demo tool all route through it. These
tests prove the frozen scenarios:

  R24  agent play -> user pause -> user seek -> agent resume: one
       controller, no "no media loaded" on user actions.
  R25  media.seek(seconds) actually changes the playback position —
       the emitted MediaStateEvent carries the real target.
  R26  the emitted state shape carries position/duration/state so the
       renderer can sync player callbacks against it (no fake claims).
"""

import asyncio

import pytest

from arsvox_contracts import MediaState
from arsvox_contracts.commands import AudioPlay, MediaPlayPause, MediaSeek
from arsvox_contracts.events import MediaStateEvent

from arsvox_agent.actions import handle_ui_command
from arsvox_agent.deps import Deps
from arsvox_agent.media import media_controller, reset_media_controller
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.media_tools import media_play, media_resume

from tests.python.test_media_tools import seed_offered


class _CaptureBus:
    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


class _FakePanels:
    def upsert(self, panel_type: str, title: str) -> None:
        pass

    def list(self) -> list:
        return []

    def touch(self, panel_type: str) -> None:
        pass


def _make_context() -> tuple[ToolContext, _CaptureBus, Deps]:
    bus = _CaptureBus()
    panels = _FakePanels()
    deps = Deps(
        config=None,
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
    return tctx, bus, deps


def _run(coro):
    return asyncio.run(coro)


def _media_states(bus) -> list[MediaStateEvent]:
    return [e for e in bus.events if isinstance(e, MediaStateEvent)]


@pytest.fixture(autouse=True)
def _clean_media():
    reset_media_controller()
    # GATE-5 (W1-YOUTUBE): media.play resolves ids against the OFFERED
    # set — these controller tests exercise play -> MediaStateEvent, so
    # they seed the 'agent already searched' precondition directly.
    seed_offered()
    yield
    reset_media_controller()


def test_r24_agent_play_user_pause_user_seek_agent_resume_one_controller():
    """The full R24 chain — every leg uses the SAME controller instance.

    Agent play (tool) -> user pause (client action) -> user seek (client
    action) -> agent resume (tool). User actions must NEVER hit "no media
    loaded": the agent leg already loaded the track into the shared
    controller.
    """
    tctx, bus, deps = _make_context()

    # Leg 1 — agent plays (media tool path).
    _run(media_play(tctx, "dQw4w9WgXcQ"))
    assert media_controller.state == MediaState.PLAYING
    assert media_controller.title == "Taller de carpintería para principiantes"
    assert len(_media_states(bus)) == 1

    # Leg 2 — user pause (client action path, same controller).
    verdict = _run(handle_ui_command(deps, None, MediaPlayPause()))
    assert verdict.status == "done"
    assert verdict.detail == "paused"  # NOT "no media loaded"
    assert media_controller.state == MediaState.PAUSED

    # Leg 3 — user seek (client action path).
    verdict = _run(handle_ui_command(deps, None, MediaSeek(position_s=37)))
    assert verdict.status == "done"
    assert verdict.detail == "37"  # NOT "no media loaded"
    assert media_controller.position_s == 37

    # Leg 4 — agent resume (media tool path).
    _run(media_resume(tctx))
    assert media_controller.state == MediaState.PLAYING

    # Every emitted event is a full state from the one controller.
    states = _media_states(bus)
    assert [s.state for s in states] == [
        MediaState.PLAYING,
        MediaState.PAUSED,
        MediaState.PAUSED,  # seek keeps the state, emits the position
        MediaState.PLAYING,
    ]
    assert states[2].position_s == 37
    assert all(s.video_id == "dQw4w9WgXcQ" for s in states)


def test_r24_user_seek_after_agent_play_keeps_playing_state():
    tctx, bus, deps = _make_context()

    _run(media_play(tctx, "dQw4w9WgXcQ"))
    verdict = _run(handle_ui_command(deps, None, MediaSeek(position_s=60)))
    assert verdict.status == "done"
    assert media_controller.state == MediaState.PLAYING
    assert media_controller.position_s == 60


def test_r25_seek_emits_the_real_target_position_and_drives_state():
    """R25: seek actually changes playback position — the event carries
    the position AND the controller state moved (no fake "Posición
    cambiada" without an effect)."""
    tctx, bus, deps = _make_context()

    _run(media_play(tctx, "dQw4w9WgXcQ"))
    verdict = _run(handle_ui_command(deps, None, MediaSeek(position_s=90)))

    assert verdict.status == "done"
    assert verdict.detail == "90"
    last = _media_states(bus)[-1]
    assert last.position_s == 90
    assert last.state == MediaState.PLAYING


def test_r26_emitted_state_is_full_and_snapshot_serializable():
    """R26: the state the UI receives is complete (position/duration/
    source/kind/volume) — the renderer reconciles player callbacks
    against exactly this shape, and A6's snapshot can serialize it."""
    tctx, bus, _ = _make_context()

    _run(media_play(tctx, "dQw4w9WgXcQ"))

    ev = _media_states(bus)[0]
    snap = ev.model_dump(mode="json")
    assert snap["state"] == "playing"
    assert snap["source"] == "youtube"
    assert snap["kind"] == "video"
    assert snap["video_id"] == "dQw4w9WgXcQ"
    assert snap["position_s"] == 0
    assert snap["duration_s"] == 0
    assert snap["volume"] == 1.0
    assert set(snap.keys()) >= {
        "state",
        "source",
        "kind",
        "title",
        "video_id",
        "url",
        "position_s",
        "duration_s",
        "volume",
    }
    # The controller's own snapshot round-trips through the event model
    # (A6 snapshot.py validates tracker payloads with MediaStateEvent).
    restored = MediaStateEvent.model_validate(media_controller.snapshot())
    assert restored.model_dump(exclude={"created_at"}) == ev.model_dump(exclude={"created_at"})


def test_play_pause_with_no_track_is_an_honest_no_media_loaded():
    tctx, bus, deps = _make_context()

    verdict = _run(handle_ui_command(deps, None, MediaPlayPause()))
    assert verdict.status == "done"
    assert verdict.detail == "no media loaded"
    assert _media_states(bus) == []  # no fake state emitted


def test_stop_keeps_track_and_play_pause_resumes():
    """Stopped-with-track is not a dead end: play_pause resumes (R24
    spirit — user actions always apply once a track is loaded)."""
    tctx, bus, deps = _make_context()

    _run(media_play(tctx, "dQw4w9WgXcQ"))
    _run(handle_ui_command(deps, None, MediaPlayPause()))  # -> paused
    _run(handle_ui_command(deps, None, MediaPlayPause()))  # -> playing
    verdict = _run(handle_ui_command(deps, None, MediaPlayPause()))  # -> paused
    assert verdict.detail == "paused"

    states = _media_states(bus)
    assert [s.state for s in states] == [
        MediaState.PLAYING,
        MediaState.PAUSED,
        MediaState.PLAYING,
        MediaState.PAUSED,
    ]


def test_audio_play_local_loads_track_through_controller():
    tctx, bus, deps = _make_context()

    verdict = _run(handle_ui_command(deps, None, AudioPlay(asset="chime.wav")))
    assert verdict.status == "done"
    assert media_controller.state == MediaState.PLAYING
    assert media_controller.source == "local"
    assert media_controller.kind == "audio"
    assert media_controller.title == "chime.wav"

    # A user pause right after the local audio.play also works (R24).
    verdict = _run(handle_ui_command(deps, None, MediaPlayPause()))
    assert verdict.detail == "paused"
