"""W3 gate: kill the window mid-turn, come back, and find the turn finished.

For real, not simulated: the request that starts the turn is sent over a raw
socket which is then reset (SO_LINGER 0 -> RST) while the model is still working.
Nothing about the answer can depend on that client, because the client is gone.
Then a fresh client asks for the log and gets the whole conversation.

    python tools/w3_cut_probe.py "pedido" [--port 8790] [--session web]
"""

from __future__ import annotations

import argparse
import json
import socket
import struct
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]


def get(port: int, path: str) -> dict:
    with urlopen(f"http://127.0.0.1:{port}{path}", timeout=10) as response:
        return json.load(response)


def post(port: int, path: str, payload: dict) -> dict:
    request = Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def start_turn_then_vanish(port: int, text: str, session: str) -> str:
    """Send the request, read the fact that it was accepted, then reset the socket."""
    body = json.dumps({"text": text, "session": session}).encode("utf-8")
    request = (
        f"POST /turn HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
        "Content-Type: application/json\r\nConnection: close\r\n"
        f"Content-Length: {len(body)}\r\n\r\n"
    ).encode("ascii") + body
    connection = socket.create_connection(("127.0.0.1", port), timeout=5)
    connection.sendall(request)
    accepted = connection.recv(200).decode("ascii", "replace").splitlines()[0]
    connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
    connection.close()  # RST: the window is dead while the turn runs
    return accepted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("text", nargs="?", default="¿Qué tengo que hacer hoy?")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--session", default="web")
    args = parser.parse_args()

    before = get(args.port, "/health")
    start_id = get(args.port, f"/events?after=0&session={args.session}")["last_id"]
    print(f"health     {json.dumps({k: before[k] for k in ('model', 'session', 'busy')}, ensure_ascii=False)}")
    print(f"last_id    {start_id}")

    hung_up_at = time.time()
    line = start_turn_then_vanish(args.port, args.text, args.session)
    print(f"request    {line}   -> socket reset at {time.strftime('%H:%M:%S', time.localtime(hung_up_at))}")

    busy_seen = False
    for _ in range(120):
        health = get(args.port, "/health")
        busy_seen = busy_seen or health["busy"]
        if not health["busy"]:
            break
        time.sleep(0.25)

    done_at = time.time()
    print(f"busy seen while the client was gone: {busy_seen}")
    print(f"service finished the turn alone after {done_at - hung_up_at:.1f}s")

    events = get(args.port, f"/events?after={start_id}&session={args.session}")["events"]
    print(f"\nreconnect: {len(events)} events since the cut")
    for event in events:
        payload = event["payload"]
        detail = payload.get("text") or payload.get("name") or ""
        if event["kind"] == "tool_call":
            detail = f"{payload['name']} {json.dumps(payload['arguments'], ensure_ascii=False)}"
        print(f"  {event['id']:4d} {event['ts'][11:19]} {event['kind']:18s} {str(detail)[:90]}")

    kinds = [e["kind"] for e in events]
    last_visible = events[-1]["id"] if events else start_id
    verdict = {
        "turn_started": "user_text" in kinds,
        "answered_without_the_client": "assistant_text" in kinds,
        "answer_written_after_the_cut": bool(events) and events[-1]["id"] > start_id,
        # event ids are global and the silent ones are filtered, so ask after the
        # last id actually seen, never "start + how many there were"
        "no_duplicate_replay": get(
            args.port, f"/events?after={last_visible}&session={args.session}"
        )["events"] == [],
    }
    print()
    print(json.dumps(verdict, ensure_ascii=False, indent=2))
    out = REPO_ROOT / "results" / "w3-cut.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {"request": args.text, "hung_up_at": hung_up_at, "busy_seen": busy_seen,
             "events": events, "verdict": verdict},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"evidence   {out}")
    return 0 if all(verdict.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
