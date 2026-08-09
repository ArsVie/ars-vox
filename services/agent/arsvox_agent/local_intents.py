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

STOP_UTTERANCES = {
    "stop",
    "detente",
    "deten",
    "alto",
    "basta",
}

# NOTE: "para" is deliberately NOT in the vocabulary — it is one of the
# most common Spanish words ("para cocinar", "para que pueda leerlo")
# and even as an exact utterance it is too risky for a voice assistant
# (Ars's decision, 2026-08-07). All entries are post-_normalize forms
# (accent-stripped, lowercased).

# STOP is an utterance-level command: the whole (normalized) utterance
# must BE the command, optionally with politeness filler. Word-boundary
# regexes are NOT used because "para" mid-sentence is one of the most
# common Spanish words ("para cocinar", "para que pueda leerlo").
STOP_POLITENESS_SUFFIXES = (" por favor", "por favor")

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

# R35 (GATE-3.5): spoken confirmation vocabulary. Same discipline as STOP:
# whole-utterance, accent-stripped, optional politeness filler. These
# entries are post-_normalize forms (lowercased, accent-stripped — "sí"
# normalizes to "si"). A confirmation utterance only ever resolves the
# single global pending confirmation; with none pending it is IGNORED
# (R36 — conservative: never approve random things, never start a turn
# on a bare sí/no).
CONFIRM_UTTERANCES = {
    "confirmar",
    "confirmo",
    "si",
    "si enviar",
    "aprobar",
}

REJECT_UTTERANCES = {
    "cancelar",
    "rechazar",
    "no",
    "no enviar",
}

# Note: "sí enviar" / "no enviar" deliberately mirror the telegram
# confirmation copy ("confirmar envío"). Longer phrasings ("sí, envíalo",
# "cancelar la acción") are NOT in the frozen vocabulary — they fall
# through to the normal model turn, exactly like STOP's word-boundary rule.


@dataclass(frozen=True)
class LocalIntent:
    kind: str  # stop | snooze | dismiss | list_reminders
    text: str


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    # strip common punctuation so "¡Para!", "para, por favor" and
    # "detente." all normalize to their plain command forms.
    text = text.translate(str.maketrans("", "", "¡!¿?.,;:()[]"))
    return text.lower().strip()


def _is_stop_utterance(norm: str) -> bool:
    """True only when the whole utterance IS a stop command (optionally
    with trailing politeness filler) — never a word inside a sentence."""
    if norm in STOP_UTTERANCES:
        return True
    for suffix in STOP_POLITENESS_SUFFIXES:
        if norm.endswith(suffix):
            core = norm[: -len(suffix)].rstrip(" ,")
            if core in STOP_UTTERANCES:
                return True
    return False


def _is_confirmation_utterance(norm: str, vocabulary: set[str]) -> bool:
    """Whole-utterance match against a confirmation vocabulary, with the
    same politeness-filler rule as STOP. Never a word inside a sentence:
    'sí, quiero' or 'no sé' must not resolve a confirmation (R36)."""
    if norm in vocabulary:
        return True
    for suffix in STOP_POLITENESS_SUFFIXES:
        if norm.endswith(suffix):
            core = norm[: -len(suffix)].rstrip(" ,")
            if core in vocabulary:
                return True
    return False


def match_confirmation_utterance(text: str) -> str | None:
    """R35/R36: 'approve' | 'reject' | None for a spoken/typed
    confirmation utterance (whole-utterance, accent-stripped).

    Returning a decision does NOT approve anything — the caller must
    resolve the currently pending confirmation; with none pending the
    utterance is ignored (R36)."""
    norm = _normalize(text)
    if _is_confirmation_utterance(norm, CONFIRM_UTTERANCES):
        return "approve"
    if _is_confirmation_utterance(norm, REJECT_UTTERANCES):
        return "reject"
    return None


def match_intent(text: str) -> LocalIntent | None:
    norm = _normalize(text)
    if _is_stop_utterance(norm):
        return LocalIntent("stop", text)
    if any(re.search(p, norm) for p in SNOOZE_PATTERNS):
        return LocalIntent("snooze", text)
    if any(re.search(p, norm) for p in DISMISS_PATTERNS):
        return LocalIntent("dismiss", text)
    if any(re.search(p, norm) for p in LIST_REMINDER_PATTERNS):
        return LocalIntent("list_reminders", text)
    return None
