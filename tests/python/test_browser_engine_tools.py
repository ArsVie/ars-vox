"""BROWSER-USE INTEGRATION — the tools' engine-first paths.

With an engine in deps.browser_engine, browser.navigate and
browser.dom_action execute IN-PROCESS (never waiting on the desktop)
while STILL emitting the frozen wire events for the user's display
mirror. These tests pin:

  * navigate: policy gate BEFORE any emission; real landing detail from
    the engine's state; no dependence on the browser_state store;
  * dom_action: query/click/set_value/scroll route to the engine;
  * error mapping: blocked / unavailable / timeout / element-missing
    all answer honestly in Spanish;
  * mock mode still wins (the demo path never touches the engine).

The legacy round-trip (engine=None) stays pinned by the existing
test_browser_tools.py — untouched.
"""

import asyncio
from datetime import datetime, timezone

from arsvox_contracts import AppConfig

from arsvox_agent.browser_engine import (
    BrowserBlockedError,
    BrowserElementError,
    BrowserEngineError,
    BrowserTimeoutError,
    NavigationDecision,
)
from arsvox_agent.browser_state import BrowserState
from arsvox_agent.deps import Deps
from arsvox_agent.tools import browser_tools
from arsvox_agent.tools.context import ToolContext

ALLOWLIST = ["youtube.com", "*.youtube.com", "wikipedia.org", "openstreetmap.org"]


class _CaptureBus:
    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


class FakeEngine:
    """Duck-typed BrowserEngine — tools depend only on the methods."""

    def __init__(self, *, allow: bool = True):
        self._allow = allow
        self.navigated: list[str] = []
        self.queries: list[str] = []
        self.clicks: list[str] = []
        self.filled: list[tuple[str, str]] = []
        self.scrolls: list[tuple[str, str | None]] = []
        self.navigate_error: Exception | None = None
        self.op_error: Exception | None = None

    def check_url(self, url: str) -> NavigationDecision:
        return NavigationDecision(self._allow, "ok" if self._allow else "not-allowlisted")

    async def navigate(self, url: str) -> BrowserState:
        if self.navigate_error is not None:
            raise self.navigate_error
        self.navigated.append(url)
        return BrowserState(url=url, title="Página real")

    async def query(self, target: str = "") -> str:
        if self.op_error is not None:
            raise self.op_error
        self.queries.append(target)
        return "Noticias locales: mercado, clima..."

    async def click(self, target: str) -> str:
        if self.op_error is not None:
            raise self.op_error
        self.clicks.append(target)
        return f"Se hizo clic en {target}."

    async def set_value(self, target: str, value: str) -> str:
        if self.op_error is not None:
            raise self.op_error
        self.filled.append((target, value))
        return f"Se escribió en {target}."

    async def scroll(self, target: str = "", value: str | None = None) -> str:
        if self.op_error is not None:
            raise self.op_error
        self.scrolls.append((target, value))
        return "Se desplazó la página."


def _make_context(mock: bool = False, engine: FakeEngine | None = None) -> tuple[ToolContext, _CaptureBus]:
    config = AppConfig()
    config.agent.mock = mock
    bus = _CaptureBus()
    deps = Deps(
        config=config,
        db=None,
        sessions=None,
        notes=None,
        tasks=None,
        reminders=None,
        notifications=None,
        panels=None,
        preferences=None,
        progress=None,
        pending=None,
        documents=None,
        audit=None,
        bus=bus,  # type: ignore[arg-type]
        policy=None,
        confirmations=None,
        tts=None,
        telegram=None,
        browser_engine=engine,  # type: ignore[arg-type]
        run_id="test-run",
        session_id="test-session",
    )
    tctx = ToolContext(deps=deps, run_id="test-run", session_id="test-session", bus=bus)
    return tctx, bus


# --------------------------------------------------------------------- #
# browser.navigate — engine path
# --------------------------------------------------------------------- #


def test_navigate_engine_path_returns_real_landing_and_emits_mirror_event():
    engine = FakeEngine()
    tctx, bus = _make_context(engine=engine)

    result = asyncio.run(browser_tools.browser_navigate(tctx, "https://es.wikipedia.org/wiki/Pasta"))

    assert result == "Navegación completada: https://es.wikipedia.org/wiki/Pasta — Página real"
    # The engine executed — the tool never touched the round-trip store
    # (deps.browser_state is None here and the tool did not fail).
    assert engine.navigated == ["https://es.wikipedia.org/wiki/Pasta"]
    # The frozen mirror events still went on the wire for the desktop:
    # the loading event first, then the REAL landing state (url/title,
    # loading cleared) — the renderer bag reduces both.
    assert len(bus.events) == 2
    ev_loading, ev_landed = bus.events
    assert ev_loading.type == "browser.navigate"
    assert ev_loading.url == "https://es.wikipedia.org/wiki/Pasta"
    assert ev_loading.loading is True
    assert ev_landed.type == "browser.navigate"
    assert ev_landed.url == "https://es.wikipedia.org/wiki/Pasta"
    assert ev_landed.title == "Página real"
    assert ev_landed.loading is False


def test_navigate_blocked_refuses_before_any_emission():
    engine = FakeEngine(allow=False)
    tctx, bus = _make_context(engine=engine)

    result = asyncio.run(browser_tools.browser_navigate(tctx, "https://example.com/"))

    assert result == "Página bloqueada: esta dirección no está permitida (not-allowlisted)."
    # Policy gate ran first: nothing emitted, engine never navigated.
    assert bus.events == []
    assert engine.navigated == []


def test_navigate_engine_unavailable_is_honest():
    engine = FakeEngine()
    engine.navigate_error = BrowserEngineError("no se pudo iniciar Chromium (RuntimeError)")
    tctx, _ = _make_context(engine=engine)

    result = asyncio.run(browser_tools.browser_navigate(tctx, "https://es.wikipedia.org/"))

    assert result == (
        "El navegador local no está disponible "
        "(no se pudo iniciar Chromium (RuntimeError))."
    )


def test_navigate_engine_timeout_is_honest():
    engine = FakeEngine()
    engine.navigate_error = BrowserTimeoutError()
    tctx, _ = _make_context(engine=engine)

    result = asyncio.run(browser_tools.browser_navigate(tctx, "https://es.wikipedia.org/"))

    assert result == "La página tardó demasiado en responder."


def test_navigate_mock_mode_wins_over_the_engine():
    engine = FakeEngine()
    tctx, bus = _make_context(mock=True, engine=engine)

    result = asyncio.run(browser_tools.browser_navigate(tctx, "https://es.wikipedia.org/"))

    assert result.startswith("[mock]")
    assert engine.navigated == []  # the demo path never touches the engine


def test_navigate_empty_url_still_refused_without_emitting():
    engine = FakeEngine()
    tctx, bus = _make_context(engine=engine)

    result = asyncio.run(browser_tools.browser_navigate(tctx, "   "))

    assert "URL no válida" in result
    assert bus.events == []


# --------------------------------------------------------------------- #
# browser.dom_action — engine path
# --------------------------------------------------------------------- #


def test_dom_action_query_routes_to_engine_and_emits_mirror():
    engine = FakeEngine()
    tctx, bus = _make_context(engine=engine)

    result = asyncio.run(browser_tools.browser_dom_action(tctx, "query", target="body"))

    assert result == "Noticias locales: mercado, clima..."
    assert engine.queries == ["body"]
    assert len(bus.events) == 1
    ev = bus.events[-1]
    assert ev.type == "browser.dom_action"
    assert ev.operation == "query"
    assert ev.result is None  # request shape; result comes from the engine


def test_dom_action_ops_route_to_the_engine():
    engine = FakeEngine()
    tctx, _ = _make_context(engine=engine)

    asyncio.run(browser_tools.browser_dom_action(tctx, "click", target="#go"))
    asyncio.run(browser_tools.browser_dom_action(tctx, "set_value", target="#search", value="pasta"))
    asyncio.run(browser_tools.browser_dom_action(tctx, "scroll", value="400"))

    assert engine.clicks == ["#go"]
    assert engine.filled == [("#search", "pasta")]
    assert engine.scrolls == [("", "400")]


def test_dom_action_element_error_returns_the_detail():
    engine = FakeEngine()
    engine.op_error = BrowserElementError("No encontré el elemento '#x' en la página.")
    tctx, _ = _make_context(engine=engine)

    result = asyncio.run(browser_tools.browser_dom_action(tctx, "click", target="#x"))

    assert result == "No encontré el elemento '#x' en la página."


def test_dom_action_engine_unavailable_and_timeout_are_honest():
    engine = FakeEngine()
    engine.op_error = BrowserEngineError("no hay ninguna página abierta")
    tctx, _ = _make_context(engine=engine)
    assert asyncio.run(browser_tools.browser_dom_action(tctx, "query")) == (
        "El navegador local no está disponible (no hay ninguna página abierta)."
    )

    engine.op_error = BrowserTimeoutError()
    assert asyncio.run(browser_tools.browser_dom_action(tctx, "click", target="a")) == (
        "La página tardó demasiado en responder."
    )


def test_dom_action_mock_mode_wins_over_the_engine():
    engine = FakeEngine()
    tctx, bus = _make_context(mock=True, engine=engine)

    result = asyncio.run(browser_tools.browser_dom_action(tctx, "query", target="body"))

    assert result == "[mock] query: body"
    assert engine.queries == []
    assert bus.events[-1].result == result


def test_dom_action_invalid_operation_still_refused_without_emitting():
    engine = FakeEngine()
    tctx, bus = _make_context(engine=engine)

    result = asyncio.run(browser_tools.browser_dom_action(tctx, "hover", target="a"))

    assert "Operación no válida" in result
    assert bus.events == []
