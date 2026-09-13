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

# Addressed to the model about itself: the direct "le hablas de usted" is what holds.
# Written in the third person or in infinitive, the same rules lost to the model's habit.
IDENTITY = (
    "Eres Ars Vox, un asistente que funciona por voz y en español. "
    "Tu usuario es una persona mayor, con poca costumbre de usar computadoras. "
    "Hablas corto, claro y sin tecnicismos. Nunca usas emojis ni listas largas. "
    "Una respuesta tuya se escucha en voz alta: dos o tres frases como máximo."
)

# The register is a setting, not a style choice made here: it comes in from
# config.REGISTERS, which also decides the voice and the country the search answers for.
DEFAULT_PERSONA = (
    "Le hablas de usted, con respeto y cariño, como se le habla a una persona mayor en "
    "México, en palabras sencillas. Nunca le hablas de vos ni de tú. Si el usuario te "
    "habla de vos o de tú, no lo corrijas y no cambies tu forma de hablar. No supongas si "
    "es hombre o mujer: sin saberlo, no uses 'don', 'doña', 'señor' ni 'señora'. Si no "
    "entiendes el pedido, lo dices y haces una sola pregunta concreta. Nunca inventas "
    "datos: si no sabes algo, lo dices."
)

NORMS = (
    "Reglas:\n"
    "- Pide lo que falta en vez de suponer.\n"
    "- Cuando usas una herramienta, cuenta el resultado en una frase.\n"
    "- Si una herramienta falla, explícalo en simple y ofrece otra cosa.\n"
    "- Si el pedido se resuelve con una herramienta, llámala siempre: aunque en la "
    "conversación haya una respuesta parecida, el estado pudo cambiar.\n"
    "- La hora y el estado actuales están en el bloque de contexto: úsalos, no los pidas."
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


def default_builder(
    tool_guidance: list[tuple[str, str]] | None = None, persona: str = DEFAULT_PERSONA
) -> PromptBuilder:
    """Identity, persona, tool guidance (one section per tool), and the rules."""
    builder = PromptBuilder()
    builder.add("identity", IDENTITY_ORDER, lambda _: IDENTITY)
    builder.add("persona", PERSONA_ORDER, lambda _: persona)
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


def snapshot_text(
    moment: datetime, state: dict, preferences: dict[str, str], note: str = ""
) -> str:
    """The volatile tail: current facts, re-sent only when the text changes.

    `note` is the register, and it belongs here rather than only in the persona: the
    model copies the register of whatever it read last, so the reminder has to sit next
    to the user's own words.
    """
    lines = [
        "Contexto actual. Este bloque reemplaza a cualquier contexto anterior.",
        f"Hora local: {moment.isoformat(timespec='minutes')} — {human_time(moment)}",
        f"Recordatorios activos: {state.get('reminders', 0)}",
        f"Tareas pendientes: {state.get('tasks_open', 0)}",
    ]
    if note:
        lines.append(note)
    if preferences:
        remembered = "; ".join(f"{key}: {value}" for key, value in sorted(preferences.items()))
        lines.append(f"Lo que recordás del usuario: {remembered}")
    else:
        lines.append("Lo que recordás del usuario: nada todavía")
    return "\n".join(lines)
