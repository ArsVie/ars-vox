"""W2-VIEW (GATE-5, ADR 0007) — in-process mirror of the desktop view's
REAL navigation state.

The integrated browser is a WebContentsView owned by the Electron MAIN
process (apps/desktop). Main publishes the view's live navigation state
(url/title/can_go_back/can_go_forward/loading) to this service with an
authenticated ``PUT /api/browser-state`` (frozen snake_case wire shape —
the exact ``BrowserNavigateEvent`` field set; do NOT rename fields).
``actions.py`` and ``demo_tools.py`` emit those REAL values instead of
the hardcoded ``False`` defaults the service had before this channel
existed.

Snapshot wiring: browser state is deliberately EXCLUDED from reconnect
snapshots (``snapshot.py`` ``build_state_snapshot``). The view is
client-side and IS the navigation authority; the service mirror is a
best-effort cache for event emission. On reconnect main re-pushes the
live state on the next did-* event, so the mirror self-heals without
snapshot participation.
"""

import asyncio
import threading
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel


class BrowserStatePayload(BaseModel):
    """FROZEN wire shape — mirrors BrowserNavigateEvent fields exactly
    (W2-VIEW: published by the Electron main process; do not rename)."""

    url: str = ""
    title: str = ""
    can_go_back: bool = False
    can_go_forward: bool = False
    loading: bool = False


@dataclass(frozen=True)
class BrowserState:
    """Immutable snapshot of the view's latest known navigation state."""

    url: str = ""
    title: str = ""
    can_go_back: bool = False
    can_go_forward: bool = False
    loading: bool = False


class BrowserStateStore:
    """Latest known navigation state of the desktop WebContentsView.

    In-process only (no DB): a live mirror of a client-owned view, not
    authoritative history. Thread-safe: the PUT handler and agent-tool
    emitters may run on different threads/loops.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = BrowserState()

    def update(self, payload: BrowserStatePayload) -> None:
        with self._lock:
            self._state = BrowserState(
                url=payload.url,
                title=payload.title,
                can_go_back=payload.can_go_back,
                can_go_forward=payload.can_go_forward,
                loading=payload.loading,
            )

    def get(self) -> BrowserState:
        with self._lock:
            return self._state


# --------------------------------------------------------------------- #
# W2-DRIVE (GATE-5): the dom_action execution round-trip.
#
# The browser.dom_action TOOL emits the frozen wire event (the request);
# the renderer forwards it to Electron main via arsvox:browser-dom-action
# IPC; main executes against the browser view's webContents and PUTs the
# REAL result back here (authenticated /api/browser-dom-result, echo of
# the request's created_at). The tool awaits wait_for() keyed by the
# SAME created_at, so the agent sees the actual page result — never a
# fake "done".
# --------------------------------------------------------------------- #


class DomActionResultPayload(BaseModel):
    """Service-internal channel payload (main -> service). NOT part of the
    frozen client wire — mirrors BrowserStatePayload's role for the
    browser-state channel."""

    created_at: datetime
    result: str


# Results older than this are evicted (unmatched/never-awaited requests).
_DOM_RESULT_CAP = 64


class DomActionResultStore:
    """Latest dom_action execution results, keyed by the request's
    created_at (the browser.dom_action wire event's own timestamp).

    Thread-safe + loop-agnostic (mirrors BrowserStateStore's threading
    design): update() may be called from any thread/loop (the FastAPI
    PUT handler), wait_for() from any loop (the tool handler). Waiters
    are woken via call_soon_threadsafe so no loop affinity leaks.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._results: dict[datetime, str] = {}
        self._waiters: dict[datetime, list[tuple[asyncio.AbstractEventLoop, asyncio.Future]]] = {}

    def update(self, created_at: datetime, result: str) -> None:
        with self._lock:
            self._results[created_at] = result
            if len(self._results) > _DOM_RESULT_CAP:
                # Evict oldest unmatched entries (dict = insertion order).
                for key in list(self._results)[: len(self._results) - _DOM_RESULT_CAP]:
                    del self._results[key]
            for loop, fut in self._waiters.pop(created_at, []):
                if not fut.done():
                    loop.call_soon_threadsafe(fut.set_result, result)

    async def wait_for(self, created_at: datetime, timeout_s: float) -> str | None:
        """Resolve with the result for this request, or None on timeout."""
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        with self._lock:
            if created_at in self._results:
                return self._results.pop(created_at)
            self._waiters.setdefault(created_at, []).append((loop, fut))
        try:
            return await asyncio.wait_for(fut, timeout_s)
        except asyncio.TimeoutError:
            return None
        finally:
            with self._lock:
                waiters = self._waiters.get(created_at)
                if waiters:
                    waiters[:] = [(l, f) for (l, f) in waiters if f is not fut]
                    if not waiters:
                        del self._waiters[created_at]
