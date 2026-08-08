"""FastAPI application: lifespan wiring, REST endpoints, WebSocket."""

import hmac
import json
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from arsvox_contracts import (
    AppConfig,
    ConfigUpdateEvent,
    ErrorEvent,
)
from arsvox_memory import (
    AuditStore,
    Database,
    DocumentStore,
    NoteStore,
    NotificationStore,
    PanelStore,
    PendingStore,
    PreferenceStore,
    ProgressStore,
    ReminderStore,
    SessionStore,
    TaskStore,
)

from arsvox_agent.config_loader import load_config, save_config
from arsvox_agent.confirmations import ConfirmationCoordinator
from arsvox_agent.deps import Deps
from arsvox_agent.events import EventBus
from arsvox_agent.policy import PolicyEngine
from arsvox_agent.runtime import AgentRuntime
from arsvox_agent.snapshot import SnapshotTracker
from arsvox_agent.telegram_client import build_telegram
from arsvox_agent.tools import ToolRegistry
from arsvox_agent.tools.library_tools import list_books, read_book_text
from arsvox_agent.tools.register import register_all
from arsvox_agent.tools.scheduler import ReminderScheduler
from arsvox_agent.ws import websocket_endpoint
from arsvox_tts import build_tts
from arsvox_voice import VoicePipeline
from arsvox_voice.providers import build_stt

log = logging.getLogger(__name__)

# Hard cap on /api/stt uploads (25 MB) — the endpoint slurps the whole
# file into memory, so a size limit is the memory-safety boundary.
STT_MAX_BYTES = 25 * 1024 * 1024

# Close code for unauthenticated WS handshakes (4xxx = app-defined).
_WS_UNAUTHORIZED_CLOSE = 4401


def _bearer_token(header: str | None) -> str | None:
    """Extract the token from an ``Authorization: Bearer <token>`` header."""
    if not header:
        return None
    scheme, _, rest = header.partition(" ")
    if scheme.lower() != "bearer" or not rest.strip():
        return None
    return rest.strip()


def _token_matches(provided: str | None, expected: str) -> bool:
    """Constant-time comparison so timing cannot leak the token."""
    return provided is not None and hmac.compare_digest(provided, expected)


def _is_protected_path(path: str) -> bool:
    # /health stays public (probes); everything else — /config, /api/*,
    # /tts and any future route — defaults to protected.
    return path != "/health"


def _ws_authorized(ws: WebSocket, token: str, allowed_origins: list[str]) -> bool:
    """WS handshake gate: strict origin allowlist + bearer token.

    Browsers cannot set WS headers, so the renderer sends the token as a
    query param; native clients may use the Authorization header instead.
    """
    origin = ws.headers.get("origin")
    if origin is not None and origin not in allowed_origins:
        log.warning("ws handshake rejected: origin %r not allowed", origin)
        return False
    if _token_matches(_bearer_token(ws.headers.get("authorization")), token):
        return True
    return _token_matches(ws.query_params.get("token"), token)


class ProgressPayload(BaseModel):
    position: dict


class DocCreatePayload(BaseModel):
    title: str


class DocContentPayload(BaseModel):
    content: str
    saved: bool = True


class TtsPayload(BaseModel):
    text: str
    voice: str | None = None


class AppServices:
    """Everything the app wires at startup; handed to routes and ws."""

    def __init__(self, config: AppConfig, config_path: Path):
        self.config = config
        self.config_path = config_path
        self.started_at = time.time()
        self.db = Database(config.resolved_paths.db_path)
        self.sessions = SessionStore(self.db)
        self.notes = NoteStore(self.db)
        self.tasks = TaskStore(self.db)
        self.reminders = ReminderStore(self.db, tz_name=config.reminders.timezone or None)
        self.notifications = NotificationStore(self.db)
        self.panels = PanelStore(self.db)
        self.preferences = PreferenceStore(self.db)
        self.progress = ProgressStore(self.db)
        self.pending = PendingStore(self.db)
        self.documents = DocumentStore(self.db)
        self.audit = AuditStore(self.db)
        self.bus = EventBus()
        # H5: reconnect snapshots need the latest media/voice state; the
        # tracker records it from the bus without a background task.
        self.tracker = SnapshotTracker(self.bus)
        self.tracker.start()
        self.registry = ToolRegistry()
        register_all(self.registry)
        self.policy = PolicyEngine()
        self.tts = build_tts(config)
        self.stt = build_stt(config)
        self.telegram = build_telegram(config)
        self.confirmations = ConfirmationCoordinator(
            self.pending,
            self.audit,
            self.bus,
            config.reminders.confirmation_timeout_s,
            self.registry.execute_direct,
        )
        self.deps_base = Deps(
            config=config,
            db=self.db,
            sessions=self.sessions,
            notes=self.notes,
            tasks=self.tasks,
            reminders=self.reminders,
            notifications=self.notifications,
            panels=self.panels,
            preferences=self.preferences,
            progress=self.progress,
            pending=self.pending,
            documents=self.documents,
            audit=self.audit,
            bus=self.bus,
            policy=self.policy,
            confirmations=self.confirmations,
            tts=self.tts,
            telegram=self.telegram,
        )
        self.registry.attach_deps(self.deps_base)
        self.runtime = AgentRuntime(config, self.deps_base, self.registry, self.bus)
        self.scheduler = ReminderScheduler(
            config.reminders.scheduler_interval_s,
            self.reminders,
            self.notifications,
            self.bus,
            self.confirmations,
        )
        self.pipeline = VoicePipeline(
            config,
            on_user_text=self.runtime.handle_user_text,
            on_stop=self.runtime.cancel,
            on_state_change=self.runtime.notify_voice_state,
        )
        self.runtime.pipeline = self.pipeline

    def reload_config(self, config: AppConfig) -> None:
        """Live config swap: runtime rebuilds the agent lazily; stores and
        services keep working (provider changes take effect on restart)."""
        self.config = config
        self.deps_base.config = config
        self.runtime.set_config(config)

    def config_snapshot(self) -> dict:
        return self.config.model_dump(mode="json")


def create_app(config_path: Path | str = "configs/app.yaml") -> FastAPI:
    config_path = Path(config_path).resolve()
    config, _ = load_config(config_path)
    services = AppServices(config, config_path)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("ars-vox agent service starting (model=%s mock=%s)",
                 config.agent.model.name, config.agent.mock)
        await services.scheduler.start()
        await services.pipeline.start()
        yield
        await services.scheduler.stop()
        await services.pipeline.stop()
        services.db.close()

    app = FastAPI(title="Ars-Vox agent service", version="0.1.0", lifespan=lifespan)
    app.state.services = services

    # ------------------------------------------------- auth + cors setup #
    # Per-launch bearer token: from the configured env var (set by the
    # Electron main process / launcher). Fallback: a fresh random token
    # so a bare `uvicorn` boot is still authenticated (dev convenience —
    # the token is printed so standalone clients can use it).
    auth_cfg = config.auth
    auth_token: str | None = None
    if auth_cfg.enabled:
        auth_token = os.environ.get(auth_cfg.token_env)
        if not auth_token:
            auth_token = secrets.token_urlsafe(32)
            log.warning(
                "auth: env %r unset — generated per-launch token (dev fallback): %s",
                auth_cfg.token_env,
                auth_token,
            )

    # CORS is locked to the configured allowlist (never "*"); the token
    # is the real gate. Headers/methods restricted to what the app uses.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=auth_cfg.allowed_origins,
        allow_methods=["GET", "PATCH", "POST", "PUT", "DELETE"],
        allow_headers=["content-type", "authorization", "origin"],
    )

    if auth_token is not None:

        @app.middleware("http")
        async def _auth_gate(request: Request, call_next):
            # CORS preflights carry no credentials by design — let them
            # through so the (inner) CORSMiddleware can answer them; the
            # real request behind the preflight is still gated below.
            if request.method == "OPTIONS":
                return await call_next(request)
            if _is_protected_path(request.url.path) and not _token_matches(
                _bearer_token(request.headers.get("authorization")), auth_token
            ):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "unauthorized"},
                    headers={"WWW-Authenticate": "Bearer"},
                )
            return await call_next(request)

    # ------------------------------------------------------------- health #
    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "app": services.config.app.name,
            "model": services.config.agent.model.name,
            "mock": services.config.agent.mock,
            "uptime_s": int(time.time() - services.started_at),
        }

    # ------------------------------------------------------------ config #
    @app.get("/config")
    async def get_config():
        return services.config_snapshot()

    @app.patch("/config")
    async def patch_config(payload: dict):
        try:
            new_config = AppConfig.model_validate(payload)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"config inválida: {exc}") from exc
        new_config.anchor(services.config_path.parent)
        save_config(services.config_path, new_config)
        services.reload_config(new_config)
        await services.bus.publish(
            ConfigUpdateEvent(config=services.config_snapshot())
        )
        return services.config_snapshot()

    # -------------------------------------------------------------- api #
    @app.get("/api/books")
    async def api_books():
        return list_books(services.config)

    @app.get("/api/books/{book_id}/content")
    async def api_book_content(book_id: str):
        text = read_book_text(services.config, book_id)
        if not text:
            raise HTTPException(status_code=404, detail="libro no encontrado")
        return {"book_id": book_id, "content": text}

    @app.put("/api/progress/{kind}/{ref}")
    async def api_progress(kind: str, ref: str, payload: ProgressPayload):
        services.progress.set(kind, ref, payload.position)
        return {"ok": True}

    @app.get("/api/notes")
    async def api_notes(q: str | None = None):
        if q:
            return services.notes.search(q)
        return services.notes.list_recent(50)

    @app.get("/api/tasks")
    async def api_tasks():
        return services.tasks.list()

    @app.get("/api/reminders")
    async def api_reminders():
        return services.reminders.list_active()

    @app.get("/api/audit")
    async def api_audit(limit: int = 50):
        return services.audit.recent(min(limit, 200))

    @app.post("/api/documents")
    async def api_documents_create(payload: DocCreatePayload):
        title = payload.title.strip()
        if "/" in title or "\\" in title or ".." in title:
            raise HTTPException(status_code=422, detail="título no válido")
        existing = services.documents.find_by_title(title)
        if existing:
            raise HTTPException(status_code=409, detail="ya existe")
        path = services.config.resolved_paths.documents_dir / f"{title}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")
        doc_id = services.documents.create(title, str(path))
        return {"id": doc_id, "title": title}

    @app.get("/api/documents")
    async def api_documents_list():
        return services.documents.list()

    @app.get("/api/documents/{doc_id}")
    async def api_document_get(doc_id: int):
        doc = services.documents.get(doc_id)
        if not doc:
            raise HTTPException(status_code=404, detail="documento no encontrado")
        content = Path(doc["path"]).read_text(encoding="utf-8") if Path(doc["path"]).is_file() else ""
        return {"doc": doc, "content": content}

    @app.put("/api/documents/{doc_id}/content")
    async def api_document_content(doc_id: int, payload: DocContentPayload):
        doc = services.documents.get(doc_id)
        if not doc:
            raise HTTPException(status_code=404, detail="documento no encontrado")
        if payload.saved:
            Path(doc["path"]).write_text(payload.content, encoding="utf-8")
        services.documents.update_content(doc_id, payload.content, saved=payload.saved)
        return {"ok": True}

    # -------------------------------------------------------------- tts #
    @app.post("/tts")
    async def api_tts(payload: TtsPayload):
        """Synthesize speech for the given text (returns audio bytes).

        POST-only: a GET would leak the spoken text into URLs/logs.
        """
        text = payload.text.strip()
        if not text:
            raise HTTPException(status_code=422, detail="text is required")
        audio = await services.tts.synthesize(text[:2000], payload.voice)
        if not audio:
            raise HTTPException(status_code=503, detail="tts provider returned no audio")

        return Response(content=audio, media_type=services.tts.media_type)

    # -------------------------------------------------------------- stt #
    @app.post("/api/stt")
    async def api_stt(file: UploadFile):
        """Transcribe an uploaded audio file (wav/mp3/ogg) to text."""
        import tempfile

        # Starlette's UploadFile exposes no size/content_length on the
        # installed stack — enforce the cap by reading at most cap+1
        # bytes (a larger upload then trips the length check below).
        data = await file.read(STT_MAX_BYTES + 1)
        if len(data) > STT_MAX_BYTES:
            raise HTTPException(status_code=413, detail="upload too large")
        if not data:
            raise HTTPException(status_code=422, detail="empty upload")
        suffix = Path(file.filename or "audio.wav").suffix or ".wav"
        with tempfile.NamedTemporaryFile("wb", suffix=suffix, delete=False) as f:
            f.write(data)
            tmp_path = f.name
        try:
            text = await services.stt.transcribe(tmp_path, language="es")
        finally:
            Path(tmp_path).unlink(missing_ok=True)
        return {"text": text}

    # --------------------------------------------------------------- ws #
    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        # Handshake gate (token + origin). The connect handler below is
        # untouched: voice-state init and snapshot emission stay as-is.
        if auth_token is not None and not _ws_authorized(
            ws, auth_token, auth_cfg.allowed_origins
        ):
            await ws.close(code=_WS_UNAUTHORIZED_CLOSE)
            return
        await websocket_endpoint(
            ws,
            services.bus,
            services.runtime,
            services.scheduler,
            services.config_snapshot(),
            services.tracker,
        )

    return app
