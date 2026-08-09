"""Policy engine: classification, denials, approval requirements."""

from arsvox_contracts import PolicyKind

from arsvox_agent.policy import PolicyEngine


def test_read_only_no_approval():
    d = PolicyEngine().decide("app.get_state", {})
    assert d.allowed
    assert d.kind == PolicyKind.READ_ONLY
    assert not d.requires_approval


def test_reversible_no_approval():
    d = PolicyEngine().decide("layout.compose", {"template": "sidecar"})
    assert d.allowed
    assert not d.requires_approval


def test_external_requires_approval():
    d = PolicyEngine().decide("telegram.send_pending", {"text": "hola"})
    assert d.allowed
    assert d.kind == PolicyKind.EXTERNAL
    assert d.requires_approval


def test_override_requires_approval():
    # frictionless policy (2026-08-08): reminders no longer require
    # approval — only telegram.prepare_message keeps the confirmation.
    d = PolicyEngine().decide("reminders.create", {"text": "x", "due_at": "2026-01-01T00:00:00"})
    assert d.allowed
    assert d.kind == PolicyKind.REVERSIBLE
    assert not d.requires_approval


def test_unknown_tool_denied():
    d = PolicyEngine().decide("ui.anything_else", {})
    assert not d.allowed


def test_privileged_denied():
    d = PolicyEngine().decide("shell.exec", {"cmd": "rm -rf /"})
    assert not d.allowed


def test_approval_never_removable():
    # even a model-supplied description cannot alter the decision
    engine = PolicyEngine()
    assert engine.decide("telegram.send_pending", {"text": "x"}).requires_approval
    assert engine.decide("telegram.send_pending", {}).requires_approval


def test_frictionless_policy_no_gates_except_messages():
    """User directive 2026-08-08: no confirmation gates except messages
    (telegram.send). Every registered tool must be REVERSIBLE or READ_ONLY
    — nothing may silently wait on a confirmation."""
    from arsvox_agent.tools import ToolRegistry
    from arsvox_agent.tools.register import register_all

    registry = ToolRegistry()
    register_all(registry)
    gated = [
        name for name, spec in registry._specs.items()
        if spec.kind == PolicyKind.USER_VISIBLE
    ]
    assert sorted(gated) == ["telegram.prepare_message"], gated


def test_policy_kinds_match_registry_specs():
    """TOOL_KINDS (policy.py) must never drift from the registered ToolSpecs:
    both tables are sources of truth and they must agree (single authority)."""
    from arsvox_agent.policy import TOOL_KINDS
    from arsvox_agent.tools import ToolRegistry
    from arsvox_agent.tools.register import register_all

    registry = ToolRegistry()
    register_all(registry)
    drift = [
        name for name, spec in registry._specs.items()
        if TOOL_KINDS.get(name) != spec.kind
    ]
    assert drift == [], f"policy TOOL_KINDS drifted from specs: {drift}"
    extra = set(TOOL_KINDS) - set(registry._specs)
    assert not extra, f"TOOL_KINDS references unregistered tools: {extra}"
    # frictionless: nothing outside the Telegram send flow may require approval
    from arsvox_agent.policy import APPROVAL_OVERRIDES
    assert APPROVAL_OVERRIDES <= {"telegram.send_pending"}, APPROVAL_OVERRIDES
