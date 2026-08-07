"""Shared harness for scripts that boot the agent service.

Duplicated bits extracted from scripts/smoke_mock.py, scripts/demo_live.py
and services/agent/arsvox_agent/__main__.py:

  * dump_mock_config — load the app config, flip agent.mock, and write a
    temp YAML so the real config file is never rewritten;
  * wait_healthy — poll GET /health until the service answers;
  * run_server / start_server — boot uvicorn in a daemon thread.
"""

import asyncio
import tempfile
import time
from threading import Thread

import httpx
import uvicorn
import yaml

from arsvox_agent.app import create_app
from arsvox_agent.config_loader import load_config
from arsvox_contracts import AppConfig


def dump_mock_config(
    config_path: str = "configs/app.yaml", mock: bool = True
) -> tuple[str, AppConfig]:
    """Load ``config_path``, flip ``agent.mock`` to ``mock``, and dump the
    result to a temp YAML file.

    Returns ``(tmp_path, config)`` so callers can still read values such as
    ``config.server.port`` without loading the file twice.
    """
    config, _ = load_config(config_path)
    cfg = config.model_dump(mode="json")
    cfg["agent"]["mock"] = mock
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        yaml.safe_dump(cfg, f, sort_keys=False, allow_unicode=True)
        tmp = f.name
    return tmp, config


async def wait_healthy(base_url: str, timeout_s: float = 10.0) -> dict | None:
    """Poll ``GET {base_url}/health`` until it returns 200.

    Returns the health JSON body, or None if the service never became
    healthy within ``timeout_s`` seconds.
    """
    async with httpx.AsyncClient(timeout=5) as client:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            try:
                r = await client.get(f"{base_url}/health")
                if r.status_code == 200:
                    return r.json()
            except Exception:
                pass
            await asyncio.sleep(0.25)
    return None


def run_server(config_path: str, port: int, log_level: str = "warning") -> None:
    app = create_app(config_path)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level=log_level)


def start_server(config_path: str, port: int) -> Thread:
    """Boot the service in a daemon thread (caller must wait_healthy)."""
    t = Thread(target=run_server, args=(config_path, port), daemon=True)
    t.start()
    return t
