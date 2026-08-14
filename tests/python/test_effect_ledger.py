"""EffectLedger (Cordis lane A1): per-run revertible effects.

Unit scope:
  * EffectLedger semantics — LIFO rollback, idempotence (each inverse at
    most once, second rollback a no-op), failure isolation (a failing
    inverse never stops its siblings), arming tokens, cancellation
    propagation.
  * The opt-in pair table (inverse_for / inverted_tools) — including the
    deliberate omissions: document.create / tasks.add have NO registered
    delete/remove tool, and telegram.* / reminders.* are emissions; none
    of them may ever record an inverse.

Integration scope (the seams runtime.py exposes):
  * _instrumented_registry: model-visible tools get recording wrappers
    while the SHARED registry (execute_direct / approval executor) keeps
    the original handlers — verified by driving the real media handlers
    end-to-end: media.play_youtube records the inverse, rollback stops the media
    controller through the real execute_direct path.
  * _run_turn: fresh ledger per turn; abort (exception or cancellation)
    rolls back; normal completion keeps effects; cancellation is silent
    (no ErrorEvent).
"""

import asyncio

import pytest

from arsvox_contracts import AppConfig, ErrorEvent, MediaState
from arsvox_contracts.enums import MediaKind, MediaSource
from arsvox_contracts.events import MediaSearchResult

from arsvox_agent.deps import Deps
from arsvox_agent.effect_ledger import EffectLedger, inverse_for, inverted_tools
from arsvox_agent.media import media_controller, reset_media_controller
from arsvox_agent.policy import PolicyEngine
from arsvox_agent.runtime import AgentRuntime
from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools import media_tools
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.media_tools import reset_offered_results
from arsvox_agent.tools.register import register_all


# --------------------------------------------------------------------- #
# helpers

def _async_append(calls: list, name: str):
    async def _inverse():
        calls.append(name)

    return _inverse


class _CaptureBus:
    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


class _FakePanels:
    def __init__(self) -> None:
        self.upserted: list[tuple[str, str]] = []

    def upsert(self, panel_type: str, title: str) -> None:
        self.upserted.append((panel_type, title))


@pytest.fixture(autouse=True)
def _clean_media():
    reset_media_controller()
    reset_offered_results()
    yield
    reset_media_controller()
    reset_offered_results()


def _offer(video_id: str = "dQw4w9WgXcQ", title: str = "Taller de carpintería para principiantes") -> None:
    """Seed the offered set — the 'the agent already searched'
    precondition for media.play (same helper pattern as test_media_tools)."""
    media_tools._last_offered.append(
        MediaSearchResult(
            id=video_id,
            title=title,
            source=MediaSource.YOUTUBE,
            kind=MediaKind.VIDEO,
            channel="El Taller de Marta",
            duration_s=742,
            published="hace 3 días",
            thumbnail_url=None,
        )
    )


def _make_deps(bus: _CaptureBus, panels: _FakePanels, policy=None) -> Deps:
    return Deps(
        config=AppConfig(),
        db=None,
        sessions=None,
        notes=None,
        tasks=None,
        reminders=None,
        notifications=None,
        panels=panels,
        preferences=None,
        progress=None,
        pending=None,
        documents=None,
        audit=None,
        bus=bus,  # type: ignore[arg-type]
        policy=policy,
        confirmations=None,
        tts=None,
        telegram=None,
        run_id="turn-1",
        session_id="sess-1",
    )


def _make_media_world(policy=None) -> tuple[_CaptureBus, Deps, ToolRegistry]:
    bus = _CaptureBus()
    deps = _make_deps(bus, _FakePanels(), policy=policy)
    registry = ToolRegistry()
    register_all(registry)
    registry.attach_deps(deps)
    return bus, deps, registry


def _make_runtime(bus=None) -> tuple[AgentRuntime, _CaptureBus]:
    """Minimal runtime for _run_turn wiring tests: _turn is always
    monkeypatched, so only pending (settle_to_terminal) + bus are live."""
    bus = bus or _CaptureBus()
    deps = type("Deps", (), {"pending": type("P", (), {"list_pending": lambda self: []})(), "audit": None})()
    runtime = AgentRuntime(config=AppConfig(), deps_base=deps, registry=ToolRegistry(), bus=bus)
    runtime.pipeline = None
    return runtime, bus


# --------------------------------------------------------------------- #
# EffectLedger unit semantics

def test_rollback_runs_inverses_lifo():
    async def scenario():
        ledger = EffectLedger()
        calls = []
        ledger.add("a", _async_append(calls, "a"))
        ledger.add("b", _async_append(calls, "b"))
        ledger.add("c", _async_append(calls, "c"))
        await ledger.rollback()
        return calls

    assert asyncio.run(scenario()) == ["c", "b", "a"]


def test_rollback_is_idempotent():
    ledger = EffectLedger()
    calls = []
    ledger.add("a", _async_append(calls, "a"))
    asyncio.run(ledger.rollback())
    asyncio.run(ledger.rollback())
    assert calls == ["a"]


def test_inverse_failure_does_not_stop_siblings():
    async def _boom():
        raise RuntimeError("undo failed")

    async def scenario():
        ledger = EffectLedger()
        calls = []
        ledger.add("a", _async_append(calls, "a"))
        ledger.add("b", _boom)
        ledger.add("c", _async_append(calls, "c"))
        # rollback must NOT raise: teardown never fails the teardown.
        await ledger.rollback()
        return calls

    assert asyncio.run(scenario()) == ["c", "a"]


def test_disarmed_token_is_skipped():
    ledger = EffectLedger()
    calls = []
    token = ledger.add("a", _async_append(calls, "a"))
    token.disarm()
    asyncio.run(ledger.rollback())
    assert calls == []
    assert not ledger.has_armed("a")


def test_has_armed_tracks_armed_entries():
    ledger = EffectLedger()
    assert not ledger.has_armed("media.play_youtube")
    ledger.add("media.play_youtube", _async_append([], "x"))
    assert ledger.has_armed("media.play_youtube")
    asyncio.run(ledger.rollback())
    assert not ledger.has_armed("media.play_youtube")


def test_rollback_empty_ledger_is_noop():
    asyncio.run(EffectLedger().rollback())


def test_rollback_propagates_cancellation_but_previous_inverses_ran():
    async def _cancel_me():
        raise asyncio.CancelledError()

    async def scenario():
        ledger = EffectLedger()
        calls = []
        ledger.add("a", _async_append(calls, "a"))
        ledger.add("b", _cancel_me)
        ledger.add("c", _async_append(calls, "c"))
        with pytest.raises(asyncio.CancelledError):
            await ledger.rollback()
        return calls

    # LIFO: c runs, b cancels the walk, a never runs.
    assert asyncio.run(scenario()) == ["c"]


# --------------------------------------------------------------------- #
# Opt-in pair table (what may record, and the deliberate omissions)

def test_inverted_tools_only_wired_pairs():
    assert "media.play_youtube" in inverted_tools()
    # Omitted pairs must NEVER record: no registered inverse tool
    # (document.delete / tasks.remove do not exist) or emissions.
    for tool in (
        "document.create",
        "document.save",
        "document.insert_text",
        "tasks.add",
        "tasks.complete",
        "notes.add",
        "telegram.send_pending",
        "telegram.prepare_message",
        "reminders.create",
        "media.pause",
        "media.seek",
        "media.set_volume",
        "media.stop",
    ):
        assert tool not in inverted_tools(), tool


def test_inverse_for_media_play_success():
    assert inverse_for(
        "media.play_youtube",
        {"result_id": "dQw4w9WgXcQ"},
        "Reproduciendo: Taller de carpintería para principiantes",
    ) == ("media.stop", {})


def test_inverse_for_failed_effect_records_nothing():
    # honest refusals / validation errors: no effect -> no inverse
    assert inverse_for("media.play_youtube", {"result_id": "xyz"}, "No conozco ese resultado: busca primero y elige uno de los resultados ofrecidos.") is None
    assert inverse_for("media.play_youtube", {"result_id": "bad"}, "El resultado «bad» no es un id de vídeo de YouTube válido.") is None


def test_inverse_for_omitted_tools_is_none():
    assert inverse_for("document.create", {"title": "recetas"}, "Documento 'recetas' creado y abierto.") is None
    assert inverse_for("tasks.add", {"title": "comprar pan"}, "Tarea agregada: comprar pan (#7).") is None
    assert inverse_for("telegram.send_pending", {"text": "hola"}, "ok") is None
    assert inverse_for("reminders.create", {"text": "x"}, "ok") is None


# --------------------------------------------------------------------- #
# Recording seam: instrumented registry + real media handlers

def test_media_play_records_inverse_and_rollback_stops_media():
    _offer()
    bus, deps, registry = _make_media_world()
    runtime = AgentRuntime(config=AppConfig(), deps_base=deps, registry=registry, bus=bus)
    ledger = EffectLedger()
    runtime._run_ledger = ledger
    instrumented = runtime._instrumented_registry()
    tctx = ToolContext(deps=deps, run_id="turn-1", session_id="sess-1", bus=bus)

    out = asyncio.run(instrumented.get("media.play_youtube").handler(tctx, result_id="dQw4w9WgXcQ"))

    assert out.startswith("Reproduciendo:")
    assert media_controller.state == MediaState.PLAYING
    assert len(ledger) == 1
    assert ledger.has_armed("media.play_youtube")

    asyncio.run(ledger.rollback())

    # the inverse rode the real execute_direct path (media.stop handler)
    assert media_controller.state == MediaState.STOPPED
    assert not ledger.has_armed("media.play_youtube")
    assert any(getattr(e, "tool", None) == "media.stop" for e in bus.events)


def test_media_play_records_at_most_one_inverse_per_run():
    _offer()
    _offer(video_id="9bZkp7q19f0", title="Cómo lijar madera sin errores")
    bus, deps, registry = _make_media_world()
    runtime = AgentRuntime(config=AppConfig(), deps_base=deps, registry=registry, bus=bus)
    ledger = EffectLedger()
    runtime._run_ledger = ledger
    instrumented = runtime._instrumented_registry()
    tctx = ToolContext(deps=deps, run_id="turn-1", session_id="sess-1", bus=bus)

    asyncio.run(instrumented.get("media.play_youtube").handler(tctx, result_id="dQw4w9WgXcQ"))
    asyncio.run(instrumented.get("media.play_youtube").handler(tctx, result_id="9bZkp7q19f0"))

    # "clear media ONLY when the same run opened it" — one armed inverse
    assert len(ledger) == 1
    assert ledger.has_armed("media.play_youtube")
    asyncio.run(ledger.rollback())
    assert media_controller.state == MediaState.STOPPED


def test_media_play_via_execute_gated_records_inverse():
    # the full model-visible path: execute_gated -> _run_handler ->
    # recording wrapper -> original handler
    _offer()
    bus, deps, registry = _make_media_world(policy=PolicyEngine())
    runtime = AgentRuntime(config=AppConfig(), deps_base=deps, registry=registry, bus=bus)
    ledger = EffectLedger()
    runtime._run_ledger = ledger
    instrumented = runtime._instrumented_registry()
    tctx = ToolContext(deps=deps, run_id="turn-1", session_id="sess-1", bus=bus)

    out = asyncio.run(
        instrumented.execute_gated(instrumented.get("media.play_youtube"), tctx, {"result_id": "dQw4w9WgXcQ"})
    )

    assert out.startswith("Reproduciendo:")
    assert ledger.has_armed("media.play_youtube")


def test_shared_registry_handlers_are_not_wrapped():
    bus, deps, registry = _make_media_world(policy=PolicyEngine())
    runtime = AgentRuntime(config=AppConfig(), deps_base=deps, registry=registry, bus=bus)
    runtime._run_ledger = EffectLedger()
    instrumented = runtime._instrumented_registry()

    wrapped = instrumented.get("media.play_youtube")
    assert wrapped.handler is not registry.get("media.play_youtube").handler
    assert wrapped.handler.__wrapped__ is registry.get("media.play_youtube").handler
    # non-opted-in specs pass through as the SAME object
    assert instrumented.get("document.create") is registry.get("document.create")
    assert instrumented.get("telegram.send_pending") is registry.get("telegram.send_pending")


def test_execute_direct_never_records_inverses():
    # the approval executor's gate-bypassed path runs ORIGINAL handlers
    # on the shared registry: even with a live turn ledger, nothing is
    # recorded for approved-snapshot executions.
    _offer()
    bus, deps, registry = _make_media_world()
    runtime = AgentRuntime(config=AppConfig(), deps_base=deps, registry=registry, bus=bus)
    runtime._run_ledger = EffectLedger()

    out = asyncio.run(registry.execute_direct("media.play_youtube", {"result_id": "dQw4w9WgXcQ"}, run_id="approved"))

    assert out.startswith("Reproduciendo:")
    assert len(runtime._run_ledger) == 0


def test_completed_turn_keeps_media_playing():
    # product invariant: media stays after a turn; only abort rolls back
    _offer()
    bus, deps, registry = _make_media_world()
    runtime = AgentRuntime(config=AppConfig(), deps_base=deps, registry=registry, bus=bus)
    ledger = EffectLedger()
    runtime._run_ledger = ledger
    instrumented = runtime._instrumented_registry()
    tctx = ToolContext(deps=deps, run_id="turn-1", session_id="sess-1", bus=bus)

    asyncio.run(instrumented.get("media.play_youtube").handler(tctx, result_id="dQw4w9WgXcQ"))
    assert media_controller.state == MediaState.PLAYING

    # normal completion: ledger dropped, never rolled back
    runtime._run_ledger = None
    assert media_controller.state == MediaState.PLAYING


# --------------------------------------------------------------------- #
# Runtime wiring: _run_turn abort paths

def test_turn_exception_rolls_back():
    runtime, bus = _make_runtime()
    calls = []

    async def fake_turn(text):
        runtime._run_ledger.add("fake", _async_append(calls, "undo"))
        raise RuntimeError("boom")

    runtime._turn = fake_turn
    asyncio.run(runtime._run_turn("hola"))

    assert calls == ["undo"]
    assert runtime._run_ledger is None
    assert any(isinstance(e, ErrorEvent) for e in bus.events)


def test_turn_cancel_rolls_back_silently():
    runtime, bus = _make_runtime()
    calls = []

    async def scenario():
        started = asyncio.Event()

        async def fake_turn(text):
            runtime._run_ledger.add("fake", _async_append(calls, "undo"))
            started.set()
            await asyncio.sleep(3600)

        runtime._turn = fake_turn
        task = asyncio.create_task(runtime._run_turn("hola"))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(scenario())

    assert calls == ["undo"]
    assert runtime._run_ledger is None
    # cancellation is silent: no ErrorEvent, no false failure
    assert not any(isinstance(e, ErrorEvent) for e in bus.events)


def test_turn_normal_completion_keeps_effects():
    runtime, bus = _make_runtime()
    calls = []

    async def fake_turn(text):
        runtime._run_ledger.add("fake", _async_append(calls, "undo"))

    runtime._turn = fake_turn
    asyncio.run(runtime._run_turn("hola"))

    assert calls == []
    assert runtime._run_ledger is None
    assert not any(isinstance(e, ErrorEvent) for e in bus.events)


def test_fresh_ledger_per_turn():
    runtime, _ = _make_runtime()
    seen = []

    async def fake_turn(text):
        seen.append(runtime._run_ledger)

    runtime._turn = fake_turn
    asyncio.run(runtime._run_turn("uno"))
    asyncio.run(runtime._run_turn("dos"))

    assert len(seen) == 2
    assert seen[0] is not None and seen[1] is not None
    assert seen[0] is not seen[1]
