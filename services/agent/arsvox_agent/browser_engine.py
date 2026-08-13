"""browser_engine.py — ars-vox's LOCAL, TEXT-FIRST browser engine.

BROWSER-USE INTEGRATION: the agent's browser authority moves
IN-PROCESS. Navigation and DOM actions execute here on a local Chromium
(browser-use 0.13.7, CDP-based, headless by default) instead of the
Electron main round-trip that produced "El escritorio no respondió".

The Electron WebContentsView remains the USER'S display: the tools
still emit the frozen wire events so the desktop mirrors the agent's
navigation when the app is open — but the agent never WAITS on it.

Text-first, by construction:
  * no screenshots, no vision model, no LLM agent loop — url/title/DOM
    text only (innerText / aria labels / CSS selectors);
  * telemetry disabled (ANONYMIZED_TELEMETRY=false) BEFORE browser_use
    is ever imported;
  * navigation policy mirrors the desktop's (blocked schemes / local-
    or-private / allowlist — ported 1:1 from apps/desktop/electron/
    security-policy.ts) so the in-process engine is never weaker than
    the Electron view.

browser_use is imported LAZILY (its top-level modules are heavy) and
the Chromium session starts on first use, so service startup stays lean
and deployments with engine_enabled=False never pay the import.
"""

from __future__ import annotations

import asyncio
import os
from typing import Callable
from urllib.parse import urlparse

from arsvox_agent.browser_state import BrowserState

# --------------------------------------------------------------------- #
# Navigation policy — ported 1:1 from apps/desktop/electron/
# security-policy.ts (R40). Keep in sync with that file. Pure functions,
# no I/O, no browser imports: fully unit-testable.
# --------------------------------------------------------------------- #

_BLOCKED_SCHEMES: frozenset[str] = frozenset(
    {
        "file",
        "javascript",
        "data",
        "blob",
        "chrome",
        "chrome-extension",
        "devtools",
        "arsvox-doc",
        "ws",
        "wss",
    }
)

# 'about:blank' is allowed explicitly (initial/empty documents); every
# other 'about:' URL is blocked (mirrors the TS BLOCKED_NAVIGATION_SCHEMES
# + about:blank exemption).


def host_matches_allowlist(host: str, allowlist: list[str]) -> bool:
    """Host-level allowlist semantics — identical to the TS matcher."""
    h = host.lower()
    return any(
        h.endswith(entry[1:]) if entry.startswith("*.") else h == entry or h.endswith(f".{entry}")
        for entry in allowlist
    )


def _parse_ipv4(host: str) -> list[int] | None:
    parts = host.split(".")
    if len(parts) != 4:
        return None
    octets: list[int] = []
    for p in parts:
        if not p.isdigit() or len(p) > 3:
            return None
        n = int(p)
        if n > 255:
            return None
        octets.append(n)
    return octets


def _is_private_ipv4(o: list[int]) -> bool:
    a, b = o[0], o[1]
    if a == 0:
        return True
    if a == 10:
        return True
    if a == 100 and 64 <= b <= 127:
        return True
    if a == 127:
        return True
    if a == 169 and b == 254:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    if a == 192 and b == 0:
        return True
    if a == 192 and b == 168:
        return True
    if a == 198 and b in (18, 19):
        return True
    if a == 198 and b == 51 and o[2] == 100:
        return True
    if a == 203 and b == 0 and o[2] == 113:
        return True
    if a >= 224:
        return True
    return False


def _parse_ipv6(host: str) -> list[int] | None:
    if "%" in host:
        return None  # scope ids are link-local anyway
    double_colon = "::" in host
    head, tail = host.split("::") if double_colon else (host, "")
    head_groups = head.split(":") if head else []
    tail_groups = tail.split(":") if tail else []
    if tail_groups and "." in tail_groups[-1]:
        v4 = _parse_ipv4(tail_groups[-1])
        if v4 is None:
            return None
        tail_groups = tail_groups[:-1] + [
            format((v4[0] << 8) | v4[1], "x"),
            format((v4[2] << 8) | v4[3], "x"),
        ]
    total = len(head_groups) + len(tail_groups)
    if double_colon:
        if total > 7:
            return None
    elif total != 8:
        return None
    middle = ["0"] * (8 - total) if double_colon else []
    groups: list[int] = []
    for g in head_groups + middle + tail_groups:
        try:
            groups.append(int(g, 16))
        except ValueError:
            return None
    return groups


def _is_private_ipv6(g: list[int]) -> bool:
    if all(x == 0 for x in g):
        return True
    if all(x == 0 for x in g[:7]) and g[7] == 1:
        return True
    if (g[0] & 0xFE00) == 0xFC00:
        return True
    if (g[0] & 0xFFC0) == 0xFE80:
        return True
    if (g[0] & 0xFFC0) == 0xFEC0:
        return True
    if (g[0] & 0xFF00) == 0xFF00:
        return True
    if g[0] == 0x2001 and g[1] == 0x0DB8:
        return True
    if g[0] == 0 and g[1] == 0 and g[2] == 0 and g[3] == 0 and g[4] == 0 and g[5] == 0xFFFF:
        octets = [(g[6] >> 8) & 0xFF, g[6] & 0xFF, (g[7] >> 8) & 0xFF, g[7] & 0xFF]
        return _is_private_ipv4(octets)
    return False


def is_local_or_private_host(host: str) -> bool:
    """Local/private-network destination check (R40, allowlist-independent)."""
    h = host.lower()
    if not h:
        return False
    if (
        h == "localhost"
        or h.endswith(".localhost")
        or h.endswith(".local")
        or h.endswith(".internal")
        or h.endswith(".lan")
    ):
        return True
    bare = h[1:-1] if h.startswith("[") and h.endswith("]") else h
    v4 = _parse_ipv4(bare)
    if v4 is not None:
        return _is_private_ipv4(v4)
    v6 = _parse_ipv6(bare)
    if v6 is not None:
        return _is_private_ipv6(v6)
    return False


class NavigationDecision:
    __slots__ = ("allowed", "reason")

    def __init__(self, allowed: bool, reason: str) -> None:
        self.allowed = allowed
        self.reason = reason

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, NavigationDecision):
            return NotImplemented
        return self.allowed == other.allowed and self.reason == other.reason


def decide_remote_navigation(url: str, allowlist: list[str]) -> NavigationDecision:
    """Decide whether the engine may navigate to ``url``.

    Order of checks (mirrors decideRemoteNavigation): unparseable ->
    dangerous scheme (about:blank exempt) -> non-http(s) -> local/
    private -> allowlist membership.
    """
    try:
        u = urlparse(url)
    except ValueError:
        return NavigationDecision(False, "unparseable-url")
    scheme = u.scheme
    if not scheme:
        return NavigationDecision(False, "unparseable-url")
    if scheme == "about":
        return (
            NavigationDecision(True, "ok")
            if url.strip().lower() == "about:blank"
            else NavigationDecision(False, "blocked-scheme:about:")
        )
    if scheme in _BLOCKED_SCHEMES or scheme not in ("http", "https"):
        return NavigationDecision(False, f"blocked-scheme:{scheme}:")
    hostname = u.hostname or ""
    if not hostname:
        return NavigationDecision(False, "no-host")
    if is_local_or_private_host(hostname):
        return NavigationDecision(False, "local-or-private")
    if not host_matches_allowlist(hostname, allowlist):
        return NavigationDecision(False, "not-allowlisted")
    return NavigationDecision(True, "ok")


# --------------------------------------------------------------------- #
# Engine errors — every failure mode maps to an honest Spanish message.
# --------------------------------------------------------------------- #


class BrowserBlockedError(Exception):
    """The requested navigation was refused by the policy gate."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class BrowserEngineError(Exception):
    """The local browser could not be started or is unusable."""

    def __init__(self, detail: str = "") -> None:
        self.detail = detail
        super().__init__(detail)


class BrowserElementError(Exception):
    """The page loaded fine but the requested element was not found."""


class BrowserTimeoutError(Exception):
    """A bounded engine operation exceeded its window."""


# How much page text a query hands the model (bounded — keeps turns lean).
MAX_QUERY_TEXT_CHARS = 4000


class BrowserEngine:
    """Local, text-first browser authority for the agent.

    The Chromium session (browser_use.BrowserSession) starts lazily on
    the first operation and lives for the service's lifetime. Every
    operation is bounded and serialized behind one lock (CDP commands
    are not concurrent-safe).

    ``session_factory`` is an async callable returning a session object
    (defaults to a headless browser-use BrowserSession); tests inject a
    fake with the same surface.
    """

    def __init__(
        self,
        allowlist: list[str],
        *,
        headless: bool = True,
        navigate_timeout_s: float = 20.0,
        dom_timeout_s: float = 10.0,
        session_factory: Callable[[], object] | None = None,
    ) -> None:
        self._allowlist = list(allowlist)
        self._headless = headless
        self._navigate_timeout_s = navigate_timeout_s
        self._dom_timeout_s = dom_timeout_s
        self._session_factory = session_factory
        self._session: object | None = None
        self._page: object | None = None
        self._lock = asyncio.Lock()
        self._start_failed: str | None = None

    # ------------------------------------------------------------------ #
    # config
    # ------------------------------------------------------------------ #

    def update_config(self, allowlist: list[str], *, headless: bool | None = None) -> None:
        """Live config reload: new allowlist/headless apply to future ops."""
        self._allowlist = list(allowlist)
        if headless is not None:
            self._headless = headless

    @property
    def allowlist(self) -> list[str]:
        return list(self._allowlist)

    @property
    def ready(self) -> bool:
        return self._session is not None and self._start_failed is None

    # ------------------------------------------------------------------ #
    # policy (public for the tool's pre-emission gate)
    # ------------------------------------------------------------------ #

    def check_url(self, url: str) -> NavigationDecision:
        return decide_remote_navigation(url, self._allowlist)

    # ------------------------------------------------------------------ #
    # session lifecycle
    # ------------------------------------------------------------------ #

    def _default_session_factory(self) -> object:
        # Lazy import: browser_use's top-level modules are heavy and the
        # telemetry kill-switch must be set before the first import.
        os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")
        from browser_use import BrowserSession  # noqa: PLC0415

        return BrowserSession(headless=self._headless)

    async def _ensure_session(self) -> object:
        if self._start_failed is not None:
            raise BrowserEngineError(self._start_failed)
        if self._session is not None:
            return self._session
        factory = self._session_factory or self._default_session_factory
        try:
            session = factory()
        except Exception as exc:  # noqa: BLE001 — honest Spanish error
            self._start_failed = f"no se pudo cargar el navegador ({type(exc).__name__})"
            raise BrowserEngineError(self._start_failed) from exc
        try:
            # BrowserSession 0.13.x lifecycle: async start() (launches
            # Chromium and wires the CDP client), async stop() at
            # shutdown.
            await session.start()  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001 — chromium missing etc.
            self._start_failed = f"no se pudo iniciar Chromium ({type(exc).__name__})"
            raise BrowserEngineError(self._start_failed) from exc
        self._session = session
        return session

    async def close(self) -> None:
        session, self._session = self._session, None
        self._page = None
        if session is None:
            return
        try:
            await session.stop()  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 — shutdown must never raise
            pass

    # ------------------------------------------------------------------ #
    # operations
    # ------------------------------------------------------------------ #

    async def navigate(self, url: str) -> BrowserState:
        decision = self.check_url(url)
        if not decision.allowed:
            raise BrowserBlockedError(decision.reason)

        async with self._lock:

            async def _do() -> BrowserState:
                session = await self._ensure_session()
                if self._page is None:
                    # Use the session's CURRENT page — navigate_to drives
                    # that target. Creating our own tab here would orphan
                    # it: the engine would read the blank target while
                    # the real navigation happens elsewhere.
                    self._page = (
                        await session.get_current_page()  # type: ignore[attr-defined]
                        or await session.new_page()  # type: ignore[attr-defined]
                    )
                    if self._page is None:
                        raise BrowserEngineError("no se pudo abrir una página")
                await session.navigate_to(url)  # type: ignore[attr-defined]
                await self._wait_ready(self._page, min(8.0, self._navigate_timeout_s * 0.5))
                final_url = await session.get_current_page_url()  # type: ignore[attr-defined]
                # browser-use's get_current_page_title reads TargetInfo,
                # which lags behind the loaded document — read the real
                # <title> from the complete DOM instead.
                title = await self._page.evaluate("() => document.title || ''")  # type: ignore[attr-defined]
                return BrowserState(url=final_url or "", title=(title or "").strip())

            try:
                return await asyncio.wait_for(_do(), self._navigate_timeout_s)
            except BrowserBlockedError:
                raise
            except BrowserEngineError:
                raise
            except asyncio.TimeoutError as exc:
                raise BrowserTimeoutError() from exc
            except Exception as exc:  # noqa: BLE001 — page-level failure
                raise BrowserEngineError(type(exc).__name__) from exc

    async def query(self, target: str = "") -> str:
        """Read the page text (body or the element matching ``target``),
        truncated. Text-first by design: no screenshots, no vision."""
        async with self._lock:

            async def _do() -> str:
                session = await self._ensure_session()
                page = await self._page_for_op(session)
                await self._wait_ready(page, 3.0)
                if target:
                    text = await page.evaluate(  # type: ignore[attr-defined]
                        f"() => {{ const el = document.querySelector({target!r}); "
                        "return el ? (el.innerText || '') : null; }"
                    )
                    if text == "null":
                        raise BrowserElementError(
                            f"No encontré el elemento {target!r} en la página."
                        )
                else:
                    text = await page.evaluate(  # type: ignore[attr-defined]
                        "() => document.body ? document.body.innerText : ''"
                    )
                # actor Page.evaluate returns the STRING form of the JS
                # result (objects/arrays JSON-stringified).
                return (text or "").strip()

            try:
                text = await asyncio.wait_for(_do(), self._dom_timeout_s)
            except asyncio.TimeoutError as exc:
                raise BrowserTimeoutError() from exc
            except (BrowserEngineError, BrowserElementError, BrowserBlockedError):
                raise
            except Exception as exc:  # noqa: BLE001
                raise BrowserEngineError(type(exc).__name__) from exc

            if not text:
                return "No encontré texto en la página."
            if len(text) > MAX_QUERY_TEXT_CHARS:
                text = text[:MAX_QUERY_TEXT_CHARS] + "\n… (texto recortado)"
            return text

    async def click(self, target: str) -> str:
        async with self._lock:

            async def _do() -> str:
                session = await self._ensure_session()
                page = await self._page_for_op(session)
                clicked = await page.evaluate(  # type: ignore[attr-defined]
                    _click_js(target)
                )
                if clicked != "true":
                    raise BrowserElementError(
                        f"No encontré el elemento {target!r} en la página."
                    )
                return f"Se hizo clic en {target}."

            return await self._bounded(_do)

    async def set_value(self, target: str, value: str) -> str:
        async with self._lock:

            async def _do() -> str:
                session = await self._ensure_session()
                page = await self._page_for_op(session)
                done = await page.evaluate(  # type: ignore[attr-defined]
                    _set_value_js(target, value)
                )
                if done != "true":
                    raise BrowserElementError(
                        f"No encontré el campo {target!r} en la página."
                    )
                return f"Se escribió en {target}."

            return await self._bounded(_do)

    async def scroll(self, target: str = "", value: str | None = None) -> str:
        try:
            dy = int(value) if value else 0
        except ValueError:
            dy = 0
        if target and not dy:
            dy = 400  # "scroll to target": one viewport-ish step toward it
        async with self._lock:

            async def _do() -> str:
                session = await self._ensure_session()
                page = await self._page_for_op(session)
                if target and value is None:
                    found = await page.evaluate(  # type: ignore[attr-defined]
                        f"() => {{ const el = document.querySelector({target!r}); "
                        "if (el) { el.scrollIntoView({behavior:'instant', block:'center'}); "
                        "return true; } return false; }"
                    )
                    if found != "true":
                        raise BrowserElementError(
                            f"No encontré el elemento {target!r} en la página."
                        )
                    return f"Se desplazó la página hasta {target}."
                await page.evaluate(  # type: ignore[attr-defined]
                    f"() => {{ window.scrollBy(0, {dy}); return true; }}"
                )
                return f"Se desplazó la página {dy} píxeles."

            return await self._bounded(_do)

    async def back(self) -> BrowserState:
        async with self._lock:

            async def _do() -> BrowserState:
                session = await self._ensure_session()
                page = await self._page_for_op(session)
                await page.go_back()  # type: ignore[attr-defined]
                final_url = await session.get_current_page_url()  # type: ignore[attr-defined]
                title = await session.get_current_page_title()  # type: ignore[attr-defined]
                return BrowserState(url=final_url or "", title=title or "")

            try:
                return await asyncio.wait_for(_do(), self._navigate_timeout_s)
            except asyncio.TimeoutError as exc:
                raise BrowserTimeoutError() from exc
            except (BrowserEngineError, BrowserBlockedError):
                raise
            except Exception as exc:  # noqa: BLE001
                raise BrowserEngineError(type(exc).__name__) from exc

    # ------------------------------------------------------------------ #
    # internals
    # ------------------------------------------------------------------ #

    async def _page_for_op(self, session: object) -> object:
        """The current page for DOM ops; raises if no page exists yet."""
        if self._page is not None:
            return self._page
        try:
            page = await session.get_current_page()  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001
            raise BrowserEngineError("no hay ninguna página abierta") from exc
        if page is None:
            raise BrowserEngineError("no hay ninguna página abierta")
        self._page = page
        return page

    async def _wait_ready(self, page: object, timeout_s: float) -> None:
        """Poll document.readyState until 'complete' (bounded).

        browser-use's NavigateToUrlEvent resolves on navigation commit,
        before the DOM necessarily finishes loading — text reads must
        wait for the document or they see an empty body.
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_s
        while True:
            try:
                state = await page.evaluate(  # type: ignore[attr-defined]
                    "() => document.readyState || 'complete'"
                )
            except Exception:  # noqa: BLE001 — page may be mid-teardown
                return
            if state == "complete" or loop.time() >= deadline:
                return
            await asyncio.sleep(0.2)

    async def _bounded(self, op) -> str:
        try:
            return await asyncio.wait_for(op(), self._dom_timeout_s)
        except asyncio.TimeoutError as exc:
            raise BrowserTimeoutError() from exc
        except (BrowserEngineError, BrowserElementError, BrowserBlockedError):
            raise
        except Exception as exc:  # noqa: BLE001
            raise BrowserEngineError(type(exc).__name__) from exc


# --------------------------------------------------------------------- #
# DOM helpers (page.evaluate payloads) — pure JS strings, no vision.
# --------------------------------------------------------------------- #


def _click_js(target: str) -> str:
    """Click the first element matching: CSS selector (when target looks
    like one), else aria-label / visible text on a/button/input."""
    import json

    t = json.dumps(target)
    # Deterministic rule: explicit selectors start with # . [ or contain a
    # combinator; anything else is an aria-label / visible-text target.
    css_first = target[:1] in "#.[" or ">" in target
    if css_first:
        return (
            f"() => {{ const el = document.querySelector({t}); "
            "if (!el) return false; el.click(); return true; }"
        )
    return (
        f"() => {{ const t = {t}.toLowerCase(); "
        "const els = document.querySelectorAll('a, button, input, [role=button], [role=link]'); "
        "for (const el of els) { "
        "const label = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().toLowerCase(); "
        "if (label === t) { el.click(); return true; } } "
        "return false; }"
    )


def _set_value_js(target: str, value: str) -> str:
    import json

    t = json.dumps(target)
    v = json.dumps(value)
    css_first = target[:1] in "#.[" or ">" in target
    if css_first:
        return (
            f"() => {{ const el = document.querySelector({t}); "
            "if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false; "
            f"const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; "
            "setter.call(el, " + v + "); el.dispatchEvent(new Event('input', {bubbles:true})); return true; }"
        )
    return (
        f"() => {{ const t = {t}.toLowerCase(); "
        "const els = document.querySelectorAll('input, textarea, select'); "
        "for (const el of els) { "
        "const label = (el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || '').trim().toLowerCase(); "
        "if (label === t || label.includes(t)) { "
        f"const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; "
        "setter.call(el, " + v + "); el.dispatchEvent(new Event('input', {bubbles:true})); return true; } } "
        "return false; }"
    )
