"""Reminder scheduler: an LLM-independent local loop.

The model only interprets the request; this service owns execution.
When a reminder fires it opens a visible panel, emits a notification
event, and waits for posponer (snooze) or descartar (dismiss) — both of
which are local intents, never model-dependent.
"""

import asyncio
import inspect
import logging
from collections.abc import Callable, Awaitable
from datetime import datetime, timezone

from arsvox_contracts import (
    AgentMessageEvent,
    NotificationEvent,
    NotificationKind,
    NotificationStatus,
)
from arsvox_contracts.events import ReminderItem, TasksUpdateEvent, TodoItem
from arsvox_memory import NotificationStore, ReminderStore, TaskStore

from arsvox_agent.confirmations import ConfirmationCoordinator
from arsvox_agent.events import EventBus
from arsvox_agent.tools.reminder_tools import _due_plain_words

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
        tasks: TaskStore | None = None,
        on_fire: Callable[[dict], Awaitable[None] | None] | None = None,
    ):
        self.interval_s = interval_s
        self.reminders = reminders
        self.notifications = notifications
        self.bus = bus
        self.confirmations = confirmations
        # Optional tasks store: when wired, snooze/dismiss emit the same
        # TasksUpdateEvent the agent actions emit (W2), so the renderer's
        # content.tasks stays fresh. The app wires it; tests may omit it.
        self.tasks = tasks
        # W1-TASKS (GATE-5): cadence-injection hook — called once per
        # fired reminder AFTER the fire's own events (notification,
        # tasks.update) so the agent turn the app wires here starts with
        # the reminder in context. The scheduler never owns the turn;
        # the app decides (runtime.handle_reminder_fire).
        self.on_fire = on_fire
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
        fired: list[dict] = []
        for reminder in self.reminders.due(now):
            self.reminders.mark_fired(reminder["id"], now)
            fired.append(reminder)
            nid = self.notifications.insert(
                NotificationKind.REMINDER.value,
                "Recordatorio",
                reminder["text"],
                reminder["id"],
            )
            log.info("reminder %s fired", reminder["id"])
            # W2 (GATE-3.5): publish ONE event per reminder. The
            # `notification` event is the authoritative channel — it
            # carries due_at, feeds the reconnect snapshot, and the
            # renderer appends exactly one chat line for it. The old
            # second publish (UiCommandEvent/NotificationShow) made the
            # renderer append a SECOND identical chat line (fresh id),
            # because pushNotification dedupes by id but the chat line
            # does not.
            await self.bus.publish(
                NotificationEvent(
                    notification_id=str(nid),
                    kind=NotificationKind.REMINDER,
                    title="Recordatorio",
                    text=reminder["text"],
                    due_at=reminder["due_at"],
                )
            )
        await self.confirmations.expire_all() if self.confirmations else None
        # ADV-F2 (2026-08-09): refresh content.tasks after the fire loop —
        # mark_fired moves one-shots out of list_active, but the renderer's
        # tasks panel kept showing them (stale until the next snooze/dismiss).
        # tasks-None-guarded: inert without the store, as _emit_tasks_update
        # documents.
        await self._emit_tasks_update()
        # W1-TASKS (GATE-5): cadence injection — AFTER the fire's own
        # frames (notification, tasks.update) so the wired hook starts a
        # fresh agent turn with the reminder in context, exactly once per
        # fired reminder. The hook is app-wired (runtime) and must stay
        # optional here: unit tests and LLM-free deployments omit it.
        for reminder in fired:
            await self._invoke_on_fire(reminder)

    async def _invoke_on_fire(self, reminder: dict) -> None:
        if self.on_fire is None:
            return
        try:
            result = self.on_fire(reminder)
            if inspect.isawaitable(result):
                await result
        except Exception:  # noqa: BLE001 — a broken hook must never kill the tick
            log.exception("reminder %s on_fire hook failed", reminder["id"])

    # ------------------------------------------------------------------ #
    async def _emit_tasks_update(self) -> None:
        """Mirror of the agent actions' TasksUpdateEvent (W2): both stores
        (reminders and notifications) changed, so the renderer's
        content.tasks must refresh — publishing only the AgentMessageEvent
        left it stale until something else triggered the update.

        Only emits when the tasks store is wired: the renderer REPLACES
        content.tasks wholesale from this event, so a todos=[] payload
        would wipe the user's todo list.
        """
        if self.tasks is None:
            return
        reminders = [
            ReminderItem(
                id=str(r["id"]),
                title=r["text"],
                cadence=r.get("repeat_rule") or "none",
                next_fire=r.get("due_at") or "",
            )
            for r in self.reminders.list_active()
        ]
        todos = [
            TodoItem(
                id=str(t["id"]),
                title=t["title"],
                done=t["status"] == "done",
                priority=t.get("priority") or "normal",
                due=t.get("due_at"),
            )
            for t in self.tasks.list()
        ]
        await self.bus.publish(TasksUpdateEvent(todos=todos, reminders=reminders))

    async def snooze_top(self, seconds: int, now: datetime | None = None) -> str:
        n = self.notifications.latest_active()
        if not n or not n["reminder_id"]:
            return "No hay ningún recordatorio activo para posponer."
        ok = self.reminders.snooze(
            n["reminder_id"], seconds, now or datetime.now(timezone.utc)
        )
        if not ok:
            return "No pude posponer el recordatorio."
        self.notifications.resolve(n["id"], NotificationStatus.SNOOZED.value)
        minutes = seconds // 60
        await self._emit_tasks_update()
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
        await self._emit_tasks_update()
        await self.bus.publish(AgentMessageEvent(text="Recordatorio descartado.", delta=False))
        return "Recordatorio descartado."

    def list_active_text(self) -> str:
        active = self.reminders.list_active()
        if not active:
            return "No tienes recordatorios activos."
        lines = [
            f"#{r['id']} {_due_plain_words(r['due_at'], self.reminders.tz)} — {r['text']}"
            + (
                " (se repite a diario)"
                if r["repeat_rule"] == "daily"
                else " (se repite todas las semanas)"
                if r["repeat_rule"] == "weekly"
                else ""
            )
            for r in active
        ]
        return "Tienes: " + "; ".join(lines)
