"""What is allowed to run, as data, frozen at import.

The floor cannot be relaxed by configuration, a flag, or text that arrives from a
page or a document: the deny set is built once when this module loads.
"""

from __future__ import annotations

from dataclasses import dataclass, field

MAX_ARGUMENT_CHARS = 500

# Frozen floor. Nothing below this line may be added to the registry at all.
DENY_ALWAYS = frozenset(
    {
        "shell",
        "bash",
        "exec",
        "subprocess",
        "file_write",
        "file_delete",
        "file_read_any",
        "python",
        "eval",
        "http_request",
        "browser_fetch_raw",
        "install",
    }
)


@dataclass(frozen=True, slots=True)
class Rule:
    required: dict[str, type]
    optional: dict[str, type] = field(default_factory=dict)
    changes_state: bool = False
    description: str = ""


TOOL_RULES: dict[str, Rule] = {
    "reminders_set": Rule(
        required={"text": str}, optional={"when_local": str}, changes_state=True,
        description="create a reminder",
    ),
    "reminders_list": Rule(required={}, description="list active reminders"),
    "reminders_cancel": Rule(required={"reminder_id": int}, changes_state=True,
                             description="remove a reminder"),
    "tasks_add": Rule(required={"text": str}, changes_state=True, description="add a to-do"),
    "tasks_list": Rule(required={}, description="list to-dos"),
    "tasks_done": Rule(required={"task_id": int}, changes_state=True,
                       description="mark a to-do done"),
    "preferences_set": Rule(required={"key": str, "value": str}, changes_state=True,
                            description="remember something about the user"),
    "preferences_list": Rule(required={}, description="read what is remembered"),
}


@dataclass(slots=True)
class Decision:
    allowed: bool
    reason: str = ""
    arguments: dict = field(default_factory=dict)


def sanitize(arguments: dict) -> dict:
    """Keep known-shaped values only, and cap their length."""
    clean: dict = {}
    for key, value in (arguments or {}).items():
        if isinstance(value, str):
            clean[key] = value.strip()[:MAX_ARGUMENT_CHARS]
        elif isinstance(value, (int, float, bool)) or value is None:
            clean[key] = value
        else:
            clean[key] = str(value)[:MAX_ARGUMENT_CHARS]
    return clean


class PolicyEngine:
    """Decides one tool call: allowed, or refused with a reason the model can read."""

    def __init__(self, rules: dict[str, Rule] | None = None) -> None:
        self.rules = dict(rules or TOOL_RULES)

    def decide(self, name: str, arguments: dict) -> Decision:
        if name in DENY_ALWAYS:
            return Decision(False, f"'{name}' está prohibido siempre")
        rule = self.rules.get(name)
        if rule is None:
            return Decision(False, f"herramienta desconocida: '{name}'")
        clean = sanitize(arguments)
        missing = [key for key in rule.required if clean.get(key) in (None, "")]
        if missing:
            return Decision(False, f"faltan datos: {', '.join(missing)}")
        for key, expected in rule.required.items():
            if not isinstance(clean.get(key), expected) or (
                expected is int and isinstance(clean.get(key), bool)
            ):
                return Decision(False, f"'{key}' debe ser {expected.__name__}")
        for key, expected in rule.optional.items():
            if clean.get(key) is not None and not isinstance(clean[key], expected):
                return Decision(False, f"'{key}' debe ser {expected.__name__}")
        allowed_keys = set(rule.required) | set(rule.optional)
        return Decision(True, "", {k: v for k, v in clean.items() if k in allowed_keys})

    def tool_names(self) -> list[str]:
        return sorted(self.rules)


def signature(name: str, arguments: dict) -> str:
    """Stable hash input for repetition detection."""
    import hashlib
    import json

    payload = json.dumps({"name": name, "arguments": arguments}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


class DoomLoopCap:
    """Cheap repetition cap: warn on the second identical call, stop on the third."""

    def __init__(self, max_repeats: int = 3, warn_at: int = 2) -> None:
        self.max_repeats = max_repeats
        self.warn_at = warn_at
        self.seen: dict[str, int] = {}

    def check(self, name: str, arguments: dict) -> tuple[bool, str]:
        key = signature(name, arguments)
        self.seen[key] = self.seen.get(key, 0) + 1
        count = self.seen[key]
        if count >= self.max_repeats:
            return False, f"'{name}' se repitió {count} veces con los mismos datos; me detengo"
        if count >= self.warn_at:
            return True, f"aviso: '{name}' ya se llamó {count - 1} vez con los mismos datos"
        return True, ""


class StepBudget:
    """Hard cap on model steps inside one turn."""

    def __init__(self, max_steps: int = 6) -> None:
        self.max_steps = max(1, max_steps)

    def check(self, step: int) -> tuple[bool, str]:
        if step > self.max_steps:
            return False, f"se alcanzó el límite de {self.max_steps} pasos en un turno"
        return True, ""
