"""Real YouTube search behind a PROVIDER SEAM (GATE-5, W1-YOUTUBE).

The vision line: *"The LLM searches YouTube and OFFERS the user options
(results render as selectable cards)."* This module is the search
authority: it defines the provider interface, ships the DEFAULT
scraping provider (no API key needed) and selects the active provider
through configuration. A hosted API-key provider can drop in later
without touching any caller (media_tools, actions.py, the renderer).

Honesty rules (the FIXTURE_RESULTS defect class):
  * search() returns REAL results parsed from the live YouTube results
    page, or an EMPTY list when the page genuinely has no video results
    for the query — never a canned list.
  * Any transport or parse failure raises YoutubeSearchError; the tool
    reports it truthfully. No silent fallback, no stub.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Awaitable, Callable, Protocol
from urllib.parse import quote_plus

log = logging.getLogger(__name__)

# Provider selection: read once per factory call. The config schema lives
# in packages/contracts (frozen after GATE-0), so selection is env-driven
# today; a future config field can pass the name into
# create_youtube_search_provider() without touching callers.
PROVIDER_ENV = "ARSVOX_YOUTUBE_PROVIDER"
DEFAULT_PROVIDER = "scrape"

# Real YouTube video ids are exactly 11 chars of [A-Za-z0-9_-].
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# The results page is served to a browser-like client. SOCS=CAI is the
# standard no-consent cookie so EU IPs get the real page, not the
# consent interstitial — not an API key, just a locale preference.
_RESULTS_URL = "https://www.youtube.com/results?search_query={query}"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Cookie": "SOCS=CAI",
}


class YoutubeSearchError(RuntimeError):
    """The provider could not search YouTube honestly (transport,
    parsing, or configuration). The tool surfaces the message as-is."""


@dataclass(frozen=True)
class YoutubeSearchResult:
    """One REAL search hit, provider-neutral (the wire card type lives
    in arsvox_contracts; callers map into it)."""

    id: str
    title: str
    channel: str
    duration_s: int
    published: str
    thumbnail_url: str | None = None


class YoutubeSearchProvider(Protocol):
    """The seam. Any implementation (scrape, hosted API key, ...) that
    returns normalized, REAL results satisfies it; callers depend only
    on this interface."""

    name: str

    async def search(self, query: str, limit: int = 10) -> list[YoutubeSearchResult]: ...


# --------------------------------------------------------------------- #
# Default implementation: scrape the public results page (no API key).
# --------------------------------------------------------------------- #

HttpGetter = Callable[[str], Awaitable[str]]


async def _httpx_get(url: str) -> str:
    import httpx

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(15.0, connect=10.0),
            headers=_HEADERS,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.text
    except httpx.HTTPError as exc:
        raise YoutubeSearchError(f"no se pudo consultar YouTube: {exc}") from exc


def _extract_yt_initial_data(html: str) -> dict:
    """Pull the `var ytInitialData = {...};` JSON out of the results page.

    Scans for the assignment and extracts the FIRST balanced JSON object
    (string-aware), so the parse does not depend on exact script
    boundaries. Raises YoutubeSearchError when the page carries no data
    (consent wall, bot check, layout change).
    """
    marker = "ytInitialData"
    start = html.find(marker)
    if start == -1:
        raise YoutubeSearchError(
            "YouTube no devolvió datos de resultados (bloqueo o cambio de página)"
        )
    brace = html.find("{", start)
    if brace == -1:
        raise YoutubeSearchError("respuesta de YouTube sin JSON de resultados")
    depth = 0
    in_string = False
    escape = False
    for i in range(brace, len(html)):
        ch = html[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                raw = html[brace : i + 1]
                try:
                    data = json.loads(raw)
                except ValueError as exc:
                    raise YoutubeSearchError(
                        "JSON de resultados de YouTube inválido"
                    ) from exc
                if not isinstance(data, dict):
                    raise YoutubeSearchError("JSON de resultados de YouTube inesperado")
                return data
    raise YoutubeSearchError("JSON de resultados de YouTube truncado")


def _text(value: dict | None) -> str:
    """Resolve a YouTube text object (runs[] / simpleText / accessibility)."""
    if not isinstance(value, dict):
        return ""
    runs = value.get("runs")
    if isinstance(runs, list):
        parts = [r.get("text", "") for r in runs if isinstance(r, dict)]
        if parts:
            return "".join(parts).strip()
    simple = value.get("simpleText")
    if isinstance(simple, str):
        return simple.strip()
    acc = value.get("accessibility")
    if isinstance(acc, dict):
        label = acc.get("accessibilityData", {}).get("label")
        if isinstance(label, str):
            return label.strip()
    return ""


def _parse_duration(text: str) -> int:
    """'1:02:03' -> 3723, '12:34' -> 754; anything else -> 0 (unknown)."""
    if not text:
        return 0
    parts = text.strip().split(":")
    total = 0
    try:
        for part in parts:
            total = total * 60 + int(part)
    except ValueError:
        return 0
    return total


def _walk_video_renderers(data: dict) -> list[dict]:
    """All videoRenderer items in the search results tree, in page order.

    Sections without an itemSectionRenderer (continuations, shelves of
    shorts/channels) are skipped — only real video results count.
    """
    items: list[dict] = []
    try:
        contents = (
            data.get("contents", {})
            .get("twoColumnSearchResultsRenderer", {})
            .get("primaryContents", {})
            .get("sectionListRenderer", {})
            .get("contents", [])
        )
    except AttributeError:
        return []
    for section in contents if isinstance(contents, list) else []:
        if not isinstance(section, dict):
            continue
        item_section = section.get("itemSectionRenderer")
        if not isinstance(item_section, dict):
            continue
        for entry in item_section.get("contents", []) if isinstance(
            item_section.get("contents"), list
        ) else []:
            if not isinstance(entry, dict):
                continue
            renderer = entry.get("videoRenderer")
            if isinstance(renderer, dict):
                items.append(renderer)
    return items


def _parse_video_renderer(renderer: dict) -> YoutubeSearchResult | None:
    video_id = renderer.get("videoId")
    if not isinstance(video_id, str) or not YOUTUBE_ID_RE.match(video_id):
        return None
    title = _text(renderer.get("title"))
    if not title:
        return None
    channel = _text(renderer.get("ownerText")) or _text(
        renderer.get("longBylineText")
    )
    length = _text(renderer.get("lengthText"))
    duration_s = _parse_duration(length)
    published = _text(renderer.get("publishedTimeText"))
    thumbnail_url = None
    thumbs = renderer.get("thumbnail", {}).get("thumbnails")
    if isinstance(thumbs, list) and thumbs:
        for thumb in reversed(thumbs):
            url = thumb.get("url") if isinstance(thumb, dict) else None
            if isinstance(url, str) and url:
                thumbnail_url = url
                break
    return YoutubeSearchResult(
        id=video_id,
        title=title,
        channel=channel,
        duration_s=duration_s,
        published=published,
        thumbnail_url=thumbnail_url,
    )


class ScrapeYoutubeSearchProvider:
    """Default provider: parses the public YouTube results page.

    ``http_get`` is injectable so tests can mock the network while the
    parsing path stays real (deterministic, no live requests).
    """

    name = "scrape"

    def __init__(self, http_get: HttpGetter | None = None) -> None:
        self._http_get = http_get or _httpx_get

    async def search(self, query: str, limit: int = 10) -> list[YoutubeSearchResult]:
        q = query.strip()
        if not q:
            return []
        url = _RESULTS_URL.format(query=quote_plus(q))
        try:
            html = await self._http_get(url)
        except YoutubeSearchError:
            raise
        except Exception as exc:
            raise YoutubeSearchError(f"no se pudo consultar YouTube: {exc}") from exc
        data = _extract_yt_initial_data(html)
        results: list[YoutubeSearchResult] = []
        for renderer in _walk_video_renderers(data):
            hit = _parse_video_renderer(renderer)
            if hit is not None:
                results.append(hit)
            if len(results) >= max(1, limit):
                break
        return results


# --------------------------------------------------------------------- #
# Selection factory + active-provider accessor.
# --------------------------------------------------------------------- #


def create_youtube_search_provider(provider: str | None = None) -> YoutubeSearchProvider:
    """Config-driven provider selection (default: scrape, no API key).

    ``provider`` is an explicit override (a future config field); when
    None it reads the ARSVOX_YOUTUBE_PROVIDER env var. Unknown or
    unimplemented selections raise — honest failure, never a silent
    fallback to fixtures.
    """
    name = provider or os.environ.get(PROVIDER_ENV, DEFAULT_PROVIDER)
    if name == "scrape":
        return ScrapeYoutubeSearchProvider()
    if name == "api":
        raise YoutubeSearchError(
            "el proveedor 'api' aún no está implementado; usa 'scrape' (sin API key)"
        )
    raise YoutubeSearchError(f"proveedor de YouTube desconocido: {name!r}")


_active_provider: YoutubeSearchProvider | None = None


def get_youtube_search_provider() -> YoutubeSearchProvider:
    """The process-wide active provider (lazy, cached). Tests override
    the media tool's import of this function to inject a fake provider."""
    global _active_provider
    if _active_provider is None:
        _active_provider = create_youtube_search_provider()
    return _active_provider


def reset_youtube_search_provider() -> None:
    """Test hook: drop the cached provider so the next call re-selects."""
    global _active_provider
    _active_provider = None
