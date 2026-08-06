"""Contract validation tests: events, commands, client messages."""

import pytest

from arsvox_contracts import (
    LayoutApply,
    PanelOpen,
    StateUpdateEvent,
    UiCommandEvent,
    parse_client_message,
)
from arsvox_contracts.enums import LayoutTemplate, PanelType, VoiceState


def test_state_update_serializes_enum_values():
    event = StateUpdateEvent(voice_state=VoiceState.THINKING)
    dumped = event.model_dump(mode="json")
    assert dumped["type"] == "state_update"
    assert dumped["voice_state"] == "thinking"


def test_ui_command_discriminates_on_action():
    cmd = LayoutApply(template=LayoutTemplate.SPLIT, primary_panel=PanelType.DOCUMENT_EDITOR)
    assert cmd.action == "layout.apply"
    event = UiCommandEvent(command=cmd)
    payload = event.model_dump(mode="json")
    assert payload["command"]["template"] == "split"
    assert payload["command"]["primary_panel"] == "document_editor"


def test_ui_command_rejects_bad_enum():
    with pytest.raises(Exception):
        LayoutApply(template="sideways", primary_panel="document_editor")  # type: ignore


def test_parse_client_message_roundtrip():
    msg = parse_client_message('{"type": "user_text", "text": "hola"}')
    assert msg.type == "user_text"
    assert msg.text == "hola"


def test_parse_client_message_rejects_unknown_type():
    with pytest.raises(Exception):
        parse_client_message('{"type": "fly", "text": "x"}')


def test_parse_client_message_requires_type_field():
    with pytest.raises(Exception):
        parse_client_message('{"text": "x"}')


def test_panel_open_defaults():
    cmd = PanelOpen(panel_type=PanelType.MEDIA)
    assert cmd.action == "panel.open"
    assert cmd.title is None
