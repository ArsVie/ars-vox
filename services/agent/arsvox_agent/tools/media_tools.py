"""Media tools. YouTube adapter is a fixture stub for iteration 1
(real adapter lands with the browser service); the media panel plays
the configured sample video."""

import json

from arsvox_contracts import MediaState, PanelType
from arsvox_contracts.commands import MediaStateChange, PanelOpen
from arsvox_contracts.events import UiCommandEvent

from arsvox_agent.tools.context import ToolContext

FIXTURE_RESULTS = [
    {"id": "yt-1", "title": "Taller de carpintería para principiantes", "duration": "12:34"},
    {"id": "yt-2", "title": "Cómo lijar madera sin errores", "duration": "8:12"},
    {"id": "yt-3", "title": "Hacer una estantería en un día", "duration": "25:47"},
    {"id": "yt-4", "title": "Herramientas básicas de banco", "duration": "15:03"},
]


async def media_search_youtube(tctx: ToolContext, query: str) -> str:
    q = query.lower()
    results = [r for r in FIXTURE_RESULTS if q in r["title"].lower()] or FIXTURE_RESULTS
    return json.dumps(results, ensure_ascii=False)


async def media_play(tctx: ToolContext, result_id: str) -> str:
    result = next((r for r in FIXTURE_RESULTS if r["id"] == result_id), FIXTURE_RESULTS[0])
    url = tctx.deps.config.media.sample_video_url
    tctx.deps.panels.upsert(PanelType.MEDIA.value, result["title"])
    await tctx.emit(UiCommandEvent(command=PanelOpen(panel_type=PanelType.MEDIA, title=result["title"])))
    await tctx.emit(
        UiCommandEvent(
            command=MediaStateChange(state=MediaState.PLAYING, title=result["title"], url=url)
        )
    )
    return f"Reproduciendo: {result['title']}"


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
