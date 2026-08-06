"""Local intent matching — LLM-free global commands.

The stop path is handled at the protocol level (ClientMessage stop);
these patterns cover the reminder/task vocabulary so that scheduling
controls never depend on a model being responsive:
  - posponer / snooze
  - descartar / dismiss
  - what alarms/reminders do I have
"""

import re
import unicodedata
from dataclasses import dataclass

STOP_PATTERNS = [
    r"\bstop\b",
    r"^detente$",
    r"^detén$",
    r"^para\b",
    r"^alto\b",
    r"^basta\b",
]

SNOOZE_PATTERNS = [
    r"\bposponer\b",
    r"\bpospón\b",
    r"\bpospon\b",
    r"\bsnooze\b",
]

DISMISS_PATTERNS = [
    r"\bdescartar\b",
    r"\bdismiss\b",
    r"\bquitar la alarma\b",
    r"\bdescartar la alarma\b",
]

LIST_REMINDER_PATTERNS = [
    r"qu[eé] alarmas",
    r"qu[eé] recordatorios",
    r"mis alarmas",
    r"mis recordatorios",
    r"what alarms",
    r"what reminders",
    r"list alarms",
    r"list reminders",
]


@dataclass(frozen=True)
class LocalIntent:
    kind: str  # stop | snooze | dismiss | list_reminders
    text: str


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.lower().strip()


def match_intent(text: str) -> LocalIntent | None:
    norm = _normalize(text)
    if any(re.search(p, norm) for p in STOP_PATTERNS):
        return LocalIntent("stop", text)
    if any(re.search(p, norm) for p in SNOOZE_PATTERNS):
        return LocalIntent("snooze", text)
    if any(re.search(p, norm) for p in DISMISS_PATTERNS):
        return LocalIntent("dismiss", text)
    if any(re.search(p, norm) for p in LIST_REMINDER_PATTERNS):
        return LocalIntent("list_reminders", text)
    return None
