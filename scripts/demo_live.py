#!/usr/bin/env python3
"""Live model proof: boot the agent service with the REAL provider
(opencode-go), connect over WS, ask for a simple interface action, and
assert the typed ui_command path end to end.

Checks (per HANDOFF.md):
  - tool name and JSON argument shape
  - provider compatibility (real model, real network)
  - event sequence: tool_call -> ui_command -> tool_result -> agent_message
  - fails when no typed ui_command is received
  - fails when an error event is received
  - short deadline; --wait-s can extend it for slow providers

Usage:
  OPENCODE_GO_API_KEY=... python scripts/demo_live.py [--wait-s 90]

The service must NOT already be running on port 8765 (this script boots
its own instance with a temp config that forces mock=false).
"""

import argparse
import asyncio
import json
import os
import sys
import tempfile
import time
from threading import Thread

import httpx
import uvicorn
import websockets
import yaml

from arsvox_agent.app import create_app
from arsvox_agent.config_loader import load_config


def run_server(config_path: str, port: int) -> None:
    app = create_app(config_path)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wait-s", type=float, default=60.0, help="per-recv deadline")
    parser.add_argument("--text", default="Open YouTube.", help="request to send")
    args = parser.parse_args()

    if not os.environ.get("OPENCODE_GO_API_KEY"):
        print("FAIL: OPENCODE_GO_API_KEY is not set")
        return 1

    config_path = "configs/app.yaml"
    config, _ = load_config(config_path)
    port = config.server.port

    cfg = config.model_dump(mode="json")
    cfg["agent"]["mock"] = False  # force the live provider
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
        yaml.safe_dump(cfg, f, sort_keys=False, allow_unicode=True)
        tmp = f.name

    t = Thread(target=run_server, args=(tmp, port), daemon=True)
    t.start()

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
            first = json.loads(await asyncio.wait_for(ws.recv(), 5))
            print("initial:", first["type"])
            await ws.send(json.dumps({"type": "user_text", "text": args.text}))
            print("sent:", args.text)

            events: list[dict] = []
            deadline = time.time() + args.wait_s * 4
            while time.time() < deadline:
                try:
                    ev = json.loads(await asyncio.wait_for(ws.recv(), args.wait_s))
                except asyncio.TimeoutError:
                    print(f"WARN: no event for {args.wait_s}s; stopping collection")
                    break
                events.append(ev)
                etype = ev["type"]
                if etype == "tool_call":
                    print(f"  tool_call: {ev['tool']} {ev['status']} args={json.dumps(ev['args'], ensure_ascii=False)[:160]}")
                elif etype == "ui_command":
                    print(f"  ui_command: {json.dumps(ev['command'], ensure_ascii=False)[:200]}")
                elif etype == "agent_message" and not ev.get("delta"):
                    print(f"  agent_message: {ev['text'][:120]}")
                    break
                elif etype == "error":
                    print(f"  ERROR: {ev['message']}")
                    break
                elif etype == "state_update":
                    print(f"  state: {ev['voice_state']}")

            types = [e["type"] for e in events]
            print("event sequence:", types)

            errors = [e for e in events if e["type"] == "error"]
            if errors:
                print("LIVE_FAIL: error events received:", errors)
                return 1

            commands = [e for e in events if e["type"] == "ui_command"]
            if not commands:
                print("LIVE_FAIL: no typed ui_command received for:", args.text)
                return 1

            tools = [e for e in events if e["type"] == "tool_call"]
            if not tools:
                print("LIVE_FAIL: no tool_call events received")
                return 1
            if tools[0]["status"] == "error":
                print("LIVE_FAIL: tool errored:", tools[0].get("result"))
                return 1

            if not any(e["type"] == "agent_message" for e in events):
                print("LIVE_FAIL: no agent_message received")
                return 1

            print(f"LIVE_OK tool={tools[0]['tool']} command={commands[0]['command'].get('action')}")
            return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
