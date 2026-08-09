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
    "layout.compose": PolicyKind.REVERSIBLE,
    "ui.set_fullscreen": PolicyKind.REVERSIBLE,
    "ui.restore_layout": PolicyKind.REVERSIBLE,
    # media
    "media.search_youtube": PolicyKind.READ_ONLY,
    "media.play": PolicyKind.REVERSIBLE,
    "media.pause": PolicyKind.REVERSIBLE,
    "media.resume": PolicyKind.REVERSIBLE,
    "media.stop": PolicyKind.REVERSIBLE,
    "media.seek": PolicyKind.REVERSIBLE,
    "media.set_volume": PolicyKind.REVERSIBLE,
    # library
    "library.scan": PolicyKind.READ_ONLY,
    "library.search": PolicyKind.READ_ONLY,
    "library.open": PolicyKind.REVERSIBLE,
    "library.continue_reading": PolicyKind.REVERSIBLE,
    "library.get_position": PolicyKind.READ_ONLY,
    "library.set_position": PolicyKind.REVERSIBLE,
    "library.read_selection": PolicyKind.REVERSIBLE,
    "library.read_next_section": PolicyKind.REVERSIBLE,
    # documents
    "document.create": PolicyKind.REVERSIBLE,
    "document.open": PolicyKind.REVERSIBLE,
    "document.list": PolicyKind.READ_ONLY,
    "document.search": PolicyKind.READ_ONLY,
    "document.save": PolicyKind.REVERSIBLE,
    "document.insert_text": PolicyKind.REVERSIBLE,
    "document.undo": PolicyKind.REVERSIBLE,
    "document.redo": PolicyKind.REVERSIBLE,
    # notes / tasks
    "notes.add": PolicyKind.REVERSIBLE,
    "notes.search": PolicyKind.READ_ONLY,
    "notes.today": PolicyKind.READ_ONLY,
    "tasks.add": PolicyKind.REVERSIBLE,
    "tasks.list": PolicyKind.READ_ONLY,
    "tasks.complete": PolicyKind.REVERSIBLE,
    # reminders
    "reminders.create": PolicyKind.REVERSIBLE,
    "reminders.list": PolicyKind.READ_ONLY,
    "reminders.cancel": PolicyKind.REVERSIBLE,
    # telegram
    "telegram.prepare_message": PolicyKind.USER_VISIBLE,
    "telegram.send_pending": PolicyKind.EXTERNAL,
    # memory (GATE-5 W1: k/v remember/recall retired; FTS search + explicit
    # preference-setting replaced them)
    "memory.search": PolicyKind.READ_ONLY,
    "preferences.set": PolicyKind.REVERSIBLE,
    # media (GATE-5 W1)
    "media.search_local": PolicyKind.READ_ONLY,
    "media.play_local": PolicyKind.REVERSIBLE,
    # demo (mock mode only — the handler guards itself)
    "demo_populate": PolicyKind.REVERSIBLE,
}

# Tools that need explicit user confirmation even though their class is
# not EXTERNAL/DESTRUCTIVE. Frictionless policy (2026-08-08): only the
# Telegram send step keeps a gate — the confirmation UI was designed for
# messages ("muestra el mensaje, léelo, confirma").
APPROVAL_OVERRIDES: set[str] = {
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
