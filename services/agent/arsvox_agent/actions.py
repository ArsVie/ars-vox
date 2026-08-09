"""Authoritative handlers for client-initiated ui_command actions (H1).

The React UI may optimistically apply an action locally, but only these
handlers decide the real outcome. Every handled action results in an
``action_result`` event (published by the WS layer) so the UI can
reconcile: done (effect applied), unsupported (no backend capability —
the UI must stop pretending the action is live), failed (understood but
could not be applied).

Backend capabilities implemented here:
  * tasks.toggle       -> TaskStore complete/reopen, then tasks.update
  * document.save      -> routed through the registered document.save
                          tool (ToolRegistry gating + real persistence)
  * youtube.search     -> routed through media.search_youtube tool,
                          then a youtube.search event with results
  * browser.navigate   -> authoritative browser.navigate event
  * browser.back/forward/refresh -> client-local iframe operations;
                          acknowledged (done) — no backend browser yet
  * media.play_pause / media.seek / audio.play -> authoritative
                          media.state events from the service-side
                          media controller
  * layout.apply / panel.open / panel.close / panel.set_primary /
    panel.fullscreen / layout.restore (C1 human-initiated layout
    surface) -> service panel registry updated + the matching
    UiCommand re-emitted as the authoritative event
  * everything else    -> unsupported (server-originated commands or
                          capabilities that do not exist yet)
"""

import json
import logging
from typing import Any

from arsvox_contracts import ActionResultEvent
from arsvox_contracts.commands import (
    LayoutApply,
    LayoutRestore,
    PanelClose,
    PanelFullscreen,
    PanelOpen,
    PanelSetPrimary,
    UiCommand,
)
from arsvox_contracts.enums import MediaKind, MediaSource, MediaState
from arsvox_contracts.events import (
    BrowserNavigateEvent,
    ReminderItem,
    TasksUpdateEvent,
    TodoItem,
    UiCommandEvent,
    YoutubeSearchEvent,
    YoutubeVideoResult,
)

from arsvox_agent.deps import Deps
from arsvox_agent.media import media_controller
from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools.context import ToolContext

log = logging.getLogger(__name__)

# --------------------------------------------------------------------- #
# Service-side media authority — ONE controller (GATE-3.5, R24-R27).
#
# Agent media tools (tools/media_tools.py), client actions (below) and
# the demo tool all route through ``media_controller`` (arsvox_agent/
# media.py). Every transition publishes a full MediaStateEvent carrying
# position/duration/source/kind — there is no second partial command
# path, so agent and user inputs can never disagree about the loaded
# track (R24), seek really emits the target position (R25) and the
# renderer reconciles player callbacks against the same shape (R26).
# --------------------------------------------------------------------- #


def reset_media_state() -> None:
    """Test hook: clear the in-memory media controller."""
    from arsvox_agent.media import reset_media_controller

    reset_media_controller()


# --------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------- #


async def handle_ui_command(
    deps: Deps, registry: ToolRegistry, command: UiCommand
) -> ActionResultEvent:
    """Dispatch a parsed client action and return the verdict event.

    The verdict is returned, not published: the WS layer publishes it on
    the bus after the handler returns, so it is always queued AFTER any
    authoritative events the handler emitted (FIFO ordering).
    """
    action = command.action
    try:
        if action == "tasks.toggle":
            return await _toggle_task(deps, command)
        if action == "document.save":
            return await _save_document(deps, registry, command)
        if action == "youtube.search":
            return await _search_youtube(deps, registry, command)
        if action == "browser.navigate":
            return await _navigate_browser(deps, command)
        if action in ("browser.back", "browser.forward", "browser.refresh", "youtube.play"):
            return _acknowledge_local(action)
        if action in ("media.play_pause", "media.seek", "audio.play"):
            return await _media_action(deps, action, command)
        if action in (
            "layout.apply",
            "panel.open",
            "panel.close",
            "panel.set_primary",
            "panel.fullscreen",
            "layout.restore",
        ):
            return await _panel_action(deps, action, command)
    except Exception as exc:  # noqa: BLE001 — never crash the ws loop
        log.exception("client action %s failed", action)
        deps.audit.log("action", "failed", {"action": action, "error": str(exc)})
        return ActionResultEvent(action=action, status="failed", detail=str(exc))
    # Parsed but with no backend handler: keep the UI honest.
    return ActionResultEvent(
        action=action,
        status="unsupported",
        detail="no backend capability for this action",
    )


# --------------------------------------------------------------------- #
# Handlers
# --------------------------------------------------------------------- #


async def _toggle_task(deps: Deps, command: UiCommand) -> ActionResultEvent:
    try:
        task_id = int(command.task_id)  # type: ignore[attr-defined]
    except (TypeError, ValueError):
        return ActionResultEvent(
            action="tasks.toggle",
            status="failed",
            detail=f"task_id must be an integer id, got {command.task_id!r}",  # type: ignore[attr-defined]
        )
    row = deps.tasks.get(task_id)
    if row is None:
        return ActionResultEvent(action="tasks.toggle", status="failed", detail=f"task {task_id} not found")
    if row["status"] == "done":
        deps.tasks.reopen(task_id)
        new_status = "pending"
    else:
        deps.tasks.complete(task_id)
        new_status = "done"
    deps.audit.log("tasks", "toggle", {"task_id": task_id, "to": new_status})
    await _emit_tasks_update(deps)
    return ActionResultEvent(
        action="tasks.toggle", status="done", detail=f"task {task_id} -> {new_status}"
    )


async def _emit_tasks_update(deps: Deps) -> None:
    todos = [
        TodoItem(
            id=str(t["id"]),
            title=t["title"],
            done=t["status"] == "done",
            priority=t.get("priority") or "normal",
            due=t.get("due_at"),
        )
        for t in deps.tasks.list()
    ]
    reminders = [
        ReminderItem(
            id=str(r["id"]),
            title=r["text"],
            cadence=r.get("repeat_rule") or "none",
            next_fire=r.get("due_at") or "",
        )
        for r in deps.reminders.list_active()
    ]
    await deps.bus.publish(TasksUpdateEvent(todos=todos, reminders=reminders))


async def _save_document(
    deps: Deps, registry: ToolRegistry, command: UiCommand
) -> ActionResultEvent:
    panel_type = command.panel_type  # type: ignore[attr-defined]
    content = command.content  # type: ignore[attr-defined]
    panel = next((p for p in deps.panels.list() if p["id"] == panel_type), None)
    if panel is None or not panel.get("content_reference"):
        return ActionResultEvent(
            action="document.save",
            status="failed",
            detail=f"no document open in panel '{panel_type}'",
        )
    try:
        doc_id = int(panel["content_reference"])
    except (TypeError, ValueError):
        return ActionResultEvent(
            action="document.save",
            status="failed",
            detail=f"panel '{panel_type}' has no document reference",
        )
    doc = deps.documents.get(doc_id)
    if doc is None:
        return ActionResultEvent(
            action="document.save", status="failed", detail=f"document #{doc_id} not found"
        )
    spec = registry.get("document.save")
    if spec is None:
        return ActionResultEvent(
            action="document.save", status="failed", detail="document.save tool unavailable"
        )
    tctx = ToolContext(deps=deps, run_id="", session_id="", bus=deps.bus)
    # Gated through the registered tool: policy classification, audit
    # and real persistence (file + DB registry) all live there.
    result = await registry.execute_gated(spec, tctx, {"title": doc["title"], "content": content})
    return ActionResultEvent(action="document.save", status="done", detail=result)


async def _search_youtube(
    deps: Deps, registry: ToolRegistry, command: UiCommand
) -> ActionResultEvent:
    query = command.query  # type: ignore[attr-defined]
    spec = registry.get("media.search_youtube")
    if spec is None:
        return ActionResultEvent(
            action="youtube.search", status="failed", detail="media.search_youtube tool unavailable"
        )
    tctx = ToolContext(deps=deps, run_id="", session_id="", bus=deps.bus)
    result = await registry.execute_gated(spec, tctx, {"query": query})
    try:
        raw = json.loads(result)
    except (TypeError, ValueError):
        return ActionResultEvent(action="youtube.search", status="failed", detail=result)
    results = [
        YoutubeVideoResult(
            id=r.get("id", ""),
            title=r.get("title", ""),
            channel=r.get("channel", ""),
            duration_s=int(r.get("duration_s", 0) or 0),
            published=r.get("published", ""),
            thumbnail_url=r.get("thumbnail_url"),
        )
        for r in raw
        if isinstance(r, dict)
    ]
    await deps.bus.publish(YoutubeSearchEvent(query=query, results=results))
    return ActionResultEvent(
        action="youtube.search", status="done", detail=f"{len(results)} results"
    )


async def _navigate_browser(deps: Deps, command: UiCommand) -> ActionResultEvent:
    url = command.url  # type: ignore[attr-defined]
    await deps.bus.publish(
        BrowserNavigateEvent(
            url=url,
            title="",
            can_go_back=False,
            can_go_forward=False,
            loading=True,
        )
    )
    deps.audit.log("action", "navigate", {"url": url})
    return ActionResultEvent(action="browser.navigate", status="done", detail=url)


def _acknowledge_local(action: str) -> ActionResultEvent:
    """browser.back/forward/refresh are client-local iframe operations;
    the backend has no browser to drive, so it acknowledges receipt and
    the UI keeps performing them locally."""
    return ActionResultEvent(
        action=action,
        status="done",
        detail="client-local operation (no backend browser)",
    )


async def _panel_action(deps: Deps, action: str, command: UiCommand) -> ActionResultEvent:
    """Authoritative handlers for the C1 human-initiated layout/panel
    surface. Mirror the agent-side ui_*_panel tools: the service panel
    registry is updated and the matching UiCommand is re-emitted, so the
    UI reconciles against the authoritative event rather than its own
    optimistic copy."""
    if action == "panel.open":
        panel_type = command.panel_type  # type: ignore[attr-defined]
        title = command.title  # type: ignore[attr-defined]
        content_reference = command.content_reference  # type: ignore[attr-defined]
        deps.panels.upsert(panel_type.value, title, content_reference)
        deps.audit.log("action", "panel.open", {"panel_type": panel_type.value})
        await deps.bus.publish(
            UiCommandEvent(
                command=PanelOpen(
                    panel_type=panel_type, title=title, content_reference=content_reference
                )
            )
        )
        return ActionResultEvent(action="panel.open", status="done", detail=panel_type.value)
    if action == "panel.close":
        panel_type = command.panel_type  # type: ignore[attr-defined]
        panel_id = command.panel_id  # type: ignore[attr-defined]
        target = panel_id or (panel_type.value if panel_type else None)
        if not target:
            return ActionResultEvent(
                action="panel.close", status="failed", detail="panel_type or panel_id required"
            )
        deps.panels.remove(target)
        deps.audit.log("action", "panel.close", {"target": target})
        await deps.bus.publish(
            UiCommandEvent(command=PanelClose(panel_type=panel_type, panel_id=panel_id))
        )
        return ActionResultEvent(action="panel.close", status="done", detail=target)
    if action == "panel.set_primary":
        panel_type = command.panel_type  # type: ignore[attr-defined]
        deps.panels.touch(panel_type.value)
        deps.audit.log("action", "panel.set_primary", {"panel_type": panel_type.value})
        await deps.bus.publish(UiCommandEvent(command=PanelSetPrimary(panel_type=panel_type)))
        return ActionResultEvent(action="panel.set_primary", status="done", detail=panel_type.value)
    if action == "panel.fullscreen":
        panel_type = command.panel_type  # type: ignore[attr-defined]
        deps.audit.log("action", "panel.fullscreen", {"panel_type": panel_type.value})
        await deps.bus.publish(UiCommandEvent(command=PanelFullscreen(panel_type=panel_type)))
        return ActionResultEvent(action="panel.fullscreen", status="done", detail=panel_type.value)
    if action == "layout.apply":
        template = command.template  # type: ignore[attr-defined]
        primary_panel = command.primary_panel  # type: ignore[attr-defined]
        secondary_panel = command.secondary_panel  # type: ignore[attr-defined]
        slots = command.slots  # type: ignore[attr-defined]
        preserve = command.preserve  # type: ignore[attr-defined]
        deps.panels.upsert(primary_panel.value)
        deps.audit.log(
            "action", "layout.apply",
            {"template": template.value, "primary_panel": primary_panel.value},
        )
        await deps.bus.publish(
            UiCommandEvent(
                command=LayoutApply(
                    template=template,
                    primary_panel=primary_panel,
                    secondary_panel=secondary_panel,
                    slots=slots,
                    preserve=preserve,
                )
            )
        )
        return ActionResultEvent(action="layout.apply", status="done", detail=template.value)
    if action == "layout.restore":
        deps.audit.log("action", "layout.restore", {})
        await deps.bus.publish(UiCommandEvent(command=LayoutRestore()))
        return ActionResultEvent(action="layout.restore", status="done")
    # unreachable — every ClientAction member has a branch above (R39).
    return ActionResultEvent(
        action=action,
        status="unsupported",
        detail="no backend capability for this action",
    )


async def _media_action(
    deps: Deps, action: str, command: UiCommand
) -> ActionResultEvent:
    # One controller for every media input (GATE-3.5, R24): the agent
    # tool path (media_tools.py) and this client-action path share
    # ``media_controller``, so a user pause/seek after an agent play
    # always finds the loaded track — never "no media loaded".
    if action == "audio.play":
        asset = command.asset  # type: ignore[attr-defined]
        await media_controller.play_local(deps.bus, asset)
        return ActionResultEvent(action="audio.play", status="done", detail=asset)
    if action == "media.play_pause":
        if not media_controller.has_track():
            return ActionResultEvent(
                action="media.play_pause", status="done", detail="no media loaded"
            )
        if media_controller.state == MediaState.PLAYING:
            await media_controller.pause(deps.bus)
        else:
            # paused or stopped-with-track: resume. Stopped with a loaded
            # track is NOT a dead end (R24: user actions always apply).
            await media_controller.resume(deps.bus)
        return ActionResultEvent(
            action="media.play_pause", status="done", detail=media_controller.state.value
        )
    # media.seek
    position = max(0, command.position_s)  # type: ignore[attr-defined]
    if not media_controller.has_track():
        return ActionResultEvent(
            action="media.seek", status="done", detail="no media loaded"
        )
    await media_controller.seek(deps.bus, position)
    return ActionResultEvent(
        action="media.seek", status="done", detail=str(media_controller.position_s)
    )
