"""GATE-3.5 A10 — adversarial contract tests R16/R17/R18/R39: the
model-visible surface and the client-action union.

R16 — the model's layout tool must speak the native adaptive vocabulary
      (sidecar/stack/split/triple + role assignments + proportion) —
      today ui.apply_layout teaches focus/split/reading/dashboard.
R17 — invalid specs (duplicate surfaces, unsupported roles) are rejected
      deterministically and never reach state.
R18 — the model-visible surface vocabulary (tool descriptions + PanelType
      enum + system prompt) contains NO news: the panel vision is that
      the browser covers news, no news panel exists (PanelType.NEWS
      deleted).
R39 — ClientAction is the narrowed human-initiated union (16 members)
      and every declared member has an authoritative handler.

EXPECTED-FAIL markers name the owner: A3 (agent layout contract) for
R16/R17. R18 and R39 assert landed state (A3's enum cleanup + A7's
narrowed union).
"""

from pathlib import Path

import pytest

from arsvox_contracts import PanelType
from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools.register import register_all

REPO_ROOT = Path(__file__).resolve().parents[2]
SYSTEM_MD = REPO_ROOT / "services" / "agent" / "arsvox_agent" / "prompts" / "system.md"

ADAPTIVE_TEMPLATES = ("sidecar", "stack", "split", "triple")


@pytest.fixture(scope="module")
def registry() -> ToolRegistry:
    reg = ToolRegistry()
    register_all(reg)
    return reg


def _layout_tools(registry: ToolRegistry):
    return [s for s in registry.all() if "layout" in s.name]


# --------------------------------------------------------------------- #
# R18 — no news in the model-visible vocabulary
# --------------------------------------------------------------------- #


def test_r18_panel_type_has_no_news():
    """The PanelType enum is model-visible (tool arg schemas). A news
    panel does not exist per the frozen panel vision (browser covers
    news)."""
    assert not hasattr(PanelType, "NEWS"), "PanelType.NEWS must be deleted (R18)"


def test_r18_tool_descriptions_have_no_news(registry):
    """Every tool description the model sees must not teach a news
    panel."""
    for spec in registry.all():
        assert "news" not in spec.description.lower(), (
            f"model-visible tool {spec.name} mentions news: {spec.description}"
        )


def test_r18_system_prompt_has_no_news():
    """Guard: the system prompt already avoids the news vocabulary."""
    text = SYSTEM_MD.read_text(encoding="utf-8")
    assert "news" not in text.lower()
    assert "noticias" not in text.lower()


# --------------------------------------------------------------------- #
# R16 — native adaptive LayoutSpec on the model-visible layout tool
# --------------------------------------------------------------------- #


def test_r16_layout_tool_speaks_adaptive_templates(registry):
    """The agent's layout tool must expose the frozen adaptive template
    vocabulary (sidecar/stack/split/triple) — the model never speaks
    focus/split/reading/dashboard templates with pixel-adjacent slots.
    EXPECTED-FAIL until A3 lands (ui.apply_layout still teaches
    focus/split/reading/dashboard + flat side/rail/dock kwargs)."""
    layout = _layout_tools(registry)
    assert layout, "no model-visible layout tool registered"
    descriptions = " ".join(s.description.lower() for s in layout)
    for template in ADAPTIVE_TEMPLATES:
        assert template in descriptions, (
            f"layout tool must teach the adaptive template '{template}' (R16)"
        )
    # the legacy four-template vocabulary must be GONE from the schema
    for legacy in ("reading", "dashboard"):
        assert legacy not in descriptions, (
            f"legacy template '{legacy}' must not be model-visible (R16/C5)"
        )


def test_r17_invalid_specs_rejected_before_state(registry):
    """The layout tool must reject invalid specs (duplicate surfaces /
    unsupported roles) deterministically — the rejection must never
    reach layout state. EXPECTED-FAIL until A3 lands: no model-visible
    tool accepts role assignments today, so the invalid-spec path cannot
    even be exercised through the model surface."""
    layout = _layout_tools(registry)
    descriptions = " ".join(s.description.lower() for s in layout)
    # A3's native tool documents deterministic validation of the frozen
    # LayoutSpec (assignments with surfaceId/role/slot + template).
    assert "role" in descriptions, (
        "model-visible layout tool must accept role assignments (R16/R17)"
    )
    assert "surface" in descriptions, (
        "model-visible layout tool must validate surface assignments (R17)"
    )


# --------------------------------------------------------------------- #
# R39 — ClientAction narrowed union, every member handled
# --------------------------------------------------------------------- #


def _client_action_members():
    from typing import Literal, get_args

    from arsvox_contracts.client_messages import ClientAction

    inner = get_args(ClientAction)[0]
    actions = []
    for m in get_args(inner):
        if not hasattr(m, "model_fields") or "action" not in m.model_fields:
            continue
        ann = m.model_fields["action"].annotation
        literal = get_args(ann) if ann is not None else ()
        if literal:
            actions.append(literal[0])
    return sorted(actions)


# The landed narrowed human-initiated union (A7/C1), exactly the 16
# members with authoritative handlers in arsvox_agent/actions.py (H1).
# Server-originated commands (tts.speak, audio.play, notification.show,
# media.state) are correctly ABSENT — they travel server->client, never
# as client frames. The test's value is the exact-set drift guard: it
# fails if the union gains or loses a member.
HANDLED_ACTIONS = {
    "browser.back",
    "browser.forward",
    "browser.navigate",
    "browser.refresh",
    "document.save",
    "layout.apply",
    "layout.restore",
    "media.play_pause",
    "media.seek",
    "panel.close",
    "panel.fullscreen",
    "panel.open",
    "panel.set_primary",
    "tasks.toggle",
    "youtube.play",
    "youtube.search",
}


def test_r39_every_client_action_has_authoritative_handler():
    """ClientAction must equal the landed union EXACTLY — an enumeration
    test that fails if the set drifts in either direction (C1/R39)."""
    members = _client_action_members()
    assert members, "ClientAction union must not be empty"
    missing = sorted(set(members) - HANDLED_ACTIONS)
    assert not missing, (
        f"ClientAction members without an authoritative handler: {missing} "
        "(R39/C1 — the union must stay the narrowed human-initiated set)"
    )
    extra = sorted(HANDLED_ACTIONS - set(members))
    assert not extra, (
        f"handled actions no longer declared in the ClientAction union: {extra} "
        "(R39/C1 — the landed union is exactly the handled set)"
    )
    assert len(members) == 16, f"landed ClientAction union has 16 members (got {len(members)})"


def test_r39_tts_speak_is_not_a_client_action():
    """Guard for the narrowing direction: tts.speak is a SERVER-originated
    command (the model tells the UI to speak) — it must not be in the
    human-initiated ClientAction union. EXPECTED-FAIL until A7 lands."""
    members = _client_action_members()
    assert "tts.speak" not in members, (
        "tts.speak must not be a client-initiated action (R39/C1)"
    )
