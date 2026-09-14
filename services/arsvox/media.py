"""Playing something for the user, and controlling it.

The machine has a browser and a network; there is no media library here and no
video player of our own. So: resolve the request to a real thing, open it in the
browser, and let the keyboard's own play/pause key do the controlling. Saying
"te lo abrí" is honest; pretending we own a player is not.
"""

from __future__ import annotations

import subprocess
import sys


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


def open_in_browser(url: str) -> bool:
    """Open a url the way a person would: the default browser, one window."""
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


MEDIA_PLAY_PAUSE = 0xB3
KEY_EVENT_SCRIPT = f"""
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Keys {{
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void MediaPlayPause() {{ keybd_event({MEDIA_PLAY_PAUSE}, 0, 0, UIntPtr.Zero); keybd_event({MEDIA_PLAY_PAUSE}, 0, 2, UIntPtr.Zero); }}
}}
'@
[Keys]::MediaPlayPause()
"""


def toggle_playback() -> bool:
    """The media key, so whatever is playing pauses: our player is the machine's."""
    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", KEY_EVENT_SCRIPT], capture_output=True, timeout=15
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0
