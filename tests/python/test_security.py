"""GATE-2.5 H4: local service boundary security tests.

Auth ON (per-launch bearer token), CORS locked, STT capped, TTS is POST,
config mutations constrained (base_url / api_key_env / system_prompt_file).
The shared conftest fixture runs with auth OFF (mock/dev path); these
tests build their own app with auth.enabled=True and a fixed token.
"""

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import arsvox_agent.app as app_module
from arsvox_agent.app import create_app
from arsvox_contracts import AppConfig

from tests.python.conftest import base_config

TEST_TOKEN = "test-secret-token"
AUTH = {"Authorization": f"Bearer {TEST_TOKEN}"}
REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def secure_config_path(tmp_path, monkeypatch):
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


def full_config(client) -> dict:
    return client.get("/config", headers=AUTH).json()


# ------------------------------------------------------------- no token #


@pytest.mark.parametrize(
    "method,path,kwargs",
    [
        ("get", "/config", {}),
        ("get", "/api/books", {}),
        ("get", "/api/notes", {}),
        ("post", "/api/stt", {"files": {"file": ("a.wav", b"x", "audio/wav")}}),
        ("post", "/tts", {"json": {"text": "hola"}}),
        ("patch", "/config", {"json": {}}),
    ],
)
def test_protected_endpoints_reject_missing_token(auth_client, method, path, kwargs):
    resp = getattr(auth_client, method)(path, **kwargs)
    assert resp.status_code == 401
    assert resp.headers.get("www-authenticate") == "Bearer"


def test_health_is_public(auth_client):
    assert auth_client.get("/health").status_code == 200


def test_protected_endpoints_reject_wrong_token(auth_client):
    resp = auth_client.get("/config", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401


def test_protected_endpoints_accept_correct_token(auth_client):
    resp = auth_client.get("/config", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["app"]["name"] == "Ars-Vox"


def test_tts_is_post_only(auth_client):
    # GET /tts (text-in-URL) must be gone: 405 with a valid token.
    resp = auth_client.get("/tts", headers=AUTH)
    assert resp.status_code == 405


def test_tts_post_returns_audio(auth_client):
    resp = auth_client.post("/tts", json={"text": "hola"}, headers=AUTH)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("audio/")


def test_tts_post_rejects_empty_text(auth_client):
    resp = auth_client.post("/tts", json={"text": "   "}, headers=AUTH)
    assert resp.status_code == 422


# ------------------------------------------------------------------ cors #


def test_cors_never_wildcard(auth_client):
    resp = auth_client.options(
        "/config",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert resp.status_code == 200
    allow_origin = resp.headers.get("access-control-allow-origin", "")
    assert allow_origin != "*"
    assert allow_origin == "http://localhost:5173"
    assert "GET" in resp.headers.get("access-control-allow-methods", "")
    assert "authorization" in resp.headers.get("access-control-allow-headers", "")


def test_cors_rejects_disallowed_origin(auth_client):
    resp = auth_client.options(
        "/config",
        headers={
            "Origin": "http://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in resp.headers


def test_cors_header_on_real_request_reflects_allowed_origin(auth_client):
    resp = auth_client.get("/config", headers={**AUTH, "Origin": "http://localhost:5173"})
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"


# ------------------------------------------------------------------- stt #


def test_stt_over_limit_rejected(auth_client, monkeypatch):
    monkeypatch.setattr(app_module, "STT_MAX_BYTES", 1024)
    resp = auth_client.post(
        "/api/stt",
        files={"file": ("big.wav", b"x" * 2048, "audio/wav")},
        headers=AUTH,
    )
    assert resp.status_code == 413


def test_stt_small_upload_accepted(auth_client):
    # mock STT provider returns deterministic text for any input
    resp = auth_client.post(
        "/api/stt",
        files={"file": ("ok.wav", b"x" * 64, "audio/wav")},
        headers=AUTH,
    )
    assert resp.status_code == 200
    assert "text" in resp.json()


# ------------------------------------------------- config mutation guards #


def test_config_rejects_http_base_url_to_remote_host(auth_client):
    cfg = full_config(auth_client)
    cfg["agent"]["model"]["base_url"] = "http://evil.example/v1/"
    resp = auth_client.patch("/config", json=cfg, headers=AUTH)
    assert resp.status_code == 422


def test_config_allows_http_base_url_to_localhost(auth_client):
    cfg = full_config(auth_client)
    cfg["agent"]["model"]["base_url"] = "http://127.0.0.1:11434/v1/"
    resp = auth_client.patch("/config", json=cfg, headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["agent"]["model"]["base_url"] == "http://127.0.0.1:11434/v1/"


def test_config_allows_https_base_url_to_any_host(auth_client):
    cfg = full_config(auth_client)
    cfg["agent"]["model"]["base_url"] = "https://api.openai.com/v1/"
    resp = auth_client.patch("/config", json=cfg, headers=AUTH)
    assert resp.status_code == 200


def test_config_rejects_non_http_scheme_base_url(auth_client):
    cfg = full_config(auth_client)
    cfg["agent"]["model"]["base_url"] = "file:///etc/passwd"
    resp = auth_client.patch("/config", json=cfg, headers=AUTH)
    assert resp.status_code == 422


def test_config_rejects_bad_api_key_env_name(auth_client):
    cfg = full_config(auth_client)
    cfg["agent"]["model"]["api_key_env"] = "1BAD NAME"
    resp = auth_client.patch("/config", json=cfg, headers=AUTH)
    assert resp.status_code == 422


def test_config_rejects_system_prompt_file_outside_repo(auth_client):
    cfg = full_config(auth_client)
    cfg["agent"]["system_prompt_file"] = "/etc/passwd"
    resp = auth_client.patch("/config", json=cfg, headers=AUTH)
    assert resp.status_code == 422


def test_config_rejects_system_prompt_file_dotdot(auth_client):
    cfg = full_config(auth_client)
    cfg["agent"]["system_prompt_file"] = "../secret.txt"
    resp = auth_client.patch("/config", json=cfg, headers=AUTH)
    assert resp.status_code == 422


def test_config_accepts_system_prompt_file_in_repo(auth_client):
    cfg = full_config(auth_client)
    cfg["agent"]["system_prompt_file"] = str(REPO_ROOT / "docs" / "prompt.md")
    resp = auth_client.patch("/config", json=cfg, headers=AUTH)
    assert resp.status_code == 200


def test_config_accepts_system_prompt_file_relative(auth_client):
    cfg = full_config(auth_client)
    cfg["agent"]["system_prompt_file"] = "configs/prompt.md"
    resp = auth_client.patch("/config", json=cfg, headers=AUTH)
    assert resp.status_code == 200


def test_model_validation_unit():
    # direct model-level checks (same validators PATCH /config uses)
    Model = AppConfig.model_validate
    good = {"agent": {"model": {"base_url": "https://opencode.ai/zen/go/v1/"}}}
    Model(good)
    with pytest.raises(Exception):
        Model({"agent": {"model": {"base_url": "http://evil.example/v1/"}}})
    with pytest.raises(Exception):
        Model({"agent": {"system_prompt_file": "/etc/passwd"}})
    with pytest.raises(Exception):
        Model({"agent": {"model": {"api_key_env": "not valid"}}})


# --------------------------------------------------------------------- ws #


def test_ws_rejects_missing_token(auth_client):
    with pytest.raises(WebSocketDisconnect):
        with auth_client.websocket_connect("/ws"):
            pass


def test_ws_rejects_wrong_token(auth_client):
    with pytest.raises(WebSocketDisconnect):
        with auth_client.websocket_connect("/ws?token=wrong"):
            pass


def test_ws_accepts_token_query_param(auth_client):
    with auth_client.websocket_connect(f"/ws?token={TEST_TOKEN}") as ws:
        ev = ws.receive_json()
        assert ev["type"] in ("state_update", "config_update")


def test_ws_accepts_authorization_header(auth_client):
    with auth_client.websocket_connect("/ws", headers=AUTH) as ws:
        ev = ws.receive_json()
        assert ev["type"] in ("state_update", "config_update")


def test_ws_rejects_disallowed_origin(auth_client):
    with pytest.raises(WebSocketDisconnect):
        with auth_client.websocket_connect(
            f"/ws?token={TEST_TOKEN}", headers={"origin": "http://evil.example"}
        ):
            pass


def test_ws_accepts_allowed_origin(auth_client):
    with auth_client.websocket_connect(
        f"/ws?token={TEST_TOKEN}", headers={"origin": "http://localhost:5173"}
    ) as ws:
        ev = ws.receive_json()
        assert ev["type"] in ("state_update", "config_update")
