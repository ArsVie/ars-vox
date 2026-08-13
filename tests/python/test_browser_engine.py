"""BROWSER-USE INTEGRATION — browser_engine.py unit tests.

Pins the engine WITHOUT launching Chromium: the session factory is
injected (FakeSession/FakePage), so the policy gate, error mapping,
single-page discipline, truncation and the lazy-start lifecycle are all
tested deterministically.

The navigation policy is ported 1:1 from apps/desktop/electron/
security-policy.ts — these tests mirror the vitest cases in
tests/electron-security-policy.test.ts.
"""

import asyncio
import re

import pytest

from arsvox_agent.browser_engine import (
    MAX_QUERY_TEXT_CHARS,
    BrowserBlockedError,
    BrowserElementError,
    BrowserEngineError,
    BrowserTimeoutError,
    BrowserEngine,
    NavigationDecision,
    decide_remote_navigation,
    host_matches_allowlist,
    is_local_or_private_host,
)

ALLOWLIST = ["youtube.com", "*.youtube.com", "wikipedia.org", "openstreetmap.org"]


# --------------------------------------------------------------------- #
# Policy primitives (pure) — the desktop-parity matrix
# --------------------------------------------------------------------- #


def test_allowlist_host_semantics():
    assert host_matches_allowlist("www.youtube.com", ALLOWLIST)  # wildcard entry
    assert host_matches_allowlist("youtube.com", ALLOWLIST)  # exact
    assert host_matches_allowlist("m.youtube.com", ALLOWLIST)  # subdomain of exact entry
    assert host_matches_allowlist("es.wikipedia.org", ALLOWLIST)
    assert host_matches_allowlist("WIKIPEDIA.ORG", ALLOWLIST)  # case-insensitive
    assert not host_matches_allowlist("evil.com", ALLOWLIST)
    assert not host_matches_allowlist("notyoutube.com", ALLOWLIST)
    assert not host_matches_allowlist("youtube.com.evil.com", ALLOWLIST)


def test_decide_allows_allowlisted_public_https():
    assert decide_remote_navigation("https://es.wikipedia.org/wiki/Pasta", ALLOWLIST) == (
        NavigationDecision(True, "ok")
    )
    assert decide_remote_navigation("http://www.youtube.com/watch?v=1", ALLOWLIST) == (
        NavigationDecision(True, "ok")
    )


def test_decide_blocks_non_allowlisted_hosts():
    d = decide_remote_navigation("https://example.com/docs", ALLOWLIST)
    assert not d.allowed
    assert d.reason == "not-allowlisted"


def test_decide_blocks_dangerous_schemes_regardless_of_allowlist():
    for url in [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,x",
        "blob:https://www.youtube.com/1",
        "chrome://settings",
        "devtools://devtools",
        "arsvox-doc:receta",
        "ws://www.youtube.com",
        "wss://www.youtube.com",
    ]:
        d = decide_remote_navigation(url, ALLOWLIST)
        assert not d.allowed, url
        assert d.reason.startswith("blocked-scheme:"), url


def test_decide_allows_only_about_blank():
    assert decide_remote_navigation("about:blank", ALLOWLIST).allowed
    d = decide_remote_navigation("about:config", ALLOWLIST)
    assert not d.allowed
    assert d.reason == "blocked-scheme:about:"


def test_decide_blocks_local_and_private_destinations_even_when_allowlisted():
    for url in [
        "http://localhost/",
        "http://foo.localhost/",
        "http://myhost.local/",
        "http://x.internal/",
        "http://nas.lan/",
        "http://127.0.0.1/",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://169.254.1.1/",
        "http://100.64.0.1/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[fe80::1]/",
    ]:
        d = decide_remote_navigation(url, ALLOWLIST + ["localhost", "10.0.0.5"])
        assert not d.allowed, url
        assert d.reason == "local-or-private", url


def test_decide_blocks_unparseable_and_hostless():
    assert decide_remote_navigation("esto no es una url", ALLOWLIST).reason == "unparseable-url"
    assert decide_remote_navigation("http://", ALLOWLIST).reason == "no-host"


def test_local_host_classification():
    assert is_local_or_private_host("localhost")
    assert is_local_or_private_host("api.local")
    assert is_local_or_private_host("192.168.0.10")
    assert is_local_or_private_host("::1")
    assert is_local_or_private_host("0.0.0.0")
    assert not is_local_or_private_host("wikipedia.org")
    assert not is_local_or_private_host("8.8.8.8")


# --------------------------------------------------------------------- #
# Fake session/page — deterministic, no Chromium
# --------------------------------------------------------------------- #


class FakePage:
    def __init__(self, on_evaluate):
        self._on_evaluate = on_evaluate
        self.back_calls = 0

    async def evaluate(self, js: str):
        # The engine's _wait_ready polls readyState and navigate reads
        # document.title directly — answer both deterministically so the
        # fakes don't spin or return noise.
        if "readyState" in js:
            return "complete"
        if "document.title" in js:
            return "Título real"
        return self._on_evaluate(js)

    async def go_back(self):
        self.back_calls += 1


class FakeSession:
    def __init__(self, page: FakePage, *, url: str = "", title: str = ""):
        self.page = page
        self.url = url
        self.title = title
        self.new_page_calls: list[str | None] = []
        self.navigate_to_calls: list[str] = []
        self.started = 0
        self.stopped = 0

    async def start(self):
        self.started += 1

    async def stop(self):
        self.stopped += 1

    async def new_page(self, url: str | None = None):
        self.new_page_calls.append(url)
        return self.page

    async def navigate_to(self, url: str):
        self.navigate_to_calls.append(url)
        self.url = url
        self.title = "Página: " + url

    async def get_current_page(self):
        return self.page

    async def get_current_page_url(self):
        return self.url

    async def get_current_page_title(self):
        return self.title


def _selector_in(js: str) -> str | None:
    m = re.search(r'document\.querySelector\("([^"]+)"\)', js)
    return m.group(1) if m else None


def _text_target_in(js: str) -> str | None:
    m = re.search(r"const t = \"([^\"]+)\"", js)
    return m.group(1) if m else None


# --------------------------------------------------------------------- #
# Engine: navigation
# --------------------------------------------------------------------- #


def _engine(session_factory, allowlist=None):
    return BrowserEngine(
        allowlist if allowlist is not None else list(ALLOWLIST),
        session_factory=session_factory,
        navigate_timeout_s=2.0,
        dom_timeout_s=2.0,
    )


def test_navigate_first_call_opens_new_page_and_reports_real_state():
    session = FakeSession(FakePage(lambda js: None))
    engine = _engine(lambda: session)

    state = asyncio.run(engine.navigate("https://es.wikipedia.org/wiki/Pasta"))

    # The session's current page is reused — no orphan tab is created.
    assert session.new_page_calls == []
    assert session.navigate_to_calls == ["https://es.wikipedia.org/wiki/Pasta"]
    assert state.url == "https://es.wikipedia.org/wiki/Pasta"
    assert state.title == "Título real"
    assert engine.ready


def test_navigate_second_call_reuses_the_page():
    session = FakeSession(FakePage(lambda js: None))
    engine = _engine(lambda: session)

    asyncio.run(engine.navigate("https://es.wikipedia.org/wiki/A"))
    asyncio.run(engine.navigate("https://es.wikipedia.org/wiki/B"))

    assert session.new_page_calls == []  # current page reused both times
    assert session.navigate_to_calls == [
        "https://es.wikipedia.org/wiki/A",
        "https://es.wikipedia.org/wiki/B",
    ]


def test_navigate_blocked_by_policy_before_any_session_work():
    session = FakeSession(FakePage(lambda js: None))
    engine = _engine(lambda: session)

    with pytest.raises(BrowserBlockedError):
        asyncio.run(engine.navigate("https://example.com/"))
    with pytest.raises(BrowserBlockedError):
        asyncio.run(engine.navigate("http://192.168.1.50/"))

    # Policy refusal happens BEFORE the session is ever created.
    assert session.new_page_calls == []
    assert not engine.ready


def test_navigate_unavailable_factory_error_is_honest():
    def broken_factory():
        raise RuntimeError("browser-use is not installed")

    engine = _engine(broken_factory)

    with pytest.raises(BrowserEngineError) as exc:
        asyncio.run(engine.navigate("https://es.wikipedia.org/"))
    assert "no se pudo cargar el navegador" in exc.value.detail


def test_navigate_timeout_raises_bounded_error():
    async def slow_navigate(url):
        await asyncio.sleep(5)

    session = FakeSession(FakePage(lambda js: None))
    session.navigate_to = slow_navigate  # type: ignore[assignment]
    engine = _engine(lambda: session)
    engine._navigate_timeout_s = 0.05

    with pytest.raises(BrowserTimeoutError):
        asyncio.run(engine.navigate("https://es.wikipedia.org/"))


def test_start_failure_is_cached_and_reported_once():
    class FailingStartSession(FakeSession):
        async def start(self):
            raise RuntimeError("chromium executable not found")

    session = FailingStartSession(FakePage(lambda js: None))
    engine = _engine(lambda: session)

    for _ in range(2):
        with pytest.raises(BrowserEngineError) as exc:
            asyncio.run(engine.navigate("https://es.wikipedia.org/"))
        assert "no se pudo iniciar Chromium" in exc.value.detail
    assert not engine.ready


# --------------------------------------------------------------------- #
# Engine: DOM ops (text-first)
# --------------------------------------------------------------------- #


def test_query_returns_body_text_truncated():
    big = "x" * (MAX_QUERY_TEXT_CHARS + 500)

    def on_evaluate(js: str):
        return big

    session = FakeSession(FakePage(on_evaluate))
    engine = _engine(lambda: session)
    asyncio.run(engine.navigate("https://es.wikipedia.org/"))

    text = asyncio.run(engine.query(""))
    assert text.startswith("x" * MAX_QUERY_TEXT_CHARS)
    assert "texto recortado" in text


def test_query_target_missing_raises_element_error():
    def on_evaluate(js: str):
        return "null"

    session = FakeSession(FakePage(on_evaluate))
    engine = _engine(lambda: session)
    asyncio.run(engine.navigate("https://es.wikipedia.org/"))

    with pytest.raises(BrowserElementError):
        asyncio.run(engine.query("#no-existe"))


def test_click_by_css_selector():
    def on_evaluate(js: str):
        sel = _selector_in(js)
        return "true" if sel == "#go" else "false"

    session = FakeSession(FakePage(on_evaluate))
    engine = _engine(lambda: session)
    asyncio.run(engine.navigate("https://es.wikipedia.org/"))

    assert asyncio.run(engine.click("#go")) == "Se hizo clic en #go."
    with pytest.raises(BrowserElementError):
        asyncio.run(engine.click("#missing"))


def test_click_by_visible_text():
    import json as _json

    def on_evaluate(js: str):
        # json.dumps escapes non-ASCII (ensure_ascii) — the JS payload
        # carries the ORIGINAL case + "\u00e1" escapes; JS lowercases
        # at runtime, so the fake matches the raw payload (quotes off).
        return "true" if _text_target_in(js) == _json.dumps("Leer más")[1:-1] else "false"

    session = FakeSession(FakePage(on_evaluate))
    engine = _engine(lambda: session)
    asyncio.run(engine.navigate("https://es.wikipedia.org/"))

    assert asyncio.run(engine.click("Leer más")) == "Se hizo clic en Leer más."


def test_set_value_returns_honest_result():
    def on_evaluate(js: str):
        return "true" if _selector_in(js) == "#search" else "false"

    session = FakeSession(FakePage(on_evaluate))
    engine = _engine(lambda: session)
    asyncio.run(engine.navigate("https://es.wikipedia.org/"))

    assert asyncio.run(engine.set_value("#search", "pasta")) == "Se escribió en #search."


def test_scroll_pixels_and_close():
    session = FakeSession(FakePage(lambda js: "true"))
    engine = _engine(lambda: session)
    asyncio.run(engine.navigate("https://es.wikipedia.org/"))

    assert asyncio.run(engine.scroll("", "400")) == "Se desplazó la página 400 píxeles."
    asyncio.run(engine.close())
    assert session.stopped == 1
    asyncio.run(engine.close())  # idempotent
    assert session.stopped == 1


def test_update_config_swaps_allowlist():
    session = FakeSession(FakePage(lambda js: None))
    engine = _engine(lambda: session)

    # Wikipedia is allowlisted — navigation works.
    assert asyncio.run(engine.navigate("https://es.wikipedia.org/x")).url
    # Flip to an allowlist without it.
    engine.update_config(["youtube.com"])

    d = engine.check_url("https://es.wikipedia.org/x")
    assert not d.allowed
    assert d.reason == "not-allowlisted"
