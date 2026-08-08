"""Messages sent by the UI (or test clients) to the agent service.

Discriminated union on ``type`` — the field must stay REQUIRED so the
discriminator works (parse_client_message validates raw frames).
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from arsvox_contracts.commands import (
    AudioPlay,
    BrowserBack,
    BrowserForward,
    BrowserNavigate,
    BrowserRefresh,
    DocumentSave,
    LayoutApply,
    LayoutRestore,
    MediaPlayPause,
    MediaSeek,
    MediaStateChange,
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
# H1: client-initiated actions.
#
# ClientAction mirrors the TS UiCommand union (apps/desktop/src/contracts.ts)
# action-for-action — the variant classes are shared with the server->client
# channel (arsvox_contracts.commands) so the two can never drift. The wire
# frame the UI sends is {type: "ui_command", command: <ClientAction>}.
# Unknown action strings fail parse (strict union) and the service replies
# action_result failed instead of the generic "Mensaje no válido".
# --------------------------------------------------------------------- #
ClientAction = Annotated[
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
