"""System prompt drift guard: the model-facing vocabulary must match the
frozen adaptive contract (GATE-3.5 C5 / A3, R16-R18). If system.md stops
teaching the frozen set — or re-advertises the deprecated legacy
vocabulary — this fails."""

from arsvox_agent.runtime import PROMPT_FILE


def _prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


def test_system_prompt_names_all_adaptive_templates():
    text = _prompt()
    for template in ("focus", "sidecar", "stack", "split", "triple"):
        assert template in text, f"system.md no longer names template '{template}'"


def test_system_prompt_defines_all_roles():
    text = _prompt()
    for role in ("primary", "companion", "support", "persistent"):
        assert role in text, f"system.md no longer names role '{role}'"
    # persistent is shell-owned, never assignable — the prompt must say so
    assert "shell" in text


def test_system_prompt_defines_all_proportions():
    text = _prompt()
    for proportion in ("narrow", "balanced", "wide"):
        assert proportion in text, f"system.md no longer names proportion '{proportion}'"


def test_system_prompt_names_all_panel_types():
    from arsvox_contracts import PanelType

    text = _prompt()
    for panel in PanelType:
        if panel.value == "news":
            # frozen product direction (panel-vision): NO news panel — the
            # browser covers it. The model must never see news as a surface.
            assert panel.value not in text
            continue
        assert (
            panel.value in text
        ), f"system.md no longer names panel '{panel.value}'"


def test_system_prompt_does_not_advertise_deprecated_layout_vocabulary():
    # Legacy wire templates and slot names are NOT model vocabulary
    # anymore (C5): layout.compose is semantic-only, the application
    # derives slots from roles and owns all geometry.
    text = _prompt()
    for legacy in ("dashboard", "reading", "dock", "rail", "background_media", "reference"):
        assert legacy not in text, f"system.md re-advertises legacy vocabulary '{legacy}'"


def test_system_prompt_forbids_coordinates():
    text = _prompt()
    assert "coordinates" in text
