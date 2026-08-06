"""Messages sent by the UI (or test clients) to the agent service.

Discriminated union on ``type`` — the field must stay REQUIRED so the
discriminator works (parse_client_message validates raw frames).
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


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


ClientMessage = Annotated[
    Union[UserText, ConfirmMessage, CancelMessage, StopMessage, PingMessage],
    Field(discriminator="type"),
]


def parse_client_message(raw: str | bytes) -> ClientMessage:
    """Parse a raw JSON frame. Union aliases don't carry
    model_validate_json, so parse through a TypeAdapter."""
    from pydantic import TypeAdapter

    return TypeAdapter(ClientMessage).validate_json(raw)
