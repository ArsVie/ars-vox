"""Media tools. GATE-5 (W1-YOUTUBE): media.search_youtube is REAL.

The vision line: *"The LLM searches YouTube and OFFERS the user options
(results render as selectable cards)."* The tool searches through the
provider seam (arsvox_agent/search/youtube.py — default scraping
provider, no API key) and emits the GATE-5 wire member
``media.search_results`` with the real cards. Zero results is an honest
empty list (the agent tells the user "no encontré nada") — never a
fixture (FIXTURE_RESULTS is deleted).

media.play resolves ids against the results the search last OFFERED —
the offered set is the honesty gate: the agent can only play what it
really offered, never an invented id and never a fallback sample video.

GATE-3.5 (R24-R27): ALL media tools route through the single
service-side MediaController (arsvox_agent/media.py) — the same
controller client actions use. No tool emits a partial media command
anymore: every transition publishes ONE full MediaStateEvent carrying
position/duration/source/kind, so agent play -> user pause/seek -> agent
resume share one authoritative state (R24), seek really emits the target
position (R25), and the renderer's player callbacks reconcile against
the same shape (R26).
"""

import json
import re

from arsvox_contracts import PanelType
from arsvox_contracts.commands import PanelOpen
from arsvox_contracts.enums import MediaKind, MediaSource
from arsvox_contracts.events import (
    MediaSearchResult,
    MediaSearchResultsEvent,
    UiCommandEvent,
)

from arsvox_agent.media import media_controller
from arsvox_agent.search.youtube import (
    YoutubeSearchError,
    get_youtube_search_provider,
)
from arsvox_agent.tools.context import ToolContext

# Real YouTube video ids are exactly 11 chars of [A-Za-z0-9_-].
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# The results the search last OFFERED — the only ids media.play may
# resolve (real search output only; replaced on every search).
_last_offered: list[MediaSearchResult] = []


def reset_offered_results() -> None:
    """Test hook: clear the offered set (module state is per-process)."""
    _last_offered.clear()


async def media_search_youtube(tctx: ToolContext, query: str) -> str:
    q = query.strip()
    if not q:
        return "Necesito un término de búsqueda."
    try:
        provider = get_youtube_search_provider()
        hits = await provider.search(q)
    except YoutubeSearchError as exc:
        # Honest failure: no fake results, no silent fallback. The frozen
        # actions.py turns this non-JSON return into a failed verdict the
        # agent reads and the UI surfaces.
        return f"No pude buscar en YouTube: {exc}"
    cards = [
        MediaSearchResult(
            id=hit.id,
            title=hit.title,
            source=MediaSource.YOUTUBE,
            kind=MediaKind.VIDEO,
            channel=hit.channel,
            duration_s=hit.duration_s,
            published=hit.published,
            thumbnail_url=hit.thumbnail_url,
        )
        for hit in hits
        if YOUTUBE_ID_RE.match(hit.id)
    ]
    _last_offered[:] = cards
    # GATE-5 wire: media.search_results carries the real cards; the user
    # picks by click (media.select_result) or voice (media.play). An
    # empty list is the honest "no encontré nada" — the panel renders the
    # empty state and the agent says so.
    await tctx.emit(MediaSearchResultsEvent(query=q, results=cards))
    return json.dumps([c.model_dump() for c in cards], ensure_ascii=False)


async def media_play(tctx: ToolContext, result_id: str) -> str:
    # Honesty gate: only ids the search actually OFFERED can be played —
    # the agent holds them from the media.search_results JSON it saw.
    result = next((r for r in _last_offered if r.id == result_id), None)
    if result is None:
        return (
            "No conozco ese resultado: busca primero y elige uno de los "
            "resultados ofrecidos."
        )
    if not YOUTUBE_ID_RE.match(result.id):
        return f"El resultado «{result.id}» no es un id de vídeo de YouTube válido."
    url = f"https://www.youtube.com/watch?v={result.id}"
    tctx.deps.panels.upsert(PanelType.MEDIA.value, result.title)
    await tctx.emit(UiCommandEvent(command=PanelOpen(panel_type=PanelType.MEDIA, title=result.title)))
    await media_controller.play(
        tctx.bus,
        title=result.title,
        url=url,
        video_id=result.id,
        source=MediaSource.YOUTUBE,
        kind=MediaKind.VIDEO,
    )
    return f"Reproduciendo: {result.title}"


async def media_pause(tctx: ToolContext) -> str:
    await media_controller.pause(tctx.bus)
    return "Video en pausa."


async def media_resume(tctx: ToolContext) -> str:
    await media_controller.resume(tctx.bus)
    return "Video reanudado."


async def media_stop(tctx: ToolContext) -> str:
    await media_controller.stop(tctx.bus)
    return "Video detenido."


async def media_seek(tctx: ToolContext, seconds: int) -> str:
    # R25: real seek — the controller moves the position and emits the
    # actual target in the MediaStateEvent (no fake "Posición cambiada"
    # without a position). The renderer drives the iframe from it.
    if not media_controller.has_track():
        # Nothing loaded: nothing moved. Say so plainly — never claim a
        # position change for a seek that could not apply (R25 no-fake-
        # success contract).
        return "No hay medios cargados para cambiar la posición."
    await media_controller.seek(tctx.bus, max(0, int(seconds)))
    return f"Posición cambiada a {media_controller.position_s} segundos."


async def media_set_volume(tctx: ToolContext, volume: float) -> str:
    await media_controller.set_volume(tctx.bus, volume)
    return f"Volumen al {int(media_controller.volume * 100)}%."


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec(
        "media.search_youtube",
        "Search YouTube by topic or creator. Returns a JSON list of real "
        "result ids; then call media.play with one id. An empty list means "
        "nothing was found — tell the user 'no encontré nada', never invent "
        "results.",
        media_search_youtube,
        PolicyKind.READ_ONLY,
    ),
    ToolSpec(
        "media.play",
        "Play one of the results the search just offered; opens the media panel.",
        media_play,
        PolicyKind.REVERSIBLE,
    ),
    ToolSpec("media.pause", "Pause the current media.", media_pause, PolicyKind.REVERSIBLE),
    ToolSpec("media.resume", "Resume the current media.", media_resume, PolicyKind.REVERSIBLE),
    ToolSpec("media.stop", "Stop the current media.", media_stop, PolicyKind.REVERSIBLE),
    ToolSpec("media.seek", "Seek to a position in seconds.", media_seek, PolicyKind.REVERSIBLE),
    ToolSpec("media.set_volume", "Set media volume, 0.0 to 1.0.", media_set_volume, PolicyKind.REVERSIBLE),
]
