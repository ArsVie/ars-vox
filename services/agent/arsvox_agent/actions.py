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
  * media.select_result (GATE-5) -> the USER picked a result card; the
                          ONE media controller plays it (youtube or local
                          — same player), then the media panel opens
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
  * layout.compose     -> frozen adaptive validation (LayoutSpec +
                          registered-surface gate) then the command
                          re-emitted as the authoritative event
                          (mirrors the agent-side layout.compose tool)
  * everything else    -> unsupported (server-originated commands or
                          capabilities that do not exist yet)

Dispatch is an EXHAUSTIVE match over the NARROWED ClientAction
discriminated union (GATE-3.5 W1 + GATE-5 W0-CONTRACT): the entry point
declares exactly the client-sendable wire surface (ws.py hands it
``message.command: ClientAction``), so a wire action that joins the
client union without a handler FAILS at type-check time (the
``_assert_never`` tail guard) instead of silently falling through — the
drift class that produced the layout.compose gap. Server-originated
UiCommand members (notification.show, media.state, tts.speak,
audio.play, layout.compose, memory.search) keep typed cases below
because the direct-call test surface (tests/python/test_client_actions.py,
test_media_controller.py) pins their verdicts; they can never arrive on
the client wire today (strict union parse rejects them first).
"""

import json
import logging
from typing import Never

from arsvox_contracts import ActionResultEvent, ClientAction, validate_layout_spec
from arsvox_contracts.adaptive import LayoutSpec
from arsvox_contracts.commands import (
    AudioPlay,
    BrowserBack,
    BrowserForward,
    BrowserNavigate,
    BrowserRefresh,
    DocumentSave,
    LayoutApply,
    LayoutCompose,
    LayoutRestore,
    MediaPlayPause,
    MediaSelectResult,
    MediaSeek,
    MediaStateChange,
    MemorySearch,
    NotificationShow,
    PanelClose,
    PanelFullscreen,
    PanelOpen,
    PanelSetPrimary,
    TasksToggle,
    TtsSpeak,
    YoutubePlay,
    YoutubeSearch,
)
from arsvox_contracts.enums import MediaSource, MediaState, PanelType
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
from arsvox_agent.tools.ui_tools import REGISTERED_SURFACES

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
    deps: Deps, registry: ToolRegistry, command: ClientAction
) -> ActionResultEvent:
    """Dispatch a parsed client action and return the verdict event.

    The verdict is returned, not published: the WS layer publishes it on
    the bus after the handler returns, so it is always queued AFTER any
    authoritative events the handler emitted (FIFO ordering).

    The match below is exhaustive over the NARROWED ClientAction union —
    every client-sendable member has a typed case (GATE-3.5 W1, GATE-5
    W0-CONTRACT). A new member without a case fails the ``_assert_never``
    tail guard at type-check time. Cases for server-originated UiCommand
    members (notification.show, media.state, tts.speak, audio.play,
    layout.compose, memory.search) are retained for the direct-call test
    surface that pins their verdicts; they cannot arrive on the client
    wire (strict union parse rejects them first).
    """
    action = command.action
    try:
        match command:
            case TasksToggle():
                return await _toggle_task(deps, command)
            case DocumentSave():
                return await _save_document(deps, registry, command)
            case YoutubeSearch():
                return await _search_youtube(deps, registry, command)
            case BrowserNavigate():
                return await _navigate_browser(deps, command)
            case BrowserBack() | BrowserForward() | BrowserRefresh():
                return _acknowledge_local(command.action)
            case YoutubePlay():
                return _acknowledge_local(command.action)
            case MediaSelectResult():
                return await _select_media_result(deps, command)
            case AudioPlay() | MediaPlayPause() | MediaSeek():
                return await _media_action(deps, command)
            case LayoutApply() | PanelOpen() | PanelClose() | PanelSetPrimary() | PanelFullscreen() | LayoutRestore():
                return await _panel_action(deps, command)
            case LayoutCompose():
                return await _compose_layout(deps, command)
            case MemorySearch():
                # Server-originated (GATE-5 W0-CONTRACT): the agent's
                # semantic/FTS recall command. W1-MEMORY wires the real
                # tool behind memory.search_results; until then an
                # honest not-implemented verdict (never a fake recall).
                return _unsupported(deps, command.action)
            case NotificationShow() | MediaStateChange() | TtsSpeak():
                # Server-originated commands (C1): they cannot arrive on
                # the client wire union today, but they ARE UiCommand
                # members, so the exhaustive match must account for
                # them. Recorded + honest verdict (this was silent
                # before GATE-3.5).
                return _unsupported(deps, command.action)
    except Exception as exc:  # noqa: BLE001 — never crash the ws loop
        log.exception("client action %s failed", action)
        deps.audit.log("action", "failed", {"action": action, "error": str(exc)})
        return ActionResultEvent(action=action, status="failed", detail=str(exc))
    # Unreachable — every UiCommand member has a case above (R39). If a
    # new member joins the union without one, `command` is no longer
    # `Never` here and this call is a type error (the drift guard that
    # type-ignore comments used to silence).
    _assert_never(command)


def _unsupported(deps: Deps, action: str) -> ActionResultEvent:
    """Parsed but with no backend handler: keep the UI honest."""
    log.warning("client action %s has no backend handler (unsupported)", action)
    return ActionResultEvent(
        action=action,
        status="unsupported",
        detail="no backend capability for this action",
    )


def _assert_never(value: Never) -> Never:
    """Type-level exhaustiveness guard for the UiCommand dispatch match."""
    raise AssertionError(f"unhandled UiCommand member: {value!r}")


# --------------------------------------------------------------------- #
# Handlers
# --------------------------------------------------------------------- #


async def _toggle_task(deps: Deps, command: TasksToggle) -> ActionResultEvent:
    try:
        task_id = int(command.task_id)
    except (TypeError, ValueError):
        return ActionResultEvent(
            action="tasks.toggle",
            status="failed",
            detail=f"task_id must be an integer id, got {command.task_id!r}",
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
    deps: Deps, registry: ToolRegistry, command: DocumentSave
) -> ActionResultEvent:
    panel_type = command.panel_type
    content = command.content
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
    deps: Deps, registry: ToolRegistry, command: YoutubeSearch
) -> ActionResultEvent:
    query = command.query
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


async def _select_media_result(deps: Deps, command: MediaSelectResult) -> ActionResultEvent:
    """GATE-5: the USER picked a result card (media.search_results).

    Routes through the ONE media controller (R24) so a youtube video and
    a local library file reach the SAME player — same controls, same UI.
    The media panel opens so the unified player is visible. This is the
    click path; voice picks go through the agent's play tools, which
    land in the same controller.
    """
    if command.source == MediaSource.LOCAL:
        url = command.local_path or command.url
        if not url:
            return ActionResultEvent(
                action="media.select_result",
                status="failed",
                detail="local result needs local_path or url",
            )
        await media_controller.play(
            deps.bus,
            title=command.title,
            url=url,
            source=MediaSource.LOCAL,
            kind=command.kind,
        )
    else:
        await media_controller.play(
            deps.bus,
            title=command.title,
            url=command.url or f"https://www.youtube.com/watch?v={command.result_id}",
            video_id=command.result_id,
            source=MediaSource.YOUTUBE,
            kind=command.kind,
        )
    deps.panels.upsert(PanelType.MEDIA.value, command.title)
    await deps.bus.publish(
        UiCommandEvent(command=PanelOpen(panel_type=PanelType.MEDIA, title=command.title))
    )
    deps.audit.log(
        "action",
        "media.select_result",
        {"result_id": command.result_id, "source": command.source.value},
    )
    return ActionResultEvent(
        action="media.select_result", status="done", detail=command.title
    )


async def _navigate_browser(deps: Deps, command: BrowserNavigate) -> ActionResultEvent:
    url = command.url
    # GATE-3.5 (reported to W2-BROWSER by g35r-dispatch): title,
    # can_go_back and can_go_forward stay at the contract defaults
    # because the agent service has NO browser-state source — the
    # browser surface lives client-side (apps/desktop) and no
    # browser-state channel exists back to the service (the only other
    # emitter, demo_tools.py, hardcodes the same defaults). The UI must
    # not believe history navigation is available.
    # TODO(g35r-dispatch, remove when W2-BROWSER adds a browser-state channel):
    #   feed real title/can_go_back/can_go_forward into this event.
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


async def _panel_action(
    deps: Deps,
    command: LayoutApply
    | PanelOpen
    | PanelClose
    | PanelSetPrimary
    | PanelFullscreen
    | LayoutRestore,
) -> ActionResultEvent:
    """Authoritative handlers for the C1 human-initiated layout/panel
    surface. Mirror the agent-side ui_*_panel tools: the service panel
    registry is updated and the matching UiCommand is re-emitted, so the
    UI reconciles against the authoritative event rather than its own
    optimistic copy."""
    match command:
        case PanelOpen():
            panel_type = command.panel_type
            title = command.title
            content_reference = command.content_reference
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
        case PanelClose():
            # Distinct local names: mypy types each name once per
            # function scope, and PanelClose's panel_type is optional
            # while PanelOpen's is not.
            close_type = command.panel_type
            close_id = command.panel_id
            target = close_id or (close_type.value if close_type else None)
            if not target:
                return ActionResultEvent(
                    action="panel.close", status="failed", detail="panel_type or panel_id required"
                )
            deps.panels.remove(target)
            deps.audit.log("action", "panel.close", {"target": target})
            await deps.bus.publish(
                UiCommandEvent(command=PanelClose(panel_type=close_type, panel_id=close_id))
            )
            return ActionResultEvent(action="panel.close", status="done", detail=target)
        case PanelSetPrimary():
            panel_type = command.panel_type
            deps.panels.touch(panel_type.value)
            deps.audit.log("action", "panel.set_primary", {"panel_type": panel_type.value})
            # PanelSetPrimary is the one union member whose `action`
            # literal has no default — pass it explicitly or the
            # re-emitted command fails pydantic validation (latent bug
            # surfaced by the W1 narrowing: the old type-ignore made
            # this call Any, so the missing arg was silent).
            await deps.bus.publish(
                UiCommandEvent(
                    command=PanelSetPrimary(action="panel.set_primary", panel_type=panel_type)
                )
            )
            return ActionResultEvent(action="panel.set_primary", status="done", detail=panel_type.value)
        case PanelFullscreen():
            panel_type = command.panel_type
            deps.audit.log("action", "panel.fullscreen", {"panel_type": panel_type.value})
            await deps.bus.publish(UiCommandEvent(command=PanelFullscreen(panel_type=panel_type)))
            return ActionResultEvent(action="panel.fullscreen", status="done", detail=panel_type.value)
        case LayoutApply():
            template = command.template
            primary_panel = command.primary_panel
            secondary_panel = command.secondary_panel
            slots = command.slots
            preserve = command.preserve
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
        case LayoutRestore():
            deps.audit.log("action", "layout.restore", {})
            await deps.bus.publish(UiCommandEvent(command=LayoutRestore()))
            return ActionResultEvent(action="layout.restore", status="done")
    # Unreachable — every member of the panel/layout union has a case
    # above (R39). A new member without one fails here at type-check.
    _assert_never(command)


async def _compose_layout(deps: Deps, command: LayoutCompose) -> ActionResultEvent:
    """Authoritative client-side handler for layout.compose (C5/A3) —
    mirrors the agent-side ui_tools.layout_compose tool: the frozen
    adaptive invariants (LayoutSpec) plus the registered-surface gate
    run server-side, then the command is re-emitted as the
    authoritative event for the UI to reconcile against."""
    try:
        spec = LayoutSpec(
            template=command.template,
            assignments=command.assignments,
            proportion=command.proportion,
        )
        validate_layout_spec(spec, set(REGISTERED_SURFACES))
    except ValueError as exc:
        return ActionResultEvent(action="layout.compose", status="failed", detail=str(exc))
    deps.audit.log("action", "layout.compose", {"template": command.template.value})
    await deps.bus.publish(
        UiCommandEvent(
            command=LayoutCompose(
                template=command.template,
                assignments=spec.assignments,
                proportion=command.proportion,
            )
        )
    )
    return ActionResultEvent(action="layout.compose", status="done", detail=command.template.value)


async def _media_action(
    deps: Deps, command: AudioPlay | MediaPlayPause | MediaSeek
) -> ActionResultEvent:
    # One controller for every media input (GATE-3.5, R24): the agent
    # tool path (media_tools.py) and this client-action path share
    # ``media_controller``, so a user pause/seek after an agent play
    # always finds the loaded track — never "no media loaded".
    match command:
        case AudioPlay():
            asset = command.asset
            await media_controller.play_local(deps.bus, asset)
            return ActionResultEvent(action="audio.play", status="done", detail=asset)
        case MediaPlayPause():
            if not media_controller.has_track():
                return ActionResultEvent(
                    action="media.play_pause", status="done", detail="no media loaded"
                )
            if media_controller.state == MediaState.PLAYING:
                await media_controller.pause(deps.bus)
            else:
                # paused or stopped-with-track: resume. Stopped with a
                # loaded track is NOT a dead end (R24: user actions
                # always apply).
                await media_controller.resume(deps.bus)
            return ActionResultEvent(
                action="media.play_pause", status="done", detail=media_controller.state.value
            )
        case MediaSeek():
            # media.seek
            position = max(0, command.position_s)
            if not media_controller.has_track():
                # R25: seek with nothing loaded must NOT read as a
                # success — the UI must not believe a position change
                # happened. "failed" = understood but could not be
                # applied (module docstring).
                return ActionResultEvent(
                    action="media.seek", status="failed", detail="no media loaded"
                )
            await media_controller.seek(deps.bus, position)
            return ActionResultEvent(
                action="media.seek", status="done", detail=str(media_controller.position_s)
            )
    # Unreachable — every member of the media union has a case above.
    _assert_never(command)
