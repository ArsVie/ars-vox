"""Local music library discovery (GATE-5 W1-MEDIA-LOCAL).

Scans the configured library directory (``config.resolved_paths.library_dir``,
default ``data/library``) for playable audio files and exposes them through
the FROZEN wire: ``MediaSearchResult`` items with ``source=LOCAL``,
``kind=AUDIO`` and ``local_path`` set, carried by the existing
``media.search_results`` event. Selecting such a result (click or voice)
routes through the SAME MediaController and renders in the SAME unified
player as YouTube content — one player, two sources.

This is a LIBRARY module (not a tools module): it owns no SPECS and does
not touch the tool registry. The agent-facing tools live in
``arsvox_agent.tools.local_media_tools``, which feed these results into the
wire.

Honesty contract (the FIXTURE_RESULTS defect class): discovery scans the
REAL library directory. An empty or missing library yields an empty list —
never a hardcoded set of pretend tracks.
"""

from __future__ import annotations

from pathlib import Path

from arsvox_contracts.enums import MediaKind, MediaSource
from arsvox_contracts.events import MediaSearchResult

# Playable audio extensions the discovery recognizes. The set is the
# documented surface of the lane: mp3, m4a, wav, ogg, flac, plus common
# extras (aac, opus, wma, aiff, webm) — every one is a real audio format
# an <audio> element or the backend can play.
AUDIO_EXTENSIONS: frozenset[str] = frozenset(
    {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac", ".opus", ".wma", ".aiff", ".webm"}
)


def is_playable_audio(path: str | Path) -> bool:
    """True when ``path`` names a file with a playable audio extension."""
    return Path(path).suffix.lower() in AUDIO_EXTENSIONS


def discover_library(library_dir: str | Path | None, query: str = "") -> list[MediaSearchResult]:
    """Scan ``library_dir`` for playable audio files.

    Walks the directory RECURSIVELY (a music library is usually organized
    in artist/album folders); every audio file becomes one selectable
    result. ``channel`` carries the parent folder name (artist/album) for
    local files, per the wire's ``MediaSearchResult`` docstring. When
    ``query`` is non-empty, results are filtered case-insensitively on
    title and channel.

    Honest empty: a missing or empty library dir yields ``[]`` — never a
    fixture list pretending to be the library.

    Result fields:
      - id:          library-relative path (stable, unique, click-selectable)
      - title:       file stem (what the agent/user sees on the card)
      - source:      LOCAL, kind: AUDIO — the local-source wire members
      - channel:     parent folder name (artist/album), "" at the root
      - duration_s:  0 = unknown. We do NOT fabricate a duration; the
                     player learns the real one from the audio element.
      - local_path:  ABSOLUTE path — the member the renderer must play.
    """
    if library_dir is None:
        return []
    root = Path(library_dir)
    if not root.is_dir():
        return []
    q = query.strip().lower()
    results: list[MediaSearchResult] = []
    for dirpath, _dirnames, filenames in sorted(os_walk(root)):
        folder = Path(dirpath)
        for name in sorted(filenames):
            if not is_playable_audio(name):
                continue
            path = folder / name
            title = path.stem
            channel = "" if folder == root else folder.name
            if q and q not in title.lower() and q not in channel.lower():
                continue
            results.append(
                MediaSearchResult(
                    id=path.relative_to(root).as_posix(),
                    title=title,
                    source=MediaSource.LOCAL,
                    kind=MediaKind.AUDIO,
                    channel=channel,
                    duration_s=0,
                    published="",
                    thumbnail_url=None,
                    local_path=str(path.resolve()),
                )
            )
    return results


def resolve_library_file(library_dir: str | Path | None, local_path: str) -> Path | None:
    """Resolve ``local_path`` to an existing file INSIDE the library.

    Returns None when the library is unset, the path escapes the library
    dir, or the file does not exist. Tools use this before playing a local
    result so the agent can only play files the library actually owns.
    """
    if library_dir is None or not local_path:
        return None
    root = Path(library_dir).resolve()
    candidate = Path(local_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    return candidate


def os_walk(root: Path):
    """os.walk wrapper (imported lazily to keep the module import-light)."""
    import os

    for dirpath, dirnames, filenames in os.walk(root):
        yield dirpath, dirnames, filenames
