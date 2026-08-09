"""Typed interface commands.

The model never controls the interface through free text. It returns
tool calls, the agent service validates them, and the service emits
UiCommand objects over the WebSocket. The UI validates again before
applying anything.

UiCommand is a discriminated union on ``action``.
"""

from datetime import datetime, timezone
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, model_validator

from arsvox_contracts.adaptive import (
    AdaptiveTemplate,
    LayoutAssignment,
    LayoutSpec,
    Proportion,
)
from arsvox_contracts.enums import (
    LayoutTemplate,
    MediaKind,
    MediaSource,
    MediaState,
    NotificationKind,
    PanelType,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LayoutSlots(BaseModel):
    """Panel→slot assignments for multi-zone layouts.

    ``main`` is always populated (frozen invariant). ``side``/``rail``/
    ``dock`` are optional. The model never sends coordinates — only
    assignments; the engine owns geometry.
    """

    main: PanelType
    side: PanelType | None = None
    rail: PanelType | None = None
    dock: PanelType | None = None


class LayoutApply(BaseModel):
    action: Literal["layout.apply"] = "layout.apply"
    template: LayoutTemplate
    primary_panel: PanelType
    secondary_panel: PanelType | None = None
    # Optional superset: when present it WINS over primary/secondary
    # (engine treats slots.main as the source of truth for the main slot).
    slots: LayoutSlots | None = None
    # When True the UI keeps current panels mounted; only roles change.
    preserve: bool = True

    @model_validator(mode="after")
    def _slots_main_matches_primary(self) -> "LayoutApply":
        if self.slots is not None and self.slots.main != self.primary_panel:
            raise ValueError("slots.main must equal primary_panel when both are present")
        return self


class LayoutCompose(BaseModel):
    """Native adaptive layout composition (GATE-3.5 C5, A3).

    Carries the frozen LayoutSpec semantics — template, surface-role
    assignments, optional proportion. NO geometry: no pixels, CSS, or
    coordinates anywhere in this shape. Slot names are derived by the
    emitting tool from roles (primary→main, companion→side, support→rail)
    and validated here against the frozen adaptive.py invariants.
    """

    action: Literal["layout.compose"] = "layout.compose"
    template: AdaptiveTemplate
    assignments: list[LayoutAssignment] = Field(min_length=1)
    proportion: Proportion | None = None

    @model_validator(mode="after")
    def _reuse_frozen_layout_invariants(self) -> "LayoutCompose":
        # Single source of truth: constructing LayoutSpec runs the frozen
        # adaptive.py gates (exactly-one-primary / equal split, no
        # duplicate surfaces, assignable roles only, slots match template).
        LayoutSpec(
            template=self.template,
            assignments=self.assignments,
            proportion=self.proportion,
        )
        return self


class PanelOpen(BaseModel):
    action: Literal["panel.open"] = "panel.open"
    panel_type: PanelType
    title: str | None = None
    content_reference: str | None = None


class PanelClose(BaseModel):
    action: Literal["panel.close"] = "panel.close"
    panel_type: PanelType | None = None
    panel_id: str | None = None


class PanelSetPrimary(BaseModel):
    action: Literal["panel.set_primary"]
    panel_type: PanelType


class PanelFullscreen(BaseModel):
    action: Literal["panel.fullscreen"] = "panel.fullscreen"
    panel_type: PanelType


class LayoutRestore(BaseModel):
    action: Literal["layout.restore"] = "layout.restore"


class NotificationShow(BaseModel):
    action: Literal["notification.show"] = "notification.show"
    notification_id: str
    kind: NotificationKind
    title: str
    text: str
    sound: bool = False
    snoozable: bool = True


class MediaStateChange(BaseModel):
    action: Literal["media.state"] = "media.state"
    state: MediaState
    title: str | None = None
    url: str | None = None
    volume: float | None = None


class TtsSpeak(BaseModel):
    action: Literal["tts.speak"] = "tts.speak"
    text: str
    priority: bool = False


class AudioPlay(BaseModel):
    action: Literal["audio.play"] = "audio.play"
    asset: str


class MediaPlayPause(BaseModel):
    action: Literal["media.play_pause"] = "media.play_pause"


class MediaSeek(BaseModel):
    action: Literal["media.seek"] = "media.seek"
    position_s: int


class YoutubeSearch(BaseModel):
    action: Literal["youtube.search"] = "youtube.search"
    query: str


class YoutubePlay(BaseModel):
    action: Literal["youtube.play"] = "youtube.play"
    video_id: str
    title: str


class BrowserNavigate(BaseModel):
    action: Literal["browser.navigate"] = "browser.navigate"
    url: str


class BrowserBack(BaseModel):
    action: Literal["browser.back"] = "browser.back"


class BrowserForward(BaseModel):
    action: Literal["browser.forward"] = "browser.forward"


class BrowserRefresh(BaseModel):
    action: Literal["browser.refresh"] = "browser.refresh"


class DocumentSave(BaseModel):
    action: Literal["document.save"] = "document.save"
    panel_type: str
    content: str


class TasksToggle(BaseModel):
    action: Literal["tasks.toggle"] = "tasks.toggle"
    task_id: str


# ---------------------------------------------------------------------- #
# GATE-5 (W0-CONTRACT): unified media + memory surface.
#
# media.select_result  — the USER picked one result card (click). Voice
#   picks go through the agent's play tools; both land in the ONE media
#   controller, so youtube and local files reach the same player.
# memory.search       — semantic/FTS recall over the authoritative
#   memory (W1-MEMORY), DISTINCT from the exact-key memory.recall.
#   Server-originated: the agent issues it; results come back on
#   memory.search_results.
# ---------------------------------------------------------------------- #


class MediaSelectResult(BaseModel):
    action: Literal["media.select_result"] = "media.select_result"
    result_id: str
    source: MediaSource
    kind: MediaKind
    title: str
    url: str | None = None
    local_path: str | None = None


class MemorySearch(BaseModel):
    action: Literal["memory.search"] = "memory.search"
    query: str
    limit: int = 10


UiCommand = Annotated[
    Union[
        LayoutApply,
        LayoutCompose,
        PanelOpen,
        PanelClose,
        PanelSetPrimary,
        PanelFullscreen,
        LayoutRestore,
        NotificationShow,
        MediaStateChange,
        TtsSpeak,
        AudioPlay,
        MediaPlayPause,
        MediaSeek,
        YoutubeSearch,
        YoutubePlay,
        BrowserNavigate,
        BrowserBack,
        BrowserForward,
        BrowserRefresh,
        DocumentSave,
        TasksToggle,
        MediaSelectResult,
        MemorySearch,
    ],
    Field(discriminator="action"),
]
