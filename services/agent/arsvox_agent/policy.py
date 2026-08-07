"""Policy engine — runs outside the LLM.

Classifies every tool by its side-effect kind. The model can never
remove an approval requirement: the gate lives in the tool executor and
consults this table (tool name + args), never the model's description
of what the action does.
"""

from dataclasses import dataclass

from arsvox_contracts import PolicyKind

# Side-effect class per tool. Anything not listed is DENIED.
TOOL_KINDS: dict[str, PolicyKind] = {
    # app introspection
    "app.get_state": PolicyKind.READ_ONLY,
    # ui — reversible by definition (panels and layouts can be restored)
    "ui.open_panel": PolicyKind.REVERSIBLE,
    "ui.close_panel": PolicyKind.REVERSIBLE,
    "ui.set_primary_panel": PolicyKind.REVERSIBLE,
    "ui.apply_layout": PolicyKind.REVERSIBLE,
    "ui.set_fullscreen": PolicyKind.REVERSIBLE,
    "ui.restore_layout": PolicyKind.REVERSIBLE,
    # media
    "media.search_youtube": PolicyKind.READ_ONLY,
    "media.play": PolicyKind.USER_VISIBLE,
    "media.pause": PolicyKind.USER_VISIBLE,
    "media.resume": PolicyKind.USER_VISIBLE,
    "media.stop": PolicyKind.USER_VISIBLE,
    "media.seek": PolicyKind.USER_VISIBLE,
    "media.set_volume": PolicyKind.USER_VISIBLE,
    # library
    "library.scan": PolicyKind.READ_ONLY,
    "library.search": PolicyKind.READ_ONLY,
    "library.open": PolicyKind.REVERSIBLE,
    "library.continue_reading": PolicyKind.REVERSIBLE,
    "library.get_position": PolicyKind.READ_ONLY,
    "library.set_position": PolicyKind.USER_VISIBLE,
    "library.read_selection": PolicyKind.USER_VISIBLE,
    "library.read_next_section": PolicyKind.USER_VISIBLE,
    # documents
    "document.create": PolicyKind.USER_VISIBLE,
    "document.open": PolicyKind.REVERSIBLE,
    "document.save": PolicyKind.USER_VISIBLE,
    "document.insert_text": PolicyKind.USER_VISIBLE,
    "document.undo": PolicyKind.REVERSIBLE,
    "document.redo": PolicyKind.REVERSIBLE,
    # notes / tasks
    "notes.add": PolicyKind.USER_VISIBLE,
    "notes.search": PolicyKind.READ_ONLY,
    "notes.today": PolicyKind.READ_ONLY,
    "tasks.add": PolicyKind.USER_VISIBLE,
    "tasks.list": PolicyKind.READ_ONLY,
    "tasks.complete": PolicyKind.USER_VISIBLE,
    # reminders
    "reminders.create": PolicyKind.USER_VISIBLE,
    "reminders.list": PolicyKind.READ_ONLY,
    "reminders.cancel": PolicyKind.USER_VISIBLE,
    # telegram
    "telegram.prepare_message": PolicyKind.USER_VISIBLE,
    "telegram.send_pending": PolicyKind.EXTERNAL,
    # memory
    "memory.remember": PolicyKind.USER_VISIBLE,
    # demo (mock mode only — the handler guards itself)
    "demo_populate": PolicyKind.USER_VISIBLE,
    "memory.recall": PolicyKind.READ_ONLY,
}

# Tools that need explicit user confirmation even though their class is
# not EXTERNAL/DESTRUCTIVE (e.g. reminders must be confirmed by the user).
APPROVAL_OVERRIDES: set[str] = {
    "reminders.create",
    "telegram.send_pending",
}

# Tools that exist for the demo but must never be enabled.
DENIED_ALWAYS: set[str] = {
    "shell.exec",
    "file.write",
    "file.delete",
    "browser.generic_agent",
}


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    kind: PolicyKind
    requires_approval: bool
    reason: str = ""


class PolicyEngine:
    def decide(self, tool: str, args: dict) -> PolicyDecision:
        if tool in DENIED_ALWAYS or tool not in TOOL_KINDS:
            return PolicyDecision(
                allowed=False,
                kind=PolicyKind.PRIVILEGED if tool in DENIED_ALWAYS else PolicyKind.READ_ONLY,
                requires_approval=False,
                reason=f"tool '{tool}' is not available",
            )
        kind = TOOL_KINDS[tool]
        requires = kind in (PolicyKind.EXTERNAL, PolicyKind.DESTRUCTIVE) or tool in APPROVAL_OVERRIDES
        return PolicyDecision(
            allowed=True,
            kind=kind,
            requires_approval=requires,
            reason=f"classified {kind.value}",
        )
