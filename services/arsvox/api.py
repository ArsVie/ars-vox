"""The interface layer: a thin HTTP surface over the log.

The window holds no state. It asks for events after the last id it saw, so losing
the connection mid-turn costs nothing: the turn runs inside the service, and when
the window comes back the answer is already in the log. That is the whole reason
this layer is a request per need instead of a live socket with a protocol to
recover.

Endpoints:
    GET  /health                      what the service is doing
    GET  /events?after=123            everything that happened after an id
    POST /turn      {"text": "..."}   start a turn (409 if one is running)
    POST /stop                        stop the running turn
    POST /speak     {"text": "..."}   render the product voice, return a url
    GET  /audio/<name>                the rendered wav
    GET  /                            the shell (static files)
"""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8790
SILENT_KINDS = {"runtime_snapshot", "model_usage", "model_error"}


class AgentService:
    """Owns the runtime, one turn at a time, and the audio it has rendered."""

    def __init__(self, runtime, store, tts=None, session: str = "cli", static_dir: Path | None = None):
        self.runtime = runtime
        self.store = store
        self.tts = tts
        self.session = session
        self.static_dir = Path(static_dir) if static_dir else None
        self.audio_dir = (self.static_dir or Path(".")) / "audio"
        self._lock = threading.Lock()
        self._busy = False
        self._stop = threading.Event()
        self._worker: threading.Thread | None = None
        self.last_error = ""

    # ---- state -----------------------------------------------------------
    @property
    def busy(self) -> bool:
        with self._lock:
            return self._busy

    def health(self) -> dict:
        counts = self.store.state_counts(self.session)
        return {
            "ok": True,
            "model": getattr(self.runtime.model, "name", "?"),
            "session": self.session,
            "busy": self.busy,
            "state": counts,
            "last_error": self.last_error,
            "time": self.runtime.store.events(self.session)[-1].ts if counts["events"] else "",
        }

    def events(self, after: int = 0, limit: int = 200, include_silent: bool = False) -> dict:
        rows = [e for e in self.store.events(self.session) if e.id > after]
        if not include_silent:
            rows = [e for e in rows if e.kind not in SILENT_KINDS]
        last = self.store.events(self.session)[-1].id if self.store.events(self.session) else 0
        return {
            "events": [
                {"id": e.id, "ts": e.ts, "kind": e.kind, "payload": e.payload} for e in rows[:limit]
            ],
            "last_id": last,
            "busy": self.busy,
        }

    # ---- a turn ----------------------------------------------------------
    def start_turn(self, text: str) -> tuple[bool, str]:
        text = (text or "").strip()
        if not text:
            return False, "texto vacío"
        with self._lock:
            if self._busy:
                return False, "ya estoy con otra cosa"
            self._busy = True
            self._stop.clear()
        self._worker = threading.Thread(target=self._run_turn, args=(text,), daemon=True)
        self._worker.start()
        return True, ""

    def wait(self, timeout: float = 15.0) -> bool:
        """Let the running turn finish before anything closes the store under it."""
        worker = self._worker
        if worker is not None and worker.is_alive():
            worker.join(timeout)
            return not worker.is_alive()
        return True

    def shutdown(self, timeout: float = 15.0) -> None:
        """Stop the turn, wait for it, so the last events still reach the log."""
        self._stop.set()
        self.wait(timeout)

    def _run_turn(self, text: str) -> None:
        try:
            self.runtime.turn(self.session, text, should_stop=self._stop.is_set)
            self.last_error = ""
        except Exception as exc:  # noqa: BLE001 - the window must survive a broken turn
            self.last_error = f"{type(exc).__name__}: {exc}"[:200]
            try:
                self.store.append(self.session, "model_error", {"error": self.last_error})
            except Exception:  # noqa: BLE001 - the store is gone: the service is shutting down
                pass
        finally:
            with self._lock:
                self._busy = False

    def stop(self) -> bool:
        if not self.busy:
            return False
        self._stop.set()
        self.store.append(self.session, "stop_requested", {"by": "ventana"})
        return True

    # ---- voice -----------------------------------------------------------
    def speak(self, text: str) -> str:
        if self.tts is None or not (text or "").strip():
            return ""
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        name = f"reply-{int(time.time() * 1000)}.wav"
        self.tts.synthesize(text.strip(), self.audio_dir / name)
        return f"/audio/{name}"


def make_handler(service: AgentService) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "ArsVox/0.2"

        def log_message(self, *args) -> None:  # no console noise
            pass

        # -- helpers
        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the window went away mid-turn; the turn itself is unaffected

        def _json(self, status: int, payload: dict) -> None:
            self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if not length:
                return {}
            try:
                return json.loads(self.rfile.read(length).decode("utf-8"))
            except json.JSONDecodeError:
                return {}

        def _static(self, path: str) -> None:
            root = service.static_dir
            if root is None:
                self._json(404, {"error": "sin interfaz"})
                return
            relative = path.lstrip("/") or "index.html"
            target = (root / relative).resolve()
            if not str(target).startswith(str(root.resolve())) or not target.is_file():
                self._json(404, {"error": "no está"})
                return
            kind = {
                ".html": "text/html; charset=utf-8",
                ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".wav": "audio/wav",
                ".svg": "image/svg+xml",
            }.get(target.suffix, "application/octet-stream")
            self._send(200, target.read_bytes(), kind)

        # -- routes
        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            if parsed.path == "/health":
                self._json(200, service.health())
            elif parsed.path == "/events":
                after = int((query.get("after") or ["0"])[0])
                silent = (query.get("silent") or ["0"])[0] == "1"
                self._json(200, service.events(after, include_silent=silent))
            else:
                self._static(parsed.path)

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            body = self._body()
            if parsed.path == "/turn":
                accepted, reason = service.start_turn(body.get("text", ""))
                self._json(200 if accepted else 409, {"accepted": accepted, "reason": reason})
            elif parsed.path == "/stop":
                self._json(200, {"stopped": service.stop()})
            elif parsed.path == "/speak":
                url = service.speak(body.get("text", ""))
                self._json(200 if url else 503, {"url": url})
            else:
                self._json(404, {"error": "no está"})

    return Handler


def serve(service: AgentService, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), make_handler(service))
    server.daemon_threads = True
    return server
