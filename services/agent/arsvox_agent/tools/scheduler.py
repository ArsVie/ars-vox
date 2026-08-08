"""Reminder scheduler: an LLM-independent local loop.

The model only interprets the request; this service owns execution.
When a reminder fires it opens a visible panel, emits a notification
event, and waits for posponer (snooze) or descartar (dismiss) — both of
which are local intents, never model-dependent.
"""

import asyncio
import logging
from datetime import datetime, timezone

from arsvox_contracts import (
    AgentMessageEvent,
    NotificationEvent,
    NotificationKind,
    NotificationStatus,
    UiCommandEvent,
)
from arsvox_contracts.commands import NotificationShow
from arsvox_memory import NotificationStore, ReminderStore

from arsvox_agent.confirmations import ConfirmationCoordinator
from arsvox_agent.events import EventBus

log = logging.getLogger(__name__)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ReminderScheduler:
    def __init__(
        self,
        interval_s: int,
        reminders: ReminderStore,
        notifications: NotificationStore,
        bus: EventBus,
        confirmations: ConfirmationCoordinator,
    ):
        self.interval_s = interval_s
        self.reminders = reminders
        self.notifications = notifications
        self.bus = bus
        self.confirmations = confirmations
        self._task: asyncio.Task | None = None

    # ------------------------------------------------------------------ #
    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self.interval_s)
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("scheduler tick failed")

    # ------------------------------------------------------------------ #
    async def tick(self, now_iso: str | None = None) -> None:
        now = now_iso or _utcnow()
        # snoozed occurrences whose snoozed_until passed become active
        self.reminders.promote_snoozed(now)
        for reminder in self.reminders.due(now):
            self.reminders.mark_fired(reminder["id"], now)
            nid = self.notifications.insert(
                NotificationKind.REMINDER.value,
                "Recordatorio",
                reminder["text"],
                reminder["id"],
            )
            log.info("reminder %s fired", reminder["id"])
            await self.bus.publish(
                NotificationEvent(
                    notification_id=str(nid),
                    kind=NotificationKind.REMINDER,
                    title="Recordatorio",
                    text=reminder["text"],
                    due_at=reminder["due_at"],
                )
            )
            await self.bus.publish(
                UiCommandEvent(
                    command=NotificationShow(
                        notification_id=str(nid),
                        kind=NotificationKind.REMINDER,
                        title="Recordatorio",
                        text=reminder["text"],
                        sound=True,
                        snoozable=True,
                    )
                )
            )
        await self.confirmations.expire_all() if self.confirmations else None

    # ------------------------------------------------------------------ #
    async def snooze_top(self, seconds: int) -> str:
        n = self.notifications.latest_active()
        if not n or not n["reminder_id"]:
            return "No hay ningún recordatorio activo para posponer."
        ok = self.reminders.snooze(n["reminder_id"], seconds, datetime.now(timezone.utc))
        if not ok:
            return "No pude posponer el recordatorio."
        self.notifications.resolve(n["id"], NotificationStatus.SNOOZED.value)
        minutes = seconds // 60
        await self.bus.publish(
            AgentMessageEvent(text=f"Recordatorio pospuesto {minutes} minutos.", delta=False)
        )
        return f"Recordatorio pospuesto {minutes} minutos."

    async def dismiss_top(self) -> str:
        n = self.notifications.latest_active()
        if not n:
            return "No hay ningún recordatorio activo que descartar."
        if n["reminder_id"]:
            self.reminders.dismiss(n["reminder_id"])
        self.notifications.resolve(n["id"], NotificationStatus.DISMISSED.value)
        await self.bus.publish(AgentMessageEvent(text="Recordatorio descartado.", delta=False))
        return "Recordatorio descartado."

    def list_active_text(self) -> str:
        active = self.reminders.list_active()
        if not active:
            return "No tienes recordatorios activos."
        lines = [
            f"#{r['id']} {r['due_at']} — {r['text']}"
            + (f" (se repite {r['repeat_rule']})" if r["repeat_rule"] != "none" else "")
            for r in active
        ]
        return "Tienes: " + "; ".join(lines)
