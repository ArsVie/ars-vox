"""Tool registry: owns definitions, policy kinds, approval flags, and the
single execution gate every tool must pass.

Flow:
  model → pydantic-ai Tool (built from spec) → registry.execute_gated
       → PolicyEngine.decide
       → approval? ConfirmationCoordinator.request (PENDING_APPROVAL)
       → handler(ToolContext, **args) → ToolCallEvent(done)

Approved snapshots run through execute_direct (same handlers, gate
bypassed by design — the approval already happened).
"""

import asyncio
import dataclasses
import inspect
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from pydantic import BaseModel

from arsvox_contracts import (
    ConfirmationRequestedEvent,
    PolicyKind,
    ToolCallEvent,
    UiCommandEvent,
)

from arsvox_agent.deps import Deps
from arsvox_agent.tools.context import ToolContext

log = logging.getLogger(__name__)

Handler = Callable[..., Awaitable[str]]


def _json_safe(value: Any) -> Any:
    """Recursively convert pydantic model instances to plain JSON-safe
    values (model_dump) for recording/emission on the wire.

    Tools with nested model parameters (e.g. layout.compose's
    assignments) receive validated model instances in ``args``; the
    tool-call store, audit log, and bus events all JSON-serialize args,
    so the executor normalizes them at the boundary. The handler itself
    still receives the validated instances.
    """
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


@dataclass
class ToolSpec:
    name: str
    description: str
    handler: Handler
    kind: PolicyKind
    approval: bool = False


def _approval_text(tool: str, args: dict) -> tuple[str, str]:
    """Human-readable confirmation card for a pending action."""
    if tool == "telegram.send_pending":
        text = args.get("text", "")
        return "Enviar mensaje por Telegram", f"Se enviará a la persona aprobada:\n{text}"
    if tool == "reminders.create":
        due = args.get("due_at", "")
        return "Programar recordatorio", f"{args.get('text', '')}\nFecha y hora: {due}"
    title = tool.replace(".", " ").capitalize()
    return title, json.dumps(args, ensure_ascii=False)[:500]


class ToolRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}
        self.base_deps: Deps | None = None

    # ------------------------------------------------------------------ #
    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._specs:
            raise ValueError(f"duplicate tool {spec.name}")
        self._specs[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._specs.get(name)

    def all(self) -> list[ToolSpec]:
        return list(self._specs.values())

    def attach_deps(self, deps: Deps) -> None:
        self.base_deps = deps

    @staticmethod
    def _tctx_from_ctx(ctx) -> ToolContext:
        deps: Deps = ctx.deps
        return ToolContext(deps=deps, run_id=deps.run_id, session_id=deps.session_id, bus=deps.bus)

    # ------------------------------------------------------------------ #
    async def execute_gated(self, spec: ToolSpec, tctx: ToolContext, args: dict) -> str:
        safe_args = _json_safe(args)
        tc = tctx.deps.tool_calls
        decision = tctx.deps.policy.decide(spec.name, safe_args)
        if not decision.allowed:
            await self._emit_tool(tctx, spec, safe_args, "rejected", decision.reason)
            tctx.deps.audit.log("policy", "denied", {"tool": spec.name, "reason": decision.reason})
            if tc:
                tc.record(tctx.session_id, tctx.run_id, spec.name, safe_args, "rejected")
            return f"Acción no permitida: {decision.reason}."
        await self._emit_tool(tctx, spec, safe_args, "running")
        if decision.requires_approval or spec.approval:
            title, detail = _approval_text(spec.name, safe_args)
            pending_id = await tctx.deps.confirmations.request(
                tctx.run_id, spec.name, safe_args, title, detail
            )
            if tc:
                tc.record(tctx.session_id, tctx.run_id, spec.name, safe_args, "pending")
            return (
                f"PENDING_APPROVAL:{pending_id} — {title}. "
                "The user must confirm. End your turn and wait."
            )
        return await self._run_handler(spec, tctx, args)

    async def execute_direct(
        self,
        tool: str,
        args: dict,
        run_id: str = "",
        cancel_token: Any | None = None,
    ) -> str:
        """Executes a stored approved snapshot (gate bypassed on purpose).

        ``cancel_token`` (R38) is the cooperative CancellationToken from
        the confirmation executor; tool handlers consult it before side
        effects and mark their point of no return.
        """
        spec = self.get(tool)
        if spec is None or self.base_deps is None:
            return f"Error: tool {tool} not available."
        deps = dataclasses.replace(
            self.base_deps, run_id=run_id or "approved", session_id=""
        )
        tctx = ToolContext(
            deps=deps,
            run_id=run_id or "approved",
            session_id="",
            bus=deps.bus,
            cancel_token=cancel_token,
        )
        await self._emit_tool(tctx, spec, args, "running")
        return await self._run_handler(spec, tctx, args)

    # ------------------------------------------------------------------ #
    async def _run_handler(self, spec: ToolSpec, tctx: ToolContext, args: dict) -> str:
        safe_args = _json_safe(args)
        tc = tctx.deps.tool_calls
        call_id = tc.record(tctx.session_id, tctx.run_id, spec.name, safe_args, "running") if tc else 0
        try:
            result = await spec.handler(tctx, **args)
            await self._emit_tool(tctx, spec, safe_args, "done", result)
            if tc:
                tc.finish(call_id, "done", result)
            return result
        except asyncio.CancelledError:
            await self._emit_tool(tctx, spec, safe_args, "error", "cancelled")
            if tc:
                tc.finish(call_id, "cancelled", "cancelled")
            raise
        except Exception as exc:  # noqa: BLE001 — tools must never crash the run
            log.exception("tool %s failed", spec.name)
            tctx.deps.audit.log("tool", "error", {"tool": spec.name, "error": str(exc)})
            await self._emit_tool(tctx, spec, safe_args, "error", str(exc))
            if tc:
                tc.finish(call_id, "error", str(exc))
            return f"Error ejecutando {spec.name}: {exc}"

    async def _emit_tool(
        self, tctx: ToolContext, spec: ToolSpec, args: dict, status: str, result: str | None = None
    ) -> None:
        await tctx.bus.publish(
            ToolCallEvent(
                run_id=tctx.run_id,
                tool=spec.name,
                args=args,
                status=status,  # type: ignore[arg-type]
                result=result[:400] if result else None,
            )
        )


# --------------------------------------------------------------------- #
def build_pydantic_tools(registry: ToolRegistry) -> list:
    """Build pydantic-ai Tool objects from the registry.

    Each tool is a dynamically-created async function whose signature
    matches the handler's typed parameters (pydantic-ai derives the JSON
    schema from it) and whose first parameter is the RunContext.
    """
    from pydantic_ai import RunContext
    from pydantic_ai.tools import Tool

    tools: list = []
    for spec in registry.all():
        sig = inspect.signature(spec.handler)
        params = [p for p in sig.parameters.values() if p.name != "tctx"]
        param_src = []
        for p in params:
            if p.default is not inspect.Parameter.empty:
                param_src.append(f"{p.name}={p.default!r}")
            else:
                param_src.append(p.name)
        signature = ", ".join(["ctx"] + param_src)
        body = (
            "args = {k: v for k, v in locals().items() if k not in ('ctx',)}\n"
            "tctx = _registry._tctx_from_ctx(ctx)\n"
            "return await _registry.execute_gated(_spec, tctx, args)\n"
        )
        fn_name = f"tool_{spec.name.replace('.', '_')}"
        namespace = {"_registry": registry, "_spec": spec}
        exec(
            f"async def {fn_name}({signature}):\n" + "".join(f"    {line}\n" for line in body.splitlines()),
            namespace,
        )
        fn = namespace[fn_name]
        # The live provider (Console Go / opencode-go) rejects tool names
        # that are not ^[a-zA-Z0-9_-]+$ — dots must be flattened here.
        # Internal dotted names (policy, confirmations, audit, events) are
        # preserved; only the model-visible name is sanitized.
        wire_name = spec.name.replace(".", "_")
        fn.__name__ = wire_name
        fn.__qualname__ = wire_name
        fn.__doc__ = spec.description
        # copy the handler's typed annotations so pydantic-ai builds a
        # proper JSON schema (enums, optionals, literals)
        fn.__annotations__ = {
            p.name: p.annotation
            for p in sig.parameters.values()
            if p.name != "tctx" and p.annotation is not inspect.Parameter.empty
        } | {"return": str}
        tools.append(Tool(fn, name=wire_name, description=spec.description, takes_ctx=True))
    return tools


# keep module import surface stable
_tctx_from_ctx = ToolRegistry._tctx_from_ctx
