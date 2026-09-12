"""The cheap caps, and nothing else.

"Safety mechanisms become important in direct proportion to the autonomy the agent
is given" (section 10). One user, one machine, eight tools that write to a local
database is the bottom of that scale, so there is no sandbox, no approval prompt,
no permission classifier and no deny-list here. Recommendation 10 scopes those to
enterprise, shared and automated deployments; the scaffold in 16.4 omits them on
purpose.

What survives is Recommendation 18: cap the steps in a turn, and count repeated
identical calls. Both cost a dozen lines.
"""

from __future__ import annotations

import hashlib
import json


def signature(name: str, arguments: dict) -> str:
    """Stable hash input for repetition detection."""
    payload = json.dumps({"name": name, "arguments": arguments}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


class StepBudget:
    """Hard cap on model steps inside one turn."""

    def __init__(self, max_steps: int = 6) -> None:
        self.max_steps = max(1, max_steps)

    def check(self, step: int) -> tuple[bool, str]:
        if step > self.max_steps:
            return False, f"se alcanzó el límite de {self.max_steps} pasos en un turno"
        return True, ""


class DoomLoopCap:
    """Warn on the second identical call, stop on the third."""

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
