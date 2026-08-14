"""Per-run dependency container handed to every tool via RunContext.

Built fresh for each agent turn: run_id and session_id travel with the
run, stores and services are shared singletons from the app lifespan.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

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

from arsvox_agent.browser_engine import BrowserEngine
from arsvox_agent.browser_state import BrowserStateStore, DomActionResultStore
from arsvox_agent.confirmations import ConfirmationCoordinator
from arsvox_agent.events import EventBus
from arsvox_agent.policy import PolicyEngine
from arsvox_agent.telegram_client import TelegramClient

if TYPE_CHECKING:  # runtime-inert: tools/__init__.py imports Deps (cycle)
    from arsvox_agent.tools import ToolRegistry


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
    # Tool-surface collapse: the instrumented tool registry attached per
    # agent build (runtime._build_agent) so dispatcher tools (tools/
    # surface.py) can delegate to hidden granular specs via
    # registry.execute_gated. String annotation to avoid a circular
    # import (tools/__init__.py imports Deps). None in unit tests that
    # never run tools through the registry — same convention as
    # tool_calls.
    registry: "ToolRegistry | None" = None
    # W2-VIEW (ADR 0007): latest real navigation state of the desktop
    # WebContentsView (in-process mirror; None in unit tests that never
    # emit browser events — emitters fall back to the contract defaults).
    browser_state: BrowserStateStore | None = None
    # W2-DRIVE (GATE-5): dom_action execution results pushed back by
    # Electron main (keyed by the request's created_at; None in unit
    # tests that never run the browser tool).
    browser_dom: DomActionResultStore | None = None
    # BROWSER-USE INTEGRATION: the in-process, text-first browser engine
    # (None when config.browser.engine_enabled=False, or in unit tests
    # that never run the browser tools — the legacy round-trip remains
    # the fallback authority in those cases).
    browser_engine: BrowserEngine | None = None
    # per-run
    run_id: str = ""
    session_id: str = ""
