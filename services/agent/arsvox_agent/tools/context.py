"""ToolContext: what a tool handler needs. Deliberately NOT pydantic-ai's
RunContext — tools stay decoupled from the framework so the same
handlers can run through the approval executor (execute_direct) without
faking a RunContext."""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from arsvox_agent.deps import Deps
from arsvox_agent.events import EventBus

if TYPE_CHECKING:
    from arsvox_agent.confirmations import CancellationToken


@dataclass
class ToolContext:
    deps: Deps
    run_id: str
    session_id: str
    bus: EventBus
    # R38: cooperative cancellation token for approved-action execution.
    # Tool handlers check it before their side effect and mark the
    # point of no return (see confirmations.CancellationToken).
    cancel_token: "CancellationToken | None" = None

    async def emit(self, event: BaseModel) -> None:
        await self.bus.publish(event)

    def state_snapshot(self) -> dict[str, Any]:
        return {
            "panels": self.deps.panels.list(),
            "pending": len(self.deps.pending.list_pending()),
            "activity": "idle",
        }
