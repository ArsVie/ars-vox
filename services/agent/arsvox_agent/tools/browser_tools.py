"""browser.dom_action + browser.navigate — the agent drives the browser.

BROWSER-USE INTEGRATION: the agent's browser authority is now the
IN-PROCESS engine (browser_engine.py — local Chromium via CDP,
text-first, no screenshots, no vision). Both tools execute against it
and answer with the engine's REAL result (real url/title/redirects,
real page text, real click/fill verdicts) — never a canned "done", and
never a wait on the desktop.

The Electron WebContentsView remains the USER'S display: both tools
still emit the FROZEN wire events (browser.navigate /
browser.dom_action) so the desktop mirrors the agent's navigation when
the app is open — but the agent never WAITS on it. The "El escritorio
no respondió" defect (a dead desktop eating the turn) is structurally
gone: the agent's browser works even with the app window closed.

Legacy fallback (engine disabled in config, or unit tests without an
engine): the previous emit -> await Electron-main round-trip through
the browser_state/browser_dom stores is preserved unchanged.

Navigation policy: the engine enforces the SAME scheme/local-private
gate as the desktop view, so the in-process browser is never weaker
than the Electron one. Any PUBLIC http(s) page is navigable — there is
no domain allowlist.

Mock mode (config.agent.mock — the demo path): same frozen event shape,
canned result explicitly marked "[mock]". The demo never pretends a
real DOM execution happened.
"""

from datetime import datetime, timezone
from typing import Literal
from urllib import request as urlrequest

from arsvox_contracts import PolicyKind
from arsvox_contracts.events import BrowserDomActionEvent, BrowserNavigateEvent

from arsvox_agent.browser_engine import (
    BrowserBlockedError,
    BrowserElementError,
    BrowserEngineError,
    BrowserTimeoutError,
)
from arsvox_agent.browser_state import BrowserState, BrowserStatePayload
from arsvox_agent.tools import ToolSpec
from arsvox_agent.tools.context import ToolContext

DomOperation = Literal["click", "scroll", "set_value", "query"]
_OPERATIONS: tuple[str, ...] = ("click", "scroll", "set_value", "query")

# How long the handler waits for Electron main to execute the action
# and push the result back (bounded — a missing desktop must not eat
# the turn).
DOM_ACTION_TIMEOUT_S = 10.0

# Same bounded window for browser.navigate: main PUTs the view's
# post-navigation state (url/title) on every did-* event; if it never
# reports (no Electron, view unattached, policy-blocked, failed
# load) the handler answers honestly after this wait.
NAVIGATE_TIMEOUT_S = 10.0

_NO_RESPONSE = (
    "El escritorio no respondió a la acción de navegador "
    "(¿está abierta la app?)."
)

_NAV_NO_RESPONSE = (
    "El escritorio no respondió a la navegación "
    "(¿está abierta la app? ¿la página fue bloqueada?)."
)


# --------------------------------------------------------------------- #
# Engine error mapping (browser-use integration): the tools own the
# user-facing Spanish; the engine raises typed errors with details.
# --------------------------------------------------------------------- #


def _engine_blocked(reason: str) -> str:
    return f"Página bloqueada: esta dirección no está permitida ({reason})."


def _engine_unavailable(detail: str = "") -> str:
    base = "El navegador local no está disponible"
    return f"{base} ({detail})." if detail else f"{base}."


def _engine_timeout() -> str:
    return "La página tardó demasiado en responder."


async def browser_dom_action(
    tctx: ToolContext,
    operation: DomOperation,
    target: str = "",
    value: str | None = None,
) -> str:
    """Drive the integrated browser's CURRENT page.

    ``operation``: click (CSS selector or aria label/role), scroll
    (pixels in ``value`` or to ``target``), set_value (fill a page
    input — native setter + input event), query (read the page text,
    truncated). To open a new page use browser.navigate.
    """
    raw_operation = (operation or "").strip()
    if raw_operation not in _OPERATIONS:
        return (
            f"Operación no válida: {raw_operation!r}. "
            "Usa click, scroll, set_value o query."
        )
    target = (target or "").strip()
    if value is not None and not isinstance(value, str):
        value = str(value)

    # Demo/mock path: same frozen shape, canned result marked as mock.
    if tctx.deps.config.agent.mock:
        result = f"[mock] {operation}: {target or 'página'}"
        if value:
            result += f" = {value}"
        await tctx.emit(
            BrowserDomActionEvent(
                operation=operation,
                target=target,
                value=value,
                result=result,
            )
        )
        return result

    # Real path (engine first): execute against the IN-PROCESS engine —
    # the desktop still receives the frozen event so it can mirror the
    # action on the user's view, but the agent never waits on it.
    engine = tctx.deps.browser_engine
    if engine is not None:
        created_at = datetime.now(timezone.utc)
        await tctx.emit(
            BrowserDomActionEvent(
                operation=operation,
                target=target,
                value=value,
                result=None,
                created_at=created_at,
            )
        )
        try:
            if operation == "query":
                return await engine.query(target)
            if operation == "click":
                return await engine.click(target)
            if operation == "set_value":
                return await engine.set_value(target, value or "")
            return await engine.scroll(target, value)
        except BrowserElementError as exc:
            return str(exc)
        except BrowserTimeoutError:
            return _engine_timeout()
        except BrowserEngineError as exc:
            return _engine_unavailable(exc.detail)
        except BrowserBlockedError as exc:
            return _engine_blocked(exc.reason)

    # Legacy fallback (engine disabled): emit the REQUEST, then await the
    # execution result that Electron main pushes back (keyed by this
    # event's created_at).
    created_at = datetime.now(timezone.utc)
    await tctx.emit(
        BrowserDomActionEvent(
            operation=operation,
            target=target,
            value=value,
            result=None,
            created_at=created_at,
        )
    )
    store = tctx.deps.browser_dom
    if store is None:
        return _NO_RESPONSE
    result = await store.wait_for(created_at, DOM_ACTION_TIMEOUT_S)
    if result is None:
        return _NO_RESPONSE
    return result


def _landing_detail(state: BrowserState, requested: str) -> str:
    """The REAL post-navigation state, so the agent sees where it
    landed — including redirects/blocked loads (never a fake success)."""
    where = state.url or "página vacía"
    title = f" — {state.title}" if state.title else ""
    if state.url == requested:
        return f"Navegación completada: {where}{title}"
    return (
        f"La navegación terminó en {where}{title} "
        f"(la dirección pedida era {requested})."
    )


async def browser_navigate(tctx: ToolContext, url: str) -> str:
    """Open a new page in the integrated browser.

    Navigates the SAME WebContentsView the user manipulates (main-owned,
    allowlist-pre-checked). Emits the frozen ``browser.navigate`` wire
    event and AWAITS the post-navigation state the desktop pushes back
    (``/api/browser-state``), so the agent sees the REAL resulting
    url/title — never a canned \"done\". If the desktop never reports
    (no Electron, view unattached, page blocked, failed load), the
    handler answers honestly after a bounded wait.
    """
    url = (url or "").strip()
    if not url:
        return (
            "URL no válida: no puedo navegar a una dirección vacía. "
            "Pásame la dirección completa (p. ej. https://...)."
        )

    # Demo/mock path: same frozen shape, canned result marked as mock.
    if tctx.deps.config.agent.mock:
        result = f"[mock] Navegación a {url}"
        await tctx.emit(
            BrowserNavigateEvent(
                url=url,
                title="[mock] Página simulada",
                loading=False,
            )
        )
        return result

    # Real path (engine first): the in-process engine navigates and
    # reports the REAL landing (url/title — including redirects). The
    # desktop still receives the frozen event so the user's view
    # mirrors the navigation, but the agent never waits on it.
    engine = tctx.deps.browser_engine
    if engine is not None:
        # The engine's policy gate runs BEFORE anything is emitted: a
        # doomed navigation never reaches the desktop mirror either.
        decision = engine.check_url(url)
        if not decision.allowed:
            return _engine_blocked(decision.reason)
        store = tctx.deps.browser_state
        baseline = store.get() if store is not None else None
        created_at = datetime.now(timezone.utc)
        await tctx.emit(
            BrowserNavigateEvent(
                url=url,
                title=baseline.title if baseline is not None and baseline.url == url else "",
                can_go_back=baseline.can_go_back if baseline is not None else False,
                can_go_forward=baseline.can_go_forward if baseline is not None else False,
                loading=True,
                created_at=created_at,
            )
        )
        try:
            state = await engine.navigate(url)
        except BrowserTimeoutError:
            return _engine_timeout()
        except BrowserEngineError as exc:
            return _engine_unavailable(exc.detail)
        except BrowserBlockedError as exc:
            return _engine_blocked(exc.reason)
        # BROWSER-USE: complete the mirror with the REAL landing state.
        # The legacy path gets the post-navigation state back from
        # Electron main (PUT /api/browser-state); the engine knows it
        # in-process, so emit it directly — the renderer bag reduces the
        # same frozen field set and the panel shows the true url/title
        # (loading=False clears the spinner). Main dedupes a re-navigate
        # to the URL already displayed, so the Electron view is
        # untouched by this second event.
        await tctx.emit(
            BrowserNavigateEvent(
                url=state.url,
                title=state.title,
                can_go_back=state.can_go_back,
                can_go_forward=state.can_go_forward,
                loading=False,
                created_at=created_at,
            )
        )
        # Keep the server-side mirror coherent with the engine (the
        # loading event's baseline for the NEXT navigation reads this).
        store = tctx.deps.browser_state
        if store is not None:
            store.update(
                BrowserStatePayload(
                    url=state.url,
                    title=state.title,
                    can_go_back=state.can_go_back,
                    can_go_forward=state.can_go_forward,
                    loading=False,
                )
            )
        return _landing_detail(state, url) + _embeddable_note(state.url)

    # Engine disabled: fall back to the Electron-main round-trip.
    return await _legacy_navigate(tctx, url)


def _embeddable_note(url: str) -> str:
    """R7 (2026-08-14, reviewer round 7 finding 2): some sites send
    X-Frame-Options / CSP frame-ancestors that forbid being displayed
    inside an iframe. The ELECTRON app layers a main-owned
    WebContentsView over the placeholder (unaffected), but the WEB
    harness renders a real iframe — the page silently fails there while
    the agent still says "Listo, te la abrí". Probe the landing page's
    headers and return an honest note the agent must relay, or "" when
    the page is embeddable (or unknown)."""
    try:
        req = urlrequest.Request(url, method="GET", headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
            "Accept": "text/html,*/*",
        })
        with urlrequest.urlopen(req, timeout=6) as resp:
            xfo = resp.headers.get("X-Frame-Options", "").lower()
            csp = resp.headers.get("Content-Security-Policy", "").lower()
    except Exception:
        # Network hiccup / probe refused: we cannot know — stay silent
        # rather than invent a claim.
        return ""
    blocked = False
    if xfo in ("deny", "sameorigin"):
        blocked = True
    elif "frame-ancestors" in csp and "frame-ancestors 'none'" in csp:
        blocked = True
    elif "frame-ancestors" in csp and "localhost:5173" not in csp:
        # CSP frame-ancestors present but not allowing our origin.
        blocked = True
    if not blocked:
        return ""
    return (
        " AVISO: este sitio no permite mostrarse dentro del panel de la "
        "app web (lo bloquea para verse embebido); en la app de escritorio "
        "sí se ve. No digas 'listo, ya lo abrí' como si estuviera en "
        "pantalla: di la verdad, por ejemplo 'te abrí la página pero este "
        "sitio no deja verse dentro del panel; ¿querés que pruebe con otro?'"
    )


async def _legacy_navigate(tctx: ToolContext, url: str) -> str:
    # Legacy fallback (engine disabled): snapshot the view's current
    # state, emit the REQUEST, then await the post-navigation state
    # Electron main pushes back.
    store = tctx.deps.browser_state
    baseline = store.get() if store is not None else None
    created_at = datetime.now(timezone.utc)
    await tctx.emit(
        BrowserNavigateEvent(
            url=url,
            title=baseline.title if baseline is not None and baseline.url == url else "",
            can_go_back=baseline.can_go_back if baseline is not None else False,
            can_go_forward=baseline.can_go_forward if baseline is not None else False,
            loading=True,
            created_at=created_at,
        )
    )
    if store is None:
        return _NAV_NO_RESPONSE
    state = await store.wait_for_update(NAVIGATE_TIMEOUT_S)
    if state is None:
        return _NAV_NO_RESPONSE
    return _landing_detail(state, url)


# --------------------------------------------------------------------- #
SPECS = [
    ToolSpec(
        "browser.dom_action",
        "Drive the browser's CURRENT page (in-process engine; the "
        "desktop view mirrors it): click a target (CSS selector or "
        "aria label/visible text), scroll (pixels in ``value`` or to "
        "``target``), set_value (fill a page input), or query (read "
        "the page text, truncated). To open a new page use "
        "browser.navigate.",
        browser_dom_action,
        PolicyKind.REVERSIBLE,
        effect="revertible",
    ),
    ToolSpec(
        "browser.navigate",
        "Open a page in the browser: navigate to the given URL "
        "(any PUBLIC page over http(s) is allowed — no domain "
        "allowlist; local/private addresses and non-http schemes "
        "remain blocked). Returns the REAL resulting url/title, "
        "including redirects. The desktop view mirrors the navigation "
        "when the app is open.",
        browser_navigate,
        PolicyKind.REVERSIBLE,
        effect="revertible",
    ),
]
