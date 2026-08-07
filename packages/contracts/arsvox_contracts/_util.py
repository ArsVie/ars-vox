"""Small internal helpers shared across the contracts package."""

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Current UTC time; default factory for event/command timestamps."""
    return datetime.now(timezone.utc)
