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
    DocumentKind,
    EventType,
    MediaKind,
    MediaSource,
    MediaState,
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


class YoutubeVideoResult(BaseModel):
    id: str
    title: str
    channel: str
    duration_s: int
    published: str
    thumbnail_url: str | None = None


class YoutubeSearchEvent(BaseModel):
    type: Literal[EventType.YOUTUBE_SEARCH] = EventType.YOUTUBE_SEARCH
    query: str
    results: list[YoutubeVideoResult]
    created_at: datetime = Field(default_factory=_utcnow)


class BrowserNavigateEvent(BaseModel):
    type: Literal[EventType.BROWSER_NAVIGATE] = EventType.BROWSER_NAVIGATE
    url: str
    title: str
    can_go_back: bool = False
    can_go_forward: bool = False
    loading: bool = False
    created_at: datetime = Field(default_factory=_utcnow)


class DocumentChapter(BaseModel):
    title: str
    content: str


class DocumentLoadEvent(BaseModel):
    type: Literal[EventType.DOCUMENT_LOAD] = EventType.DOCUMENT_LOAD
    title: str
    kind: DocumentKind
    path: str
    content: str = ""
    chapters: list[DocumentChapter] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)


class TodoItem(BaseModel):
    id: str
    title: str
    done: bool = False
    priority: Literal["low", "normal", "high"] = "normal"
    due: str | None = None


class ReminderItem(BaseModel):
    id: str
    title: str
    cadence: str
    next_fire: str


class TasksUpdateEvent(BaseModel):
    type: Literal[EventType.TASKS_UPDATE] = EventType.TASKS_UPDATE
    todos: list[TodoItem] = Field(default_factory=list)
    reminders: list[ReminderItem] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)


class MediaStateEvent(BaseModel):
    type: Literal[EventType.MEDIA_STATE] = EventType.MEDIA_STATE
    state: MediaState
    source: MediaSource
    kind: MediaKind
    title: str = ""
    video_id: str | None = None
    url: str | None = None
    position_s: int = 0
    duration_s: int = 0
    volume: float = 1.0
    created_at: datetime = Field(default_factory=_utcnow)


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
        YoutubeSearchEvent,
        BrowserNavigateEvent,
        DocumentLoadEvent,
        TasksUpdateEvent,
        MediaStateEvent,
        PongEvent,
    ],
    Field(discriminator="type"),
]
