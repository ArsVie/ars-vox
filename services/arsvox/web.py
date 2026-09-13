"""Looking things up on the web, with no account and no key.

The user asks about the weather, the news, the price of the dollar. There is no
search API configured here, so this reads the no-javascript result page of a search
engine and returns titles and snippets for the assistant to read aloud, plus the
ability to open the real page when the answer needs to be seen.
"""

from __future__ import annotations

import html
import re
import urllib.parse
import urllib.request

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ArsVox/0.2"
TIMEOUT_S = 12
# lite.duckduckgo.com answers without javascript; html.duckduckgo.com does not any more
SEARCH_URL = "https://lite.duckduckgo.com/lite/"
ANCHOR = re.compile(r"(<a\b[^>]*result-link[^>]*>)(.*?)</a>", re.S | re.I)
HREF = re.compile(r'href="([^"]+)"', re.I)
SNIPPET = re.compile(r"<td[^>]*class='?\"?result-snippet'?>?\s*(.*?)</td>", re.S | re.I)
TAGS = re.compile(r"<[^>]+>")


def _clean(fragment: str) -> str:
    return html.unescape(TAGS.sub("", fragment)).strip()


def _unwrap(link: str) -> str:
    """Results are wrapped: //duckduckgo.com/l/?uddg=<real url>."""
    if "uddg=" not in link:
        return link if link.startswith("http") else f"https:{link}"
    query = urllib.parse.urlparse(link).query
    return urllib.parse.parse_qs(query).get("uddg", [link])[0]


def parse_results(page: str, limit: int = 5) -> list[dict]:
    """Read the no-javascript result page. Split out so it can be tested offline."""
    snippets = [_clean(fragment) for fragment in SNIPPET.findall(page)]
    results = []
    for index, (tag, title) in enumerate(ANCHOR.findall(page)[:limit]):
        found = HREF.search(tag)
        results.append(
            {
                "title": _clean(title),
                "url": _unwrap(found.group(1)) if found else "",
                "snippet": snippets[index] if index < len(snippets) else "",
            }
        )
    return results


def search(query: str, limit: int = 5, region: str = "mx-es") -> list[dict]:
    """`region` decides whose results these are. It followed the copy into Argentina."""
    url = SEARCH_URL + "?" + urllib.parse.urlencode({"q": query, "kl": region})
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            page = response.read().decode("utf-8", "replace")
    except Exception:  # noqa: BLE001 - a failed lookup is a sentence, not a crash
        return []
    return parse_results(page, limit)


def readable(results: list[dict], limit: int = 3) -> str:
    """One line per result, the way it will be spoken."""
    lines = []
    for result in results[:limit]:
        snippet = result["snippet"][:200]
        lines.append(f"{result['title']}: {snippet}" if snippet else result["title"])
    return " | ".join(lines)


def read(url: str, limit: int = 1800) -> str:
    """The readable text of a page, for when a snippet is not an answer."""
    if not url.startswith("http"):
        return ""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            raw = response.read(400_000).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return ""
    raw = re.sub(r"(?is)<(script|style|nav|footer|header|svg).*?</\1>", " ", raw)
    text = html.unescape(TAGS.sub(" ", raw))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]
