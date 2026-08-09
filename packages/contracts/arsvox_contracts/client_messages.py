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
    MediaSelectResult,
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


class TtsStarted(BaseModel):
    """Renderer ack: physical playback of a queued phrase actually began.

    The renderer is the physical-playback authority: it reports
    started/finished/cancelled so the canonical voice state machine
    (pipeline) only leaves THINKING for SPEAKING when audio is really
    playing, and only returns to LISTENING after speech ends (R05/R08).
    """

    type: Literal["tts.started"]


class TtsFinished(BaseModel):
    """Renderer ack: a phrase ended without being cancelled (played to
    completion, or failed to play — in both cases no speech is coming
    from this item). The pipeline settles to the terminal state."""

    type: Literal["tts.finished"]


class TtsCancelled(BaseModel):
    """Renderer ack: a phrase that had started was interrupted (STOP /
    queue cleared). During the STOP path the pipeline is already
    STOPPING/SLEEPING, so this ack is the observable confirmation that
    physical playback stopped (R07); defensively it also settles a
    SPEAKING state whose speech vanished without a stop."""

    type: Literal["tts.cancelled"]


class PingMessage(BaseModel):
    type: Literal["ping"]


# --------------------------------------------------------------------- #
# C1 (GATE-3.5): client-initiated actions — NARROWED union.
#
# ClientAction is ONLY the actions the human client is allowed to
# initiate: media play/pause/seek + result selection, browser
# navigation, document.save, tasks.toggle, layout/panel overrides.
# Server-originated commands (notification.show, media.state, tts.speak,
# audio.play, memory.search) are NOT here — they travel server->client
# via the full UiCommand union
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
        MediaSelectResult,
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
        TtsStarted,
        TtsFinished,
        TtsCancelled,
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
