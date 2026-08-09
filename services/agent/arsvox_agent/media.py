"""Single media authority (GATE-3.5, R24-R27).

One MediaController serves EVERY media input path in the service:

  * agent media tools (tools/media_tools.py) — media.play/pause/resume/
    stop/seek/set_volume;
  * client actions (actions.py) — media.play_pause / media.seek /
    audio.play;
  * demo tool (tools/demo_tools.py, mock mode) — demo_populate loads
    representative state through the same controller.

Every transition publishes ONE canonical event: a full ``MediaStateEvent``
(position/duration/source/kind included). There is no second, partial
``MediaStateChange`` command path anymore: what the UI receives is exactly
what the controller holds, so agent actions and user actions can never
disagree about the loaded track (R24), seek really moves the position and
emits it (R25), and the renderer's player callbacks reconcile against the
same shape the controller emits (R26).

The controller is deliberately bus-agnostic: callers pass the EventBus (or
a test capture bus) per call, so unit tests do not need app wiring.
"""

from typing import Any

from arsvox_contracts.enums import MediaKind, MediaSource, MediaState
from arsvox_contracts.events import MediaStateEvent

_URLISH = ("http://", "https://", "//", "/", "./", "../")


class MediaController:
    """Authoritative in-memory media state for the service process.

    Holds the loaded track (title/source/kind/video_id/url), the playback
    state, the position and the volume. Transitions mutate this state and
    publish the resulting ``MediaStateEvent`` on the given bus.
    """

    def __init__(self) -> None:
        self.state = MediaState.STOPPED
        self.source = MediaSource.LOCAL
        self.kind = MediaKind.AUDIO
        self.title = ""
        self.video_id: str | None = None
        self.url: str | None = None
        self.position_s = 0
        self.duration_s = 0
        self.volume = 1.0

    # ------------------------------------------------------------------ #
    # Introspection
    # ------------------------------------------------------------------ #

    def has_track(self) -> bool:
        """True when a track is loaded (title/video_id/url present).

        ``has_track`` — not the playback state — decides whether user
        actions apply. A stopped player with a loaded track can still be
        paused/resumed/seeded; only a truly empty player answers
        "no media loaded" (R24: agent play -> user pause/seek must never
        hit that dead end).
        """
        return bool(self.title or self.video_id or self.url)

    def snapshot(self) -> dict[str, Any]:
        """Serialized shape (A6 snapshot.py consumes it as MediaStateEvent)."""
        return {
            "state": self.state,
            "source": self.source,
            "kind": self.kind,
            "title": self.title,
            "video_id": self.video_id,
            "url": self.url,
            "position_s": self.position_s,
            "duration_s": self.duration_s,
            "volume": self.volume,
        }

    def to_event(self) -> MediaStateEvent:
        return MediaStateEvent(**self.snapshot())

    # ------------------------------------------------------------------ #
    # Transitions — every one publishes the canonical MediaStateEvent
    # ------------------------------------------------------------------ #

    async def play(
        self,
        bus,
        *,
        title: str,
        url: str | None = None,
        video_id: str | None = None,
        source: MediaSource = MediaSource.YOUTUBE,
        kind: MediaKind = MediaKind.VIDEO,
        position_s: int = 0,
        duration_s: int = 0,
        volume: float | None = None,
    ) -> MediaStateEvent:
        """Load a track and start playing (agent media.play / youtube.play)."""
        self.state = MediaState.PLAYING
        self.source = source
        self.kind = kind
        self.title = title
        self.video_id = video_id
        self.url = url
        self.position_s = max(0, position_s)
        self.duration_s = max(0, duration_s)
        if volume is not None:
            self.volume = max(0.0, min(1.0, volume))
        return await self._emit(bus)

    async def play_local(self, bus, asset: str) -> MediaStateEvent:
        """Load a local audio asset and start playing (audio.play)."""
        self.state = MediaState.PLAYING
        self.source = MediaSource.LOCAL
        self.kind = MediaKind.AUDIO
        self.title = asset
        self.video_id = None
        self.url = asset if asset.startswith(_URLISH) else None
        self.position_s = 0
        self.duration_s = 0
        return await self._emit(bus)

    async def pause(self, bus) -> MediaStateEvent | None:
        """Pause playback. No-op (None) when nothing is loaded."""
        if not self.has_track():
            return None
        self.state = MediaState.PAUSED
        return await self._emit(bus)

    async def resume(self, bus) -> MediaStateEvent | None:
        """Resume playback (also re-starts a stopped loaded track)."""
        if not self.has_track():
            return None
        self.state = MediaState.PLAYING
        return await self._emit(bus)

    async def stop(self, bus) -> MediaStateEvent | None:
        """Stop playback, keeping the loaded track (position retained)."""
        if not self.has_track():
            return None
        self.state = MediaState.STOPPED
        return await self._emit(bus)

    async def seek(self, bus, position_s: int) -> MediaStateEvent | None:
        """Move playback to ``position_s`` seconds and emit the real target.

        R25: the emitted event carries the actual position the player must
        seek to — never a state-only change with a fake message.
        """
        if not self.has_track():
            return None
        self.position_s = max(0, int(position_s))
        return await self._emit(bus)

    async def set_volume(self, bus, volume: float) -> MediaStateEvent | None:
        if not self.has_track():
            return None
        self.volume = max(0.0, min(1.0, float(volume)))
        return await self._emit(bus)

    async def load(
        self,
        bus,
        *,
        state: MediaState = MediaState.STOPPED,
        source: MediaSource = MediaSource.LOCAL,
        kind: MediaKind = MediaKind.AUDIO,
        title: str = "",
        video_id: str | None = None,
        url: str | None = None,
        position_s: int = 0,
        duration_s: int = 0,
        volume: float = 1.0,
    ) -> MediaStateEvent:
        """Full-state override (demo tool / snapshot restore)."""
        self.state = state
        self.source = source
        self.kind = kind
        self.title = title
        self.video_id = video_id
        self.url = url
        self.position_s = max(0, position_s)
        self.duration_s = max(0, duration_s)
        self.volume = max(0.0, min(1.0, volume))
        return await self._emit(bus)

    # ------------------------------------------------------------------ #

    async def _emit(self, bus) -> MediaStateEvent:
        event = self.to_event()
        await bus.publish(event)
        return event


# Module-level singleton: actions.py, media_tools.py and demo_tools.py all
# route through THIS instance, so agent and user inputs share one state.
media_controller = MediaController()


def reset_media_controller() -> None:
    """Test hook: clear the in-memory media controller.

    Mutates the singleton IN PLACE (does not rebind the module global):
    modules that imported ``media_controller`` at load time (actions.py,
    media_tools.py, ...) must keep seeing the same instance after a
    reset, or a test reset would silently fork the authority.
    """
    media_controller.state = MediaState.STOPPED
    media_controller.source = MediaSource.LOCAL
    media_controller.kind = MediaKind.AUDIO
    media_controller.title = ""
    media_controller.video_id = None
    media_controller.url = None
    media_controller.position_s = 0
    media_controller.duration_s = 0
    media_controller.volume = 1.0
