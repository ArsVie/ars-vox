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
from datetime import datetime, timedelta

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
# normalizes to "si"). A confirmation utterance resolves the single global
# pending confirmation when one exists; with none pending it is a NORMAL
# message (backlog: "Short replies send") — the funnel in
# runtime.handle_user_text falls through to a regular turn instead of
# swallowing it.
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


# ---------------------------------------------------------------------- #
# R11 (2026-08-14, reviewer round 11 finding 5): the model kept asking
# for the reminder TEXT in plain chat ("Que te recuerdo?") without
# calling reminders.create - so no draft was registered and the user's
# answer derailed into a brand-new request ("no puedo hacer llamadas").
# Deterministic interception: when the user's message is a reminder
# request with a TIME but no TEXT ("poneme un recordatorio para mañana
# a las 9"), the runtime registers the draft itself (LLM-free) and asks
# for the text; the next message completes it. The model is never in the
# loop for the ask, so it cannot derail.
# ---------------------------------------------------------------------- #
_REMINDER_TRIGGER_RE = re.compile(
    r"\b(recordatorio|recordame|recordá|recorda|alarma)\b"
)
# Normalized (accent-stripped, lowercased) Spanish time phrase:
#   [day] a las/a la HH[:MM] [de la mañana|tarde|noche|madrugada]
_DAY_PHRASES = {
    "hoy": 0,
    "manana": 1,
    "pasado manana": 2,
    "el lunes": "mon", "el martes": "tue", "el miercoles": "wed",
    "el jueves": "thu", "el viernes": "fri", "el sabado": "sat",
    "el domingo": "sun",
    "este lunes": "mon", "este martes": "tue", "este miercoles": "wed",
    "este jueves": "thu", "este viernes": "fri", "este sabado": "sat",
    "este domingo": "sun",
}
_TIME_PHRASE_RE = re.compile(
    r"(?P<day>hoy|manana|pasado manana|el lunes|el martes|el miercoles|"
    r"el jueves|el viernes|el sabado|el domingo|este lunes|este martes|"
    r"este miercoles|este jueves|este viernes|este sabado|este domingo)?"
    r"\s*(?:a las|a la)\s+(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?"
    r"\s*(?P<period>de la manana|de la tarde|de la noche|de la madrugada)?"
)
_WEEKDAY_INDEX = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _apply_period(hour: int, period: str | None) -> int:
    """12h clock -> 24h. 'de la tarde'/'de la noche' shift hours 1-11 to
    the afternoon/evening; 'de la manana'/'de la madrugada' stay."""
    if period in ("de la tarde", "de la noche") and 1 <= hour <= 11:
        return hour + 12
    return hour


def match_time_only_reminder(text: str) -> str | None:
    """Local naive YYYY-MM-DDTHH:MM when the message is a reminder
    request with a parseable TIME and NO reminder text - else None.

    Messages that carry their own text (e.g. a las 9 que llame a mi
    nieta) return None: they are complete requests for the model.
    """
    norm = _normalize(text)
    if not _REMINDER_TRIGGER_RE.search(norm):
        return None
    m = _TIME_PHRASE_RE.search(norm)
    if m is None:
        return None
    # The time phrase must be the END of the request: anything after it
    # (other than politeness filler) is the reminder TEXT.
    tail = norm[m.end():].strip(" ,")
    if tail and tail not in ("por favor",):
        return None
    try:
        hour = _apply_period(int(m.group("hour")), m.group("period"))
        minute = int(m.group("minute") or 0)
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return None
    except (TypeError, ValueError):
        return None
    now = datetime.now()
    day = m.group("day")
    if day is None:
        return None
    offset = _DAY_PHRASES.get(day)
    if offset is None:
        return None
    if isinstance(offset, str):
        target = _WEEKDAY_INDEX[offset]
        offset = (target - now.weekday()) % 7 or 7  # next occurrence, >= 1 day
    due = (now + timedelta(days=offset)).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )
    return due.isoformat(timespec="minutes")
