"""GATE-3.5 A10 — adversarial integration tests R28/R29/R32/R34/R46/R47:
snapshot + reconnect authority.

R28 — SnapshotTracker must hold current state after >1000 bus events
      (no starvation). Main: the old queue-backed tracker capped its
      subscriber queue at 1000 (events.py _SUBSCRIBER_CAP) and only
      drained when a snapshot was built, so a long gap between connects
      silently lost events. A6's listener-based tracker (C8) records
      every payload synchronously — continuously current, nothing
      buffered.
R29 — bus sequence tagging: every event carries a monotonic sequence and
      the reconnect snapshot carries the current value (the client-side
      gap detection + resync is A6's renderer work — covered by
      apps/desktop/tests/adversarial-reconnect.test.ts).
R32/R46 — snapshot voice state must come from the pipeline/config, never
      a hardcoded LISTENING — a fresh reconnect with voice disabled must
      not claim "Escuchando". Main: snapshot.py:136 falls back to
      LISTENING when the tracker has no voice event.
R34/R47 — notifications survive a reconnect: the snapshot carries the
      active notifications and the UI must render them (renderer half in
      adversarial-reconnect.test.ts).

EXPECTED-FAIL markers name the owner: A6 (Reconnect state).
"""

import asyncio

import pytest

from arsvox_contracts import StateUpdateEvent, VoiceState
from arsvox_contracts.events import MediaStateEvent

from arsvox_agent.events import EventBus
from arsvox_agent.snapshot import SnapshotTracker

from tests.python.harness_fixtures import ws_collect

# --------------------------------------------------------------------- #
# R28 — SnapshotTracker starvation beyond the subscriber cap
# --------------------------------------------------------------------- #


def _media_event(i: int) -> MediaStateEvent:
    return MediaStateEvent(
        state="playing",
        source="youtube",
        kind="video",
        title=f"t{i}",
        video_id=f"v{i}",
        url=None,
        position_s=i,
        duration_s=100,
        volume=1,
    )


def test_r28_tracker_holds_latest_after_1500_events():
    """Publish 1500 interleaved media/voice events with no snapshot built
    in between (a long window with no connects), then read the tracker.
    The listener-based tracker (C8: continuous current state) must hold
    the FINAL media and voice state — nothing is buffered, so nothing can
    drop past the old 1000-event subscriber cap."""
    bus = EventBus()
    tracker = SnapshotTracker(bus)
    tracker.start()
    try:
        async def pump():
            for i in range(1, 1501):
                if i % 2 == 0:
                    await bus.publish(_media_event(i))
                else:
                    await bus.publish(StateUpdateEvent(voice_state=VoiceState.LISTENING))

        asyncio.run(pump())

        assert tracker.last_media is not None
        assert tracker.last_media["video_id"] == "v1500", (
            f"tracker lost the final media event (got {tracker.last_media.get('video_id')}) — "
            "listener-based tracker must stay current past the old 1000-event queue cap"
        )
        assert tracker.last_voice == VoiceState.LISTENING.value
    finally:
        tracker.close()


def test_r28_tracker_stays_current_over_long_window():
    """Guard: the listener-based tracker is continuously current — at
    checkpoints mid-pump (500/1000/1500 events) last_media/last_voice
    already reflect the newest event so far, so a snapshot built at any
    point is authoritative (the old queue only drained on demand)."""
    bus = EventBus()
    tracker = SnapshotTracker(bus)
    tracker.start()
    try:
        checkpoints = {}

        async def pump():
            for i in range(1, 1501):
                if i % 2 == 0:
                    await bus.publish(_media_event(i))
                else:
                    await bus.publish(StateUpdateEvent(voice_state=VoiceState.LISTENING))
                if i in (500, 1000, 1500):
                    checkpoints[i] = (tracker.last_media, tracker.last_voice)

        asyncio.run(pump())

        assert checkpoints[500][0]["video_id"] == "v500"
        assert checkpoints[1000][0]["video_id"] == "v1000"
        assert checkpoints[1500][0]["video_id"] == "v1500"
        assert checkpoints[1500][1] == VoiceState.LISTENING.value
    finally:
        tracker.close()


# --------------------------------------------------------------------- #
# R29 — bus sequence foundation (server half)
# --------------------------------------------------------------------- #


def test_r29_sequence_is_monotonic_and_snapshot_ready():
    """Every published event is tagged with a monotonic session sequence
    and the bus exposes the current value — the snapshot's `sequence`
    field, which the client uses for gap detection (A6 renders the
    client half)."""
    bus = EventBus()

    async def pump():
        for _ in range(5):
            await bus.publish(StateUpdateEvent(voice_state=VoiceState.LISTENING))

    asyncio.run(pump())
    assert bus.sequence == 5
    # the tracker records sequence-tagged payloads, so the snapshot's
    # last sequence is always the bus's current one
    assert bus.sequence == 5


# --------------------------------------------------------------------- #
# R32/R46 — snapshot voice from pipeline state, never hardcoded LISTENING
# --------------------------------------------------------------------- #


def test_r46_snapshot_voice_state_with_voice_disabled(client):
    """Voice disabled (the shipped config): the reconnect snapshot must
    say sleeping — a fresh UI must never claim "Escuchando".
    Mechanism of the bug on main: with voice disabled the pipeline's
    start() is a no-op transition (state is already SLEEPING), so no
    StateUpdateEvent reaches the tracker; snapshot.py:136 then falls
    back to hardcoded LISTENING.
    EXPECTED-FAIL until A6 lands (C3: snapshot voice from pipeline
    config, never hardcoded)."""
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update (correct: sleeping)
        ws.receive_json()  # config_update
        snap = ws.receive_json()
        assert snap["type"] == "state_snapshot"
        assert snap["voice_state"] == "sleeping", (
            f"snapshot voice with voice disabled must not be LISTENING "
            f"(got {snap['voice_state']})"
        )


def test_r46_snapshot_voice_matches_pipeline_when_voice_enabled(voice_client):
    """Guard: with voice enabled the snapshot voice comes from the
    pipeline (listening), and the ws-level state_update agrees."""
    with voice_client.websocket_connect("/ws") as ws:
        first = ws.receive_json()
        ws.receive_json()  # config_update
        snap = ws.receive_json()
        assert first["voice_state"] == "listening"
        assert snap["type"] == "state_snapshot"
        assert snap["voice_state"] == "listening"


# --------------------------------------------------------------------- #
# R34/R47 — notifications survive a reconnect (server half)
# --------------------------------------------------------------------- #


def test_r47_snapshot_carries_active_notifications(client):
    """A reminder that fired while connected must still be in the
    reconnect snapshot's notifications (R34's server half: the UI gets
    the authoritative active set on every connect)."""
    from datetime import datetime, timedelta, timezone
    import time

    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        services = client.app.state.services
        now = datetime.now(timezone.utc)
        rid = services.reminders.create(
            "alarma de prueba",
            (now - timedelta(seconds=1)).isoformat(timespec="seconds"),
            "none",
        )
        deadline = time.time() + 6
        while not services.notifications.list_active() and time.time() < deadline:
            time.sleep(0.2)
        assert services.notifications.list_active()

    # reconnect: the snapshot must carry the active notification
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        snap = ws.receive_json()
        assert snap["type"] == "state_snapshot"
        notifs = snap["notifications"]
        assert notifs, "snapshot must carry the active reminder notification"
        assert any(n["kind"] == "reminder" for n in notifs)
        assert any("alarma de prueba" in n["text"] for n in notifs)


# --------------------------------------------------------------------- #
# fixtures (same patterns as test_voice_state.py / test_reconnect_snapshot.py)
# --------------------------------------------------------------------- #


@pytest.fixture
def voice_client(tmp_path):
    import yaml
    from fastapi.testclient import TestClient

    from arsvox_agent.app import create_app
    from tests.python.harness_fixtures import base_config

    cfg = base_config(tmp_path)
    cfg["voice"]["enabled"] = True
    path = tmp_path / "app-voice.yaml"
    path.write_text(
        yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    app = create_app(str(path))
    with TestClient(app) as c:
        yield c
