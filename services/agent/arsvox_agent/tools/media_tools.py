"""Media tools. YouTube adapter is a fixture stub for iteration 1
(real adapter lands with the browser service — Wave 2); the media panel
plays the configured sample video.

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
from arsvox_contracts.events import UiCommandEvent, YoutubeSearchEvent, YoutubeVideoResult

from arsvox_agent.media import media_controller
from arsvox_agent.tools.context import ToolContext

# Real YouTube video ids are exactly 11 chars of [A-Za-z0-9_-]; fixture-only
# ids (\"yt-1\") fall back to the sample video url.
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

FIXTURE_RESULTS = [
    YoutubeVideoResult(
        id="dQw4w9WgXcQ",
        title="Taller de carpintería para principiantes",
        channel="El Taller de Marta",
        duration_s=742,
        published="hace 3 días",
        thumbnail_url=None,
    ),
    YoutubeVideoResult(
        id="9bZkp7q19f0",
        title="Cómo lijar madera sin errores",
        channel="Bricolaje Fácil",
        duration_s=495,
        published="hace 1 semana",
        thumbnail_url=None,
    ),
    YoutubeVideoResult(
        id="kJQP7kiw5Fk",
        title="Hacer una estantería en un día",
        channel="Hazlo Tú Mismo",
        duration_s=1547,
        published="hace 2 semanas",
        thumbnail_url=None,
    ),
    YoutubeVideoResult(
        id="fJ9rUzIMcZQ",
        title="Herramientas básicas de banco",
        channel="El Taller de Marta",
        duration_s=903,
        published="hace 1 mes",
        thumbnail_url=None,
    ),
]


async def media_search_youtube(tctx: ToolContext, query: str) -> str:
    q = query.lower()
    results = [r for r in FIXTURE_RESULTS if q in r.title.lower()] or FIXTURE_RESULTS
    # H7: emit the same YoutubeSearchEvent the demo path uses so the YouTube
    # panel surface shows the agent's results.
    await tctx.emit(YoutubeSearchEvent(query=query, results=results))
    return json.dumps([r.model_dump() for r in results], ensure_ascii=False)


async def media_play(tctx: ToolContext, result_id: str) -> str:
    result = next((r for r in FIXTURE_RESULTS if r.id == result_id), FIXTURE_RESULTS[0])
    if YOUTUBE_ID_RE.match(result.id):
        url = f"https://www.youtube.com/watch?v={result.id}"
        source, kind, video_id = MediaSource.YOUTUBE, MediaKind.VIDEO, result.id
    else:
        # Fixture-only id -> configured sample video (local-ish source).
        url = tctx.deps.config.media.sample_video_url
        source, kind, video_id = MediaSource.LOCAL, MediaKind.VIDEO, None
    tctx.deps.panels.upsert(PanelType.MEDIA.value, result.title)
    await tctx.emit(UiCommandEvent(command=PanelOpen(panel_type=PanelType.MEDIA, title=result.title)))
    await media_controller.play(
        tctx.bus,
        title=result.title,
        url=url,
        video_id=video_id,
        source=source,
        kind=kind,
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
        "Search YouTube by topic or creator. Returns a JSON list of result ids;"
        " then call media.play with one id.",
        media_search_youtube,
        PolicyKind.READ_ONLY,
    ),
    ToolSpec("media.play", "Play a media result; opens the media panel.", media_play, PolicyKind.REVERSIBLE),
    ToolSpec("media.pause", "Pause the current media.", media_pause, PolicyKind.REVERSIBLE),
    ToolSpec("media.resume", "Resume the current media.", media_resume, PolicyKind.REVERSIBLE),
    ToolSpec("media.stop", "Stop the current media.", media_stop, PolicyKind.REVERSIBLE),
    ToolSpec("media.seek", "Seek to a position in seconds.", media_seek, PolicyKind.REVERSIBLE),
    ToolSpec("media.set_volume", "Set media volume, 0.0 to 1.0.", media_set_volume, PolicyKind.REVERSIBLE),
]
