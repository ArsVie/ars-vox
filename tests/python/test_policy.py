"""Policy engine: classification, denials, approval requirements."""

from arsvox_contracts import PolicyKind

from arsvox_agent.policy import PolicyEngine


def test_read_only_no_approval():
    d = PolicyEngine().decide("app.get_state", {})
    assert d.allowed
    assert d.kind == PolicyKind.READ_ONLY
    assert not d.requires_approval


def test_reversible_no_approval():
    d = PolicyEngine().decide("ui.apply_layout", {"template": "split"})
    assert d.allowed
    assert not d.requires_approval


def test_external_requires_approval():
    d = PolicyEngine().decide("telegram.send_pending", {"text": "hola"})
    assert d.allowed
    assert d.kind == PolicyKind.EXTERNAL
    assert d.requires_approval


def test_override_requires_approval():
    d = PolicyEngine().decide("reminders.create", {"text": "x", "due_at": "2026-01-01T00:00:00"})
    assert d.allowed
    assert d.kind == PolicyKind.USER_VISIBLE
    assert d.requires_approval


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
