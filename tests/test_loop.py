"""The loop: projection, tool execution, validation, caps, resume, prefix stability."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.config import Settings, load_settings  # noqa: E402
from services.arsvox.context import PromptBuilder, interpolate, snapshot_text  # noqa: E402
from services.arsvox.model import FakeModel, ModelReply, ToolCall, Usage  # noqa: E402
from services.arsvox.limits import signature  # noqa: E402
from services.arsvox.runtime import Runtime  # noqa: E402
from services.arsvox.store import Store, project  # noqa: E402


def settings(tmp_path: Path) -> Settings:
    return Settings(
        base_url="http://localhost",
        model="fake",
        api_key="test",
        db_path=tmp_path / "arsvox.db",
        max_steps=4,
    )


def tool_call(name: str, arguments: dict, call_id: str = "c1") -> ModelReply:
    return ModelReply(text="", tool_calls=[ToolCall(id=call_id, name=name, arguments=arguments)])


def runtime(tmp_path: Path, replies: list[ModelReply], **kwargs) -> tuple[Runtime, FakeModel, Store]:
    config = settings(tmp_path)
    store = Store(config.db_path)
    model = FakeModel(replies)
    return Runtime(config, store, model, **kwargs), model, store


# ---- the log and its projection -----------------------------------------

def test_projection_rule_maps_every_kind():
    from services.arsvox.store import Event

    assert project(Event(1, "t", "s", "user_text", {"text": "hola"})) == {
        "role": "user", "content": "hola"}
    assert project(Event(2, "t", "s", "assistant_text", {"text": "buenas"})) == {
        "role": "assistant", "content": "buenas"}
    tool_result = project(Event(3, "t", "s", "tool_result", {"call_id": "c1", "text": "ok"}))
    assert tool_result == {"role": "tool", "tool_call_id": "c1", "content": "ok"}
    assert project(Event(4, "t", "s", "model_usage", {"prompt_tokens": 5})) is None


def test_resume_rebuilds_the_same_history(tmp_path: Path):
    loop, _, store = runtime(
        tmp_path, [tool_call("tasks_add", {"text": "comprar pan"}), ModelReply(text="Listo, anotado.")]
    )
    loop.turn("cli", "anotá comprar pan")
    before = loop.messages("cli")
    store.close()

    reopened = Store(settings(tmp_path).db_path)
    model = FakeModel([ModelReply(text="sigo acá")])
    loop_after_restart = Runtime(settings(tmp_path), reopened, model)
    assert loop_after_restart.messages("cli") == before


def test_second_request_extends_the_first_byte_for_byte(tmp_path: Path):
    loop, model, _ = runtime(
        tmp_path,
        [
            tool_call("tasks_add", {"text": "uno"}),
            ModelReply(text="Anotado."),
            ModelReply(text="Cómo estás."),
        ],
    )
    loop.turn("cli", "anotá uno")
    loop.turn("cli", "qué tal")
    first, second = model.requests[0], model.requests[1]
    assert second[: len(first)] == first


# ---- the turn ------------------------------------------------------------

def test_tool_call_reaches_the_store_and_the_answer_is_recorded(tmp_path: Path):
    loop, _, store = runtime(
        tmp_path,
        [
            tool_call("reminders_set", {"text": "tomar la pastilla", "when_local": "2026-09-12T20:00"}),
            ModelReply(text="Listo, te lo recuerdo a las ocho."),
        ],
    )
    result = loop.turn("cli", "recordame tomar la pastilla a las ocho de la noche")
    assert result.text == "Listo, te lo recuerdo a las ocho."
    assert [t.name for t in result.tools] == ["reminders_set"]
    assert len(store.list_reminders("cli")) == 1
    assert store.events("cli")[-1].kind == "assistant_text"


def test_a_refusal_reaches_the_model_as_a_tool_result(tmp_path: Path):
    loop, model, _ = runtime(
        tmp_path,
        [tool_call("reminders_cancel", {"reminder_id": "abc"}), ModelReply(text="¿Cuál borro?")],
    )
    result = loop.turn("cli", "borrá el recordatorio")
    assert result.tools[0].ran is False
    assert "entero" in result.tools[0].result
    assert "entero" in model.requests[1][-1]["content"]


def test_bad_arguments_are_refused_with_a_readable_reason(tmp_path: Path):
    loop, _, _ = runtime(
        tmp_path,
        [tool_call("reminders_set", {"when_local": "mañana"}), ModelReply(text="Decime qué recuerdo.")],
    )
    result = loop.turn("cli", "recordame algo")
    assert result.tools[0].ran is False
    assert "faltan datos: text" in result.tools[0].result


def test_unparseable_date_is_refused_before_anything_is_stored(tmp_path: Path):
    loop, model, store = runtime(
        tmp_path,
        [
            tool_call("reminders_set", {"text": "pagar la luz", "when_local": "mañana"}),
            ModelReply(text="¿A qué hora?"),
        ],
    )
    result = loop.turn("cli", "recordame pagar la luz mañana")
    assert result.tools[0].ran is True
    assert "no entendí la fecha" in result.tools[0].result
    # nothing half-stored: the model gets one chance to send a real time instead
    assert store.list_reminders("cli") == []
    assert "no entendí la fecha" in model.requests[1][-1]["content"]


def test_repeating_the_same_call_stops_the_turn(tmp_path: Path):
    loop, _, _ = runtime(
        tmp_path,
        [tool_call("tasks_list", {}), tool_call("tasks_list", {}), tool_call("tasks_list", {})],
    )
    result = loop.turn("cli", "qué tengo que hacer")
    assert result.error and "repitió" in result.error
    assert "repitiendo lo mismo" in result.text


def test_step_budget_ends_a_long_turn(tmp_path: Path):
    replies = [tool_call("tasks_add", {"text": f"t{i}"}, call_id=f"c{i}") for i in range(6)]
    loop, _, _ = runtime(tmp_path, replies, max_steps=2)
    result = loop.turn("cli", "anotá cosas")
    assert result.error and "límite" in result.error


def test_snapshot_is_only_appended_when_it_changes(tmp_path: Path):
    loop, _, store = runtime(tmp_path, [ModelReply(text="Hola."), ModelReply(text="Otra vez.")])
    loop.turn("cli", "hola")
    first = [e for e in store.events("cli") if e.kind == "runtime_snapshot"]
    loop.turn("cli", "hola de nuevo")
    second = [e for e in store.events("cli") if e.kind == "runtime_snapshot"]
    assert len(second) >= len(first)
    assert len(second) - len(first) <= 1


# ---- context units and argument validation -------------------------------

def test_prompt_sections_drop_empty_and_keep_order():
    builder = PromptBuilder()
    builder.add("identity", -100, lambda _: "soy el asistente")
    builder.add("silent", 50, lambda _: "")
    builder.add("tail", 200, lambda _: "último")
    assert builder.render({}) == "soy el asistente\n\núltimo"
    assert builder.section_names() == ["identity", "silent", "tail"]


def test_unknown_variable_raises_instead_of_shipping_a_hole():
    with pytest.raises(KeyError):
        interpolate("hola {{quien}}", {})
    assert interpolate("hola {{quien}}", {"quien": "Ana"}) == "hola Ana"


def test_snapshot_carries_time_and_counts():
    text = snapshot_text(datetime(2026, 9, 12, 20, 0).astimezone(), {"reminders": 2, "tasks_open": 1},
                         {"musica": "jazz"})
    assert "Recordatorios activos: 2" in text
    assert "Tareas pendientes: 1" in text
    assert "jazz" in text


def test_unknown_tool_is_reported_without_a_policy_layer(tmp_path: Path):
    loop, _, _ = runtime(tmp_path, [tool_call("ls", {"p": "/"}), ModelReply(text="Esa no la tengo.")])
    result = loop.turn("cli", "listá el disco")
    assert result.tools[0].ran is False
    assert "No existe la herramienta" in result.tools[0].result


def test_tool_signature_is_stable_across_key_order():
    assert signature("tasks_add", {"text": "a", "id": 1}) == signature("tasks_add", {"id": 1, "text": "a"})


def test_usage_cache_split_never_exceeds_the_prompt():
    usage = Usage(prompt_tokens=100, cached_tokens=140)
    assert usage.uncached_prompt_tokens == 0
    assert usage.cache_hit_rate == 1.4


def test_settings_load_without_a_key_raises(monkeypatch, tmp_path: Path):
    for name in ("ARSVOX_API_KEY", "LILY_TOKEN", "COMMANDCODE_API_KEY", "OPENCODE_GO_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("services.arsvox.config.ENV_FILES", ())
    with pytest.raises(Exception):
        load_settings(db_path=tmp_path / "x.db")
