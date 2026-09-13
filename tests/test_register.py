"""The register: which Spanish this product speaks, and the guard against drifting back.

The voseo that was here first had nothing behind it. The evidence: the voice that shipped
before was es-MX, the user's own requests in the old logs ask about Mexicali, and this
machine runs on Mexico time. A register is a setting now, and the copy is checked.
"""

from __future__ import annotations

import io
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox import web  # noqa: E402
from services.arsvox.config import REGISTERS, Settings, load_register  # noqa: E402
from services.arsvox.context import default_builder  # noqa: E402

# Second person of "vos" only: these spellings do not exist in Mexican Spanish.
VOSEO = re.compile(
    r"\b(decime|abrime|poneme|buscame|usala|usalo|usalas|acordate|fijate|decile|escribile|"
    r"contame|decilo|querés|podés|tenés|sabés|volvé|vení|hacé|mirá|anotá|mandá|llevá|tomá|"
    r"andá|dejá|esperá|escuchá|probá|empezá|terminá|cerrá|buscá|seguí|sos)\b",
    re.IGNORECASE,
)
COPY_ROOTS = ("services/arsvox", "apps/cli", "apps/desktop", "tools/w0_utterances.json")


def copy_files() -> list[Path]:
    files: list[Path] = []
    for root in COPY_ROOTS:
        path = REPO_ROOT / root
        if path.is_file():
            files.append(path)
        else:
            files.extend(item for item in path.rglob("*") if item.suffix in {".py", ".js", ".html", ".json"})
    return files


def test_the_shipped_copy_is_not_rioplatense():
    offenders = []
    for path in copy_files():
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if line.lstrip().startswith(("#", "//")):
                continue
            if VOSEO.search(line):
                offenders.append(f"{path.relative_to(REPO_ROOT)}:{number}: {line.strip()[:90]}")
    assert offenders == [], "copy drifted back into voseo:\n" + "\n".join(offenders)


def test_the_default_register_is_mexican():
    assert load_register() == "es-MX"
    assert REGISTERS["es-MX"]["region"] == "mx-es"
    assert REGISTERS["es-MX"]["voice"] == "es-MX-DaliaNeural"
    assert "Le hablas de vos" not in REGISTERS["es-MX"]["persona"]
    assert "Le hablas de usted" in REGISTERS["es-MX"]["persona"]


def test_the_setting_carries_the_register_into_the_persona_and_the_voice():
    settings = Settings(base_url="http://x", model="m", api_key="k", db_path=Path("/tmp/x.db"))
    assert settings.region == "mx-es"
    assert settings.voice == "es-MX-DaliaNeural"
    assert "de usted" in settings.persona
    assert "de usted" in default_builder(persona=settings.persona).render({})


def test_the_tool_copy_speaks_the_way_the_model_speaks(tmp_path):
    """The model answers an elderly user with usted; the tool sentences said dime."""
    source = (REPO_ROOT / "services" / "arsvox" / "tools.py").read_text(encoding="utf-8")
    assert "Dígame a qué hora" in source and "Dime a qué hora" not in source
    assert "Dígame si lo paro" in source
    assert "Dígame cuál abro" in source


def test_the_other_register_is_still_reachable(monkeypatch):
    monkeypatch.setenv("ARSVOX_REGISTER", "es-AR")
    assert load_register() == "es-AR"
    assert REGISTERS["es-AR"]["region"] == "ar-es"
    monkeypatch.setenv("ARSVOX_REGISTER", "es-PT")
    with pytest.raises(Exception):
        load_register()


def test_the_search_asks_for_mexican_results(monkeypatch):
    seen: dict[str, str] = {}

    def fake_urlopen(request, timeout=None):  # noqa: ANN001
        seen["url"] = request.full_url if hasattr(request, "full_url") else str(request)
        return io.BytesIO(b"<html></html>")

    monkeypatch.setattr(web.urllib.request, "urlopen", fake_urlopen)
    web.search("clima de hoy", region="mx-es")
    assert "kl=mx-es" in seen["url"]


def test_the_register_note_reaches_the_model_before_the_request(tmp_path):
    """The context block carries the register, and the request stays last."""
    from services.arsvox.model import FakeModel, ModelReply
    from services.arsvox.runtime import Runtime
    from services.arsvox.store import Store

    settings = Settings(base_url="http://x", model="fake", api_key="k", db_path=tmp_path / "r.db")
    store = Store(settings.db_path)
    seen: list[list[dict]] = []

    class Spy(FakeModel):
        def complete(self, messages, tools, **kwargs):  # noqa: ANN001
            seen.append([dict(message) for message in messages])
            return ModelReply(text="listo")

    runtime = Runtime(settings, store, Spy([ModelReply(text="listo")]))
    runtime.turn("cli", "decime qué tengo que hacer hoy")
    messages = seen[-1]
    contents = [str(message.get("content") or "") for message in messages]
    assert contents[-1] == "decime qué tengo que hacer hoy"
    note_index = next(i for i, text in enumerate(contents) if "Cómo le hablas" in text)
    assert note_index < len(contents) - 1
    assert "de usted, en español de México" in contents[note_index]
    store.close()
