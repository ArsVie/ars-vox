"""Messages sent by the UI (or test clients) to the agent service.

Discriminated union on ``type`` — the field must stay REQUIRED so the
discriminator works (parse_client_message validates raw frames).
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from arsvox_contracts.commands import (
    BrowserBack,
    BrowserForward,
    BrowserNavigate,
    BrowserRefresh,
    DocumentSave,
    LayoutApply,
    LayoutRestore,
    MediaPlayPause,
    MediaSeek,
    PanelClose,
    PanelFullscreen,
    PanelOpen,
    PanelSetPrimary,
    TasksToggle,
    YoutubePlay,
    YoutubeSearch,
)


class UserText(BaseModel):
    type: Literal["user_text"]
    text: str


class ConfirmMessage(BaseModel):
    type: Literal["confirm"]
    pending_id: str


class CancelMessage(BaseModel):
    type: Literal["cancel"]
    pending_id: str


class StopMessage(BaseModel):
    type: Literal["stop"]


class PingMessage(BaseModel):
    type: Literal["ping"]


# --------------------------------------------------------------------- #
# C1 (GATE-3.5): client-initiated actions — NARROWED union.
#
# ClientAction is ONLY the actions the human client is allowed to
# initiate: media play/pause/seek, browser navigation, document.save,
# tasks.toggle, layout/panel overrides. Server-originated commands
# (notification.show, media.state, tts.speak, audio.play) are NOT here —
# they travel server->client via the full UiCommand union
# (arsvox_contracts.commands), never as client frames. Every declared
# ClientAction MUST have an authoritative handler
# (services/agent/arsvox_agent/actions.py); tests/python/
# test_client_actions.py fails on drift (R39). The wire frame the UI
# sends is {type: "ui_command", command: <ClientAction>}. Unknown action
# strings fail parse (strict union) and the service replies action_result
# failed instead of the generic "Mensaje no válido".
# --------------------------------------------------------------------- #
ClientAction = Annotated[
    Union[
        LayoutApply,
        PanelOpen,
        PanelClose,
        PanelSetPrimary,
        PanelFullscreen,
        LayoutRestore,
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
    ],
    Field(discriminator="action"),
]


class UiCommandMessage(BaseModel):
    type: Literal["ui_command"]
    command: ClientAction


ClientMessage = Annotated[
    Union[
        UserText,
        ConfirmMessage,
        CancelMessage,
        StopMessage,
        PingMessage,
        UiCommandMessage,
    ],
    Field(discriminator="type"),
]


def parse_client_message(raw: str | bytes) -> ClientMessage:
    """Parse a raw JSON frame. Union aliases don't carry
    model_validate_json, so parse through a TypeAdapter."""
    from pydantic import TypeAdapter

    return TypeAdapter(ClientMessage).validate_json(raw)
