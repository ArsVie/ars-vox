"""Local media tools (GATE-5 W1-MEDIA-LOCAL): one player, two sources.

The local music library is a first-class agent capability on the SAME
wire the YouTube lane uses: ``media.search_local`` discovers real files
from ``config.resolved_paths.library_dir`` and emits them as
``MediaSearchResultsEvent`` cards (source=local + local_path); the agent
offers the cards and the user picks by CLICK (``media.select_result``,
handled in actions.py) or by VOICE (``media.play_local``). Both land in
the ONE service-side MediaController (arsvox_agent/media.py) with
source=LOCAL/kind=AUDIO/url=local_path, so local files reach the SAME
unified player as YouTube content — same controls, same UI.

Honesty contract: discovery scans the real library; an empty library is
an honest empty result, never a fixture list. ``media.play_local`` only
plays files the library actually owns (resolve_library_file guard).
"""

import json

from arsvox_contracts import PanelType, PolicyKind
from arsvox_contracts.commands import PanelOpen
from arsvox_contracts.enums import MediaKind, MediaSource
from arsvox_contracts.events import MediaSearchResultsEvent, UiCommandEvent

from arsvox_agent.media import media_controller
from arsvox_agent.search.local_library import discover_library, resolve_library_file
from arsvox_agent.tools import ToolSpec
from arsvox_agent.tools.context import ToolContext


async def media_search_local(tctx: ToolContext, query: str = "") -> str:
    """Search the local music library (config.resolved_paths.library_dir).

    Discovers real audio files and emits them as media.search_results
    cards (source=local, local_path set) — the same unified search
    surface YouTube results use. Returns a JSON list of results so the
    agent can offer options and follow up with media.play_local.
    """
    library_dir = tctx.deps.config.resolved_paths.library_dir
    results = discover_library(library_dir, query)
    await tctx.emit(MediaSearchResultsEvent(query=query, results=results))
    return json.dumps([r.model_dump() for r in results], ensure_ascii=False)


async def media_play_local(tctx: ToolContext, local_path: str) -> str:
    """Play a local library file in the unified media player.

    ``local_path`` must be a file INSIDE the configured library dir (the
    agent gets these from media.search_local results). Routes through the
    single MediaController with source=local/kind=audio/url=local_path —
    the same controller YouTube plays through — and opens the media
    panel. Voice pick path: user says "el segundo" -> agent calls this
    with the picked local_path.
    """
    library_dir = tctx.deps.config.resolved_paths.library_dir
    file = resolve_library_file(library_dir, local_path)
    if file is None:
        return (
            f"No se encontró el archivo '{local_path}' en la biblioteca local."
        )
    title = file.stem
    tctx.deps.panels.upsert(PanelType.MEDIA.value, title)
    await tctx.emit(UiCommandEvent(command=PanelOpen(panel_type=PanelType.MEDIA, title=title)))
    await media_controller.play(
        tctx.bus,
        title=title,
        url=str(file),
        source=MediaSource.LOCAL,
        kind=MediaKind.AUDIO,
    )
    return f"Reproduciendo: {title}"


SPECS = [
    ToolSpec(
        "media.search_local",
        "Search the local music library (mp3, m4a, wav, ogg, flac, ...). "
        "Returns a JSON list of results; then call media.play_local with one "
        "result's local_path.",
        media_search_local,
        PolicyKind.READ_ONLY,
    ),
    ToolSpec(
        "media.play_local",
        "Play a local library file in the unified media player (voice pick "
        "after media.search_local). Takes the local_path from a search result.",
        media_play_local,
        PolicyKind.REVERSIBLE,
    ),
]
