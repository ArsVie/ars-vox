"""Per-run dependency container handed to every tool via RunContext.

Built fresh for each agent turn: run_id and session_id travel with the
run, stores and services are shared singletons from the app lifespan.
"""

from dataclasses import dataclass

from arsvox_contracts import AppConfig
from arsvox_memory import (
    AuditStore,
    Database,
    DocumentStore,
    NoteStore,
    NotificationStore,
    PanelStore,
    PendingStore,
    PreferenceStore,
    ProgressStore,
    ReminderStore,
    SessionStore,
    TaskStore,
    ToolCallStore,
)
from arsvox_tts import TTSProvider

from arsvox_agent.confirmations import ConfirmationCoordinator
from arsvox_agent.events import EventBus
from arsvox_agent.policy import PolicyEngine
from arsvox_agent.telegram_client import TelegramClient


@dataclass
class Deps:
    config: AppConfig
    db: Database
    sessions: SessionStore
    notes: NoteStore
    tasks: TaskStore
    reminders: ReminderStore
    notifications: NotificationStore
    panels: PanelStore
    preferences: PreferenceStore
    progress: ProgressStore
    pending: PendingStore
    documents: DocumentStore
    audit: AuditStore
    bus: EventBus
    policy: PolicyEngine
    confirmations: ConfirmationCoordinator
    tts: TTSProvider
    telegram: TelegramClient
    # None in unit tests that never run tools through the registry.
    tool_calls: ToolCallStore | None = None
    # per-run
    run_id: str = ""
    session_id: str = ""
