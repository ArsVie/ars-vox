"""Per-run effect ledger (Cordis lane A1): records revertible effects
during an agent turn and rolls them back LIFO when the turn ABORTS.

Product invariants (frozen by the plan):
  * A turn that COMPLETES keeps its effects — the user wanted them. The
    ledger is dropped without rolling back; there is no commit step.
  * Rollback runs ONLY on abort: cancellation (STOP cancels the running
    task — the existing path, no new STOP surface) or an unhandled
    turn exception.
  * Teardown must never fail the teardown: a failing inverse is logged
    and skipped, the remaining inverses still run.

Which tools record inverses is an OPT-IN decision (see ``_INVERSE_PAIRS``
and ``inverse_for``). Only pairs whose inverse is a REGISTERED tool with
an exact state-restoring effect are wired. Deliberately NOT wired:
  * document.create -> document.delete  — no document.delete tool exists
  * tasks.add -> tasks.remove           — no tasks.remove tool exists
  * telegram.*, reminders.create        — emissions; they ride the
    existing PNR/confirmation machinery and must never be reversed by
    the ledger.
A wrong rollback deletes user data (tasks/documents), so under-wiring is
the safe default: no registered inverse tool -> no inverse.

Reversal reuses EXISTING tool handlers via ``ToolRegistry.execute_direct``
(see runtime._recording_handler) — the ledger itself never touches
stores or files.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

log = logging.getLogger(__name__)

Inverse = Callable[[], Awaitable[Any]]


@dataclass
class LedgerToken:
    """Arming token returned by ``EffectLedger.add``.

    ``armed`` starts True; ``rollback`` runs the inverse only while the
    token is armed and disarms it before running (each inverse at most
    once). Callers that supersede an effect in-run (e.g. the model
    already undid it) can ``disarm()`` to opt out of the next rollback.
    """

    key: str
    armed: bool = True

    def disarm(self) -> None:
        self.armed = False


class EffectLedger:
    """LIFO list of (key, inverse) pairs for one agent turn."""

    def __init__(self) -> None:
        self._entries: list[tuple[LedgerToken, Inverse]] = []

    def add(self, key: str, inverse: Inverse) -> LedgerToken:
        """Record a revertible effect. Returns its arming token.

        ``key`` is a logical name (usually the effectful tool name); it
        has no uniqueness constraint here — per-key "at most one armed"
        decisions are the recorder's job via :meth:`has_armed`.
        """
        token = LedgerToken(key)
        self._entries.append((token, inverse))
        return token

    def has_armed(self, key: str) -> bool:
        """True when an armed entry for ``key`` exists.

        Used by the recorder to honour "clear media ONLY when the same
        run opened it": the first successful media.play of a run arms
        the media inverse; later ones in the same run find it armed and
        do not stack duplicates.
        """
        return any(t.armed and t.key == key for t, _ in self._entries)

    def __len__(self) -> int:
        return len(self._entries)

    async def rollback(self) -> None:
        """Run every armed inverse in LIFO order, each AT MOST ONCE.

        Idempotent: a second rollback() is a no-op (every token was
        disarmed while running). An inverse that raises is logged and
        skipped — teardown never fails the teardown. ``CancelledError``
        propagates: the host task is being torn down anyway, and
        swallowing it would fight the cancellation.
        """
        for token, inverse in reversed(self._entries):
            if not token.armed:
                continue
            token.armed = False
            try:
                await inverse()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — teardown must survive
                log.exception("effect rollback failed for key %r", token.key)


# --------------------------------------------------------------------- #
# Opt-in inverse pairs. ONLY pairs whose inverse is a REGISTERED tool
# with an EXACT state-restoring effect are listed. The ``success``
# predicate gates on the tool's returned text: an inverse is recorded
# only when the effect REALLY happened (policy denials, PENDING_APPROVAL
# stubs and error strings never record).
#
#   media.play -> media.stop: media.play opens the media surface (panel
#   open + PLAYING track); its exact registered inverse is media.stop
#   (existing handler, same controller). Recorded at most once per run
#   (has_armed guard): the run that opened the media surface is the run
#   that clears it. media.stop keeps the loaded track (STOPPED — the
#   controller has no unload transition); rollback stops playback, it
#   does not forget the video. That is the honest limit of the inverse.
_INVERSE_PAIRS: dict[str, dict[str, Any]] = {
    "media.play": {
        "inverse_tool": "media.stop",
        "inverse_args": {},
        "success": lambda result: result.startswith("Reproduciendo:"),
    },
}


def inverted_tools() -> set[str]:
    """Names of the tools whose successful calls may record inverses."""
    return set(_INVERSE_PAIRS)


def inverse_for(tool: str, args: dict, result: str) -> tuple[str, dict] | None:
    """Return ``(inverse_tool, inverse_args)`` for a successful
    effectful call, or None when there is no inverse (emission, unknown
    tool, or the effect did not happen — ``result`` failed its success
    predicate).
    """
    pair = _INVERSE_PAIRS.get(tool)
    if pair is None or not pair["success"](result):
        return None
    return pair["inverse_tool"], dict(pair["inverse_args"])
