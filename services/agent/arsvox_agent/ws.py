"""WebSocket endpoint: the UI's realtime channel.

Client → server: ClientMessage (user_text, confirm, cancel, stop, ping).
Server → client: validated AgentEvent objects from the shared bus.

Local intents (posponer / descartar / qué alarmas) are handled here,
before the LLM, so scheduling controls never depend on the model.
"""

import asyncio
import logging
import uuid
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from arsvox_contracts import (
    ActionResultEvent,
    AgentMessageEvent,
    ConfigUpdateEvent,
    PanelType,
    PongEvent,
    StateUpdateEvent,
    UiCommandEvent,
    UserMessageEvent,
    VoiceState,
    parse_client_message,
)
from arsvox_contracts.commands import PanelOpen

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
        # GATE-3.5 (C4/R05): if the renderer (the only playback
        # authority) disconnects while speech is pending or physically
        # playing, no physical ack can ever arrive — force-settle so the
        # machine never hangs in THINKING/SPEAKING with the silence
        # timer disarmed.
        if runtime.is_speech_pending():
            runtime.settle_to_terminal(force=True)


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
    if message.type == "client.info":
        # R14 (2026-08-14, reviewer round 14 finding 4): anchor reminder
        # parsing/display to the USER's zone (browser) instead of the
        # backend's system zone (WSL can drift an hour from Windows).
        if message.timezone:
            runtime.deps_base.reminders.set_tz(message.timezone)
        return
    if message.type == "stop":
        await runtime.cancel()
        return
    if message.type == "tts.started":
        runtime.on_tts_started()
        return
    if message.type == "tts.finished":
        runtime.on_tts_finished()
        return
    if message.type == "tts.cancelled":
        runtime.on_tts_cancelled()
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
        # must stay receivable while an approved action runs. Awaiting
        # resolve() only waits for the DB flip + task spawn (its only
        # await is sleep(0)), so the non-blocking property is preserved.
        # ADV-F1 (2026-08-09): settle AFTER resolve — settling before it
        # published a stale WAITING_FOR_CONFIRMATION (row still pending)
        # that nothing re-settled, disarming the silence timer.
        await runtime.deps_base.confirmations.resolve(message.pending_id, approve=True)
        await _sync_state_after_resolve(runtime)
        return
    if message.type == "cancel":
        await runtime.deps_base.confirmations.resolve(message.pending_id, approve=False)
        await _sync_state_after_resolve(runtime)
        return
    # user_text
    intent = match_intent(message.text)
    if intent is not None:
        await _handle_local_intent(ws, intent.kind, runtime, scheduler, message.text)
        return
    if runtime.pipeline is not None:
        await runtime.pipeline.inject_text(message.text)
    else:
        await runtime.handle_user_text(message.text)


async def _handle_local_intent(
    ws: WebSocket, kind: str, runtime: AgentRuntime, scheduler: ReminderScheduler, text: str
) -> None:
    if kind == "snooze":
        seconds = runtime.config.reminders.snooze_seconds
        await scheduler.snooze_top(seconds)
    elif kind == "dismiss":
        await scheduler.dismiss_top()
    elif kind == "list_reminders":
        # R9 (2026-08-14, reviewer round 9 finding 2): local intents
        # bypass handle_user_text, so the user's message was NEVER echoed
        # — the chat jumped from the last confirmation to the reply and
        # the old man thought his words vanished. Echo FIRST (same as a
        # normal turn), then answer — BOTH through the bus so the per-
        # connection queue keeps FIFO order (a direct ws.send_text would
        # race ahead of the queued echo and the reply would appear before
        # the question).
        await runtime.deps_base.bus.publish(
            UserMessageEvent(id=f"u{uuid.uuid4().hex[:8]}", text=text)
        )
        # R13 (2026-08-14, reviewer round 13 finding 3): listing
        # reminders must also open the tasks panel so RECORDATORIOS is
        # visible — chat-only answers hid it.
        runtime.deps_base.panels.upsert(PanelType.TASKS.value, None, None)
        await runtime.deps_base.bus.publish(
            UiCommandEvent(
                command=PanelOpen(panel_type=PanelType.TASKS, title=None, content_reference=None)
            )
        )
        await runtime.deps_base.bus.publish(
            AgentMessageEvent(text=scheduler.list_active_text(), delta=False)
        )
    elif kind == "stop":
        await runtime.cancel()


async def _sync_state_after_resolve(runtime: AgentRuntime) -> None:
    """Re-derive the terminal voice state after a button confirm/cancel.

    GATE-3.5 (R05): routes through the runtime's single terminal-state
    derivation, whose speech guard refuses to settle while speech is
    pending or physically playing — the tts.finished ack settles with
    the fresh pending state instead. (The voice machine owns this
    transition; confirmation resolution itself is A7's.)"""
    runtime.settle_to_terminal()


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
