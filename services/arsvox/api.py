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
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from services.arsvox import documents, media

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8790
SILENT_KINDS = {"runtime_snapshot", "model_usage", "model_error", "heard"}


class AgentService:
    """Owns the runtime, one turn at a time, the microphone and the audio it renders."""

    def __init__(
        self,
        runtime,
        store,
        tts=None,
        stt=None,
        session: str = "cli",
        static_dir: Path | None = None,
        listen_seconds: float = 15.0,
    ):
        self.runtime = runtime
        self.store = store
        self.tts = tts
        self.stt = stt
        self.session = session
        self.listen_seconds = listen_seconds
        self.static_dir = Path(static_dir) if static_dir else None
        self.audio_dir = (self.static_dir or Path(".")) / "audio"
        self._lock = threading.Lock()
        self._busy = False
        self._listening = False
        self._listen_lock = threading.Lock()
        self._stop = threading.Event()
        self._worker: threading.Thread | None = None
        self.last_error = ""
        self.apply_config()

    # ---- state -----------------------------------------------------------
    @property
    def busy(self) -> bool:
        with self._lock:
            return self._busy or self._listening

    def health(self) -> dict:
        counts = self.store.state_counts(self.session)
        return {
            "ok": True,
            "model": getattr(self.runtime.model, "name", "?"),
            "session": self.session,
            "busy": self.busy,
            "state": counts,
            "ears": getattr(self.stt, "name", "") if self.stt else "",
            "voice": getattr(self.tts, "name", "") if self.tts else "",
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
    def start_turn(self, text: str, internal: bool = False) -> tuple[bool, str]:
        text = (text or "").strip()
        if not text:
            return False, "texto vacío"
        with self._lock:
            if self._busy or self._listening:
                return False, "ya estoy con otra cosa"
            self._busy = True
            self._stop.clear()
        self._worker = threading.Thread(target=self._run_turn, args=(text, internal), daemon=True)
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

    def _run_turn(self, text: str, internal: bool = False) -> None:
        try:
            self.runtime.turn(self.session, text, should_stop=self._stop.is_set, internal=internal)
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
        with self._lock:
            if not self._busy:  # a recording in flight is not a turn to stop
                return False
        self._stop.set()
        self.store.append(self.session, "stop_requested", {"by": "ventana"})
        return True

    # ---- voice -----------------------------------------------------------
    def listen(self, wav: str | None = None) -> dict:
        """Hear one request, then run it. `wav` is for the development rig: a real
        recording on disk instead of the microphone.

        One recording at a time. Five overlapping /listen calls once captured the
        same sentence five times over — the window's poll had re-enabled the button
        mid-recording because `busy` did not cover the recording phase — and the log
        got five `heard` rows for one utterance.
        """
        if self.stt is None:
            return {"ok": False, "reason": "acá no tengo micrófono"}
        if not self._listen_lock.acquire(blocking=False):
            return {"ok": False, "reason": "todavía estoy escuchando lo anterior"}
        try:
            with self._lock:
                if self._busy:
                    return {"ok": False, "reason": "ya estoy con otra cosa"}
                self._listening = True
            try:
                meta: dict = {}
                if wav:
                    result = self.stt.transcribe(wav)
                    meta = {"source": "archivo", "audio_s": round(result.duration_s, 2)}
                else:
                    from services.arsvox.mic import normalize_gain, record_until_silence

                    capture = record_until_silence(max_seconds=self.listen_seconds)
                    if not capture.has_speech:
                        self.store.append(
                            self.session, "heard", {"source": "micrófono", "speech_s": 0.0}
                        )
                        return {"ok": False, "reason": "no escuché nada", "seconds": round(capture.seconds, 2)}
                    result = self.stt.transcribe(normalize_gain(capture.samples))
                    meta = {"source": "micrófono", "speech_s": round(capture.speech_seconds, 2)}
                text = result.text.strip()
                self.store.append(
                    self.session,
                    "heard",
                    {**meta, "engine_s": round(result.elapsed_s, 2), "text": text},
                )
            finally:
                with self._lock:
                    self._listening = False
            if not text:
                return {"ok": False, "reason": "no entendí", **meta}
            accepted, reason = self.start_turn(text)
            return {"ok": accepted, "heard": text, "reason": reason, "engine_s": round(result.elapsed_s, 2), **meta}
        finally:
            self._listen_lock.release()

    def speak(self, text: str) -> str:
        if self.tts is None or not (text or "").strip():
            return ""
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        name = f"reply-{int(time.time() * 1000)}.wav"
        self.tts.synthesize(text.strip(), self.audio_dir / name)
        return f"/audio/{name}"

    # ---- the media panel --------------------------------------------------
    def media_play(self, payload: dict) -> dict:
        """The panel's own play paths: a YouTube pick, the sound path, or a local file."""
        source = str(payload.get("source") or "youtube")
        if source == "music":
            return self._media_play_music(payload)
        if source == "local":
            event = media.local_event(str(payload.get("path") or ""), str(payload.get("title") or ""))
            if event is None:
                return {"ok": False, "reason": "ese archivo no es música ni video, o no existe"}
        else:
            try:
                seconds = int(payload.get("seconds") or 0)
            except (TypeError, ValueError):
                seconds = 0
            event = media.youtube_event(
                str(payload.get("url") or ""),
                title=str(payload.get("title") or ""),
                channel=str(payload.get("channel") or ""),
                seconds=seconds,
            )
            if event is None:
                return {"ok": False, "reason": "no es un enlace de video de YouTube"}
        return {"ok": True, "id": self.store.append(self.session, "media_state", event), "event": event}

    def _media_play_music(self, payload: dict) -> dict:
        """A music card was clicked: fetch the sound and put it in the panel."""
        url = str(payload.get("url") or "")
        folder = (self.store.config(self.session).get("music_path") or "").strip()
        target = Path(folder) if folder else self.store.path.parent / "media-cache"
        try:
            path, fetched_title = media.fetch_audio(url, target)
        except media.MediaError as exc:
            return {"ok": False, "reason": f"no pude traer el audio: {exc}"}
        try:
            seconds = int(payload.get("seconds") or 0)
        except (TypeError, ValueError):
            seconds = 0
        event = media.music_event(
            path,
            str(payload.get("title") or "") or fetched_title,
            seconds=seconds,
            origin=url,
        )
        return {"ok": True, "id": self.store.append(self.session, "media_state", event), "event": event}

    def media_control(self, action: str) -> dict:
        """A control the user pressed in the panel; the log records it like any event."""
        if action not in ("pause", "resume", "close"):
            return {"ok": False, "reason": f"no conozco la acción '{action}'"}
        if media.current(self.store, self.session) is None:
            return {"ok": False, "reason": "no hay nada puesto"}
        return {"ok": True, "id": self.store.append(self.session, "media_state", {"action": action})}

    def media_failed(self, payload: dict) -> dict:
        """The panel could not show a video: the log records it and the assistant speaks.

        No error ever reaches the user. The failure wakes one turn, the model reads
        what happened and offers the sound path in its own words.
        """
        url = str(payload.get("url") or "").strip()
        title = str(payload.get("title") or "ese video").strip()
        code = str(payload.get("code") or "").strip()
        event = {"action": "failed", "source": "youtube", "url": url, "title": title, "code": code}
        event_id = self.store.append(self.session, "media_state", event)
        address = f" ({url})" if url else ""
        message = (
            f"[el panel] No se pudo ver «{title}»{address}: YouTube no permite verlo fuera de su página "
            f"(error {code or 'desconocido'}). Dile en una frase breve y sencilla que ese video no se puede "
            "ver aquí y ofrécele ponerlo para oír. Si le dice que sí, póngalo con play(type='music') y la "
            "misma dirección; no lo intentes como video otra vez."
        )
        started, _ = self.start_turn(message, internal=True)
        return {"ok": True, "id": event_id, "turn": started}

    # ---- the folders the user sets from the window ------------------------
    def apply_config(self) -> None:
        """The books folder the user set reaches the reader (and where books save)."""
        books_path = (self.store.config(self.session).get("books_path") or "").strip()
        documents.set_search_folders([books_path] if books_path else None)

    def config_get(self) -> dict:
        return {"ok": True, "config": self.store.config(self.session)}

    def config_set(self, payload: dict) -> dict:
        for key in ("books_path", "music_path"):
            if key in payload:
                self.store.set_config(self.session, key, str(payload.get(key) or "").strip())
        self.apply_config()
        return {"ok": True, "config": self.store.config(self.session)}


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

        def _media_file(self, path_text: str) -> None:
            """Serve one local media file, with Range so video seeking works.

            The extension whitelist (media.MEDIA_TYPES) is the gate: whatever this
            route hands out is a file the panel could play, never any other file.
            """
            target = Path(path_text).expanduser() if path_text else None
            kind = media.media_type(target) if target else None
            if kind is None or not target.is_file():
                self._json(404, {"error": "no está"})
                return
            _, content_type = kind
            size = target.stat().st_size
            start, end, status = 0, max(size - 1, 0), 200
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", (self.headers.get("Range") or "").strip())
            if match:
                if match.group(1):
                    start = int(match.group(1))
                    if match.group(2):
                        end = int(match.group(2))
                elif match.group(2):
                    start = max(size - int(match.group(2)), 0)
                end = min(end, size - 1)
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                status = 206
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with target.open("rb") as handle:
                handle.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = handle.read(min(65536, remaining))
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        break  # the player seeked away; the rest of the file is unwanted
                    remaining -= len(chunk)

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
            elif parsed.path == "/config":
                self._json(200, service.config_get())
            elif parsed.path == "/media/file":
                self._media_file((query.get("path") or [""])[0])
            else:
                self._static(parsed.path)

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            body = self._body()
            if parsed.path == "/turn":
                accepted, reason = service.start_turn(body.get("text", ""))
                self._json(200 if accepted else 409, {"accepted": accepted, "reason": reason})
            elif parsed.path == "/media/play":
                self._json(200, service.media_play(body))
            elif parsed.path == "/media/control":
                self._json(200, service.media_control(str(body.get("action") or "")))
            elif parsed.path == "/media/failed":
                self._json(200, service.media_failed(body))
            elif parsed.path == "/config":
                self._json(200, service.config_set(body))
            elif parsed.path == "/stop":
                self._json(200, {"stopped": service.stop()})
            elif parsed.path == "/listen":
                self._json(200, service.listen(body.get("wav") or None))
            elif parsed.path == "/speak":
                url = service.speak(body.get("text", ""))
                self._json(200 if url else 503, {"url": url})
            else:
                self._json(404, {"error": "no está"})

    return Handler


class PortBusy(RuntimeError):
    """Another Ars Vox already holds this port. Fail loudly instead of shadowing it."""


def serve(service: AgentService, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    # A second instance must error, not quietly share the port: four stale services once
    # all sat on 8790 and the oldest one answered every request.
    ThreadingHTTPServer.allow_reuse_address = False
    try:
        server = ThreadingHTTPServer((host, port), make_handler(service))
    except OSError as exc:
        raise PortBusy(
            f"el puerto {port} ya está ocupado ({exc.strerror}). "
            "Hay otro Ars Vox corriendo: cerralo antes de abrir este."
        ) from exc
    server.daemon_threads = True
    return server
