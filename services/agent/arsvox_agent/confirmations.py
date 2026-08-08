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

Executor = Callable[[str, dict, str], Awaitable[str]]


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
        # executed | failed. Approval state stays separate from the
        # execution result: the row reflects the real outcome and the
        # terminal event reports it (executed / failed).
        self.pending.resolve(pending_id, ConfirmationStatus.APPROVED.value)
        self.audit.log("confirmation", "approved", {"pending_id": pending_id, "tool": row["tool"]})
        self.pending.set_status(
            pending_id, ConfirmationStatus.EXECUTING.value,
            from_status=ConfirmationStatus.APPROVED.value,
        )
        self.audit.log("confirmation", "executing", {"pending_id": pending_id})
        try:
            result = await self.executor(row["tool"], row["args"], row["run_id"] or "")
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
            # stop/cancel while executing: the action was aborted mid-run.
            self.pending.set_status(
                pending_id, ConfirmationStatus.CANCELLED.value,
                from_status=ConfirmationStatus.EXECUTING.value,
            )
            raise
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
