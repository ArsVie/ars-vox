"""clock.now: read-only local-time tool (quick action "Dime la hora")."""

import asyncio
import re

from arsvox_agent.tools.system_tools import clock_now
from arsvox_agent.tools import ToolRegistry

from arsvox_agent.tools.register import register_all


def test_clock_now_registered_in_registry():
    registry = ToolRegistry()
    n = register_all(registry)
    assert n > 0
    spec = registry.get("clock.now")
    assert spec is not None
    assert spec.handler is clock_now


def test_clock_now_returns_spanish_local_time():
    text = asyncio.run(clock_now(None))
    # "Son las HH:MM del lunes 3 de agosto de 2026."
    assert re.match(
        r"^Son las \d{2}:\d{2} del (lunes|martes|miércoles|jueves|viernes|sábado|domingo) "
        r"\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) "
        r"de \d{4}\.$",
        text,
    ), text
