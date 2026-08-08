"""System tools: facts the agent can read about the local machine.

``clock.now`` is the one the demo quick action "Dime la hora" expects: a
read-only, deterministic local-time answer (no network, no side effects).
"""

from datetime import datetime

WEEKDAYS_ES = [
    "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo",
]
MONTHS_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


async def clock_now(tctx) -> str:
    """Current local date and time, in Spanish."""
    now = datetime.now().astimezone()
    return (
        f"Son las {now.strftime('%H:%M')} del {WEEKDAYS_ES[now.weekday()]} "
        f"{now.day} de {MONTHS_ES[now.month - 1]} de {now.year}."
    )


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec(
        "clock.now",
        "Current local date and time (Spanish, no arguments).",
        clock_now,
        PolicyKind.READ_ONLY,
    ),
]
