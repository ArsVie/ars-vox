"""Ars-Vox authoritative memory service (library form).

SQLite is the single source of truth for all reliable state: sessions,
turns, notes, tasks, reminders, pending confirmations, audit events,
content progress, documents, panel instances. Full-text search uses FTS5.

The agent service runs this in-process for iteration 1; the package
layout keeps it separable as its own process later.
"""

from arsvox_memory.db import Database
from arsvox_memory.repos import (
    AuditStore,
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
)
from arsvox_memory.search import search_all

__all__ = [
    "AuditStore",
    "Database",
    "DocumentStore",
    "NoteStore",
    "NotificationStore",
    "PanelStore",
    "PendingStore",
    "PreferenceStore",
    "ProgressStore",
    "ReminderStore",
    "SessionStore",
    "TaskStore",
    "search_all",
]
