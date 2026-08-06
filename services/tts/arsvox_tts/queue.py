"""TTS queue: phrase streaming, priority, cancellation, size cap, cleanup."""

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

_MARKDOWN = re.compile(r"[*_#`>|~\[\]()]+")
_WHITESPACE = re.compile(r"\s+")


@dataclass
class TtsQueueItem:
    text: str
    priority: bool = False
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class TTSQueue:
    """Ordered by priority (priority first), then insertion order."""

    def __init__(self, max_size: int = 20):
        self.max_size = max_size
        self._items: list[TtsQueueItem] = []

    @staticmethod
    def cleanup(text: str) -> str:
        """Sentence cleanup: strip markdown symbols, collapse whitespace."""
        cleaned = _MARKDOWN.sub("", text)
        cleaned = _WHITESPACE.sub(" ", cleaned).strip()
        return cleaned

    def push(self, text: str, priority: bool = False) -> bool:
        item = TtsQueueItem(text=self.cleanup(text), priority=priority)
        if not item.text or len(self._items) >= self.max_size:
            return False
        self._items.append(item)
        return True

    def pop_next(self) -> TtsQueueItem | None:
        priority_items = [i for i in self._items if i.priority]
        if priority_items:
            self._items.remove(priority_items[0])
            return priority_items[0]
        if self._items:
            return self._items.pop(0)
        return None

    def clear(self) -> int:
        n = len(self._items)
        self._items.clear()
        return n

    def __len__(self) -> int:
        return len(self._items)
