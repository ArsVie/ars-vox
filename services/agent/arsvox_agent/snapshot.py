"""Reconnect recovery (H5) + snapshot authority (GATE-3.5 A6): canonical
state snapshot + continuously-current bus state tracker.

``SnapshotTracker`` rides the event bus as a SYNCHRONOUS LISTENER (not a
queue subscriber): every published payload is recorded the moment it is
published, so the tracker holds CURRENT media/voice/adaptive state with no
buffering window and no 1000-event queue cap to starve (C8/R28). No
background task, no drain step — the snapshot is always built from live
state.

``build_state_snapshot`` assembles the authoritative StateSnapshotEvent
from the service's own stores: pending confirmation (coordinator), open
panels (PanelStore), active notifications (NotificationStore), and the
tracker's media/voice/adaptive composition. Emitted once per WS connect —
never per event.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from arsvox_contracts import StateUpdateEvent, VoiceState
from arsvox_contracts.events import (
    AdaptiveAssignmentSnapshot,
    AdaptiveSnapshot,
    MediaStateEvent,
    PendingConfirmationSnapshot,
    StateSnapshotEvent,
)

from arsvox_agent.events import EventBus
from arsvox_agent.deps import Deps
from arsvox_agent.runtime import AgentRuntime

log = logging.getLogger(__name__)

_MEDIA_TYPE = MediaStateEvent.model_fields["type"].default
_STATE_TYPE = StateUpdateEvent.model_fields["type"].default
_UI_COMMAND_TYPE = "ui_command"

#: Deterministic legacy-wire template -> adaptive template mapping. Mirror
#: of the client planner's LEGACY_TEMPLATE_MAP (apps/desktop/src/adaptive/
#: planner.ts) — server truth must not disagree with the client about what
#: a legacy layout intent means. When the native LayoutSpec tool lands
#: (A3), its commands carry template+assignments directly and bypass this.
_LEGACY_TEMPLATE_MAP: dict[str, str] = {
    "focus": "focus",
    "split": "split",
    "reading": "sidecar",
    "dashboard": "triple",
    "reference": "sidecar",
    "background_media": "triple",
}

#: Wire slot -> semantic role (dock intentionally absent — persistent
#: surfaces are shell-owned).
_WIRE_SLOT_ROLE: dict[str, str] = {
    "main": "primary",
    "side": "companion",
    "rail": "support",
}


def adaptive_from_layout_command(command: dict[str, Any]) -> dict[str, Any] | None:
    """Map a wire layout intent (ui_command/layout.apply payload) to the
    adaptive composition shape carried by the snapshot.

    Mirrors the client planner's deterministic mapping (slots win over
    primary/secondary; main falls back to primary_panel; dock dropped).
    Native-shaped intents (template + assignments, A3's vocabulary) pass
    through unchanged. Returns None when the intent cannot be mapped
    (unknown template, no assignments) — the snapshot then keeps the
    previous composition.
    """
    template = command.get("template")
    if not isinstance(template, str) or not template:
        return None
    assignments = command.get("assignments")
    if isinstance(assignments, list) and assignments:
        # Native LayoutSpec-shaped command (A3): normalize to wire shape.
        built: list[dict[str, str]] = []
        for a in assignments:
            if not isinstance(a, dict):
                continue
            surface_id = a.get("surface_id") or a.get("surfaceId")
            role = a.get("role")
            slot = a.get("slot")
            if isinstance(surface_id, str) and isinstance(role, str) and isinstance(slot, str):
                built.append({"surface_id": surface_id, "role": role, "slot": slot})
        if not built:
            return None
        return {
            "template": template,
            "assignments": built,
            "proportion": command.get("proportion"),
            "overrides": command.get("overrides") or {},
        }

    adaptive_template = _LEGACY_TEMPLATE_MAP.get(template)
    if adaptive_template is None:
        return None

    built = []
    slots = command.get("slots")
    if isinstance(slots, dict):
        for slot in ("main", "side", "rail"):
            surface_id = slots.get(slot)
            if isinstance(surface_id, str) and surface_id:
                built.append(
                    {"surface_id": surface_id, "role": _WIRE_SLOT_ROLE[slot], "slot": slot}
                )
        # slots win over primary/secondary, but main is mandatory: when the
        # wire omitted it, fall back to primary_panel (legacy engine rule).
        if not any(a["slot"] == "main" for a in built):
            primary = command.get("primary_panel")
            if isinstance(primary, str) and primary:
                built.append({"surface_id": primary, "role": "primary", "slot": "main"})
    else:
        primary = command.get("primary_panel")
        if isinstance(primary, str) and primary:
            built.append({"surface_id": primary, "role": "primary", "slot": "main"})
        secondary = command.get("secondary_panel")
        if isinstance(secondary, str) and secondary:
            built.append({"surface_id": secondary, "role": "companion", "slot": "side"})

    if not built:
        return None
    return {
        "template": adaptive_template,
        "assignments": built,
        "proportion": None,
        "overrides": {},
    }


class SnapshotTracker:
    """Holds the CURRENT media/voice/adaptive state published on the bus.

    Listener-based (C8/R28): ``start`` registers a synchronous listener on
    the bus, so every published payload is recorded immediately — no queue,
    no drain, no event-loss window, no starvation past 1000 events.
    """

    def __init__(self, bus: EventBus) -> None:
        self.bus = bus
        self._listening = False
        self.last_media: dict[str, Any] | None = None
        self.last_voice: str | None = None
        self.last_adaptive: dict[str, Any] | None = None

    def _record(self, payload: dict[str, Any]) -> None:
        kind = payload.get("type")
        if kind == _MEDIA_TYPE:
            self.last_media = payload
        elif kind == _STATE_TYPE:
            self.last_voice = payload.get("voice_state") or self.last_voice
        elif kind == _UI_COMMAND_TYPE:
            command = payload.get("command")
            if isinstance(command, dict) and command.get("action") == "layout.apply":
                mapped = adaptive_from_layout_command(command)
                if mapped is not None:
                    self.last_adaptive = mapped

    def start(self) -> None:
        """Register the bus listener (idempotent). Called once at startup."""
        if not self._listening:
            self.bus.add_listener(self._record)
            self._listening = True

    def close(self) -> None:
        if self._listening:
            self.bus.remove_listener(self._record)
            self._listening = False


def _expires_in_s(row: dict) -> int:
    try:
        expires = datetime.fromisoformat(row["expires_at"])
        remaining = expires - datetime.now(timezone.utc)
        return max(0, int(remaining.total_seconds()))
    except (KeyError, TypeError, ValueError):
        return 0


def _recent_history(deps: "Deps", limit: int) -> list[dict[str, Any]]:
    """Recent turns of the most recent session (server truth for the chat).

    Turns are persisted per session; WS events are per-connection. Without
    this, a page reload blanks the conversation forever (H5 gap)."""
    try:
        sessions = deps.sessions.latest(1)
    except Exception:  # noqa: BLE001 — snapshot must never fail
        return []
    if not sessions:
        return []
    sid = sessions[0]["id"]
    try:
        turns = deps.sessions.recent_turns(sid, limit)
    except Exception:  # noqa: BLE001
        return []
    return [
        {
            "id": t["id"],
            "role": t["role"],
            "text": t["text"][:500],
            "created_at": t["created_at"],
        }
        for t in turns
    ]


def _voice_from_pipeline(runtime: AgentRuntime, config_snapshot: dict[str, Any]) -> VoiceState:
    """Derive the snapshot voice state from the canonical pipeline.

    C3/R32: NEVER the hardcoded LISTENING fallback — the pipeline owns the
    value (it derives from config.voice.enabled at start); without a
    pipeline, the config's voice.enabled decides (listening vs sleeping),
    matching the ws.py initial-state semantics.
    """
    if runtime.pipeline is not None:
        return VoiceState(runtime.pipeline.state)
    if config_snapshot.get("voice", {}).get("enabled"):
        return VoiceState.LISTENING
    return VoiceState.SLEEPING


def _adaptive_snapshot(tracker: SnapshotTracker | None) -> AdaptiveSnapshot:
    if tracker is None or not tracker.last_adaptive:
        return AdaptiveSnapshot()
    last = tracker.last_adaptive
    return AdaptiveSnapshot(
        template=last.get("template"),
        assignments=[
            AdaptiveAssignmentSnapshot(
                surface_id=a["surface_id"], role=a["role"], slot=a["slot"]
            )
            for a in last.get("assignments") or []
            if isinstance(a, dict)
            and a.get("surface_id")
            and a.get("role")
            and a.get("slot")
        ],
        proportion=last.get("proportion"),
        overrides=last.get("overrides") or {},
    )


def build_state_snapshot(
    runtime: AgentRuntime,
    config_snapshot: dict[str, Any],
    tracker: SnapshotTracker | None,
) -> StateSnapshotEvent:
    """Assemble the authoritative reconnect snapshot from service state."""
    deps = runtime.deps_base

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

    voice = _voice_from_pipeline(runtime, config_snapshot)
    if tracker is not None and tracker.last_voice:
        # The bus is the pipeline's own broadcast channel: a voice state
        # seen on the bus IS pipeline state (published by on_state_change).
        voice = VoiceState(tracker.last_voice)

    return StateSnapshotEvent(
        sequence=runtime.bus.sequence,
        voice_state=voice,
        config=config_snapshot,
        history=_recent_history(deps, runtime.config.agent.recent_turns_in_context),
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
        adaptive=_adaptive_snapshot(tracker),
    )
