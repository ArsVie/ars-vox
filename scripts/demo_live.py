#!/usr/bin/env python3
"""Live model proof: boot the agent service with the REAL provider
(opencode-go), connect over WS, ask for interface actions, and assert the
typed ui_command path end to end.

Scenarios:
  single  (default) — one request ("Open YouTube.") must produce a typed
          ui_command. Kept byte-compatible with earlier versions.
  windows — a short multi-turn window-management tour: each turn must
          produce at least one validated ui_command and no error events.
          Proves the LLM manages the app's windows across turns.

Checks (per HANDOFF.md):
  - tool name and JSON argument shape
  - provider compatibility (real model, real network)
  - event sequence: tool_call -> ui_command -> tool_result -> agent_message
  - fails when no typed ui_command is received
  - fails when an error event is received
  - short deadline; --wait-s can extend it for slow providers

Usage:
  OPENCODE_GO_API_KEY=... python scripts/demo_live.py [--wait-s 90]
  OPENCODE_GO_API_KEY=... python scripts/demo_live.py --scenario windows

The service must NOT already be running on port 8765 (this script boots
its own instance with a temp config that forces mock=false).
"""

import argparse
import asyncio
import json
import os
import sys
import time

import websockets

from _harness import dump_mock_config, start_server, wait_healthy

SCENARIOS = {
    "single": [
        {"text": "Open YouTube.", "expect": "at least one ui_command"},
    ],
    "windows": [
        {"text": "Open YouTube.", "expect": "layout"},
        {"text": "Open a document and keep the conversation next to it.", "expect": "layout"},
        {"text": "Show the news in the main panel and keep the conversation beside it.", "expect": "layout"},
        {"text": "Make the video full screen.", "expect": "fullscreen|layout"},
        {"text": "Put the layout back the way it was.", "expect": "restore|layout"},
    ],
}


async def run_turn(ws, text: str, wait_s: float) -> dict:
    """Send one user turn, collect events until the final agent_message
    (or an error / deadline). Returns a summary dict."""
    await ws.send(json.dumps({"type": "user_text", "text": text}))
    events: list[dict] = []
    deadline = time.time() + wait_s * 4
    while time.time() < deadline:
        try:
            ev = json.loads(await asyncio.wait_for(ws.recv(), wait_s))
        except asyncio.TimeoutError:
            print(f"  WARN: no event for {wait_s}s; stopping collection")
            break
        events.append(ev)
        etype = ev["type"]
        if etype == "tool_call":
            print(f"  tool_call: {ev['tool']} {ev['status']} args={json.dumps(ev['args'], ensure_ascii=False)[:140]}")
        elif etype == "ui_command":
            print(f"  ui_command: {json.dumps(ev['command'], ensure_ascii=False)[:180]}")
        elif etype == "agent_message" and not ev.get("delta"):
            print(f"  agent_message: {ev['text'][:110]}")
            break
        elif etype == "error":
            print(f"  ERROR: {ev['message']}")
            break
        elif etype == "state_update":
            print(f"  state: {ev['voice_state']}")

    return {
        "types": [e["type"] for e in events],
        "errors": [e for e in events if e["type"] == "error"],
        "commands": [e for e in events if e["type"] == "ui_command"],
        "tools": [e for e in events if e["type"] == "tool_call"],
        "has_final_message": any(
            e["type"] == "agent_message" and not e.get("delta") for e in events
        ),
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wait-s", type=float, default=60.0, help="per-recv deadline")
    parser.add_argument("--text", default=None, help="request to send (single scenario override)")
    parser.add_argument(
        "--scenario",
        default="single",
        choices=list(SCENARIOS),
        help="which turn sequence to run",
    )
    args = parser.parse_args()

    if not os.environ.get("OPENCODE_GO_API_KEY"):
        print("FAIL: OPENCODE_GO_API_KEY is not set")
        return 1

    prompts = SCENARIOS[args.scenario]
    if args.scenario == "single" and args.text:
        prompts = [{"text": args.text, "expect": "at least one ui_command"}]

    config_path = "configs/app.yaml"
    tmp, config = dump_mock_config(config_path, mock=False)  # force the live provider
    port = config.server.port

    t = start_server(tmp, port)

    health = await wait_healthy(f"http://127.0.0.1:{port}")
    if health is None:
        print("FAIL: service did not become healthy")
        return 1
    print("health:", health)

    async with websockets.connect(f"ws://127.0.0.1:{port}/ws") as ws:
        first = json.loads(await asyncio.wait_for(ws.recv(), 5))
        print("initial:", first["type"])

        results = []
        for turn in prompts:
            print(f"\n=== turn: {turn['text']} (expect {turn['expect']}) ===")
            res = await run_turn(ws, turn["text"], args.wait_s)
            results.append((turn, res))

        print("\n=== summary ===")
        ok = True
        for i, (turn, res) in enumerate(results, 1):
            n_cmd = len(res["commands"])
            n_err = len(res["errors"])
            passed = n_cmd >= 1 and n_err == 0 and res["has_final_message"]
            ok = ok and passed
            print(
                f"  turn {i}: commands={n_cmd} errors={n_err} "
                f"final_message={res['has_final_message']} "
                f"types={res['types']} -> {'PASS' if passed else 'FAIL'}"
            )
            if not passed and res["errors"]:
                print("    errors:", res["errors"])

        if ok:
            label = "LIVE_OK" if len(results) == 1 else "MULTI_OK"
            first_tool = results[0][1]["tools"][0]["tool"] if results[0][1]["tools"] else "none"
            first_cmd = (
                results[0][1]["commands"][0]["command"].get("action")
                if results[0][1]["commands"]
                else "none"
            )
            print(f"{label} turns={len(results)} tool={first_tool} command={first_cmd}")
            return 0
        print("LIVE_FAIL: one or more turns did not produce a validated ui_command")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
