"""The turn loop. One linear loop, two cheap caps, and the log.

A turn is: record the request, then alternate model calls with tool calls until
the model answers in words or a cap stops it. Everything that happens is appended
to the event log, so history is never maintained by hand.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime

from services.arsvox.config import Settings
from services.arsvox.context import default_builder, snapshot_text
from services.arsvox.limits import DoomLoopCap, StepBudget
from services.arsvox.model import Model, ModelReply, Usage
from services.arsvox.store import Store
from services.arsvox.tools import (
    ToolContext,
    build_registry,
    check_arguments,
    tool_guidance,
    tool_schemas,
)


@dataclass(slots=True)
class ToolTrace:
    name: str
    arguments: dict
    ran: bool
    result: str


@dataclass(slots=True)
class TurnResult:
    text: str
    tools: list[ToolTrace] = field(default_factory=list)
    steps: int = 0
    usage: Usage = field(default_factory=Usage)
    elapsed_s: float = 0.0
    snapshot_appended: bool = False
    error: str | None = None


class Runtime:
    def __init__(
        self,
        settings: Settings,
        store: Store,
        model: Model,
        max_steps: int | None = None,
        scheduler=None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.model = model
        self.scheduler = scheduler
        self.registry = build_registry()
        self.schemas = tool_schemas(self.registry)
        self.builder = default_builder(tool_guidance(self.registry))
        self.max_steps = max_steps or settings.max_steps

    # ---- prompt ----------------------------------------------------------
    def system_prompt(self, now: datetime | None = None) -> str:
        moment = now or datetime.now().astimezone()
        return self.builder.render({"hora": moment.isoformat(timespec="minutes")})

    def refresh_snapshot(self, session: str, now: datetime | None = None) -> bool:
        """Append the runtime context only when its text changed. Cache hygiene."""
        moment = now or datetime.now().astimezone()
        text = snapshot_text(moment, self.store.state_counts(session), self.store.preferences(session))
        if self.store.last_snapshot(session) == text:
            return False
        self.store.append(session, "runtime_snapshot", {"text": text})
        return True

    def messages(self, session: str, now: datetime | None = None) -> list[dict]:
        return [{"role": "system", "content": self.system_prompt(now)}] + self.store.messages(session)

    # ---- the turn --------------------------------------------------------
    def turn(self, session: str, user_text: str) -> TurnResult:
        started = time.perf_counter()
        self.store.append(session, "user_text", {"text": user_text})
        budget = StepBudget(self.max_steps)
        doom = DoomLoopCap()
        result = TurnResult(text="")

        step = 0
        while True:
            step += 1
            allowed, reason = budget.check(step)
            if not allowed:
                result.error = reason
                result.text = "Me quedé sin pasos para terminar el pedido. Probá de nuevo o pedímelo más simple."
                self.store.append(session, "assistant_text", {"text": result.text})
                break

            result.snapshot_appended |= self.refresh_snapshot(session)
            reply: ModelReply = self.model.complete(self.messages(session), self.schemas)
            result.usage = reply.usage
            if reply.error:
                result.error = reply.error
                result.text = "No pude comunicarme con el modelo."
                self.store.append(session, "model_error", {"error": reply.error})
                break
            self.store.append(
                session,
                "model_usage",
                {
                    "step": step,
                    **reply.usage.as_dict(),
                    "finish_reason": reply.finish_reason,
                    "seconds": round(reply.elapsed_s, 2),
                },
            )

            if not reply.tool_calls:
                result.text = reply.text or "No tengo respuesta para eso."
                result.steps = step
                self.store.append(session, "assistant_text", {"text": result.text})
                break

            for call in reply.tool_calls:
                allowed, reason = doom.check(call.name, call.arguments)
                if not allowed:
                    result.error = reason
                    result.text = "Me di cuenta de que estaba repitiendo lo mismo. Lo dejo acá."
                    self.store.append(session, "assistant_text", {"text": result.text})
                    result.steps = step
                    result.elapsed_s = time.perf_counter() - started
                    return result

                self.store.append(
                    session,
                    "tool_call",
                    {"call_id": call.id, "name": call.name, "arguments": call.arguments},
                )
                note = f"{reason}. " if reason else ""
                text, arguments, ran = self._run_tool(session, call, note)
                self.store.append(session, "tool_result", {"call_id": call.id, "text": text})
                result.tools.append(ToolTrace(call.name, arguments, ran, text))

        result.steps = step
        result.elapsed_s = time.perf_counter() - started
        return result

    def _run_tool(self, session, call, note: str) -> tuple[str, dict, bool]:
        """Run one tool call. A refusal is a tool result too: the model reads why."""
        tool = self.registry.get(call.name)
        if tool is None:
            return f"{note}No existe la herramienta '{call.name}'.", call.arguments, False
        arguments, error = check_arguments(tool, call.arguments)
        if error:
            return f"{note}{error}", call.arguments, False
        try:
            text = tool.handler(
                ToolContext(
                    self.store,
                    session,
                    self.settings,
                    datetime.now().astimezone(),
                    self.scheduler,
                ),
                arguments,
            )
        except Exception as exc:  # noqa: BLE001 - a broken tool must not kill the turn
            return f"{note}La herramienta {call.name} falló: {type(exc).__name__}", arguments, False
        return f"{note}{text}", arguments, True
