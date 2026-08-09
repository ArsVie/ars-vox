"""WebSocket endpoint: the UI's realtime channel.

Client → server: ClientMessage (user_text, confirm, cancel, stop, ping).
Server → client: validated AgentEvent objects from the shared bus.

Local intents (posponer / descartar / qué alarmas) are handled here,
before the LLM, so scheduling controls never depend on the model.
"""

import asyncio
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from arsvox_contracts import (
    ActionResultEvent,
    AgentMessageEvent,
    ConfigUpdateEvent,
    PongEvent,
    StateUpdateEvent,
    VoiceState,
    parse_client_message,
)

from arsvox_agent.actions import handle_ui_command
from arsvox_agent.events import EventBus
from arsvox_agent.local_intents import match_intent
from arsvox_agent.runtime import AgentRuntime
from arsvox_agent.snapshot import SnapshotTracker, build_state_snapshot
from arsvox_agent.tools.scheduler import ReminderScheduler

log = logging.getLogger(__name__)

_RECEIVE_TIMEOUT = 0.1


async def websocket_endpoint(
    ws: WebSocket,
    bus: EventBus,
    runtime: AgentRuntime,
    scheduler: ReminderScheduler,
    config_snapshot: dict[str, Any],
    tracker: SnapshotTracker | None = None,
) -> None:
    await ws.accept()
    queue = bus.subscribe()
    try:
        # initial state so the UI renders immediately — derived from the
        # pipeline's actual state (which itself derives from
        # config.voice.enabled), never hardcoded LISTENING: a fresh UI
        # with voice disabled must not claim "Escuchando".
        state = VoiceState.SLEEPING
        if runtime.pipeline is not None:
            state = runtime.pipeline.state
        elif config_snapshot.get("voice", {}).get("enabled"):
            state = VoiceState.LISTENING
        await ws.send_text(StateUpdateEvent(voice_state=state).model_dump_json())
        await ws.send_text(
            ConfigUpdateEvent(config=config_snapshot).model_dump_json()
        )
        # H5: reconnect recovery — one canonical snapshot per connect,
        # covering pending confirmation, open panels, media, notifications
        # and content keys. Sent before any queued event so the client can
        # treat it as authoritative and ignore stale pre-snapshot events.
        await ws.send_text(build_state_snapshot(runtime, config_snapshot, tracker).model_dump_json())
        while True:
            await _pump_outgoing(ws, queue)
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=_RECEIVE_TIMEOUT)
            except asyncio.TimeoutError:
                continue
            await _handle_client_message(ws, raw, runtime, scheduler)
    except WebSocketDisconnect:
        log.info("ws client disconnected")
    except Exception as exc:  # noqa: BLE001
        log.exception("ws handler error")
        try:
            await ws.close()
        except Exception:
            pass
    finally:
        bus.unsubscribe(queue)


async def _pump_outgoing(ws: WebSocket, queue: asyncio.Queue) -> None:
    while not queue.empty():
        payload = queue.get_nowait()
        await ws.send_text(_json(payload))


def _json(payload: dict) -> str:
    import json

    return json.dumps(payload, ensure_ascii=False, default=str)


async def _handle_client_message(
    ws: WebSocket, raw: str, runtime: AgentRuntime, scheduler: ReminderScheduler
) -> None:
    try:
        message = parse_client_message(raw)
    except Exception as exc:
        await _reply_unparsable(ws, runtime, raw, exc)
        return
    if message.type == "ping":
        await ws.send_text(PongEvent().model_dump_json())
        return
    if message.type == "stop":
        await runtime.cancel()
        return
    if message.type == "ui_command":
        # H1: client-initiated action channel. The handler performs the
        # authoritative effect (or marks it unsupported/failed) and the
        # verdict is queued AFTER any events it emitted (FIFO on the bus).
        verdict = await handle_ui_command(runtime.deps_base, runtime.registry, message.command)
        await runtime.deps_base.bus.publish(verdict)
        return
    if message.type == "confirm":
        # R38: NEVER block the receive loop on execution — a STOP frame
        # must stay receivable while an approved action runs. The
        # coordinator spawns a tracked execution task and resolves the
        # lifecycle from there.
        asyncio.create_task(
            runtime.deps_base.confirmations.resolve(message.pending_id, approve=True)
        )
        await _sync_state_after_resolve(ws, runtime)
        return
    if message.type == "cancel":
        await runtime.deps_base.confirmations.resolve(message.pending_id, approve=False)
        await _sync_state_after_resolve(ws, runtime)
        return
    # user_text
    intent = match_intent(message.text)
    if intent is not None:
        await _handle_local_intent(ws, intent.kind, runtime, scheduler)
        return
    if runtime.pipeline is not None:
        await runtime.pipeline.inject_text(message.text)
    else:
        await runtime.handle_user_text(message.text)


async def _handle_local_intent(
    ws: WebSocket, kind: str, runtime: AgentRuntime, scheduler: ReminderScheduler
) -> None:
    if kind == "snooze":
        seconds = runtime.config.reminders.snooze_seconds
        await scheduler.snooze_top(seconds)
    elif kind == "dismiss":
        await scheduler.dismiss_top()
    elif kind == "list_reminders":
        await ws.send_text(
            AgentMessageEvent(text=scheduler.list_active_text(), delta=False).model_dump_json()
        )
    elif kind == "stop":
        await runtime.cancel()


async def _sync_state_after_resolve(ws: WebSocket, runtime: AgentRuntime) -> None:
    pending = runtime.deps_base.pending.list_pending()
    state = VoiceState.WAITING_FOR_CONFIRMATION if pending else VoiceState.LISTENING
    if runtime.pipeline is not None:
        # publish into the canonical state machine; the bus carries it back
        runtime.pipeline.set_state(state)
    else:
        await ws.send_text(StateUpdateEvent(voice_state=state).model_dump_json())


async def _reply_unparsable(
    ws: WebSocket, runtime: AgentRuntime, raw: str, exc: Exception
) -> None:
    """Reply to an unparsable frame.

    Non-ui_command garbage keeps the legacy "Mensaje no válido" reply.
    A ui_command frame that fails parse (e.g. unknown action string) gets
    an action_result failed instead, so the UI reconciles honestly and
    the receive loop never crashes on unknown actions.
    """
    import json

    try:
        payload = json.loads(raw)
    except Exception:
        payload = None
    if isinstance(payload, dict) and payload.get("type") == "ui_command":
        command = payload.get("command") or {}
        action = command.get("action") if isinstance(command, dict) else None
        await runtime.deps_base.bus.publish(
            ActionResultEvent(
                action=action or "unknown",
                status="failed",
                detail=str(exc),
            )
        )
        return
    await ws.send_text(
        AgentMessageEvent(text=f"Mensaje no válido: {exc}", delta=False).model_dump_json()
    )
