"""Utterance-level STOP matching — regression guard for the \bpara\b bug.

STOP is a whole-utterance command, never a word inside a sentence.
"Para cocinar pasta" must NOT stop the assistant.
"""

import pytest

from arsvox_agent.local_intents import _is_stop_utterance, match_intent


@pytest.mark.parametrize(
    "utterance",
    [
        "stop",
        "detente",
        "Detén",
        "deten",
        "alto",
        "basta",
        "detente por favor",
        "alto, por favor",
    ],
)
def test_stop_utterances_recognized(utterance):
    assert match_intent(utterance) is not None
    assert match_intent(utterance).kind == "stop"


@pytest.mark.parametrize(
    "utterance",
    [
        "Para cocinar pasta, busca una receta",
        "Abre esto para que pueda leerlo",
        "Pon música para dormir",
        "Busca un video para aprender español",
        "para qué sirve la memoria",
        "El tren para en la próxima estación",
        "Stop haciendo eso, cambia el canal",
        "Detente un momento y piensa",
        "Alto ahí, pero sigue con la música",
        # "para" was removed from the vocabulary entirely (Ars 2026-08-07):
        "para",
        "¡Para!",
        "Para ya",
        "Para, por favor",
    ],
)
def test_stop_word_inside_sentence_not_recognized(utterance):
    assert match_intent(utterance) is None


@pytest.mark.parametrize(
    "utterance",
    [
        "para cocinar",
        "para ti",
        "detente ya mismo y explícame",
        "basta ya de eso",
    ],
)
def test_partial_or_embedded_commands_not_recognized(utterance):
    assert match_intent(utterance) is None


def test_normalization_still_applies():
    # match_intent normalizes (NFKD, lower, trim): accents, case, spaces
    assert match_intent("detén ").kind == "stop"
    assert match_intent("  DETÉNTE  ").kind == "stop"
    assert match_intent("Basta.").kind == "stop"
