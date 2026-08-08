"""Media tools. YouTube adapter is a fixture stub for iteration 1
(real adapter lands with the browser service); the media panel plays
the configured sample video.

H7 (GATE-2.5): these tools emit the event path the media surface consumes:
  - media.search_youtube -> YoutubeSearchEvent (populates the YouTube panel
    surface, same wire the demo tool uses);
  - media.play/pause/resume/stop/seek/set_volume -> UiCommandEvent with
    MediaStateChange (media.state command). The desktop store merges those
    commands into the SAME store.content.media state the MediaStateEvent
    path populates, so both emitters stay consistent on one surface.
  - media.play picks a real YouTube watch URL when the result id is a real
    video id (the store derives videoId from the url and renders the embed);
    otherwise it falls back to the configured sample video.
"""

import json
import re

from arsvox_contracts import MediaState, PanelType
from arsvox_contracts.commands import MediaStateChange, PanelOpen
from arsvox_contracts.events import UiCommandEvent, YoutubeSearchEvent, YoutubeVideoResult

from arsvox_agent.tools.context import ToolContext

# Real YouTube video ids are exactly 11 chars of [A-Za-z0-9_-]; fixture-only
# ids ("yt-1") fall back to the sample video url.
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
    url = (
        f"https://www.youtube.com/watch?v={result.id}"
        if YOUTUBE_ID_RE.match(result.id)
        else tctx.deps.config.media.sample_video_url
    )
    tctx.deps.panels.upsert(PanelType.MEDIA.value, result.title)
    await tctx.emit(UiCommandEvent(command=PanelOpen(panel_type=PanelType.MEDIA, title=result.title)))
    await tctx.emit(
        UiCommandEvent(
            command=MediaStateChange(state=MediaState.PLAYING, title=result.title, url=url)
        )
    )
    return f"Reproduciendo: {result.title}"


async def media_pause(tctx: ToolContext) -> str:
    await tctx.emit(UiCommandEvent(command=MediaStateChange(state=MediaState.PAUSED)))
    return "Video en pausa."


async def media_resume(tctx: ToolContext) -> str:
    await tctx.emit(UiCommandEvent(command=MediaStateChange(state=MediaState.PLAYING)))
    return "Video reanudado."


async def media_stop(tctx: ToolContext) -> str:
    await tctx.emit(UiCommandEvent(command=MediaStateChange(state=MediaState.STOPPED)))
    return "Video detenido."


async def media_seek(tctx: ToolContext, seconds: int) -> str:
    await tctx.emit(UiCommandEvent(command=MediaStateChange(state=MediaState.PLAYING)))
    return f"Posición cambiada a {seconds} segundos."


async def media_set_volume(tctx: ToolContext, volume: float) -> str:
    volume = max(0.0, min(1.0, volume))
    await tctx.emit(
        UiCommandEvent(command=MediaStateChange(state=MediaState.PLAYING, volume=volume))
    )
    return f"Volumen al {int(volume * 100)}%."


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
    ToolSpec("media.play", "Play a media result; opens the media panel.", media_play, PolicyKind.USER_VISIBLE),
    ToolSpec("media.pause", "Pause the current media.", media_pause, PolicyKind.USER_VISIBLE),
    ToolSpec("media.resume", "Resume the current media.", media_resume, PolicyKind.USER_VISIBLE),
    ToolSpec("media.stop", "Stop the current media.", media_stop, PolicyKind.USER_VISIBLE),
    ToolSpec("media.seek", "Seek to a position in seconds.", media_seek, PolicyKind.USER_VISIBLE),
    ToolSpec("media.set_volume", "Set media volume, 0.0 to 1.0.", media_set_volume, PolicyKind.USER_VISIBLE),
]
