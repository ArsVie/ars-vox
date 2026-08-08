"""FastAPI application: lifespan wiring, REST endpoints, WebSocket."""

import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
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

from arsvox_agent.config_loader import load_config, resolve_path, save_config
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


class ProgressPayload(BaseModel):
    position: dict


class DocCreatePayload(BaseModel):
    title: str


class DocContentPayload(BaseModel):
    content: str
    saved: bool = True


class AppServices:
    """Everything the app wires at startup; handed to routes and ws."""

    def __init__(self, config: AppConfig, config_path: Path):
        self.config = config
        self.config_path = config_path
        self.started_at = time.time()
        self.db = Database(resolve_path(config_path, config.memory.db_path))
        self.sessions = SessionStore(self.db)
        self.notes = NoteStore(self.db)
        self.tasks = TaskStore(self.db)
        self.reminders = ReminderStore(self.db)
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
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
    )

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
        path = resolve_path(services.config_path, services.config.memory.documents_dir) / f"{title}.md"
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
    @app.get("/tts")
    async def api_tts(text: str, voice: str | None = None):
        """Synthesize speech for the given text (returns audio bytes)."""
        if not text.strip():
            raise HTTPException(status_code=422, detail="text is required")
        audio = await services.tts.synthesize(text[:2000], voice)
        if not audio:
            raise HTTPException(status_code=503, detail="tts provider returned no audio")

        return Response(content=audio, media_type=services.tts.media_type)

    # -------------------------------------------------------------- stt #
    @app.post("/api/stt")
    async def api_stt(file: UploadFile):
        """Transcribe an uploaded audio file (wav/mp3/ogg) to text."""
        import tempfile

        data = await file.read()
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
        await websocket_endpoint(
            ws,
            services.bus,
            services.runtime,
            services.scheduler,
            services.config_snapshot(),
            services.tracker,
        )

    return app
