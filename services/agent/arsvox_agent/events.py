"""In-process event bus. The WebSocket broadcaster subscribes and fans
events out to every connected client."""

import asyncio
import logging
from typing import Any, Callable

from pydantic import BaseModel

log = logging.getLogger(__name__)

_SUBSCRIBER_CAP = 1000


class EventBus:
    def __init__(self) -> None:
        self._queues: list[asyncio.Queue] = []
        # GATE-3.5 (A6/R28): synchronous observers (e.g. SnapshotTracker).
        # They receive every published payload AFTER sequence tagging and
        # BEFORE fan-out to the client queues, so server-side state
        # tracking is lossless by construction — no queue cap, no
        # starvation window (C8). Cheap dict work only; never await here.
        self._listeners: list[Callable[[dict[str, Any]], None]] = []
        # H5: monotonic session sequence. Every published event is tagged
        # with it; the reconnect snapshot carries the current value so the
        # client can detect gaps (QueueFull drops) and resync.
        self._seq = 0

    @property
    def sequence(self) -> int:
        """Current session sequence (last assigned). Snapshot-on-connect
        uses this value so the client's sequence continues seamlessly."""
        return self._seq

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=_SUBSCRIBER_CAP)
        self._queues.append(q)
        return q

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self._queues:
            self._queues.remove(queue)

    def add_listener(self, listener: callable) -> None:
        """Register a synchronous observer. Called with every published
        payload (dict) after sequence tagging, before queue fan-out.
        Idempotent per listener object."""
        if listener not in self._listeners:
            self._listeners.append(listener)

    def remove_listener(self, listener: callable) -> None:
        if listener in self._listeners:
            self._listeners.remove(listener)

    async def publish(self, event: BaseModel) -> None:
        payload: dict[str, Any] = event.model_dump(mode="json")
        self._seq += 1
        payload["sequence"] = self._seq
        for listener in list(self._listeners):
            try:
                listener(payload)
            except Exception:  # noqa: BLE001 — observers must never break the bus
                log.exception("bus listener %r failed", listener)
        for q in list(self._queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                log.warning("dropping event %s for a slow subscriber", event.__class__.__name__)
