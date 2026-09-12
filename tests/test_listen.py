"""The microphone through the window: /listen, from recording to a running turn."""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.api import AgentService, serve  # noqa: E402
from services.arsvox.config import Settings  # noqa: E402
from services.arsvox.model import FakeModel, ModelReply  # noqa: E402
from services.arsvox.runtime import Runtime  # noqa: E402
from services.arsvox.store import Store  # noqa: E402
from services.arsvox.voice import FakeSpeechToText  # noqa: E402


def post(port: int, path: str, payload: dict) -> tuple[int, dict]:
    from urllib.request import Request, urlopen

    request = Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.load(response)
    except Exception as exc:  # noqa: BLE001
        return getattr(exc, "code", 500), {}


def get(port: int, path: str) -> dict:
    from urllib.request import urlopen

    with urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
        return json.load(response)


def start(tmp_path: Path, model, stt, session: str = "cli"):
    settings = Settings(base_url="http://x", model="fake", api_key="k", db_path=tmp_path / "listen.db")
    store = Store(settings.db_path)
    agent = AgentService(
        Runtime(settings, store, model), store, stt=stt, session=session, static_dir=REPO_ROOT / "apps" / "desktop"
    )
    server = serve(agent, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return agent, server.server_address[1], store, server


def test_hearing_a_recording_runs_the_turn(tmp_path: Path):
    """The fake engine reads text from a file, so the seam carries a real request."""
    said = tmp_path / "said.txt"
    said.write_text("Anotá que tengo que llamar al médico", encoding="utf-8")
    agent, port, store, server = start(tmp_path, FakeModel([ModelReply(text="Anotado.")]), FakeSpeechToText())
    try:
        status, body = post(port, "/listen", {"wav": str(said)})
        assert status == 200 and body["ok"] is True
        assert body["heard"] == "Anotá que tengo que llamar al médico"
        assert body["source"] == "archivo"
        for _ in range(100):
            events = get(port, "/events?after=0")
            if any(event["kind"] == "assistant_text" for event in events["events"]):
                break
            import time

            time.sleep(0.05)
        kinds = [event["kind"] for event in get(port, "/events?after=0")["events"]]
        assert "assistant_text" in kinds
    finally:
        server.shutdown()
        agent.shutdown()
        server.server_close()
        store.close()


def test_the_transcript_is_recorded_with_its_numbers(tmp_path: Path):
    said = tmp_path / "said.txt"
    said.write_text("Qué tengo que hacer hoy", encoding="utf-8")
    agent, port, store, server = start(tmp_path, FakeModel([ModelReply(text="Nada.")]), FakeSpeechToText())
    try:
        post(port, "/listen", {"wav": str(said)})
        heard = [event for event in store.events("cli") if event.kind == "heard"]
        assert heard and heard[-1].payload["text"] == "Qué tengo que hacer hoy"
        assert "engine_s" in heard[-1].payload
    finally:
        server.shutdown()
        agent.shutdown()
        server.server_close()
        store.close()


def test_an_empty_transcript_does_not_start_a_turn(tmp_path: Path):
    silence = tmp_path / "silencio.txt"
    silence.write_text("   ", encoding="utf-8")
    agent, port, store, server = start(tmp_path, FakeModel([]), FakeSpeechToText())
    try:
        status, body = post(port, "/listen", {"wav": str(silence)})
        assert status == 200 and body["ok"] is False and body["reason"] == "no entendí"
        assert get(port, "/events?after=0")["events"] == []
    finally:
        server.shutdown()
        agent.shutdown()
        server.server_close()
        store.close()


def test_a_service_without_ears_says_so(tmp_path: Path):
    agent, port, store, server = start(tmp_path, FakeModel([]), None)
    try:
        status, body = post(port, "/listen", {})
        assert status == 200 and body["ok"] is False
        assert "micrófono" in body["reason"]
        assert get(port, "/health")["ears"] == ""
    finally:
        server.shutdown()
        agent.shutdown()
        server.server_close()
        store.close()


def test_health_reports_the_ears_and_the_voice(tmp_path: Path):
    agent, port, store, server = start(tmp_path, FakeModel([]), FakeSpeechToText())
    try:
        assert get(port, "/health")["ears"] == "fake"
    finally:
        server.shutdown()
        agent.shutdown()
        server.server_close()
        store.close()


def test_the_window_has_a_talk_button_and_knows_when_it_cannot_hear(tmp_path: Path):
    from urllib.request import urlopen

    agent, port, store, server = start(tmp_path, FakeModel([]), None)
    try:
        with urlopen(f"http://127.0.0.1:{port}/", timeout=5) as response:
            page = response.read().decode("utf-8")
        with urlopen(f"http://127.0.0.1:{port}/app.js", timeout=5) as response:
            script = response.read().decode("utf-8")
        assert "HABLAR" in page
        assert '/listen' in script and "setEars" in script
    finally:
        server.shutdown()
        agent.shutdown()
        server.server_close()
        store.close()
