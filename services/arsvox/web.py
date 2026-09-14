"""Looking things up on the web, with no account and no key.

Two kinds of lookup live here. Structured questions (weather, headlines) go to
keyless JSON and RSS endpoints, both measured from this machine: an exact number
that cannot soft-block a scraper the way a search page can, and fresher than any
scraped snippet. General queries read the no-javascript result page of a search
engine, and a second engine stands behind the first because the first one
soft-blocks: it answers 202 with a page that carries no result anchors.

A lookup that fails says why. Empty is for "there is nothing there"; a block or a
dead network is named out loud, because one sentence for both worlds is how the
product quietly lies.
"""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ArsVox/0.2"
TIMEOUT_S = 12
# Weather is two calls back to back and the turn budget is 20 s; keep them short.
JSON_TIMEOUT_S = 8
# lite.duckduckgo.com answers without javascript; html.duckduckgo.com does not any more
SEARCH_URL = "https://lite.duckduckgo.com/lite/"
# Second engine, for when the first one soft-blocks. Structure from searxng's mojeek
# engine: results are `ul.results-standard > li`, the link anchor is `a.ob`, the title
# sits in `h2 > a` and the snippet in `p.s`.
MOJEEK_URL = "https://www.mojeek.com/search"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
NEWS_FEED = "https://www.jornada.com.mx/rss/edicion.xml"

ANCHOR = re.compile(r"(<a\b[^>]*result-link[^>]*>)(.*?)</a>", re.S | re.I)
HREF = re.compile(r'href="([^"]+)"', re.I)
SNIPPET = re.compile(r"<td[^>]*class='?\"?result-snippet'?>?\s*(.*?)</td>", re.S | re.I)
TAGS = re.compile(r"<[^>]+>")
NO_RESULTS = re.compile(r"no results", re.I)
MOJEEK_LIST = re.compile(r'<ul class="results-standard">(.*?)</ul>', re.S | re.I)
MOJEEK_ITEM = re.compile(r"<li>(.*?)</li>", re.S | re.I)
MOJEEK_TITLE = re.compile(r'<h2>\s*<a\b(?=[^>]*\bhref="([^"]+)")[^>]*>(.*?)</a>', re.S | re.I)
MOJEEK_LINK = re.compile(r'<a\b(?=[^>]*\bclass="ob")(?=[^>]*\bhref="([^"]+)")[^>]*>', re.I)
MOJEEK_SNIPPET = re.compile(r'<p\b(?=[^>]*\bclass="s")[^>]*>(.*?)</p>', re.S | re.I)

# WMO weather codes, the short spoken form.
WEATHER_CODES: dict[int, str] = {
    0: "despejado",
    1: "casi despejado",
    2: "parcialmente nublado",
    3: "nublado",
    45: "niebla",
    48: "niebla helada",
    51: "llovizna ligera",
    53: "llovizna",
    55: "llovizna fuerte",
    56: "llovizna helada",
    57: "llovizna helada fuerte",
    61: "lluvia ligera",
    63: "lluvia",
    65: "lluvia fuerte",
    66: "lluvia helada",
    67: "lluvia helada fuerte",
    71: "nieve ligera",
    73: "nieve",
    75: "nieve fuerte",
    77: "aguanieve",
    80: "chubascos ligeros",
    81: "chubascos",
    82: "chubascos fuertes",
    85: "chubascos de nieve",
    86: "chubascos de nieve fuertes",
    95: "tormenta eléctrica",
    96: "tormenta con granizo",
    99: "tormenta fuerte con granizo",
}


class WebError(Exception):
    """A lookup that could not be completed, with the reason said out loud."""


def _clean(fragment: str) -> str:
    return html.unescape(TAGS.sub("", fragment)).strip()


def _unwrap(link: str) -> str:
    """Results are wrapped: //duckduckgo.com/l/?uddg=<real url>."""
    if "uddg=" not in link:
        return link if link.startswith("http") else f"https:{link}"
    query = urllib.parse.urlparse(link).query
    return urllib.parse.parse_qs(query).get("uddg", [link])[0]


def _fetch(url: str, timeout: int = TIMEOUT_S) -> tuple[int, str]:
    """One GET. Any HTTP answer comes back as (status, text); only a dead network raises.

    The status travels because it carries meaning here: a 202 from the search engine
    is the soft-block, and the callers classify on it.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001 - a dead network is a sentence, not a crash
        raise WebError(f"no respondió ({type(exc).__name__})") from exc


def _get_json(url: str) -> dict:
    status, text = _fetch(url, timeout=JSON_TIMEOUT_S)
    if status != 200:
        raise WebError(f"respondió {status}")
    try:
        return json.loads(text)
    except ValueError as exc:
        raise WebError("no mandó datos legibles") from exc


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


def parse_mojeek(page: str, limit: int = 5) -> list[dict]:
    """Read Mojeek's result list. Split out so it can be tested offline."""
    block = MOJEEK_LIST.search(page)
    if not block:
        return []
    results = []
    for item in MOJEEK_ITEM.findall(block.group(1)):
        title_match = MOJEEK_TITLE.search(item)
        link_match = MOJEEK_LINK.search(item)
        if not title_match and not link_match:
            continue
        snippet_match = MOJEEK_SNIPPET.search(item)
        results.append(
            {
                "title": _clean(title_match.group(2)) if title_match else "",
                "url": link_match.group(1) if link_match else title_match.group(1),
                "snippet": _clean(snippet_match.group(1)) if snippet_match else "",
            }
        )
        if len(results) >= limit:
            break
    return results


def _ddg(query: str, limit: int, region: str) -> list[dict]:
    url = SEARCH_URL + "?" + urllib.parse.urlencode({"q": query, "kl": region})
    reason = "no dio una respuesta clara"
    for _ in range(2):  # the soft-block is often momentary; one retry is cheap
        status, page = _fetch(url)
        if status == 200:
            results = parse_results(page, limit)
            if results or NO_RESULTS.search(page):
                return results
            reason = "no dio resultados legibles"
        else:
            reason = f"respondió {status}"
    raise WebError(f"el buscador principal {reason}")


def _mojeek(query: str, limit: int, region: str) -> list[dict]:
    # `region` is unused: Mojeek takes language and region by cookie, and the fallback
    # only has to work. Revisit if its results look like the wrong country.
    url = MOJEEK_URL + "?" + urllib.parse.urlencode({"q": query})
    status, page = _fetch(url)
    if status != 200:
        raise WebError(f"el segundo buscador respondió {status}")
    if "captcha" in page.lower()[:3000]:
        raise WebError("el segundo buscador pidió un captcha")
    if "results-standard" not in page:
        raise WebError("el segundo buscador no dio una respuesta clara")
    return parse_mojeek(page, limit)


def search(query: str, limit: int = 5, region: str = "mx-es") -> list[dict]:
    """Two engines, in order. An answer, a real empty result, or a named failure.

    `region` decides whose results these are; it followed the copy into Mexico.
    """
    failures = []
    answered_empty = False
    for engine in (_ddg, _mojeek):
        try:
            results = engine(query, limit, region)
        except WebError as exc:
            failures.append(str(exc))
            continue
        if results:
            return results
        answered_empty = True
    if answered_empty:
        return []
    raise WebError("; ".join(failures) or "los buscadores no respondieron")


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
        raise WebError("la dirección no empieza con http")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            raw = response.read(400_000).decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001 - a page that will not load is a sentence
        raise WebError(f"no respondió ({type(exc).__name__})") from exc
    raw = re.sub(r"(?is)<(script|style|nav|footer|header|svg).*?</\1>", " ", raw)
    text = html.unescape(TAGS.sub(" ", raw))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def geocode(city: str) -> dict:
    """The first place the map service finds for a name."""
    url = GEOCODE_URL + "?" + urllib.parse.urlencode(
        {"name": city, "count": 1, "language": "es", "format": "json"}
    )
    rows = _get_json(url).get("results") or []
    if not rows:
        raise WebError("no encontré esa ciudad")
    return rows[0]


def weather(city: str, when: str = "hoy") -> str:
    """The spoken sentence for a city's weather, today or tomorrow."""
    found = geocode(city)
    url = FORECAST_URL + "?" + urllib.parse.urlencode(
        {
            "latitude": found["latitude"],
            "longitude": found["longitude"],
            "current": "temperature_2m,apparent_temperature,weather_code",
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
            "timezone": "auto",
            "forecast_days": 2,
        }
    )
    payload = _get_json(url)
    return weather_sentence(
        str(found.get("name") or city), when, payload.get("current") or {}, payload.get("daily") or {}
    )


def _value_at(payload: dict, key: str, index: int):
    values = payload.get(key)
    if isinstance(values, list) and index < len(values):
        return values[index]
    return None


def weather_sentence(city: str, when: str, current: dict, daily: dict) -> str:
    """The sentence, apart from the fetching, so a fixture can test it."""
    tomorrow = str(when).strip().lower().startswith("ma")
    index = 1 if tomorrow else 0
    pieces = []
    if tomorrow:
        pieces.append(f"En {city}, mañana.")
    else:
        now = current.get("temperature_2m")
        feels = current.get("apparent_temperature")
        if isinstance(now, (int, float)):
            line = f"En {city} ahora hay {now:.0f} grados"
            if isinstance(feels, (int, float)):
                line += f", se siente como {feels:.0f}"
            pieces.append(line + ".")
        else:
            pieces.append(f"En {city}.")
    maximum = _value_at(daily, "temperature_2m_max", index)
    minimum = _value_at(daily, "temperature_2m_min", index)
    rain = _value_at(daily, "precipitation_probability_max", index)
    code = _value_at(daily, "weather_code", index) if tomorrow else current.get("weather_code")
    details = []
    if isinstance(maximum, (int, float)):
        details.append(f"máxima de {maximum:.0f}")
    if isinstance(minimum, (int, float)):
        details.append(f"mínima de {minimum:.0f}")
    sky = WEATHER_CODES.get(code)
    if sky:
        details.append(sky)
    if isinstance(rain, (int, float)):
        if rain < 5:
            details.append("sin lluvia prevista")
        else:
            details.append(f"probabilidad de lluvia de {rain:.0f} por ciento")
    if details:
        pieces.append(", ".join(details).capitalize() + ".")
    return " ".join(pieces)


def headlines(limit: int = 5) -> list[str]:
    """Top titles of the day's edition, from the paper's own feed."""
    status, page = _fetch(NEWS_FEED)
    if status != 200:
        raise WebError(f"el diario respondió {status}")
    return parse_headlines(page, limit)


def parse_headlines(raw: str, limit: int = 5) -> list[str]:
    """Titles in order. Split out so a fixture can test it."""
    try:
        root = ET.fromstring(raw.encode("utf-8"))
    except ET.ParseError as exc:
        raise WebError("el diario no mandó un feed legible") from exc
    titles = []
    for item in root.iter("item"):
        title = " ".join(_clean(item.findtext("title") or "").split())
        if title:
            titles.append(title)
        if len(titles) >= limit:
            break
    return titles
