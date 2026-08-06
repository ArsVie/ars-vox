"""Typed interface commands.

The model never controls the interface through free text. It returns
tool calls, the agent service validates them, and the service emits
UiCommand objects over the WebSocket. The UI validates again before
applying anything.

UiCommand is a discriminated union on ``action``.
"""

from datetime import datetime, timezone
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from arsvox_contracts.enums import LayoutTemplate, MediaState, NotificationKind, PanelType


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LayoutApply(BaseModel):
    action: Literal["layout.apply"] = "layout.apply"
    template: LayoutTemplate
    primary_panel: PanelType
    secondary_panel: PanelType | None = None
    # When True the UI keeps current panels mounted; only roles change.
    preserve: bool = True


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


UiCommand = Annotated[
    Union[
        LayoutApply,
        PanelOpen,
        PanelClose,
        PanelSetPrimary,
        PanelFullscreen,
        LayoutRestore,
        NotificationShow,
        MediaStateChange,
        TtsSpeak,
        AudioPlay,
    ],
    Field(discriminator="action"),
]
