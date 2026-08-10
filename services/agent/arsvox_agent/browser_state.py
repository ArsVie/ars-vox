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

import threading
from dataclasses import dataclass

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
