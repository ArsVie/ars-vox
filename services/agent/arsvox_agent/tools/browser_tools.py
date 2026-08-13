"""browser.dom_action + browser.navigate — the agent drives the integrated browser.

GATE-5 W2-DRIVE: the agent's DOM bridge. The tool emits the FROZEN
``browser.dom_action`` wire event (operation click|scroll|set_value|
query, target, value, result) on the bus. The renderer routes the frame
into the store (visible ``lastDomAction``) and forwards it to Electron
main, which EXECUTES it against the browser view's webContents (never
the app window's page) and PUTs the real result back to the service
(``/api/browser-dom-result``). This handler AWAITS that round-trip keyed
by the event's own ``created_at``, so the model sees the ACTUAL page
result (query text, click verdict) — not a canned "done". If the
desktop never answers (no Electron, view unattached), the handler
returns an honest no-response message after a bounded wait.

GATE-5 W2-NAVIGATE: the agent's navigation tool. ``browser.navigate``
emits the FROZEN ``browser.navigate`` wire event (url, title,
can_go_back, can_go_forward, loading) — the same event the user's own
address-bar command emits. The renderer routes it to main
(window.arsvox.browserNavigate → WebContentsView, allowlist-pre-checked
in browser-view.ts), and main PUTs the view's REAL post-navigation
state via /api/browser-state into the browser-state store. The handler
AWAITS that store update (bounded window), so the model sees the real
resulting url/title — including redirects. Never a fake success:
timeouts / no store / blocked pages answer honestly in Spanish.

SEARCH-BAR SINGLE PATH (one browser state, one authority): the agent
NAVIGATES — it never types into the renderer's address bar. The address
bar draft is renderer-only transient state (its submit is a user
gesture); the browser's one authority is the WebContentsView, driven by
main-owned navigation (browser.navigate, allowlist-pre-checked). What
``set_value`` is FOR here is the PAGE's own inputs (site search boxes,
forms) — the vision's "agent drives the search bar" is the page's
search bar, applied to the SAME view the user manipulates.

Mock mode (config.agent.mock — the demo path): same frozen event shape,
canned result explicitly marked "[mock]". The demo never pretends a
real DOM execution happened.
"""

from datetime import datetime, timezone
from typing import Literal

from arsvox_contracts import PolicyKind
from arsvox_contracts.events import BrowserDomActionEvent, BrowserNavigateEvent

from arsvox_agent.browser_state import BrowserState
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
# reports (no Electron, view unattached, allowlist-blocked, failed
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

    # Real path: emit the REQUEST, then await the execution result that
    # Electron main pushes back (keyed by this event's created_at).
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

    # Real path: snapshot the view's current state, emit the REQUEST,
    # then await the post-navigation state Electron main pushes back.
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
        "Drive the integrated browser's CURRENT page: click a target "
        "(CSS selector or aria label/role), scroll (pixels or to a "
        "target), set_value (fill a page input), or query (read the "
        "page text, truncated). To open a new page use browser.navigate.",
        browser_dom_action,
        PolicyKind.REVERSIBLE,
        effect="revertible",
    ),
    ToolSpec(
        "browser.navigate",
        "Open a new page in the integrated browser: navigate the SAME "
        "WebContentsView the user manipulates to the given URL "
        "(allowlist-pre-checked by the view). Returns the real "
        "resulting url/title, or an honest no-response if the desktop "
        "does not confirm the navigation.",
        browser_navigate,
        PolicyKind.REVERSIBLE,
        effect="revertible",
    ),
]
