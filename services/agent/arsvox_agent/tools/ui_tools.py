"""Interface tools: panels and layouts. Every tool emits a typed UiCommand
that the UI validates before applying — the model never controls the
interface through free text."""

from arsvox_contracts import LayoutTemplate, PanelType
from arsvox_contracts.commands import (
    LayoutApply,
    LayoutRestore,
    PanelClose,
    PanelFullscreen,
    PanelOpen,
    PanelSetPrimary,
)
from arsvox_contracts.events import UiCommandEvent

from arsvox_agent.tools.context import ToolContext


async def ui_open_panel(
    tctx: ToolContext,
    panel_type: PanelType,
    title: str | None = None,
    content_reference: str | None = None,
) -> str:
    tctx.deps.panels.upsert(panel_type.value, title, content_reference)
    await tctx.emit(
        UiCommandEvent(
            command=PanelOpen(
                panel_type=panel_type, title=title, content_reference=content_reference
            )
        )
    )
    return f"Panel {panel_type.value} abierto."


async def ui_close_panel(
    tctx: ToolContext,
    panel_type: PanelType | None = None,
    panel_id: str | None = None,
) -> str:
    target = panel_id or (panel_type.value if panel_type else None)
    if not target:
        return "Especifica qué panel cerrar."
    tctx.deps.panels.remove(target)
    await tctx.emit(
        UiCommandEvent(command=PanelClose(panel_type=panel_type, panel_id=panel_id))
    )
    return f"Panel {target} cerrado."


async def ui_set_primary_panel(tctx: ToolContext, panel_type: PanelType) -> str:
    tctx.deps.panels.touch(panel_type.value)
    await tctx.emit(
        UiCommandEvent(command=PanelSetPrimary(panel_type=panel_type))
    )
    return f"{panel_type.value} es ahora el panel principal."


async def ui_apply_layout(
    tctx: ToolContext,
    template: LayoutTemplate,
    primary_panel: PanelType,
    secondary_panel: PanelType | None = None,
) -> str:
    tctx.deps.panels.upsert(primary_panel.value)
    await tctx.emit(
        UiCommandEvent(
            command=LayoutApply(
                template=template,
                primary_panel=primary_panel,
                secondary_panel=secondary_panel,
            )
        )
    )
    return f"Disposición {template.value} aplicada."


async def ui_set_fullscreen(tctx: ToolContext, panel_type: PanelType) -> str:
    await tctx.emit(
        UiCommandEvent(command=PanelFullscreen(panel_type=panel_type))
    )
    return f"Pantalla completa en {panel_type.value}."


async def ui_restore_layout(tctx: ToolContext) -> str:
    await tctx.emit(UiCommandEvent(command=LayoutRestore()))
    return "Disposición anterior restaurada."


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec(
        "ui.open_panel",
        "Open a panel. panel_type is one of: conversation, browser, youtube, media,"
        " book_reader, document_editor, news, notes, tasks, reminders,"
        " telegram_preview, settings. title and content_reference are optional context.",
        ui_open_panel,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec(
        "ui.close_panel",
        "Close a panel by panel_type or panel_id.",
        ui_close_panel,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec(
        "ui.set_primary_panel",
        "Make a panel the primary (largest) panel in the current layout.",
        ui_set_primary_panel,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec(
        "ui.apply_layout",
        "Apply one of the four fixed layout templates: focus (one large center panel),"
        " split (large panel + small side panel), reference (center + two narrow side"
        " panels), background_media (large work panel + small media panel)."
        " Call only when the user's primary task changes. Never invent coordinates.",
        ui_apply_layout,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec(
        "ui.set_fullscreen",
        "Put a panel in full-screen mode.",
        ui_set_fullscreen,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec(
        "ui.restore_layout",
        "Restore the previous layout.",
        ui_restore_layout,
        PolicyKind.REVERSIBLE,
    ),
]
