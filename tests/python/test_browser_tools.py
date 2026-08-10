"""GATE-5 W2-DRIVE — browser.dom_action tool: the agent DOM bridge.

Pins the producer half of the round-trip:
  * the tool is registered (SPECS -> registry) with a REVERSIBLE policy
    kind (policy.py TOOL_KINDS carries the same classification);
  * it emits the FROZEN browser.dom_action wire shape (operation, target,
    value, result, created_at) on the bus;
  * the real path emits result=None (the request) and AWAITS the
    execution result Electron main pushes back (keyed by the event's own
    created_at) — the model sees the actual page result, not a fake
    "done";
  * a desktop that never answers (or no store wired) yields an honest
    no-response message after a bounded wait;
  * mock mode (the demo path) emits the SAME shape with a canned result
    explicitly marked "[mock]";
  * invalid operations are refused honestly, without emitting.
"""

import asyncio
from datetime import datetime, timezone

from arsvox_contracts import AppConfig, PolicyKind
from arsvox_contracts.events import BrowserDomActionEvent, BrowserNavigateEvent

from arsvox_agent.browser_state import BrowserStatePayload, BrowserStateStore, DomActionResultStore
from arsvox_agent.deps import Deps
from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools import browser_tools
from arsvox_agent.tools.context import ToolContext

NO_RESPONSE = browser_tools._NO_RESPONSE
NAV_NO_RESPONSE = browser_tools._NAV_NO_RESPONSE

FROZEN_FIELDS = {"type", "operation", "target", "value", "result", "created_at"}
NAV_FROZEN_FIELDS = {
    "type",
    "url",
    "title",
    "can_go_back",
    "can_go_forward",
    "loading",
    "created_at",
}


class _CaptureBus:
    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


def _make_context(
    mock: bool = False,
    browser_dom: DomActionResultStore | None = None,
    browser_state: BrowserStateStore | None = None,
) -> tuple[ToolContext, _CaptureBus]:
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
        browser_dom=browser_dom,
        browser_state=browser_state,
        run_id="test-run",
        session_id="test-session",
    )
    tctx = ToolContext(deps=deps, run_id="test-run", session_id="test-session", bus=bus)
    return tctx, bus


def _assert_frozen_shape(ev: BrowserDomActionEvent) -> None:
    """Frozen wire field set — exactly these keys, nothing else."""
    assert isinstance(ev, BrowserDomActionEvent)
    assert set(ev.model_dump().keys()) == FROZEN_FIELDS
    assert ev.type == "browser.dom_action"


def _assert_frozen_navigate_shape(ev: BrowserNavigateEvent) -> None:
    """Frozen wire field set — exactly these keys, nothing else."""
    assert isinstance(ev, BrowserNavigateEvent)
    assert set(ev.model_dump().keys()) == NAV_FROZEN_FIELDS
    assert ev.type == "browser.navigate"


# --------------------------------------------------------------------- #
# Registration + policy
# --------------------------------------------------------------------- #


def test_browser_dom_action_registered_with_reversible_kind():
    registry = ToolRegistry()
    for spec in browser_tools.SPECS:
        registry.register(spec)
    spec = registry.get("browser.dom_action")
    assert spec is not None
    assert spec.kind == PolicyKind.REVERSIBLE
    assert spec.handler is browser_tools.browser_dom_action


# --------------------------------------------------------------------- #
# The real path: emit request -> await the desktop's execution result
# --------------------------------------------------------------------- #


def test_emits_frozen_request_shape_and_awaits_the_real_result():
    store = DomActionResultStore()

    async def scenario() -> str:
        tctx, bus = _make_context(browser_dom=store)
        task = asyncio.create_task(
            browser_tools.browser_dom_action(tctx, "query", target="body")
        )
        await asyncio.sleep(0)  # let the tool emit the request
        ev = bus.events[-1]
        _assert_frozen_shape(ev)
        assert ev.operation == "query"
        assert ev.target == "body"
        assert ev.value is None
        # The REQUEST carries no result yet — the desktop's answer comes
        # back through the store (main's PUT /api/browser-dom-result).
        assert ev.result is None
        assert isinstance(ev.created_at, datetime)
        # Electron main pushes the real page text back.
        store.update(ev.created_at, "Noticias locales: mercado, clima...")
        return await task

    result = asyncio.run(scenario())
    assert result == "Noticias locales: mercado, clima..."


def test_set_value_and_click_pass_through_verbatim():
    store = DomActionResultStore()

    async def scenario() -> tuple[str, str]:
        tctx, bus = _make_context(browser_dom=store)
        task = asyncio.create_task(
            browser_tools.browser_dom_action(tctx, "set_value", target="#search", value="pasta")
        )
        await asyncio.sleep(0)
        ev = bus.events[-1]
        _assert_frozen_shape(ev)
        assert ev.operation == "set_value"
        assert ev.target == "#search"
        assert ev.value == "pasta"
        store.update(ev.created_at, "set #search = pasta")
        first = await task

        task2 = asyncio.create_task(
            browser_tools.browser_dom_action(tctx, "click", target="button#go")
        )
        await asyncio.sleep(0)
        ev2 = bus.events[-1]
        _assert_frozen_shape(ev2)
        assert ev2.operation == "click"
        store.update(ev2.created_at, "clicked button#go")
        second = await task2
        return first, second

    first, second = asyncio.run(scenario())
    assert first == "set #search = pasta"
    assert second == "clicked button#go"


def test_result_arriving_before_the_waiter_registers_still_resolves():
    """main's PUT can land before the tool registers its waiter — a
    pre-stored result must still resolve, and stale keys never leak."""
    store = DomActionResultStore()
    stale = datetime.now(timezone.utc)
    store.update(stale, "stale")

    async def scenario() -> str:
        tctx, bus = _make_context(browser_dom=store)
        task = asyncio.create_task(
            browser_tools.browser_dom_action(tctx, "query", target="")
        )
        await asyncio.sleep(0)
        ev = bus.events[-1]
        store.update(ev.created_at, "page text")
        return await task

    assert asyncio.run(scenario()) == "page text"
    # The stale key was NOT consumed by the tool's await.
    assert asyncio.run(store.wait_for(stale, 0.01)) == "stale"


def test_timeout_returns_honest_no_response(monkeypatch):
    store = DomActionResultStore()
    monkeypatch.setattr(browser_tools, "DOM_ACTION_TIMEOUT_S", 0.05)

    async def scenario() -> str:
        tctx, _ = _make_context(browser_dom=store)
        return await browser_tools.browser_dom_action(tctx, "click", target="a")

    assert asyncio.run(scenario()) == NO_RESPONSE


def test_missing_store_returns_honest_no_response():
    tctx, bus = _make_context(browser_dom=None)

    result = asyncio.run(browser_tools.browser_dom_action(tctx, "query", target="body"))

    assert result == NO_RESPONSE
    # The request still went on the wire (the renderer may be alive).
    assert len(bus.events) == 1
    _assert_frozen_shape(bus.events[-1])


# --------------------------------------------------------------------- #
# Mock mode (the demo path): same shape, canned result marked as mock
# --------------------------------------------------------------------- #


def test_mock_mode_emits_same_shape_with_canned_mock_marked_result():
    tctx, bus = _make_context(mock=True, browser_dom=None)  # no store needed

    result = asyncio.run(
        browser_tools.browser_dom_action(tctx, "set_value", target="#search", value="pasta")
    )

    assert result.startswith("[mock]")
    assert "set_value" in result
    ev = bus.events[-1]
    _assert_frozen_shape(ev)
    assert ev.operation == "set_value"
    assert ev.target == "#search"
    assert ev.value == "pasta"
    # The canned result rides the SAME result field, marked as mock.
    assert ev.result == result


def test_mock_mode_query_shape():
    tctx, bus = _make_context(mock=True)

    result = asyncio.run(browser_tools.browser_dom_action(tctx, "query", target="body"))

    assert result == "[mock] query: body"
    ev = bus.events[-1]
    _assert_frozen_shape(ev)
    assert ev.operation == "query"
    assert ev.target == "body"
    assert ev.result == "[mock] query: body"


# --------------------------------------------------------------------- #
# Honest refusal
# --------------------------------------------------------------------- #


def test_invalid_operation_refused_without_emitting():
    tctx, bus = _make_context()

    result = asyncio.run(browser_tools.browser_dom_action(tctx, "hover", target="a"))

    assert "Operación no válida" in result
    assert bus.events == []


# --------------------------------------------------------------------- #
# browser.navigate (GATE-5 W2-NAVIGATE): the agent's navigation tool
# --------------------------------------------------------------------- #


def test_browser_navigate_registered_with_reversible_kind():
    registry = ToolRegistry()
    for spec in browser_tools.SPECS:
        registry.register(spec)
    spec = registry.get("browser.navigate")
    assert spec is not None
    assert spec.kind == PolicyKind.REVERSIBLE
    assert spec.handler is browser_tools.browser_navigate


def test_browser_navigate_emits_frozen_request_shape_and_awaits_real_state():
    """Round-trip: the handler emits the frozen REQUEST (loading=True,
    real baseline history flags) and AWAITS the post-navigation state
    the desktop pushes into the browser-state store — the agent sees
    the REAL url/title it landed on, not a canned "done"."""
    store = BrowserStateStore()
    store.update(
        BrowserStatePayload(
            url="https://old.example/",
            title="Página anterior",
            can_go_back=True,
            can_go_forward=False,
            loading=False,
        )
    )

    async def scenario() -> str:
        tctx, bus = _make_context(browser_state=store)
        task = asyncio.create_task(
            browser_tools.browser_navigate(tctx, "https://example.com/docs")
        )
        await asyncio.sleep(0)  # let the tool emit the request
        ev = bus.events[-1]
        _assert_frozen_navigate_shape(ev)
        assert ev.url == "https://example.com/docs"
        # The REQUEST carries the baseline history flags and loading=True;
        # the post-navigation title is unknown until the view loads.
        assert ev.title == ""
        assert ev.can_go_back is True
        assert ev.can_go_forward is False
        assert ev.loading is True
        assert isinstance(ev.created_at, datetime)
        # Electron main pushes the view's REAL post-navigation state.
        store.update(
            BrowserStatePayload(
                url="https://example.com/docs",
                title="Documentación",
                can_go_back=True,
                can_go_forward=True,
                loading=False,
            )
        )
        return await task

    result = asyncio.run(scenario())
    assert result == "Navegación completada: https://example.com/docs — Documentación"


def test_browser_navigate_redirect_reports_real_landing():
    """The view lands elsewhere (redirect / blocked target): the handler
    reports the REAL url — never a fake success on the requested one."""
    store = BrowserStateStore()

    async def scenario() -> str:
        tctx, bus = _make_context(browser_state=store)
        task = asyncio.create_task(browser_tools.browser_navigate(tctx, "https://a.example"))
        await asyncio.sleep(0)
        ev = bus.events[-1]
        _assert_frozen_navigate_shape(ev)
        store.update(
            BrowserStatePayload(
                url="https://b.example/landing",
                title="Aterrizó aquí",
                loading=False,
            )
        )
        return await task

    result = asyncio.run(scenario())
    assert "https://b.example/landing" in result
    assert "Aterrizó aquí" in result
    assert "https://a.example" in result  # the requested url is named, not hidden


def test_browser_navigate_timeout_returns_honest_no_response(monkeypatch):
    store = BrowserStateStore()
    monkeypatch.setattr(browser_tools, "NAVIGATE_TIMEOUT_S", 0.05)

    async def scenario() -> str:
        tctx, _ = _make_context(browser_state=store)
        return await browser_tools.browser_navigate(tctx, "https://example.com")

    assert asyncio.run(scenario()) == NAV_NO_RESPONSE


def test_browser_navigate_missing_store_returns_honest_no_response():
    tctx, bus = _make_context(browser_state=None)

    result = asyncio.run(browser_tools.browser_navigate(tctx, "https://example.com"))

    assert result == NAV_NO_RESPONSE
    # The request still went on the wire (the renderer may be alive).
    assert len(bus.events) == 1
    _assert_frozen_navigate_shape(bus.events[-1])


def test_browser_navigate_mock_mode_emits_same_shape_with_canned_mock_marked_result():
    tctx, bus = _make_context(mock=True, browser_state=None)  # no store needed

    result = asyncio.run(browser_tools.browser_navigate(tctx, "https://example.com"))

    assert result.startswith("[mock]")
    assert "https://example.com" in result
    ev = bus.events[-1]
    _assert_frozen_navigate_shape(ev)
    assert ev.url == "https://example.com"
    # The canned title rides the SAME title field, marked as mock.
    assert ev.title.startswith("[mock]")
    assert ev.loading is False


def test_browser_navigate_empty_url_refused_without_emitting():
    tctx, bus = _make_context()

    result = asyncio.run(browser_tools.browser_navigate(tctx, "   "))

    assert "URL no válida" in result
    assert bus.events == []
