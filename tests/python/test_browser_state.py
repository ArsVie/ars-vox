"""W2-VIEW (GATE-5, ADR 0007) — service-side browser-state channel.

The Electron main process publishes the WebContentsView's REAL
navigation state via authenticated ``PUT /api/browser-state`` (frozen
snake_case wire shape — BrowserNavigateEvent field set). These tests pin
the store round-trip and that actions.py emits the real values instead
of the pre-W2 hardcoded False (plan §Wave 2 W2-VIEW, frozen-file
exception quoted in the lane's service commit).
"""

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from arsvox_agent.app import create_app
from arsvox_agent.browser_state import BrowserStatePayload

from tests.python.harness_fixtures import base_config, ws_collect
from tests.python.test_security import AUTH

TEST_TOKEN = "test-secret-token"


@pytest.fixture
def secure_config_path(tmp_path, monkeypatch):
    """Auth ON with a fixed token — same pattern as test_security.py."""
    cfg = base_config(tmp_path)
    cfg["auth"] = {
        "enabled": True,
        "token_env": "ARSVOX_AUTH_TOKEN",
        "allowed_origins": ["http://localhost:5173", "null"],
    }
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")
    monkeypatch.setenv("ARSVOX_AUTH_TOKEN", TEST_TOKEN)
    return path


@pytest.fixture
def auth_client(secure_config_path):
    app = create_app(str(secure_config_path))
    with TestClient(app) as c:
        yield c


def _connect(ws):
    ws.receive_json()  # state_update
    ws.receive_json()  # config_update


def _navigate(client, ws, url: str) -> dict:
    ws.send_json(
        {
            "type": "ui_command",
            "command": {"action": "browser.navigate", "url": url},
        }
    )
    events = ws_collect(
        client=client,
        ws=ws,
        expected_break=lambda e: e["type"] == "action_result",
    )
    navs = [e for e in events if e["type"] == "browser.navigate"]
    assert navs, f"no browser.navigate event in {events}"
    return navs[-1]


# ------------------------------------------------------------- api route #


def test_browser_state_put_updates_store(auth_client):
    store = auth_client.app.state.services.browser_state
    assert store.get().url == ""

    resp = auth_client.put(
        "/api/browser-state",
        json={
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "title": "Pasta fresca en casa",
            "can_go_back": True,
            "can_go_forward": False,
            "loading": False,
        },
        headers=AUTH,
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    state = store.get()
    assert state.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert state.title == "Pasta fresca en casa"
    assert state.can_go_back is True
    assert state.can_go_forward is False
    assert state.loading is False


def test_browser_state_put_accepts_partial_defaults(auth_client):
    # The frozen wire shape has defaults for every field — a partial
    # payload (e.g. a still-empty view) must not 422.
    resp = auth_client.put("/api/browser-state", json={"url": "about:blank"}, headers=AUTH)
    assert resp.status_code == 200
    state = auth_client.app.state.services.browser_state.get()
    assert state.url == "about:blank"
    assert state.title == ""
    assert state.can_go_back is False


# ------------------------------------------------------ actions.py values #


def test_browser_navigate_emits_real_nav_state(client):
    """Seeded store -> the emitted browser.navigate event carries the
    view's real can_go_back/can_go_forward; title is real only when the
    view already shows the requested URL."""
    client.app.state.services.browser_state.update(
        BrowserStatePayload(
            url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title="Pasta fresca en casa",
            can_go_back=True,
            can_go_forward=True,
            loading=False,
        )
    )

    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        # Different target: real history capability, unknown title.
        emitted = _navigate(client, ws, "https://es.wikipedia.org/wiki/Pasta")
        assert emitted["url"] == "https://es.wikipedia.org/wiki/Pasta"
        assert emitted["title"] == ""
        assert emitted["can_go_back"] is True
        assert emitted["can_go_forward"] is True
        assert emitted["loading"] is True

        # Same target as the view: the loaded title is accurate.
        emitted = _navigate(client, ws, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert emitted["title"] == "Pasta fresca en casa"
        assert emitted["can_go_back"] is True
        assert emitted["can_go_forward"] is True


def test_browser_navigate_falls_back_to_defaults_when_store_empty(client):
    """No view reported yet (or unit tests without the store): the event
    keeps the contract defaults — the UI must not believe history
    navigation is available."""
    with client.websocket_connect("/ws") as ws:
        _connect(ws)
        emitted = _navigate(client, ws, "https://example.com/docs")
        assert emitted["title"] == ""
        assert emitted["can_go_back"] is False
        assert emitted["can_go_forward"] is False
        assert emitted["loading"] is True
