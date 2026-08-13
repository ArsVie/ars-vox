"""Effect tags (lane A2): every ToolSpec carries effect=revertible|emission.

The tag is descriptive metadata for the effect ledger and confirmation
tooling. It MUST NOT change policy behavior — the execution gate keeps
deciding on `approval` exactly as before (policy.py untouched).
"""

import pytest

from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolRegistry, ToolSpec, spec
from arsvox_agent.tools.register import register_all

VALID_TAGS = ("revertible", "emission")

# Pinned drift guard: every tool whose handler sends/publishes data out
# of the system or commits irreversibly. If a tool's side effects
# change, this list must change with it — the test fails otherwise.
EXPECTED_EMISSIONS = {
    "telegram.send_pending",  # hands the message to the provider (approval=True)
    "reminders.create",  # schedules an irreversible future delivery
}


def _registry() -> ToolRegistry:
    registry = ToolRegistry()
    register_all(registry)
    return registry


def test_every_registered_tool_has_a_valid_effect_tag():
    registry = _registry()
    assert len(registry.all()) == 48  # keep in sync with test_tools_api
    for tool_spec in registry.all():
        assert tool_spec.effect in VALID_TAGS, tool_spec.name


def test_all_approval_tools_are_emissions():
    for tool_spec in _registry().all():
        if tool_spec.approval:
            assert tool_spec.effect == "emission", tool_spec.name


def test_emission_set_matches_pinned_expected_list():
    """Drift guard: adding a new emission tool (or demoting one) must be
    a deliberate, reviewed change to EXPECTED_EMISSIONS."""
    emissions = {s.name for s in _registry().all() if s.effect == "emission"}
    assert emissions == EXPECTED_EMISSIONS


def test_register_rejects_approval_without_emission_tag():
    """Validation (A2): approval=True requires effect='emission' — an
    approved action is by definition an irreversible/external one."""
    async def _handler(tctx, **kwargs):  # pragma: no cover
        return "ok"

    bad = ToolSpec("test.bad", "desc", _handler, PolicyKind.EXTERNAL, approval=True)
    registry = ToolRegistry()
    with pytest.raises(ValueError, match="approval=True requires effect='emission'"):
        registry.register(bad)


def test_register_rejects_invalid_effect_tag():
    async def _handler(tctx, **kwargs):  # pragma: no cover
        return "ok"

    bad = ToolSpec(
        "test.bad2", "desc", _handler, PolicyKind.READ_ONLY, effect="sideways"
    )
    registry = ToolRegistry()
    with pytest.raises(ValueError, match="invalid effect tag"):
        registry.register(bad)


def test_spec_helper_builds_toolspec_correctly():
    async def _handler(tctx, **kwargs):  # pragma: no cover
        return "ok"

    # defaults: revertible + no approval
    s = spec("test.helper", "desc", _handler, PolicyKind.REVERSIBLE)
    assert isinstance(s, ToolSpec)
    assert s.effect == "revertible"
    assert s.approval is False
    assert s.kind is PolicyKind.REVERSIBLE

    # explicit emission + approval (the telegram.send_pending shape)
    s2 = spec(
        "test.helper2",
        "desc",
        _handler,
        PolicyKind.EXTERNAL,
        approval=True,
        effect="emission",
    )
    assert s2.approval is True
    assert s2.effect == "emission"

    # explicit override of the default tag
    s3 = spec("test.helper3", "desc", _handler, PolicyKind.READ_ONLY, effect="emission")
    assert s3.effect == "emission"

    # helper-built specs register fine through the same validation
    registry = ToolRegistry()
    for built in (s, s2, s3):
        registry.register(built)
    assert registry.get("test.helper2").effect == "emission"
