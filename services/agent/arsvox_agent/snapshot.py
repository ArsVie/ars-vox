"""Reconnect recovery (H5): canonical state snapshot + bus state tracker.

``SnapshotTracker`` rides the event bus and records the latest ephemeral
state that has no store of its own (media state, voice state). It is
subscribed once at startup and drained whenever a snapshot is built, so
no background task is needed and the queue never fills.

``build_state_snapshot`` assembles the authoritative StateSnapshotEvent
from the service's own stores: pending confirmation (coordinator), open
panels (PanelStore), active notifications (NotificationStore), and the
tracker's media/voice. Emitted once per WS connect — never per event.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from arsvox_contracts import StateUpdateEvent, VoiceState
from arsvox_contracts.events import (
    MediaStateEvent,
    PendingConfirmationSnapshot,
    StateSnapshotEvent,
)

from arsvox_agent.events import EventBus
from arsvox_agent.runtime import AgentRuntime

log = logging.getLogger(__name__)

_MEDIA_TYPE = MediaStateEvent.model_fields["type"].default
_STATE_TYPE = StateUpdateEvent.model_fields["type"].default


class SnapshotTracker:
    """Records the latest media/voice state published on the bus."""

    def __init__(self, bus: EventBus) -> None:
        self.bus = bus
        self._queue: asyncio.Queue | None = None
        self.last_media: dict[str, Any] | None = None
        self.last_voice: str | None = None

    def start(self) -> None:
        """Subscribe to the bus (idempotent). Called once at startup."""
        if self._queue is None:
            self._queue = self.bus.subscribe()

    def drain(self) -> None:
        """Consume queued events, keeping the latest media/voice state.
        Called when a snapshot is built (once per connect)."""
        if self._queue is None:
            return
        while not self._queue.empty():
            try:
                payload = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            kind = payload.get("type")
            if kind == _MEDIA_TYPE:
                self.last_media = payload
            elif kind == _STATE_TYPE:
                self.last_voice = payload.get("voice_state") or self.last_voice

    def close(self) -> None:
        if self._queue is not None:
            self.bus.unsubscribe(self._queue)
            self._queue = None


def _expires_in_s(row: dict) -> int:
    try:
        expires = datetime.fromisoformat(row["expires_at"])
        remaining = expires - datetime.now(timezone.utc)
        return max(0, int(remaining.total_seconds()))
    except (KeyError, TypeError, ValueError):
        return 0


def build_state_snapshot(
    runtime: AgentRuntime,
    config_snapshot: dict[str, Any],
    tracker: SnapshotTracker | None,
) -> StateSnapshotEvent:
    """Assemble the authoritative reconnect snapshot from service state."""
    deps = runtime.deps_base
    if tracker is not None:
        tracker.drain()

    pending = deps.confirmations.current_pending()
    pending_confirmation = None
    if pending:
        pending_confirmation = PendingConfirmationSnapshot(
            pending_id=pending["id"],
            tool=pending["tool"],
            title=pending["title"],
            detail=pending["detail"],
            expires_in_s=_expires_in_s(pending),
            expires_at=pending["expires_at"],
        )

    panels = deps.panels.list()
    notifications = deps.notifications.list_active()
    media = None
    if tracker is not None and tracker.last_media is not None:
        media = MediaStateEvent.model_validate(tracker.last_media)

    voice = VoiceState(tracker.last_voice) if tracker and tracker.last_voice else VoiceState.LISTENING

    return StateSnapshotEvent(
        sequence=runtime.bus.sequence,
        voice_state=voice,
        config=config_snapshot,
        layout={
            "panels": [
                {
                    "panel_type": p["panel_type"],
                    "title": p.get("title"),
                    "content_reference": p.get("content_reference"),
                }
                for p in panels
            ]
        },
        pending_confirmation=pending_confirmation,
        media=media,
        notifications=[
            {
                "notification_id": str(n["id"]),
                "kind": n["kind"],
                "title": n["title"],
                "text": n["text"],
                "due_at": n.get("due_at"),
            }
            for n in notifications
        ],
        content_keys=[
            p["content_reference"] for p in panels if p.get("content_reference")
        ],
    )
