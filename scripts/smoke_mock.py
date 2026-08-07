#!/usr/bin/env python3
"""Smoke test: boot the agent service (mock model), connect over WS,
drive one user turn, and assert the expected event sequence."""

import asyncio
import json
import sys
import time

import websockets

from _harness import dump_mock_config, start_server, wait_healthy


async def main() -> int:
    tmp, config = dump_mock_config()
    port = config.server.port

    t = start_server(tmp, port)

    # wait for health
    health = await wait_healthy(f"http://127.0.0.1:{port}")
    if health is None:
        print("FAIL: service did not become healthy")
        return 1
    print("health:", health)

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
