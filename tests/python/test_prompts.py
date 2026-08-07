"""System prompt drift guard: the model-facing vocabulary must match the
frozen template/slot union (plan B4). If system.md stops teaching the
frozen set — or re-advertises a deprecated alias — this fails."""

from arsvox_agent.runtime import PROMPT_FILE


def _prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


def test_system_prompt_names_all_four_templates():
    text = _prompt()
    for template in ("focus", "split", "reading", "dashboard"):
        assert template in text, f"system.md no longer names template '{template}'"


def test_system_prompt_defines_all_four_slots():
    text = _prompt()
    for slot in ("main", "side", "rail", "dock"):
        assert slot in text, f"system.md no longer defines slot '{slot}'"


def test_system_prompt_names_all_panel_types():
    from arsvox_contracts import PanelType

    text = _prompt()
    for panel in PanelType:
        assert (
            panel.value in text
        ), f"system.md no longer names panel '{panel.value}'"


def test_system_prompt_does_not_advertise_deprecated_aliases():
    # reference/background_media stay valid enum values but are
    # undocumented for the model (frozen decision, plan §1.1/B4).
    text = _prompt()
    assert "background_media" not in text
    assert "reference" not in text


def test_system_prompt_forbids_coordinates():
    text = _prompt()
    assert "coordinates" in text
