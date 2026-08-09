"""GATE-5 (W1-YOUTUBE) — the real search provider seam.

The provider interface, the default scraping provider (network mocked
for determinism), honest-empty parsing, and the config-driven factory.
No fixture list pretending to be a search: a page without video results
is an empty list; a page without parseable data raises.

The canned ytInitialData payloads below mirror the REAL structure of
YouTube's results page (twoColumnSearchResultsRenderer ->
itemSectionRenderer -> videoRenderer entries).
"""

import json

import pytest

from arsvox_agent.search import youtube
from arsvox_agent.search.youtube import (
    PROVIDER_ENV,
    ScrapeYoutubeSearchProvider,
    YoutubeSearchError,
    YoutubeSearchResult,
    create_youtube_search_provider,
    get_youtube_search_provider,
    reset_youtube_search_provider,
)


def _page(payload: dict) -> str:
    return f"<html><script>var ytInitialData = {json.dumps(payload)};</script></html>"


def _video(**overrides) -> dict:
    renderer = {
        "videoId": "dQw4w9WgXcQ",
        "title": {"runs": [{"text": "Taller de carpintería para principiantes"}]},
        "ownerText": {"runs": [{"text": "El Taller de Marta"}]},
        "lengthText": {"simpleText": "12:22"},
        "publishedTimeText": {"simpleText": "hace 3 días"},
        "thumbnail": {
            "thumbnails": [
                {"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=abc"}
            ]
        },
    }
    renderer.update(overrides)
    return {"videoRenderer": renderer}


def _results_page(*entries) -> dict:
    return {
        "contents": {
            "twoColumnSearchResultsRenderer": {
                "primaryContents": {
                    "sectionListRenderer": {
                        "contents": [
                            {"itemSectionRenderer": {"contents": list(entries)}},
                            {"continuationItemRenderer": {}},
                        ]
                    }
                }
            }
        }
    }


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv(PROVIDER_ENV, raising=False)
    reset_youtube_search_provider()
    yield
    reset_youtube_search_provider()


# ------------------------------------------------------------------ seam #


def test_factory_defaults_to_the_scraping_provider():
    provider = create_youtube_search_provider()
    assert isinstance(provider, ScrapeYoutubeSearchProvider)


def test_factory_env_selects_provider(monkeypatch):
    monkeypatch.setenv(PROVIDER_ENV, "scrape")
    assert isinstance(create_youtube_search_provider(), ScrapeYoutubeSearchProvider)


def test_factory_unknown_provider_fails_honestly():
    with pytest.raises(YoutubeSearchError, match="desconocido"):
        create_youtube_search_provider("telepathy")


def test_factory_api_provider_not_implemented_fails_honestly():
    # A hosted API-key provider can drop in later; selecting it today
    # must fail loudly, never silently fall back.
    with pytest.raises(YoutubeSearchError, match="no está implementado"):
        create_youtube_search_provider("api")


def test_get_provider_is_cached_and_resettable():
    first = get_youtube_search_provider()
    assert get_youtube_search_provider() is first
    reset_youtube_search_provider()
    assert get_youtube_search_provider() is not first


# ------------------------------------------------------- scrape parsing #


def test_scrape_provider_parses_real_result_cards():
    seen_urls: list[str] = []
    html = _page(
        _results_page(
            _video(),
            _video(
                videoId="9bZkp7q19f0",
                title={"runs": [{"text": "Cómo lijar madera sin errores"}]},
                ownerText={"runs": [{"text": "Bricolaje Fácil"}]},
                lengthText={"simpleText": "1:02:03"},
                publishedTimeText={"simpleText": "hace 1 semana"},
                thumbnail={"thumbnails": []},
            ),
            # Non-video entries must be skipped, not parsed as results.
            {"channelRenderer": {"channelId": "UCx", "title": {"simpleText": "Canal"}}},
            {"reelShelfRenderer": {"title": {"simpleText": "Shorts"}}},
        )
    )

    async def fake_get(url: str) -> str:
        seen_urls.append(url)
        return html

    provider = ScrapeYoutubeSearchProvider(http_get=fake_get)
    results = _run(provider.search("carpintería"))

    assert seen_urls == [
        "https://www.youtube.com/results?search_query=carpinter%C3%ADa"
    ]
    assert results == [
        YoutubeSearchResult(
            id="dQw4w9WgXcQ",
            title="Taller de carpintería para principiantes",
            channel="El Taller de Marta",
            duration_s=742,
            published="hace 3 días",
            thumbnail_url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=abc",
        ),
        YoutubeSearchResult(
            id="9bZkp7q19f0",
            title="Cómo lijar madera sin errores",
            channel="Bricolaje Fácil",
            duration_s=3723,
            published="hace 1 semana",
            thumbnail_url=None,
        ),
    ]


def test_scrape_provider_honest_empty_when_no_video_results():
    # A real page that simply has no video results for the query: the
    # provider returns [] — never a canned list.
    html = _page(_results_page({"channelRenderer": {"channelId": "UCx"}}))

    provider = ScrapeYoutubeSearchProvider(http_get=_ares(html))
    assert _run(provider.search("asdfghjklñ")) == []


def test_scrape_provider_empty_query_is_honest_empty():
    provider = ScrapeYoutubeSearchProvider(http_get=_ares("<html/>"))
    assert _run(provider.search("   ")) == []


def test_scrape_provider_raises_on_missing_initial_data():
    provider = ScrapeYoutubeSearchProvider(http_get=_ares("<html>no data"))
    with pytest.raises(YoutubeSearchError, match="no devolvió datos"):
        _run(provider.search("carpintería"))


def test_scrape_provider_wraps_transport_failures_honestly():
    async def boom(url: str) -> str:
        raise TimeoutError("red caída")

    provider = ScrapeYoutubeSearchProvider(http_get=boom)
    with pytest.raises(YoutubeSearchError, match="no se pudo consultar YouTube"):
        _run(provider.search("carpintería"))


def test_duration_parsing_handles_unknown_and_malformed():
    assert youtube._parse_duration("1:02:03") == 3723
    assert youtube._parse_duration("12:34") == 754
    assert youtube._parse_duration("") == 0
    assert youtube._parse_duration("abc") == 0


def test_limit_is_respected():
    html = _page(_results_page(_video(), _video(videoId="9bZkp7q19f0")))
    provider = ScrapeYoutubeSearchProvider(http_get=_ares(html))
    assert len(_run(provider.search("q", limit=1))) == 1


def _ares(text: str):
    async def _get(url: str) -> str:
        return text

    return _get


def _run(coro):
    import asyncio

    return asyncio.run(coro)
