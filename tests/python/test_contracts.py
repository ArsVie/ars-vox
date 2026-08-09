"""Contract validation tests: events, commands, client messages."""

import re
from pathlib import Path

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


# --------------------------------------------------------------------- #
# GATE-3.5: cross-language parity — the hand-mirrored tables must not
# drift between the Python service and the TypeScript desktop app. The TS
# literals are parsed from disk (ugly and correct); the Python side is the
# imported truth. Repo-relative paths are robust to the worktree location.

_REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_ts(rel_path: str) -> str:
    return (_REPO_ROOT / rel_path).read_text(encoding="utf-8")


def _ts_literal_body(src: str, var: str) -> str:
    """Body of `(export )?const VAR ... = { ... };` / `= [ ... ];` —
    terminates at the first `};` / `];` (inner arrays end with `],` and
    nested objects with `},`, so neither matches early)."""
    m = re.search(
        rf"(?:export )?const {var}\b[^=]*=\s*(\{{|\[)(.*?)(?:\}};|\];)", src, re.S
    )
    assert m, f"{var} literal not found in TS source"
    return m.group(2)


def _ts_string_map(src: str, var: str) -> dict[str, str]:
    """Parse `{ key: "value", ... }` with bare or quoted keys."""
    body = _ts_literal_body(src, var)
    pairs: dict[str, str] = {}
    for quoted, bare, value in re.findall(
        r'(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*"([^"]+)"', body
    ):
        pairs[quoted or bare] = value
    return pairs


def _ts_string_array(src: str, var: str) -> list[str]:
    """Parse `[ "a", "b", ... ]` (string entries only)."""
    body = _ts_literal_body(src, var)
    return re.findall(r'"([^"]+)"', body)


def _ts_object_array_field(src: str, var: str, field: str) -> list[str]:
    """Parse the values of one quoted field across an object array."""
    body = _ts_literal_body(src, var)
    return re.findall(rf"{field}\s*:\s*\"([^\"]+)\"", body)


def test_parity_legacy_template_map_with_ts_planner():
    """_LEGACY_TEMPLATE_MAP (snapshot.py) must equal the client planner's
    LEGACY_TEMPLATE_MAP (apps/desktop/src/adaptive/planner.ts): server and
    client must agree on what a legacy layout intent means."""
    from arsvox_agent.snapshot import _LEGACY_TEMPLATE_MAP

    ts = _read_ts("apps/desktop/src/adaptive/planner.ts")
    assert _ts_string_map(ts, "LEGACY_TEMPLATE_MAP") == _LEGACY_TEMPLATE_MAP


def test_parity_registered_surfaces_with_ts_product_surfaces():
    """REGISTERED_SURFACES (ui_tools.py) must equal the surfaceIds in
    PRODUCT_SURFACES (apps/desktop/src/adaptive/surfaces.ts): the model
    may only compose surfaces the frontend registry hosts."""
    from arsvox_agent.tools.ui_tools import REGISTERED_SURFACES

    ts = _read_ts("apps/desktop/src/adaptive/surfaces.ts")
    ts_ids = set(_ts_object_array_field(ts, "PRODUCT_SURFACES", "surfaceId"))
    assert ts_ids == set(REGISTERED_SURFACES)


def test_parity_spoken_vocabularies_with_ts_spoken_overrides():
    """The frozen spoken-override vocabulary (spokenOverrides.ts) must not
    collide with the Python frozen utterance vocabularies (local_intents.py)
    — an utterance can never be both a layout override and a
    stop/confirm/reject — and both sides must share the normalization and
    politeness-suffix conventions."""
    from arsvox_agent.local_intents import (
        CONFIRM_UTTERANCES,
        REJECT_UTTERANCES,
        STOP_POLITENESS_SUFFIXES,
        STOP_UTTERANCES,
        _normalize,
    )

    ts = _read_ts("apps/desktop/src/adaptive/spokenOverrides.ts")
    phrases = set(_ts_string_map(ts, "SPOKEN_OVERRIDE_PHRASES"))
    # disjointness: no phrase is also a stop/confirm/reject utterance
    assert phrases.isdisjoint(STOP_UTTERANCES | CONFIRM_UTTERANCES | REJECT_UTTERANCES)
    # keys are post-normalize forms: python normalization is idempotent on
    # every phrase the TS side stores (accents/punctuation would never match)
    assert all(_normalize(p) == p for p in phrases)
    # politeness filler convention mirrored
    assert _ts_string_array(ts, "POLITENESS_SUFFIXES") == list(STOP_POLITENESS_SUFFIXES)
