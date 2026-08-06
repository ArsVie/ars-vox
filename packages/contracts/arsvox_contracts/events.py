"""Agent events pushed from the agent service to the UI over WebSocket.

Discriminated union on ``type``. ``delta`` on agent_message means the
text continues the previous assistant message (streaming).
"""

from datetime import datetime, timezone
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field

from arsvox_contracts.commands import UiCommand
from arsvox_contracts.enums import (
    ConfirmationStatus,
    EventType,
    NotificationKind,
    VoiceState,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserMessageEvent(BaseModel):
    type: Literal[EventType.USER_MESSAGE] = EventType.USER_MESSAGE
    id: str
    text: str
    created_at: datetime = Field(default_factory=_utcnow)


class AgentMessageEvent(BaseModel):
    type: Literal[EventType.AGENT_MESSAGE] = EventType.AGENT_MESSAGE
    text: str
    delta: bool = False
    created_at: datetime = Field(default_factory=_utcnow)


class ToolCallEvent(BaseModel):
    type: Literal[EventType.TOOL_CALL] = EventType.TOOL_CALL
    run_id: str
    tool: str
    args: dict[str, Any]
    status: Literal["running", "done", "error", "rejected"]
    result: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)


class UiCommandEvent(BaseModel):
    type: Literal[EventType.UI_COMMAND] = EventType.UI_COMMAND
    command: UiCommand
    created_at: datetime = Field(default_factory=_utcnow)


class ConfirmationRequestedEvent(BaseModel):
    type: Literal[EventType.CONFIRMATION_REQUESTED] = EventType.CONFIRMATION_REQUESTED
    pending_id: str
    tool: str
    title: str
    detail: str
    expires_in_s: int
    created_at: datetime = Field(default_factory=_utcnow)


class ConfirmationResolvedEvent(BaseModel):
    type: Literal[EventType.CONFIRMATION_RESOLVED] = EventType.CONFIRMATION_RESOLVED
    pending_id: str
    status: ConfirmationStatus
    message: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)


class StateUpdateEvent(BaseModel):
    type: Literal[EventType.STATE_UPDATE] = EventType.STATE_UPDATE
    voice_state: VoiceState
    activity: str | None = None
    created_at: datetime = Field(default_factory=_utcnow)


class NotificationEvent(BaseModel):
    type: Literal[EventType.NOTIFICATION] = EventType.NOTIFICATION
    notification_id: str
    kind: NotificationKind
    title: str
    text: str
    due_at: datetime | None = None
    created_at: datetime = Field(default_factory=_utcnow)


class ErrorEvent(BaseModel):
    type: Literal[EventType.ERROR] = EventType.ERROR
    message: str
    recoverable: bool = True
    created_at: datetime = Field(default_factory=_utcnow)


class ConfigUpdateEvent(BaseModel):
    type: Literal[EventType.CONFIG_UPDATE] = EventType.CONFIG_UPDATE
    config: dict[str, Any]
    created_at: datetime = Field(default_factory=_utcnow)


class PongEvent(BaseModel):
    type: Literal[EventType.PONG] = EventType.PONG
    ts: datetime = Field(default_factory=_utcnow)


AgentEvent = Annotated[
    Union[
        UserMessageEvent,
        AgentMessageEvent,
        ToolCallEvent,
        UiCommandEvent,
        ConfirmationRequestedEvent,
        ConfirmationResolvedEvent,
        StateUpdateEvent,
        NotificationEvent,
        ErrorEvent,
        ConfigUpdateEvent,
        PongEvent,
    ],
    Field(discriminator="type"),
]
