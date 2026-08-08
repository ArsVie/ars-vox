"""Application configuration model.

Single source of truth for configs/app.yaml. Unknown keys are rejected
(``extra="forbid"``) so a typo surfaces at startup instead of being
silently ignored. The UI mirrors this through GET /config and persists
changes through PATCH /config.
"""

import re
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

_STRICT = ConfigDict(extra="forbid")

# Repo root (packages/contracts/arsvox_contracts/config.py -> repo root).
# Used to constrain system_prompt_file to in-repo locations.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_ALLOWED_PROMPT_DIRS = ("docs", "configs")
_LOCAL_HTTP_HOSTS = {"localhost", "127.0.0.1", "::1"}
_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class AppSection(BaseModel):
    model_config = _STRICT
    name: str = "Ars-Vox"
    locale: str = "es"


class ServerSection(BaseModel):
    model_config = _STRICT
    host: str = "127.0.0.1"
    port: int = Field(default=8765, ge=1, le=65535)


class AuthSection(BaseModel):
    """Local service boundary: per-launch bearer token + origin allowlist.

    enabled: master switch (mock/dev tooling may disable explicitly).
    token_env: env var holding the per-launch token (set by the Electron
        main process when spawning the service, or by the launcher).
    allowed_origins: CORS + WS handshake origin allowlist. The token is
        the real gate; origins are a defense-in-depth layer.
    """

    model_config = _STRICT
    enabled: bool = True
    token_env: str = "ARSVOX_AUTH_TOKEN"
    allowed_origins: list[str] = ["http://localhost:5173", "null"]


class ModelSection(BaseModel):
    model_config = _STRICT
    provider: str = "opencode-go"
    base_url: str = "https://opencode.ai/zen/go/v1/"
    api_key_env: str = "OPENCODE_GO_API_KEY"
    name: str = "deepseek-v4-flash"
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    timeout_s: int = Field(default=90, ge=5, le=600)
    max_steps: int = Field(default=8, ge=1, le=50)

    @field_validator("base_url")
    @classmethod
    def _validate_base_url(cls, v: str) -> str:
        # The API key (api_key_env) is sent to this URL: an attacker who
        # mutates base_url must not be able to redirect the real key.
        # https is allowed to any host; http only to loopback hosts.
        parsed = urlsplit(v)
        scheme = parsed.scheme.lower()
        if scheme == "https":
            if not parsed.hostname:
                raise ValueError("base_url must include a host")
            return v
        if scheme == "http":
            if parsed.hostname not in _LOCAL_HTTP_HOSTS:
                raise ValueError("http base_url is only allowed for local hosts (localhost/127.0.0.1)")
            return v
        raise ValueError("base_url scheme must be https (or http to a local host)")

    @field_validator("api_key_env")
    @classmethod
    def _validate_api_key_env(cls, v: str) -> str:
        if not _ENV_NAME_RE.match(v):
            raise ValueError("api_key_env must be a valid environment variable name")
        return v


class AgentSection(BaseModel):
    model_config = _STRICT
    mock: bool = False
    model: ModelSection = ModelSection()
    system_prompt_file: str | None = None
    recent_turns_in_context: int = Field(default=6, ge=0, le=50)

    @field_validator("system_prompt_file")
    @classmethod
    def _validate_system_prompt_file(cls, v: str | None) -> str | None:
        # The file content is sent to the model: it must live inside the
        # repo (docs/ or configs/) so an attacker cannot read arbitrary
        # local files into the request. (Path canonicalization is H6's
        # region; this is the validation boundary.)
        if v is None:
            return v
        p = Path(v)
        if p.is_absolute():
            resolved = p.resolve()
            allowed = [(_REPO_ROOT / d).resolve() for d in _ALLOWED_PROMPT_DIRS]
            if not any(resolved == base or base in resolved.parents for base in allowed):
                raise ValueError("system_prompt_file must live inside the repo (docs/ or configs/)")
        else:
            parts = p.parts
            if not parts or parts[0] not in _ALLOWED_PROMPT_DIRS or ".." in parts:
                raise ValueError("system_prompt_file must be a relative path under docs/ or configs/")
        return v


class WakeWordSection(BaseModel):
    model_config = _STRICT
    enabled: bool = False
    model: str | None = None


class VadSection(BaseModel):
    model_config = _STRICT
    provider: str = "silero"


class SttSection(BaseModel):
    model_config = _STRICT
    provider: str = "mock"
    model: str = "tiny"


class VoiceSection(BaseModel):
    model_config = _STRICT
    enabled: bool = False
    wake_word: WakeWordSection = WakeWordSection()
    vad: VadSection = VadSection()
    stt: SttSection = SttSection()
    silence_timeout_s: int = Field(default=60, ge=5, le=3600)
    wake_sound: str | None = None
    sleep_sound: str | None = None


class TtsSection(BaseModel):
    model_config = _STRICT
    provider: str = "mock"
    auto_speak: bool = False
    es_voice: str | None = None
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    queue_max: int = Field(default=20, ge=1, le=200)


class UiSection(BaseModel):
    model_config = _STRICT
    templates: list[str] = ["focus", "split", "reading", "dashboard"]
    reduced_motion: bool = False
    large_text: bool = False
    high_contrast: bool = False
    default_template: str = "focus"
    default_primary: str = "conversation"


class TelegramSection(BaseModel):
    model_config = _STRICT
    mock: bool = True
    token_env: str = "TELEGRAM_BOT_TOKEN"
    chat_id: str = ""


class MemorySection(BaseModel):
    model_config = _STRICT
    db_path: str = "data/arsvox.db"
    library_dir: str = "data/library"
    documents_dir: str = "data/documents"


class RemindersSection(BaseModel):
    model_config = _STRICT
    scheduler_interval_s: int = Field(default=5, ge=1, le=60)
    snooze_seconds: int = Field(default=600, ge=10, le=86400)
    confirmation_timeout_s: int = Field(default=120, ge=10, le=3600)


class BrowserSection(BaseModel):
    model_config = _STRICT
    allowlist: list[str] = ["youtube.com", "*.youtube.com", "wikipedia.org", "openstreetmap.org"]
    home_url: str = "https://www.youtube.com"


class MediaSection(BaseModel):
    model_config = _STRICT
    sample_video_url: str = (
        "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
    )


class DemoSection(BaseModel):
    model_config = _STRICT
    enabled: bool = False
    step_delay_s: float = Field(default=6.0, ge=1.0, le=120.0)


class AppConfig(BaseModel):
    model_config = _STRICT
    app: AppSection = AppSection()
    server: ServerSection = ServerSection()
    auth: AuthSection = AuthSection()
    agent: AgentSection = AgentSection()
    voice: VoiceSection = VoiceSection()
    tts: TtsSection = TtsSection()
    ui: UiSection = UiSection()
    telegram: TelegramSection = TelegramSection()
    memory: MemorySection = MemorySection()
    reminders: RemindersSection = RemindersSection()
    browser: BrowserSection = BrowserSection()
    media: MediaSection = MediaSection()
    demo: DemoSection = DemoSection()
