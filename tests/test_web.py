"""The interface layer: endpoints, the busy guard, the stop control, the resume."""

from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.arsvox.api import AgentService, serve  # noqa: E402
from services.arsvox.config import Settings  # noqa: E402
from services.arsvox.model import FakeModel, ModelReply, ToolCall  # noqa: E402
from services.arsvox.runtime import Runtime  # noqa: E402
from services.arsvox.store import Store  # noqa: E402
from services.arsvox.tts import FakeTTS  # noqa: E402

STATIC = REPO_ROOT / "apps" / "desktop"


class SlowModel:
    """Always asks for another tool step, so a turn lasts long enough to stop it."""

    name = "slow"

    def __init__(self, delay: float = 0.15) -> None:
        self.delay = delay

    def complete(self, messages, tools) -> ModelReply:
        time.sleep(self.delay)
        return ModelReply(text="", tool_calls=[ToolCall(id="c", name="agenda", arguments={"action": "list_tasks"})])


def get_json(port: int, path: str) -> dict:
    with urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
        return json.load(response)


def get_text(port: int, path: str) -> str:
    with urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
        return response.read().decode("utf-8")


def post_json(port: int, path: str, payload: dict) -> tuple[int, dict]:
    request = Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.load(response)
    except Exception as exc:  # HTTPError carries the body
        body = json.loads(exc.read().decode("utf-8")) if hasattr(exc, "read") else {}
        return getattr(exc, "code", 500), body


def wait_for(port: int, kind: str, after: int = 0, timeout: float = 6.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = get_json(port, f"/events?after={after}")
        for event in data["events"]:
            if event["kind"] == kind:
                return event
        time.sleep(0.05)
    raise AssertionError(f"no llegó ningún evento {kind}")


@pytest.fixture()
def service(tmp_path: Path):
    settings = Settings(base_url="http://x", model="fake", api_key="k", db_path=tmp_path / "web.db")

    def build(model, session: str = "cli"):
        store = Store(settings.db_path)
        runtime = Runtime(settings, store, model)
        agent = AgentService(runtime, store, tts=FakeTTS(), session=session, static_dir=STATIC)
        server = serve(agent, port=0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return agent, server.server_address[1], store, server

    made = []

    def factory(model, session: str = "cli"):
        item = build(model, session)
        made.append(item)
        return item

    yield factory
    for agent, _, store, server in made:
        server.shutdown()
        agent.shutdown()   # the turn must finish before the store closes under it
        server.server_close()
        store.close()


def scripted(*replies) -> FakeModel:
    return FakeModel(list(replies))


def test_health_says_what_is_going_on(service):
    _, port, _, _ = service(scripted())
    data = get_json(port, "/health")
    assert data["ok"] is True and data["busy"] is False and data["session"] == "cli"
    assert data["state"]["events"] == 0


def test_the_shell_is_served_from_the_same_place(service):
    _, port, _, _ = service(scripted())
    assert "Ars Vox" in get_text(port, "/")
    assert "DETENER" in get_text(port, "/")
    assert "setInterval" in get_text(port, "/app.js")


def test_a_turn_runs_and_its_answer_appears_in_the_events(service):
    _, port, store, _ = service(
        scripted(
            ModelReply(
                text="",
                tool_calls=[
                    ToolCall(id="c1", name="agenda", arguments={"action": "add_task", "text": "comprar pan"})
                ],
            ),
            ModelReply(text="Anotado, comprar pan."),
        )
    )
    status, body = post_json(port, "/turn", {"text": "anotá comprar pan"})
    assert status == 200 and body["accepted"] is True
    event = wait_for(port, "assistant_text")
    assert event["payload"]["text"] == "Anotado, comprar pan."
    assert [t["text"] for t in store.list_tasks("cli")] == ["comprar pan"]
    kinds = [e["kind"] for e in get_json(port, "/events?after=0")["events"]]
    assert "tool_call" in kinds and "user_text" in kinds


def test_reconnecting_replays_the_whole_conversation(service):
    _, port, _, _ = service(scripted(ModelReply(text="Buenas tardes.")))
    post_json(port, "/turn", {"text": "hola"})
    wait_for(port, "assistant_text")
    first = get_json(port, "/events?after=0")
    # the window that comes back asks for everything it has not seen
    again = get_json(port, "/events?after=0")
    assert [e["id"] for e in first["events"]] == [e["id"] for e in again["events"]]
    after = again["events"][-1]["id"]
    assert get_json(port, f"/events?after={after}")["events"] == []


def test_a_second_request_while_busy_is_refused(service):
    _, port, _, _ = service(SlowModel(delay=0.3))
    assert post_json(port, "/turn", {"text": "uno"})[0] == 200
    time.sleep(0.1)
    status, body = post_json(port, "/turn", {"text": "dos"})
    assert status == 409 and body["accepted"] is False
    assert get_json(port, "/health")["busy"] in (True, False)


def test_stop_ends_the_running_turn(service):
    _, port, _, _ = service(SlowModel(delay=0.2))
    post_json(port, "/turn", {"text": "seguí para siempre"})
    time.sleep(0.3)
    assert post_json(port, "/stop", {})[1]["stopped"] is True
    event = wait_for(port, "assistant_text")
    assert event["payload"]["text"] == "Listo, me detengo."
    kinds = [e["kind"] for e in get_json(port, "/events?after=0")["events"]]
    assert "stop_requested" in kinds


def test_stop_with_nothing_running_is_harmless(service):
    _, port, _, _ = service(scripted())
    assert post_json(port, "/stop", {})[1]["stopped"] is False


def test_speak_renders_a_file_and_returns_a_url(service):
    agent, port, _, _ = service(scripted())
    status, body = post_json(port, "/speak", {"text": "Te aviso a las ocho."})
    assert status == 200 and body["url"].startswith("/audio/")
    assert list(agent.audio_dir.glob("reply-*"))


def test_an_empty_request_does_nothing(service):
    _, port, _, _ = service(scripted())
    status, body = post_json(port, "/turn", {"text": "   "})
    assert status == 409 and body["accepted"] is False
    assert get_json(port, "/events?after=0")["events"] == []


def test_unknown_path_is_a_404(service):
    _, port, _, _ = service(scripted())
    assert post_json(port, "/nope", {})[0] == 404


def test_the_store_is_safe_for_the_threaded_service(tmp_path: Path):
    """Four threads on one connection, the way the interface layer does it."""
    store = Store(tmp_path / "threads.db")
    errors: list[Exception] = []

    def worker(number: int) -> None:
        try:
            for index in range(30):
                store.append("t", "user_text", {"text": f"{number}-{index}"})
                store.state_counts("t")
        except Exception as exc:  # noqa: BLE001 - the test collects what the store raised
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(number,)) for number in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert len(store.events("t")) == 120
    store.close()


def test_media_play_appends_one_event_and_serves_it_back(service):
    _, port, store, _ = service(scripted())
    status, body = post_json(
        port,
        "/media/play",
        {"source": "youtube", "url": "https://youtu.be/abc12345xyz", "title": "Prueba"},
    )
    assert status == 200 and body["ok"] is True
    (event,) = [e for e in store.events("cli") if e.kind == "media_state"]
    assert event.payload["video_id"] == "abc12345xyz"
    assert event.payload["title"] == "Prueba"
    # the window gets it from the same log it rebuilds from
    seen = [e for e in get_json(port, "/events?after=0")["events"] if e["kind"] == "media_state"]
    assert seen[0]["payload"]["url"] == "https://youtu.be/abc12345xyz"


def test_media_play_refuses_a_link_that_is_not_youtube(service):
    _, port, store, _ = service(scripted())
    status, body = post_json(port, "/media/play", {"url": "https://example.com/v"})
    assert status == 200 and body["ok"] is False
    assert store.events("cli") == []


def test_media_control_needs_something_on_the_panel(service):
    _, port, store, _ = service(scripted())
    status, body = post_json(port, "/media/control", {"action": "pause"})
    assert status == 200 and body["ok"] is False and "nada puesto" in body["reason"]
    post_json(port, "/media/play", {"url": "https://youtu.be/abc12345xyz", "title": "Prueba"})
    assert post_json(port, "/media/control", {"action": "pause"})[1]["ok"] is True
    actions = [e.payload["action"] for e in store.events("cli") if e.kind == "media_state"]
    assert actions == ["play", "pause"]
    assert post_json(port, "/media/control", {"action": "saltar"})[1]["ok"] is False


def test_a_local_media_file_plays_and_ranges(tmp_path: Path, service):
    _, port, _, _ = service(scripted())
    clip = tmp_path / "canto.mp3"
    clip.write_bytes(bytes(range(256)) * 40)  # 10240 bytes; the content does not matter
    status, body = post_json(port, "/media/play", {"source": "local", "path": str(clip)})
    assert status == 200 and body["ok"] is True
    assert body["event"]["source"] == "local" and body["event"]["kind"] == "audio"

    url = f"/media/file?path={quote(str(clip))}"
    with urlopen(f"http://127.0.0.1:{port}{url}", timeout=5) as response:
        assert response.status == 200
        assert response.headers["Accept-Ranges"] == "bytes"
        assert response.headers["Content-Type"] == "audio/mpeg"
        assert len(response.read()) == 10240

    request = Request(f"http://127.0.0.1:{port}{url}", headers={"Range": "bytes=2-4"})
    with urlopen(request, timeout=5) as response:
        assert response.status == 206
        assert response.headers["Content-Range"] == "bytes 2-4/10240"
        assert response.read() == bytes([2, 3, 4])


def test_the_file_server_never_serves_non_media(tmp_path: Path, service):
    _, port, _, _ = service(scripted())
    secret = tmp_path / "notas.txt"
    secret.write_text("no soy música", encoding="utf-8")
    status = post_json(port, "/media/play", {"source": "local", "path": str(secret)})[1]
    assert status["ok"] is False
    try:
        urlopen(f"http://127.0.0.1:{port}/media/file?path={quote(str(secret))}", timeout=5)
        raise AssertionError("the file server served a .txt")
    except HTTPError as exc:
        assert exc.code == 404


def test_media_failed_is_logged_and_the_assistant_speaks_first(service):
    _, port, store, _ = service(
        scripted(ModelReply(text="Ese video no se puede ver acá, pero se lo puedo poner para oír."))
    )
    status, body = post_json(
        port,
        "/media/failed",
        {
            "url": "https://www.youtube.com/watch?v=QDYfEBY9NM4",
            "title": "Let It Be (Official)",
            "code": 150,
        },
    )
    assert status == 200 and body["ok"] is True
    failed = [
        e for e in store.events("cli") if e.kind == "media_state" and e.payload.get("action") == "failed"
    ]
    assert failed and failed[0].payload["code"] == "150"
    cue = wait_for(port, "user_text")  # the turn thread appends it after the response
    assert cue["payload"].get("internal") is True
    event = wait_for(port, "assistant_text")
    assert "oír" in event["payload"]["text"]


def test_the_book_panel_close_reaches_the_log(service, tmp_path: Path):
    _, port, store, _ = service(scripted())
    status, body = post_json(port, "/documents/control", {"action": "close"})
    assert status == 200 and body["ok"] is False  # nothing open yet
    book = tmp_path / "novela.txt"
    book.write_text("Había una vez...", encoding="utf-8")
    store.set_document("cli", str(book), "novela")
    status, body = post_json(port, "/documents/control", {"action": "close"})
    assert status == 200 and body["ok"] is True
    states = [e for e in store.events("cli") if e.kind == "document_state"]
    assert states[-1].payload["action"] == "close"


def test_the_page_image_route_refuses_without_a_pdf(service):
    _, port, _, _ = service(scripted())
    try:
        urlopen(f"http://127.0.0.1:{port}/documents/page?page=1", timeout=5)
        raise AssertionError("served a page with no pdf open")
    except HTTPError as exc:
        assert exc.code == 404


def test_config_roundtrip_over_the_window_api(service, tmp_path):
    from services.arsvox import documents

    _, port, _, _ = service(scripted())
    status, body = post_json(port, "/config", {"books_path": str(tmp_path / "libros"), "music_path": ""})
    assert status == 200 and body["config"]["books_path"] == str(tmp_path / "libros")
    assert get_json(port, "/config")["config"]["books_path"] == str(tmp_path / "libros")
    try:
        assert documents.search_folders() == [tmp_path / "libros"]
    finally:
        documents.set_search_folders(None)
