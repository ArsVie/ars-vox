"""Playing something for the user, and controlling it.

The window has a media panel: a YouTube video embeds in it, a local file plays
in it (audio or video), and one control bar drives both. This module resolves a
request to a real thing (yt-dlp search, no download), gates which files on disk
the panel may serve, and answers "what is on" by reading the log.

Nothing here keeps a second copy of the playback state. The log's last
`media_state` event is the only authority — `play` names the thing and `close`
ends it — and the panel rebuilds from those events, so a reload loses nothing
worth keeping. Position and pause live in the page, next to the player: a
service-side "playback authority" with snapshots and reconciliation was the v1
mistake this shape removes on purpose.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote


class MediaError(Exception):
    """The search could not be done, and the reason is worth saying out loud."""


def resolve(query: str, limit: int = 5) -> list[dict]:
    """Search without downloading. Returns candidates the model can read aloud.

    Raises MediaError when the search could not be made: a missing component or a
    dead network is not the same thing as "nothing was found", and the tool says so.
    """
    try:
        import yt_dlp
    except ModuleNotFoundError as exc:
        raise MediaError("no está instalado el buscador de videos") from exc
    options = {"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": "in_playlist"}
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(f"ytsearch{limit}:{query}", download=False)
    except Exception as exc:  # noqa: BLE001 - a search that fails is a sentence, not a crash
        raise MediaError(f"la búsqueda falló ({type(exc).__name__})") from exc
    results = []
    for entry in (info or {}).get("entries") or []:
        if not entry:
            continue
        results.append(
            {
                "title": (entry.get("title") or "").strip(),
                "url": entry.get("webpage_url") or entry.get("url") or "",
                "channel": entry.get("uploader") or entry.get("channel") or "",
                "seconds": int(entry.get("duration") or 0),
            }
        )
    return results


VIDEO_ID = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{6,})"
)


def video_id(url: str) -> str:
    """The video id, out of any of the url shapes YouTube hands out."""
    match = VIDEO_ID.search(url or "")
    return match.group(1) if match else ""


# What the panel can play from disk, and what the file server may hand out. A
# closed list, so /media/file can never serve something that is not media.
MEDIA_TYPES: dict[str, tuple[str, str]] = {
    ".mp3": ("audio", "audio/mpeg"),
    ".wav": ("audio", "audio/wav"),
    ".m4a": ("audio", "audio/mp4"),
    ".ogg": ("audio", "audio/ogg"),
    ".opus": ("audio", "audio/ogg"),
    ".flac": ("audio", "audio/flac"),
    ".mp4": ("video", "video/mp4"),
    ".webm": ("video", "video/webm"),
    ".mkv": ("video", "video/x-matroska"),
}


def media_type(path: str | Path) -> tuple[str, str] | None:
    """(kind, content-type) for a path the panel could play, or None."""
    return MEDIA_TYPES.get(Path(path).suffix.lower())


def local_url(path: str | Path) -> str:
    """The url the panel plays a file from; the service serves it."""
    return "/media/file?path=" + quote(str(path))


def youtube_event(url: str, title: str = "", channel: str = "", seconds: int = 0) -> dict | None:
    """One `play` event shape for every YouTube path (the tool and the click)."""
    video = video_id(url)
    if not video:
        return None
    return {
        "action": "play",
        "source": "youtube",
        "url": url,
        "video_id": video,
        "title": title or "Video de YouTube",
        "channel": channel,
        "seconds": int(seconds or 0),
    }


def local_event(path: str | Path, title: str = "") -> dict | None:
    """One `play` event shape for a file on disk, or None if it is not media."""
    target = Path(path).expanduser()
    kind = media_type(target)
    if kind is None or not target.is_file():
        return None
    return {
        "action": "play",
        "source": "local",
        "url": local_url(target),
        "kind": kind[0],
        "title": title or target.name,
    }


def current(store, session: str) -> dict | None:
    """What is on the panel, per the log: the last play, unless a close came after."""
    for event in reversed(store.events(session)):
        if event.kind != "media_state":
            continue
        action = event.payload.get("action")
        if action == "play":
            return event.payload
        if action == "close":
            return None
    return None


def open_in_browser(url: str) -> bool:
    """Open a url the way a person would: the default browser, one window.

    The panel plays our media; this stays for plain pages (the web tool's open).
    """
    if not url:
        return False
    if sys.platform == "win32":
        import os

        os.startfile(url)  # noqa: S606 - the user's default browser is the point
        return True
    completed = subprocess.run(
        ["powershell.exe", "-NoProfile", "-Command", f"Start-Process '{url}'"], capture_output=True
    )
    return completed.returncode == 0
