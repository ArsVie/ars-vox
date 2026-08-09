"""Interface tools: panels and layouts. Every tool emits a typed UiCommand
that the UI validates before applying — the model never controls the
interface through free text.

Layout authority (GATE-3.5 C5, A3): the ONLY model-visible layout surface
is ``layout.compose`` — semantic composition (template + surface-role
assignments + proportion), never geometry. Slot names are derived from
roles (primary→main, companion→side, support→rail) and the frozen
adaptive.py invariants (LayoutSpec + validate_layout_spec) gate every
emitted spec; invalid specs are rejected deterministically and never
reach the wire.
"""

from enum import Enum

from typing import Literal

from pydantic import BaseModel, Field

from arsvox_contracts import (
    AdaptiveTemplate,
    LayoutAssignment,
    LayoutSpec,
    PanelType,
    PolicyKind,
    Proportion,
    SurfaceRole,
    validate_layout_spec,
)
from arsvox_contracts.commands import (
    LayoutCompose,
    LayoutRestore,
    PanelClose,
    PanelFullscreen,
    PanelOpen,
    PanelSetPrimary,
)
from arsvox_contracts.events import UiCommandEvent

from arsvox_agent.tools import ToolSpec
from arsvox_agent.tools.context import ToolContext

#: Registered product surfaces (mirror of apps/desktop/src/adaptive/surfaces.ts
#: PRODUCT_SURFACES, owned by A4). Only these may be composed by the model;
#: the frontend planner rejects anything else at apply time, so this set and
#: the frontend registry MUST stay in sync (see test_layout_tools no-news /
#: vocabulary guard). media IS assignable (MediaDock renders per role);
#: the shell keeps the persistent media bar independent of compositions.
REGISTERED_SURFACES: frozenset[str] = frozenset(
    {"browser", "conversation", "document_editor", "tasks", "media"}
)

#: Deterministic role → semantic slot mapping (contract: each template
#: offers exactly one slot per role; slots are implementation vocabulary,
#: so the model never sees them).
ROLE_SLOT: dict[SurfaceRole, str] = {
    SurfaceRole.PRIMARY: "main",
    SurfaceRole.COMPANION: "side",
    SurfaceRole.SUPPORT: "rail",
}


class ModelPanelType(str, Enum):
    """Panel types the model may open — the model-visible vocabulary.

    Same values as the wire PanelType minus the deprecated legacy
    surface (the browser covers that activity; the model must never see
    it as a surface). The tool JSON schemas derive from this enum, so
    that value can never reach the model. Drift guard:
    tests/python/test_tools_api.py.
    """

    CONVERSATION = "conversation"
    BROWSER = "browser"
    YOUTUBE = "youtube"
    MEDIA = "media"
    BOOK_READER = "book_reader"
    DOCUMENT_EDITOR = "document_editor"
    NOTES = "notes"
    TASKS = "tasks"
    REMINDERS = "reminders"
    TELEGRAM_PREVIEW = "telegram_preview"
    SETTINGS = "settings"
    CONFIRMATION = "confirmation"
    NOTIFICATION = "notification"


class LayoutAssignmentInput(BaseModel):
    """One surface placed in one semantic role (model-visible shape).

    ``surface`` is a registered surface id (browser, conversation,
    document_editor, tasks, media). ``role`` is one of the assignable
    roles — persistent is shell-owned and never assignable. The slot is
    derived deterministically from the role by the application; the
    model never sends slots, sizes, pixels, or coordinates.
    """

    surface: str = Field(min_length=1)
    role: Literal["primary", "companion", "support"]


async def ui_open_panel(
    tctx: ToolContext,
    panel_type: ModelPanelType,
    title: str | None = None,
    content_reference: str | None = None,
) -> str:
    tctx.deps.panels.upsert(panel_type.value, title, content_reference)
    await tctx.emit(
        UiCommandEvent(
            command=PanelOpen(
                panel_type=PanelType(panel_type.value),
                title=title,
                content_reference=content_reference,
            )
        )
    )
    return f"Panel {panel_type.value} abierto."


async def ui_close_panel(
    tctx: ToolContext,
    panel_type: ModelPanelType | None = None,
    panel_id: str | None = None,
) -> str:
    target = panel_id or (panel_type.value if panel_type else None)
    if not target:
        return "Especifica qué panel cerrar."
    tctx.deps.panels.remove(target)
    await tctx.emit(
        UiCommandEvent(
            command=PanelClose(
                panel_type=PanelType(panel_type.value) if panel_type else None,
                panel_id=panel_id,
            )
        )
    )
    return f"Panel {target} cerrado."


async def ui_set_primary_panel(tctx: ToolContext, panel_type: ModelPanelType) -> str:
    tctx.deps.panels.touch(panel_type.value)
    await tctx.emit(
        UiCommandEvent(
            command=PanelSetPrimary(panel_type=PanelType(panel_type.value))
        )
    )
    return f"{panel_type.value} es ahora el panel principal."


async def layout_compose(
    tctx: ToolContext,
    template: AdaptiveTemplate,
    assignments: list[LayoutAssignmentInput],
    proportion: Proportion | None = None,
) -> str:
    """Compose the adaptive workspace layout (semantic only — never geometry).

    The application computes all geometry from the template, the
    surface-role assignments, and the optional proportion. Invalid specs
    (duplicate surfaces, unsupported roles, unregistered surfaces,
    slots the template does not offer) are rejected deterministically
    and never reach the UI.
    """
    try:
        primary_index = 0
        derived: list[LayoutAssignment] = []
        for a in assignments:
            if a.role == "primary":
                primary_index += 1
                # Equal split: the SECOND primary tiles the side slot
                # (split = main | side; frozen 50/50 when two primaries).
                # ROLE_SLOT would put both in "main" — the renderer's
                # geometry engine rejects one-surface-per-slot duplicates.
                slot = "main" if primary_index == 1 else "side"
            else:
                slot = ROLE_SLOT[a.role]
            derived.append(
                LayoutAssignment(surface_id=a.surface, role=a.role, slot=slot)
            )
        spec = LayoutSpec(
            template=template,
            assignments=derived,
            proportion=proportion,
        )
        validate_layout_spec(spec, REGISTERED_SURFACES)
    except ValueError as exc:
        return f"Disposición rechazada: {exc}"
    await tctx.emit(
        UiCommandEvent(
            command=LayoutCompose(
                template=template,
                assignments=spec.assignments,
                proportion=proportion,
            )
        )
    )
    return f"Disposición {template.value} aplicada."


async def ui_set_fullscreen(tctx: ToolContext, panel_type: ModelPanelType) -> str:
    await tctx.emit(
        UiCommandEvent(command=PanelFullscreen(panel_type=PanelType(panel_type.value)))
    )
    return f"Pantalla completa en {panel_type.value}."


async def ui_restore_layout(tctx: ToolContext) -> str:
    await tctx.emit(UiCommandEvent(command=LayoutRestore()))
    return "Disposición anterior restaurada."


# --------------------------------------------------------------------- #
SPECS = [
    ToolSpec(
        "ui.open_panel",
        "Open a panel. panel_type is one of: conversation, browser, youtube, media,"
        " book_reader, document_editor, notes, tasks, reminders,"
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
        "layout.compose",
        "Compose the adaptive workspace layout. template is one of: focus (single"
        " main region), sidecar (primary + companion), stack (primary + stacked"
        " companion), split (primary + companion; equal split allows TWO primaries),"
        " triple (primary + companion + support). Assign each surface exactly once"
        " with a role: primary (the main activity), companion (visible secondary"
        " activity), support (compact contextual representation). Registered"
        " surfaces: browser, conversation, document_editor, tasks, media. proportion"
        " (optional): narrow, balanced, wide. The application computes all geometry"
        " from these choices — never send coordinates, sizes, or CSS. Call only"
        " when the user's primary task changes.",
        layout_compose,
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
