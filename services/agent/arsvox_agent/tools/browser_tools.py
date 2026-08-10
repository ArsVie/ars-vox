"""browser.dom_action — the agent drives the integrated browser.

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
from arsvox_contracts.events import BrowserDomActionEvent

from arsvox_agent.tools import ToolSpec
from arsvox_agent.tools.context import ToolContext

DomOperation = Literal["click", "scroll", "set_value", "query"]
_OPERATIONS: tuple[str, ...] = ("click", "scroll", "set_value", "query")

# How long the handler waits for Electron main to execute the action
# and push the result back (bounded — a missing desktop must not eat
# the turn).
DOM_ACTION_TIMEOUT_S = 10.0

_NO_RESPONSE = (
    "El escritorio no respondió a la acción de navegador "
    "(¿está abierta la app?)."
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
    ),
]
