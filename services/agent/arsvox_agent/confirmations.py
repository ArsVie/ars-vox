"""Two-phase confirmation flow (ADR-0003).

The model requests an action; the coordinator snapshots tool + args in
SQLite (pending_actions), emits confirmation_requested, and pauses. The
user says/click ``confirm``; the coordinator executes the SNAPSHOT — the
model never re-supplies args for an approved action, so the user always
confirms exactly what they saw. ``stop``/``cancel``/expiry/invalidation
abort the action; an expired confirmation never executes.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

from arsvox_contracts import (
    ConfirmationRequestedEvent,
    ConfirmationResolvedEvent,
    ConfirmationStatus,
)
from arsvox_memory import AuditStore, PendingStore

from arsvox_agent.events import EventBus

log = logging.getLogger(__name__)

Executor = Callable[[str, dict, str, "CancellationToken | None"], Awaitable[str]]


class CancellationToken:
    """Cooperative cancellation for an approved action's execution (R38).

    - ``cancel()`` requests cancellation (STOP while executing).
    - ``raise_if_cancelled()`` is checked by tool handlers BEFORE their
      side effect.
    - ``mark_point_of_no_return()`` records that the tool passed the
      irreversible step; cancellation after that point is refused and
      the execution result is surfaced instead.
    """

    __slots__ = ("_cancelled", "_point_of_no_return")

    def __init__(self) -> None:
        self._cancelled = False
        self._point_of_no_return = False

    def cancel(self) -> None:
        self._cancelled = True

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    @property
    def point_of_no_return_reached(self) -> bool:
        return self._point_of_no_return

    def raise_if_cancelled(self) -> None:
        if self._cancelled:
            raise asyncio.CancelledError

    def mark_point_of_no_return(self) -> None:
        self._point_of_no_return = True


# Point of no return per external side effect (frozen execution
# lifecycle, R38). STOP before a tool's PNR cancels the execution; after
# it, the effect is out and the result is surfaced. Handlers call
# token.mark_point_of_no_return() at exactly the documented moment.
POINT_OF_NO_RETURN: dict[str, str] = {
    "telegram.send_pending": (
        "the instant telegram.send() is invoked — the message is handed "
        "to the provider and may be delivered even if STOP arrives right after."
    ),
}


class ConfirmationCoordinator:
    def __init__(
        self,
        pending: PendingStore,
        audit: AuditStore,
        bus: EventBus,
        timeout_s: int,
        executor: Executor,
    ):
        self.pending = pending
        self.audit = audit
        self.bus = bus
        self.timeout_s = timeout_s
        self.executor = executor
        # R38: the in-flight approved execution (token + task), tracked
        # so the STOP path can cancel it.
        self._execution_task: asyncio.Task | None = None
        self._cancel_token: CancellationToken | None = None

    # ------------------------------------------------------------------ #
    async def request(
        self,
        run_id: str,
        tool: str,
        args: dict,
        title: str,
        detail: str,
    ) -> str:
        # Global one-pending policy (H5): a new confirmable request
        # replaces ANY currently pending confirmation — not just one of
        # the same tool. The superseded one is auto-cancelled and clearly
        # reported on the wire so the UI never silently loses a card.
        # (Choice: replace-with-report, per GATE-2.5 stop conditions.)
        superseded = self.pending.invalidate_all(ConfirmationStatus.SUPERSEDED.value)
        for row in superseded:
            self.audit.log(
                "confirmation",
                "superseded",
                {"pending_id": row["id"], "replaced_by_tool": tool},
            )
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=row["id"],
                    status=ConfirmationStatus.SUPERSEDED,
                    message=f"Reemplazada por una nueva confirmación ({tool}).",
                )
            )
        expires = datetime.now(timezone.utc) + timedelta(seconds=self.timeout_s)
        pending_id = self.pending.create(
            run_id=run_id,
            tool=tool,
            args=args,
            title=title,
            detail=detail,
            expires_at=expires.isoformat(timespec="seconds"),
        )
        self.audit.log("confirmation", "requested", {"pending_id": pending_id, "tool": tool, "args": args})
        await self.bus.publish(
            ConfirmationRequestedEvent(
                pending_id=pending_id,
                tool=tool,
                title=title,
                detail=detail,
                expires_in_s=self.timeout_s,
            )
        )
        return pending_id

    # ------------------------------------------------------------------ #
    async def resolve(self, pending_id: str, approve: bool) -> None:
        row = self.pending.get(pending_id)
        if not row or row["status"] != "pending":
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=pending_id,
                    status=ConfirmationStatus(row["status"]) if row else ConfirmationStatus.CANCELLED,
                    message="This confirmation is no longer pending.",
                )
            )
            return
        if row["expires_at"] <= datetime.now(timezone.utc).isoformat(timespec="seconds"):
            self.pending.resolve(pending_id, ConfirmationStatus.EXPIRED.value)
            self.audit.log("confirmation", "expired", {"pending_id": pending_id})
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=pending_id, status=ConfirmationStatus.EXPIRED
                )
            )
            return
        if not approve:
            self.pending.resolve(pending_id, ConfirmationStatus.CANCELLED.value)
            self.audit.log("confirmation", "cancelled", {"pending_id": pending_id})
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=pending_id, status=ConfirmationStatus.CANCELLED
                )
            )
            return
        # approved: execute the stored snapshot, not model-supplied args.
        # Explicit lifecycle (H5): pending -> approved -> executing ->
        # executed | failed | cancelled. Approval state stays separate
        # from the execution result: the row reflects the real outcome
        # and the terminal event reports it (executed / failed /
        # cancelled).
        self.pending.resolve(pending_id, ConfirmationStatus.APPROVED.value)
        self.audit.log("confirmation", "approved", {"pending_id": pending_id, "tool": row["tool"]})
        self.pending.set_status(
            pending_id, ConfirmationStatus.EXECUTING.value,
            from_status=ConfirmationStatus.APPROVED.value,
        )
        self.audit.log("confirmation", "executing", {"pending_id": pending_id})
        # R38: execution runs as a TRACKED task so STOP can cancel an
        # already-executing approved action. The caller (WS receive loop,
        # voice funnel) must never block on it — otherwise a STOP frame
        # could not be received while the action runs.
        token = CancellationToken()
        self._cancel_token = token
        task = asyncio.create_task(self._execute(pending_id, row, token))
        self._execution_task = task
        task.add_done_callback(lambda t: self._execution_done(t, pending_id))
        # Yield once so the execution task runs its first step (token
        # check + executor entry) before this method returns — a
        # cancellation arriving right after approval then always hits a
        # RUNNING task whose own bookkeeping can observe it.
        await asyncio.sleep(0)

    # ------------------------------------------------------------------ #
    def _execution_done(self, task: asyncio.Task, pending_id: str) -> None:
        """Clear the tracked-execution refs once the task finishes (the
        row and the wire already carry the terminal outcome). Defensive
        race guard: if the task ended CANCELLED with the row still
        EXECUTING (external task.cancel() that never reached the
        coroutine body), resolve the lifecycle here."""
        if self._execution_task is task:
            self._execution_task = None
            self._cancel_token = None
        if task.cancelled():
            row = self.pending.get(pending_id)
            if row and row["status"] == ConfirmationStatus.EXECUTING.value:
                self.pending.set_status(
                    pending_id, ConfirmationStatus.CANCELLED.value,
                    from_status=ConfirmationStatus.EXECUTING.value,
                )
                self.audit.log(
                    "confirmation", "cancelled_during_execution",
                    {"pending_id": pending_id},
                )
                asyncio.create_task(
                    self.bus.publish(
                        ConfirmationResolvedEvent(
                            pending_id=pending_id,
                            status=ConfirmationStatus.CANCELLED,
                            message="Acción cancelada durante la ejecución.",
                        )
                    )
                )

    def cancel_executing(self) -> bool:
        """R38: STOP hook — cancel an in-flight approved execution.

        Before the tool's point of no return the execution task is
        cancelled and the row resolves as cancelled. After it, only the
        token is set: the execution completes and its result is
        surfaced. Returns True when an execution was in flight.
        """
        task = self._execution_task
        if task is None or task.done():
            return False
        token = self._cancel_token
        if token is not None:
            token.cancel()
            if not token.point_of_no_return_reached:
                task.cancel()
        else:
            task.cancel()
        return True

    async def wait_for_execution(self, timeout_s: float = 10.0) -> None:
        """Await the current tracked execution (tests / sync callers)."""
        task = self._execution_task
        if task is not None:
            await asyncio.wait_for(task, timeout_s)

    # ------------------------------------------------------------------ #
    async def _execute(
        self, pending_id: str, row: dict, token: CancellationToken
    ) -> None:
        """Run the approved snapshot with cancellation semantics (R38).

        The token check is the FIRST statement so a cancellation that
        races the task's first scheduling step is still observed (the
        coroutine body runs before its first suspension point).
        """
        try:
            if token.is_cancelled:
                raise asyncio.CancelledError
            result = await self.executor(row["tool"], row["args"], row["run_id"] or "", token)
            self.pending.set_status(
                pending_id, ConfirmationStatus.EXECUTED.value,
                from_status=ConfirmationStatus.EXECUTING.value,
            )
            self.audit.log("confirmation", "executed", {"pending_id": pending_id})
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=pending_id,
                    status=ConfirmationStatus.EXECUTED,
                    message=result,
                )
            )
        except asyncio.CancelledError:
            # STOP while executing. The CancelledError is swallowed on
            # purpose: the lifecycle bookkeeping below IS the terminal
            # outcome of the requested cancellation.
            if token.point_of_no_return_reached:
                # The irreversible step was already taken (e.g. the
                # message was handed to the provider). cancel_executing
                # refuses to cancel past this point, so this branch only
                # fires on external cancellation — surface the effect as
                # executed rather than pretending it did not happen.
                self.pending.set_status(
                    pending_id, ConfirmationStatus.EXECUTED.value,
                    from_status=ConfirmationStatus.EXECUTING.value,
                )
                self.audit.log(
                    "confirmation", "executed_after_point_of_no_return",
                    {"pending_id": pending_id},
                )
                await self.bus.publish(
                    ConfirmationResolvedEvent(
                        pending_id=pending_id,
                        status=ConfirmationStatus.EXECUTED,
                        message="Acción ejecutada — el punto de no retorno ya se había alcanzado.",
                    )
                )
            else:
                self.pending.set_status(
                    pending_id, ConfirmationStatus.CANCELLED.value,
                    from_status=ConfirmationStatus.EXECUTING.value,
                )
                self.audit.log(
                    "confirmation", "cancelled_during_execution",
                    {"pending_id": pending_id},
                )
                await self.bus.publish(
                    ConfirmationResolvedEvent(
                        pending_id=pending_id,
                        status=ConfirmationStatus.CANCELLED,
                        message="Acción cancelada durante la ejecución.",
                    )
                )
        except Exception as exc:  # noqa: BLE001 — surface execution failures
            log.exception("approved action failed: %s", exc)
            self.pending.set_status(
                pending_id, ConfirmationStatus.FAILED.value,
                from_status=ConfirmationStatus.EXECUTING.value,
            )
            self.audit.log("confirmation", "execution_error", {"pending_id": pending_id, "error": str(exc)})
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=pending_id,
                    status=ConfirmationStatus.FAILED,
                    message=f"Error al ejecutar: {exc}",
                )
            )

    # ------------------------------------------------------------------ #
    async def invalidate_all(self, message: str = "Acción cancelada por stop.") -> int:
        """Cancel every pending confirmation (H5). Called by the stop path
        so the documented semantic — stop/cancel aborts the action —
        actually holds. Emits one cancelled event per invalidated row."""
        rows = self.pending.invalidate_all(ConfirmationStatus.CANCELLED.value)
        for row in rows:
            self.audit.log("confirmation", "cancelled", {"pending_id": row["id"], "reason": message})
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=row["id"],
                    status=ConfirmationStatus.CANCELLED,
                    message=message,
                )
            )
        return len(rows)

    def current_pending(self) -> dict | None:
        """The single active confirmation (global one-pending policy) or
        None. Used by the reconnect state snapshot."""
        rows = self.pending.list_pending()
        return rows[0] if rows else None

    # ------------------------------------------------------------------ #
    async def expire_all(self) -> None:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for pending_id in self.pending.expire_stale(now):
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=pending_id, status=ConfirmationStatus.EXPIRED
                )
            )
