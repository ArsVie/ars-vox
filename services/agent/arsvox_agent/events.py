"""In-process event bus. The WebSocket broadcaster subscribes and fans
events out to every connected client."""

import asyncio
import logging
from typing import Any

from pydantic import BaseModel

log = logging.getLogger(__name__)

_SUBSCRIBER_CAP = 1000


class EventBus:
    def __init__(self) -> None:
        self._queues: list[asyncio.Queue] = []
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

    async def publish(self, event: BaseModel) -> None:
        payload: dict[str, Any] = event.model_dump(mode="json")
        self._seq += 1
        payload["sequence"] = self._seq
        for q in list(self._queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                log.warning("dropping event %s for a slow subscriber", event.__class__.__name__)
