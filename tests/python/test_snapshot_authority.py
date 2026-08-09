"""GATE-3.5 A6 — snapshot/reconnect authority (R28, R32, R33).

Covers the frozen reconnect scenarios owned by A6:
  R28  SnapshotTracker holds CURRENT state after >1000 bus events — no
       starvation (C8): the tracker is a synchronous bus listener, so
       nothing is buffered and nothing can drop.
  R32  Snapshot voice state comes from pipeline config/state, NEVER the
       hardcoded VoiceState.LISTENING fallback.
  R33  Adaptive composition (template/roles/proportion/constraints) is in
       the snapshot — a reload can reconstruct the workspace.
Plus the adaptive field shape roundtrip on StateSnapshotEvent.
"""

import json

from arsvox_contracts import StateUpdateEvent, VoiceState
from arsvox_contracts.commands import LayoutApply, LayoutSlots
from arsvox_contracts.events import (
    AdaptiveAssignmentSnapshot,
    AdaptiveSnapshot,
    MediaStateEvent,
    StateSnapshotEvent,
    UiCommandEvent,
)

from arsvox_agent.events import EventBus
from arsvox_agent.snapshot import (
    SnapshotTracker,
    adaptive_from_layout_command,
    build_state_snapshot,
)

# --------------------------------------------------------------------- #
# R28 — tracker continuity past the 1000-event queue cap


async def test_tracker_holds_current_state_after_1500_bus_events():
    """The old queue-backed tracker dropped events past the 1000 cap
    (starvation); the listener-based tracker must hold the CURRENT media
    and voice state after pumping far past the cap."""
    bus = EventBus()
    tracker = SnapshotTracker(bus)
    tracker.start()
    try:
        for i in range(1500):
            await bus.publish(
                MediaStateEvent(
                    state="playing",
                    source="youtube",
                    kind="video",
                    video_id=f"v{i}",
                    position_s=i,
                )
            )
            await bus.publish(
                StateUpdateEvent(
                    voice_state=VoiceState.THINKING if i % 2 else VoiceState.LISTENING
                )
            )
        assert tracker.last_media is not None
        assert tracker.last_media["video_id"] == "v1499"
        assert tracker.last_media["position_s"] == 1499
        assert tracker.last_voice == "thinking"
    finally:
        tracker.close()


async def test_tracker_unsubscribe_stops_recording():
    bus = EventBus()
    tracker = SnapshotTracker(bus)
    tracker.start()
    tracker.close()
    await bus.publish(MediaStateEvent(state="stopped", source="local", kind="audio"))
    assert tracker.last_media is None


# --------------------------------------------------------------------- #
# R32 — snapshot voice from pipeline config/state, never hardcoded


async def test_snapshot_voice_comes_from_pipeline_state(client):
    services = client.app.state.services
    services.runtime.pipeline.set_state(VoiceState.THINKING)
    snap = build_state_snapshot(
        services.runtime, services.config_snapshot(), tracker=None
    )
    assert snap.voice_state == VoiceState.THINKING


def test_snapshot_voice_without_pipeline_uses_config(client, monkeypatch):
    services = client.app.state.services
    monkeypatch.setattr(services.runtime, "pipeline", None)
    # fixture config: voice.enabled = false -> SLEEPING, never LISTENING
    snap = build_state_snapshot(
        services.runtime, services.config_snapshot(), tracker=None
    )
    assert snap.voice_state == VoiceState.SLEEPING
    # voice-enabled config -> LISTENING (derived from config, not a default)
    snap2 = build_state_snapshot(
        services.runtime,
        {**services.config_snapshot(), "voice": {"enabled": True}},
        tracker=None,
    )
    assert snap2.voice_state == VoiceState.LISTENING


def test_snapshot_voice_prefers_tracker_bus_state(client):
    services = client.app.state.services
    services.tracker.last_voice = "speaking"
    try:
        snap = build_state_snapshot(
            services.runtime, services.config_snapshot(), services.tracker
        )
    finally:
        services.tracker.last_voice = None
    assert snap.voice_state == VoiceState.SPEAKING


# --------------------------------------------------------------------- #
# R33 — adaptive composition in the snapshot


def test_adaptive_mapping_from_legacy_layout_command():
    mapped = adaptive_from_layout_command(
        {
            "action": "layout.apply",
            "template": "split",
            "primary_panel": "conversation",
            "secondary_panel": "browser",
            "slots": None,
        }
    )
    assert mapped == {
        "template": "split",
        "assignments": [
            {"surface_id": "conversation", "role": "primary", "slot": "main"},
            {"surface_id": "browser", "role": "companion", "slot": "side"},
        ],
        "proportion": None,
        "overrides": {},
    }


def test_adaptive_mapping_slots_win_and_reading_maps_to_sidecar():
    mapped = adaptive_from_layout_command(
        {
            "action": "layout.apply",
            "template": "reading",
            "primary_panel": "document_editor",
            "secondary_panel": None,
            "slots": {
                "main": "document_editor",
                "side": "conversation",
                "rail": "tasks",
                "dock": "media",
            },
        }
    )
    assert mapped["template"] == "sidecar"
    assert mapped["assignments"] == [
        {"surface_id": "document_editor", "role": "primary", "slot": "main"},
        {"surface_id": "conversation", "role": "companion", "slot": "side"},
        {"surface_id": "tasks", "role": "support", "slot": "rail"},
    ]


def test_adaptive_mapping_native_spec_passthrough():
    mapped = adaptive_from_layout_command(
        {
            "action": "layout.apply",
            "template": "sidecar",
            "assignments": [
                {"surface_id": "browser", "role": "primary", "slot": "main"},
                {"surface_id": "conversation", "role": "companion", "slot": "side"},
            ],
            "proportion": "wide",
        }
    )
    assert mapped is not None
    assert mapped["template"] == "sidecar"
    assert mapped["proportion"] == "wide"
    assert len(mapped["assignments"]) == 2


def test_adaptive_mapping_unknown_template_is_none():
    assert (
        adaptive_from_layout_command(
            {"action": "layout.apply", "template": "hologram", "primary_panel": "browser"}
        )
        is None
    )


async def test_tracker_records_adaptive_composition_from_bus(client):
    bus = EventBus()
    tracker = SnapshotTracker(bus)
    tracker.start()
    try:
        await bus.publish(
            UiCommandEvent(
                command=LayoutApply(
                    template="split",
                    primary_panel="conversation",
                    secondary_panel="browser",
                )
            )
        )
        await bus.publish(
            UiCommandEvent(
                command=LayoutApply(
                    template="reading",
                    primary_panel="document_editor",
                    slots=LayoutSlots(
                        main="document_editor", side="conversation", rail=None, dock=None
                    ),
                )
            )
        )
        assert tracker.last_adaptive is not None
        assert tracker.last_adaptive["template"] == "sidecar"
        assert tracker.last_adaptive["assignments"] == [
            {"surface_id": "document_editor", "role": "primary", "slot": "main"},
            {"surface_id": "conversation", "role": "companion", "slot": "side"},
        ]
    finally:
        tracker.close()


async def test_snapshot_carries_adaptive_composition(client):
    services = client.app.state.services
    await services.bus.publish(
        UiCommandEvent(
            command=LayoutApply(
                template="split",
                primary_panel="conversation",
                secondary_panel="browser",
            )
        )
    )
    snap = build_state_snapshot(
        services.runtime, services.config_snapshot(), services.tracker
    )
    assert snap.adaptive.template == "split"
    assert snap.adaptive.assignments == [
        AdaptiveAssignmentSnapshot(surface_id="conversation", role="primary", slot="main"),
        AdaptiveAssignmentSnapshot(surface_id="browser", role="companion", slot="side"),
    ]
    assert snap.adaptive.proportion is None
    assert snap.adaptive.overrides == {}


def test_snapshot_adaptive_defaults_empty():
    snap = StateSnapshotEvent(
        sequence=0,
        voice_state=VoiceState.SLEEPING,
        config={},
        layout={"panels": []},
    )
    assert snap.adaptive == AdaptiveSnapshot()
    assert snap.adaptive.template is None
    assert snap.adaptive.assignments == []


def test_snapshot_adaptive_roundtrip():
    snap = StateSnapshotEvent(
        sequence=9,
        voice_state=VoiceState.LISTENING,
        config={},
        layout={"panels": []},
        adaptive=AdaptiveSnapshot(
            template="sidecar",
            assignments=[
                AdaptiveAssignmentSnapshot(
                    surface_id="browser", role="primary", slot="main"
                )
            ],
            proportion="wide",
            overrides={"browser": {"pin": True}},
        ),
    )
    dumped = snap.model_dump(mode="json")
    parsed = StateSnapshotEvent.model_validate_json(json.dumps(dumped))
    assert parsed.adaptive.template == "sidecar"
    assert parsed.adaptive.assignments[0].surface_id == "browser"
    assert parsed.adaptive.proportion == "wide"
    assert parsed.adaptive.overrides == {"browser": {"pin": True}}


async def test_snapshot_without_tracker_is_empty_adaptive(client):
    services = client.app.state.services
    snap = build_state_snapshot(
        services.runtime, services.config_snapshot(), tracker=None
    )
    assert snap.adaptive.template is None
    assert snap.adaptive.assignments == []
