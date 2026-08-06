"""Shared fixtures: temp config + FastAPI TestClient (mock model)."""

import json
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from arsvox_agent.app import create_app


def base_config(tmp_path: Path) -> dict:
    library_dir = tmp_path / "library"
    docs_dir = tmp_path / "documents"
    library_dir.mkdir(parents=True, exist_ok=True)
    docs_dir.mkdir(parents=True, exist_ok=True)
    (library_dir / "don-quijote.txt").write_text(
        "Capítulo uno.\n\nPrimera sección del libro de prueba.\n\nSegunda sección.\n\nTercera sección.",
        encoding="utf-8",
    )
    cfg = {
        "app": {"name": "Ars-Vox", "locale": "es"},
        "server": {"host": "127.0.0.1", "port": 8765},
        "agent": {
            "mock": True,
            "model": {
                "provider": "opencode-go",
                "base_url": "https://opencode.ai/zen/go/v1/",
                "api_key_env": "OPENCODE_GO_API_KEY",
                "name": "deepseek-v4-flash",
                "temperature": 0.2,
                "timeout_s": 30,
                "max_steps": 8,
            },
            "system_prompt_file": None,
            "recent_turns_in_context": 4,
        },
        "voice": {"enabled": False, "silence_timeout_s": 60},
        "tts": {"provider": "mock", "auto_speak": False, "speed": 1.0, "queue_max": 20},
        "ui": {"templates": ["focus", "split", "reference", "background_media"]},
        "telegram": {"mock": True, "token_env": "TELEGRAM_BOT_TOKEN", "chat_id": "12345"},
        "memory": {
            "db_path": str(tmp_path / "arsvox-test.db"),
            "library_dir": str(library_dir),
            "documents_dir": str(docs_dir),
        },
        "reminders": {
            "scheduler_interval_s": 1,
            "snooze_seconds": 600,
            "confirmation_timeout_s": 30,
        },
        "browser": {"allowlist": ["youtube.com"], "home_url": "https://www.youtube.com"},
        "media": {"sample_video_url": "https://example.com/sample.mp4"},
        "demo": {"enabled": False, "step_delay_s": 2},
    }
    return cfg


@pytest.fixture
def config_path(tmp_path) -> Path:
    cfg = base_config(tmp_path)
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return path


@pytest.fixture
def client(config_path):
    app = create_app(str(config_path))
    with TestClient(app) as c:
        yield c


def ws_collect(client, ws, expected_break, max_events=60, timeout_ms=200):
    """Receive events until expected_break(ev) is True; return event list."""
    events = []
    for _ in range(max_events):
        ev = ws.receive_json()
        events.append(ev)
        if expected_break(ev):
            break
    return events
