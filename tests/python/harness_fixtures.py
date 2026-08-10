"""Shared fixtures: temp config + FastAPI TestClient (mock model).

The test config is configs/app.yaml (the single source of truth) with
only test-specific overrides applied (tmp paths, mock agent, short
timeouts). This keeps the fixture honest: if a key drifts in app.yaml,
tests exercise the real value instead of a stale copy.

Declared via ``pytest_plugins = ["tests.python.harness_fixtures"]`` in
BOTH tests/python/conftest.py and tests/e2e/conftest.py. Keeping the
shared fixtures in a NON-conftest module avoids the double-registration
collision ("Plugin already registered under a different name") that
happens when a conftest.py is auto-loaded by its own directory AND
re-imported as a named plugin by another directory — with this module,
pytest registers the same plugin name exactly once for both suites, so
``pytest tests/python tests/e2e`` runs as ONE command.
"""

from pathlib import Path

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

# GATE-2.5 worktree shim: the shared venv installs the project packages
# EDITABLE pointing at the MAIN repo; running tests from a worktree would
# silently exercise main's code. Prepend this worktree's package roots so
# the code under test is the code being committed. (wsl-windows-python-
# worktrees pattern; additive, safe for any launch context.)
import sys

_WT_ROOT = Path(__file__).resolve().parents[2]
for _rel in ("services/memory", "services/agent", "packages/contracts", "services/tts", "services/voice"):
    _root = str(_WT_ROOT / _rel)
    if _root not in sys.path:
        sys.path.insert(0, _root)

from arsvox_agent.app import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]


def base_config(tmp_path: Path) -> dict:
    library_dir = tmp_path / "library"
    docs_dir = tmp_path / "documents"
    library_dir.mkdir(parents=True, exist_ok=True)
    docs_dir.mkdir(parents=True, exist_ok=True)
    (library_dir / "don-quijote.txt").write_text(
        "Capítulo uno.\n\nPrimera sección del libro de prueba.\n\nSegunda sección.\n\nTercera sección.",
        encoding="utf-8",
    )
    cfg = yaml.safe_load((REPO_ROOT / "configs" / "app.yaml").read_text(encoding="utf-8"))
    # --- test-only overrides ------------------------------------------ #
    cfg["agent"]["mock"] = True
    cfg["agent"]["model"]["timeout_s"] = 30
    cfg["agent"]["recent_turns_in_context"] = 4
    cfg["memory"]["db_path"] = str(tmp_path / "arsvox-test.db")
    cfg["memory"]["library_dir"] = str(library_dir)
    cfg["memory"]["documents_dir"] = str(docs_dir)
    cfg["reminders"]["scheduler_interval_s"] = 1
    cfg["reminders"]["confirmation_timeout_s"] = 30
    cfg["telegram"]["chat_id"] = "12345"
    cfg["media"]["sample_video_url"] = "https://example.com/sample.mp4"
    cfg["demo"]["enabled"] = False
    # Mock/dev path: auth is OFF by default in the shared fixture (the
    # brief allows explicit disable); test_security.py builds its own
    # app with auth.enabled=True to exercise the boundary.
    cfg.setdefault("auth", {})["enabled"] = False
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
