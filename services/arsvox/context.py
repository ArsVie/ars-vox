"""The system prompt, assembled from ordered sections.

Sections carry an order number, in reserved bands: identity sits at -100, the
persona at 0, and tool guidance from 100 up. Empty sections are dropped, so a
section can switch itself off. Static text interpolates strictly: an unknown
{{variable}} raises instead of shipping a literal hole to the model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

IDENTITY_ORDER = -100
PERSONA_ORDER = 0
TOOL_GUIDANCE_ORDER = 100

VARIABLE = re.compile(r"\{\{(\w+)\}\}")
WEEKDAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")

IDENTITY = (
    "Sos Ars Vox, un asistente que funciona por voz y en español. "
    "Tu usuario es una persona mayor, con poca costumbre de usar computadoras. "
    "Hablás corto, claro y sin tecnicismos. Nunca usás emojis ni listas largas. "
    "Una respuesta tuya se escucha en voz alta: dos o tres frases como máximo."
)

PERSONA = (
    "Tratás al usuario de vos, con respeto y calidez. "
    "Si no entendés el pedido, lo decís y preguntás una sola cosa concreta. "
    "Nunca inventás datos: si no sabés algo, lo decís."
)

NORMS = (
    "Reglas:\n"
    "- Pedí lo que falta en vez de suponer.\n"
    "- Cuando usás una herramienta, contá el resultado en una frase.\n"
    "- Si una herramienta falla, explicá en simple y ofrecé otra cosa.\n"
    "- Si el pedido se resuelve con una herramienta, llamala siempre: aunque en la "
    "conversación haya una respuesta parecida, el estado pudo cambiar.\n"
    "- La hora y el estado actuales están en el bloque de contexto: usalos, no los pidas."
)

TIME_FORMAT = "%Y-%m-%dT%H:%M%z"


class MissingVariable(KeyError):
    pass


@dataclass(slots=True)
class Section:
    name: str
    order: int
    render: Callable[[dict], str]


def interpolate(text: str, variables: dict) -> str:
    def replace(match: re.Match) -> str:
        name = match.group(1)
        if name not in variables:
            raise MissingVariable(name)
        return str(variables[name])

    return VARIABLE.sub(replace, text)


class PromptBuilder:
    def __init__(self) -> None:
        self._sections: list[Section] = []

    def add(self, name: str, order: int, render: Callable[[dict], str]) -> None:
        self._sections.append(Section(name, order, render))

    def render(self, variables: dict) -> str:
        pieces: list[str] = []
        for section in sorted(self._sections, key=lambda s: (s.order, s.name)):
            text = section.render(variables)
            if text and text.strip():
                pieces.append(interpolate(text, variables).strip())
        return "\n\n".join(pieces)

    def section_names(self) -> list[str]:
        return [s.name for s in sorted(self._sections, key=lambda s: (s.order, s.name))]


def default_builder(tool_guidance: list[tuple[str, str]] | None = None) -> PromptBuilder:
    """Identity, persona, tool guidance (one section per tool), and the rules."""
    builder = PromptBuilder()
    builder.add("identity", IDENTITY_ORDER, lambda _: IDENTITY)
    builder.add("persona", PERSONA_ORDER, lambda _: PERSONA)
    for index, (name, description) in enumerate(tool_guidance or []):
        builder.add(
            f"tool:{name}",
            TOOL_GUIDANCE_ORDER + index,
            lambda _, text=f"Cuándo usar {name}: {description}": text,
        )
    builder.add("norms", TOOL_GUIDANCE_ORDER + 90, lambda _: NORMS)
    return builder


def human_time(moment: datetime) -> str:
    return f"{moment.strftime('%Y-%m-%d %H:%M')} ({WEEKDAYS[moment.weekday()]})"


def snapshot_text(moment: datetime, state: dict, preferences: dict[str, str]) -> str:
    """The volatile tail: current facts, re-sent only when the text changes."""
    lines = [
        "Contexto actual. Este bloque reemplaza a cualquier contexto anterior.",
        f"Hora local: {moment.isoformat(timespec='minutes')} — {human_time(moment)}",
        f"Recordatorios activos: {state.get('reminders', 0)}",
        f"Tareas pendientes: {state.get('tasks_open', 0)}",
    ]
    if preferences:
        remembered = "; ".join(f"{key}: {value}" for key, value in sorted(preferences.items()))
        lines.append(f"Lo que recordás del usuario: {remembered}")
    else:
        lines.append("Lo que recordás del usuario: nada todavía")
    return "\n".join(lines)
