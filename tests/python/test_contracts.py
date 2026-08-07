"""Contract validation tests: events, commands, client messages."""

import pytest

from arsvox_contracts import (
    LayoutApply,
    LayoutSlots,
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


# --------------------------------------------------------------------- #
# B1/B2: frozen template union + LayoutSlots on LayoutApply


def test_layout_template_frozen_union():
    # canonical values
    assert LayoutTemplate.READING.value == "reading"
    assert LayoutTemplate.DASHBOARD.value == "dashboard"
    assert LayoutTemplate.FOCUS.value == "focus"
    assert LayoutTemplate.SPLIT.value == "split"
    # deprecated aliases remain valid (deployed configs)
    assert (
        LayoutApply(template="reference", primary_panel="conversation").template
        is LayoutTemplate.REFERENCE
    )
    assert (
        LayoutApply(template="background_media", primary_panel="conversation").template
        is LayoutTemplate.BACKGROUND_MEDIA
    )


def test_layout_apply_roundtrip_with_slots():
    cmd = LayoutApply(
        template=LayoutTemplate.READING,
        primary_panel=PanelType.DOCUMENT_EDITOR,
        slots=LayoutSlots(
            main=PanelType.DOCUMENT_EDITOR,
            side=PanelType.CONVERSATION,
            dock=PanelType.MEDIA,
        ),
    )
    dumped = cmd.model_dump(mode="json")
    assert dumped["template"] == "reading"
    assert dumped["slots"]["main"] == "document_editor"
    assert dumped["slots"]["side"] == "conversation"
    assert dumped["slots"]["dock"] == "media"
    assert dumped["slots"]["rail"] is None
    # wire round-trip
    parsed = LayoutApply.model_validate(dumped)
    assert parsed.slots is not None
    assert parsed.slots.dock == PanelType.MEDIA


def test_layout_apply_slots_main_mismatch_rejected():
    with pytest.raises(Exception):
        LayoutApply(
            template=LayoutTemplate.DASHBOARD,
            primary_panel=PanelType.NOTES,
            slots=LayoutSlots(main=PanelType.CONVERSATION),
        )


def test_layout_apply_backcompat_without_slots():
    cmd = LayoutApply(
        template=LayoutTemplate.SPLIT,
        primary_panel=PanelType.CONVERSATION,
        secondary_panel=PanelType.BROWSER,
    )
    assert cmd.slots is None
    dumped = cmd.model_dump(mode="json")
    assert dumped["slots"] is None


# --------------------------------------------------------------------- #
# B6: regenerated JSON schema on disk matches the models


def _ui_commands_schema() -> dict:
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "schemas" / "ui-commands.schema.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_generated_schema_frozen_templates_and_slots():
    schema = _ui_commands_schema()
    defs = schema["$defs"]
    # frozen union: canonical set + deprecated aliases, nothing else
    assert defs["LayoutTemplate"]["enum"] == [
        "focus",
        "split",
        "reading",
        "dashboard",
        "reference",
        "background_media",
    ]
    # layout.apply carries the nullable slots def
    slots_prop = defs["LayoutApply"]["properties"]["slots"]
    assert slots_prop["anyOf"][0]["$ref"] == "#/$defs/LayoutSlots"
    # slots: main required, rest optional
    assert defs["LayoutSlots"]["required"] == ["main"]
    assert set(defs["LayoutSlots"]["properties"]) == {"main", "side", "rail", "dock"}
