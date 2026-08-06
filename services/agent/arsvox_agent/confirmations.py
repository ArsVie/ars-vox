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
        # Rule: a new request invalidates older pending confirmations of
        # the same tool (e.g. a new Telegram draft kills the old one).
        self.pending.supersede_tool(tool)
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
        # approved: execute the stored snapshot, not model-supplied args
        self.pending.resolve(pending_id, ConfirmationStatus.APPROVED.value)
        self.audit.log("confirmation", "approved", {"pending_id": pending_id, "tool": row["tool"]})
        try:
            result = await self.executor(row["tool"], row["args"], row["run_id"] or "")
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=pending_id,
                    status=ConfirmationStatus.APPROVED,
                    message=result,
                )
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — surface execution failures
            log.exception("approved action failed: %s", exc)
            self.audit.log("confirmation", "execution_error", {"pending_id": pending_id, "error": str(exc)})
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=pending_id,
                    status=ConfirmationStatus.APPROVED,
                    message=f"Error al ejecutar: {exc}",
                )
            )

    # ------------------------------------------------------------------ #
    async def expire_all(self) -> None:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for pending_id in self.pending.expire_stale(now):
            await self.bus.publish(
                ConfirmationResolvedEvent(
                    pending_id=pending_id, status=ConfirmationStatus.EXPIRED
                )
            )
