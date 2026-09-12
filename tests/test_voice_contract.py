from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.tts import FakeTTS
from services.arsvox.voice import FakeSpeechToText
from tools.stt_baseline import normalize, word_error_rate


def test_normalize_drops_punctuation_and_case():
    assert normalize("Hola, MUNDO! ¿Qué tal?") == ["hola", "mundo", "qué", "tal"]


def test_normalize_can_strip_accents():
    assert normalize("Qué tal", strip_accents=True) == ["que", "tal"]


def test_wer_perfect_transcript_is_zero():
    result = word_error_rate("ponme música", "Ponme música.")
    assert result["wer"] == 0.0
    assert result["words"] == 2


def test_wer_counts_substitutions():
    result = word_error_rate("uno dos", "uno tres")
    assert result["wer"] == 0.5
    assert (result["substitutions"], result["deletions"], result["insertions"]) == (1, 0, 0)


def test_wer_counts_deletions():
    result = word_error_rate("uno dos tres cuatro", "uno dos cuatro")
    assert result["wer"] == 0.25
    assert (result["substitutions"], result["deletions"], result["insertions"]) == (0, 1, 0)


def test_wer_counts_insertions():
    result = word_error_rate("uno dos", "uno dos tres")
    assert result["wer"] == 0.5
    assert (result["substitutions"], result["deletions"], result["insertions"]) == (0, 0, 1)


def test_wer_ignoring_accents_only_helps_accent_errors():
    result = word_error_rate("música corazón", "musica corazon")
    assert result["wer"] == 1.0
    assert result["wer_ignoring_accents"] == 0.0


def test_fake_stt_reads_text_from_a_file(tmp_path: Path):
    audio = tmp_path / "clip.txt"
    audio.write_text("hola desde el archivo", encoding="utf-8")
    assert FakeSpeechToText().transcribe(audio).text == "hola desde el archivo"


def test_fake_tts_records_what_would_be_spoken(tmp_path: Path):
    engine = FakeTTS()
    engine.synthesize("buenos días", tmp_path / "out.wav")
    assert engine.spoken == ["buenos días"]


@pytest.mark.parametrize("text,expected", [("", 0), ("una palabra", 2)])
def test_normalize_word_counts(text, expected):
    assert len(normalize(text)) == expected
