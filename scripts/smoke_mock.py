#!/usr/bin/env python3
"""Smoke test: boot the agent service (mock model), connect over WS,
drive one user turn, and assert the expected event sequence."""

import asyncio
import json
import sys
import time

import httpx
import websockets

from arsvox_agent.app import create_app
from arsvox_agent.config_loader import load_config

import uvicorn
from threading import Thread


def run_server(config_path: str, port: int):
    app = create_app(config_path)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


async def main() -> int:
    config_path = "configs/app.yaml"
    config, _ = load_config(config_path)
    port = config.server.port
    # force mock by patching config file copy? create_app reads file; use env override
    # simplest: launch with a temporary mock config
    import tempfile
    import yaml

    cfg = config.model_dump(mode="json")
    cfg["agent"]["mock"] = True
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        yaml.safe_dump(cfg, f, sort_keys=False, allow_unicode=True)
        tmp = f.name

    t = Thread(target=run_server, args=(tmp, port), daemon=True)
    t.start()

    # wait for health
    async with httpx.AsyncClient(timeout=5) as client:
        for _ in range(40):
            try:
                r = await client.get(f"http://127.0.0.1:{port}/health")
                if r.status_code == 200:
                    break
            except Exception:
                pass
            await asyncio.sleep(0.25)
        else:
            print("FAIL: service did not become healthy")
            return 1
        print("health:", r.json())

        async with websockets.connect(f"ws://127.0.0.1:{port}/ws") as ws:
            # initial events
            first = json.loads(await asyncio.wait_for(ws.recv(), 5))
            print("initial:", first["type"])
            await ws.send(json.dumps({"type": "user_text", "text": "Abre el documento de la lista de la compra"}))
            events = []
            deadline = time.time() + 30
            while time.time() < deadline:
                try:
                    ev = json.loads(await asyncio.wait_for(ws.recv(), 5))
                except asyncio.TimeoutError:
                    break
                events.append(ev["type"])
                if ev["type"] == "agent_message":
                    print("agent:", ev["text"][:100])
                if ev["type"] == "ui_command":
                    print("ui_command:", ev["command"])
                if ev["type"] == "state_update":
                    print("state:", ev["voice_state"])
                if ev["type"] == "agent_message" and not ev.get("delta"):
                    break
            print("event sequence:", events)
            required = {"state_update", "user_message", "tool_call", "ui_command", "agent_message"}
            if required.issubset(set(events)):
                print("SMOKE_OK")
                return 0
            print("SMOKE_FAIL: missing events", required - set(events))
            return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
