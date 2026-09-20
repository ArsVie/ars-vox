"""The voice never lets Azure's date normalizer eat a number (de 471 -> abril de 71)."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.tts import speakable  # noqa: E402


def test_the_date_trap_is_spelled_away():
    assert speakable("Página 13 de 471.") == "Página trece de cuatrocientos setenta y uno."
    assert speakable("va en la página 13 de 500") == "va en la página trece de quinientos"


def test_plain_numbers():
    assert speakable("8") == "ocho"
    assert speakable("100") == "cien"
    assert speakable("101") == "ciento uno"
    assert speakable("1527") == "mil quinientos veintisiete"
    assert speakable("21000") == "veintiún mil"
    assert speakable("31 de agosto") == "treinta y uno de agosto"
    assert speakable("2026") == "dos mil veintiséis"


def test_decimals_and_long_ids_keep_their_digits():
    assert speakable("Compra 17,20 - Venta 17,60") == "Compra 17,20 - Venta 17,60"
    assert speakable("1.500 pesos") == "1.500 pesos"
    assert speakable("id 1234567890") == "id 1234567890"
