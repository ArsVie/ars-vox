"""Shared enumerations for Ars-Vox contracts."""

from enum import Enum


class LayoutTemplate(str, Enum):
    FOCUS = "focus"
    SPLIT = "split"
    READING = "reading"
    DASHBOARD = "dashboard"
    # Deprecated aliases — kept forever (deployed configs may reference
    # them); engine resolves them to READING/DASHBOARD. Not documented
    # to the model.
    REFERENCE = "reference"
    BACKGROUND_MEDIA = "background_media"


class LayoutRole(str, Enum):
    PRIMARY = "primary"
    SECONDARY = "secondary"
    BACKGROUND = "background"
    HIDDEN = "hidden"


class PanelType(str, Enum):
    CONVERSATION = "conversation"
    BROWSER = "browser"
    YOUTUBE = "youtube"
    MEDIA = "media"
    BOOK_READER = "book_reader"
    DOCUMENT_EDITOR = "document_editor"
    NEWS = "news"
    NOTES = "notes"
    TASKS = "tasks"
    REMINDERS = "reminders"
    TELEGRAM_PREVIEW = "telegram_preview"
    CONFIRMATION = "confirmation"
    SETTINGS = "settings"
    NOTIFICATION = "notification"


class VoiceState(str, Enum):
    SLEEPING = "sleeping"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    WAITING_FOR_CONFIRMATION = "waiting_for_confirmation"
    STOPPING = "stopping"
    ERROR = "error"


class PolicyKind(str, Enum):
    READ_ONLY = "read_only"
    REVERSIBLE = "reversible"
    USER_VISIBLE = "user_visible"
    EXTERNAL = "external"
    DESTRUCTIVE = "destructive"
    PRIVILEGED = "privileged"


class ConfirmationStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    # H5: explicit execution lifecycle — approval state is separate from
    # the execution result. Rows walk pending -> approved -> executing ->
    # executed | failed | cancelled | expired | superseded.
    EXECUTING = "executing"
    EXECUTED = "executed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    SUPERSEDED = "superseded"


class TaskStatus(str, Enum):
    PENDING = "pending"
    DONE = "done"


class ReminderStatus(str, Enum):
    ACTIVE = "active"
    FIRED = "fired"
    CANCELLED = "cancelled"


class NotificationKind(str, Enum):
    REMINDER = "reminder"
    ALARM = "alarm"
    INFO = "info"
    ERROR = "error"


class NotificationStatus(str, Enum):
    ACTIVE = "active"
    SNOOZED = "snoozed"
    DISMISSED = "dismissed"
    HANDLED = "handled"


class MediaState(str, Enum):
    PLAYING = "playing"
    PAUSED = "paused"
    STOPPED = "stopped"


class EventType(str, Enum):
    USER_MESSAGE = "user_message"
    AGENT_MESSAGE = "agent_message"
    TOOL_CALL = "tool_call"
    UI_COMMAND = "ui_command"
    CONFIRMATION_REQUESTED = "confirmation_requested"
    CONFIRMATION_RESOLVED = "confirmation_resolved"
    STATE_UPDATE = "state_update"
    NOTIFICATION = "notification"
    ERROR = "error"
    CONFIG_UPDATE = "config_update"
    YOUTUBE_SEARCH = "youtube.search"
    BROWSER_NAVIGATE = "browser.navigate"
    DOCUMENT_LOAD = "document.load"
    TASKS_UPDATE = "tasks.update"
    MEDIA_STATE = "media.state"
    PONG = "pong"
    # H5: canonical state snapshot replayed on every WS connect (reconnect
    # recovery). Carries its own session sequence for gap detection.
    STATE_SNAPSHOT = "state_snapshot"


class MediaSource(str, Enum):
    YOUTUBE = "youtube"
    LOCAL = "local"


class MediaKind(str, Enum):
    VIDEO = "video"
    AUDIO = "audio"


class DocumentKind(str, Enum):
    TXT = "txt"
    MD = "md"
    PDF = "pdf"
    EPUB = "epub"
