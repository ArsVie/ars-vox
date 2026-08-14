"""Application configuration model.

Single source of truth for configs/app.yaml. Unknown keys are rejected
(``extra="forbid"``) so a typo surfaces at startup instead of being
silently ignored. The UI mirrors this through GET /config and persists
changes through PATCH /config.
"""

import os
import re
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationInfo, field_validator

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

    enabled: master switch (mock/dev tooling may disable explicitly in
        the config FILE; the runtime PATCH path must NOT persist a
        disabled state — see _validate_enabled, source="patch").
    token_env: env var holding the per-launch token (set by the Electron
        main process when spawning the service, or by the launcher).
    allowed_origins: CORS + WS handshake origin allowlist. The token is
        the real gate; origins are a defense-in-depth layer. Wildcard
        entries are rejected at the model level (never "*").
    """

    model_config = _STRICT
    enabled: bool = True
    token_env: str = "ARSVOX_AUTH_TOKEN"
    allowed_origins: list[str] = ["http://localhost:5173", "null"]

    @field_validator("allowed_origins")
    @classmethod
    def _validate_allowed_origins(cls, v: list[str]) -> list[str]:
        # GATE-3.5 R15: the auth boundary must never be persisted into a
        # wildcard state. "*" (or any wildcard-bearing origin) would make
        # the CORSMiddleware reflect any origin and open the WS handshake
        # to any site. The app's own origins never need wildcards.
        for origin in v:
            if "*" in origin:
                raise ValueError(
                    "allowed_origins must not contain wildcard entries (got %r)" % origin
                )
        if not v:
            raise ValueError("allowed_origins must not be empty")
        return v

    @field_validator("enabled")
    @classmethod
    def _validate_enabled(cls, v: bool, info: ValidationInfo) -> bool:
        # GATE-3.5 R15: auth.enabled=false is a legitimate FILE-level dev/
        # mock state (conftest and the mock harness rely on it), but the
        # runtime PATCH /config path must reject it: persisting a disabled
        # auth boundary through the settings API would silently weaken the
        # launch security on the next boot. The PATCH handler validates
        # with context={"source": "patch"}.
        if not v and (info.context or {}).get("source") == "patch":
            raise ValueError(
                "auth.enabled cannot be disabled at runtime via PATCH "
                "(dev/mock only via the config file)"
            )
        return v


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
    # W3-VOICE (GATE-5): provider seam behind config — mock | openwakeword.
    # The mock stays the default: nothing opens the microphone unless the
    # operator explicitly opts in (enabled: true + provider: openwakeword).
    provider: str = "mock"
    model: str | None = None  # openWakeWord model name or .onnx path (None = library default set)


class VadSection(BaseModel):
    model_config = _STRICT
    # W3-VOICE (GATE-5): provider seam behind config — mock | silero.
    # The mock stays the default so a bare config never tries to load a
    # real model; silero (ONNX, torch-free) is the opt-in real provider.
    provider: str = "mock"


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
    # None -> stable user-owned default (see _default_db_path); any
    # explicit value keeps the old semantics (absolute as-is, relative
    # resolved against the config anchor).
    db_path: str | None = None
    library_dir: str = "data/library"
    documents_dir: str = "data/documents"


class RemindersSection(BaseModel):
    model_config = _STRICT
    scheduler_interval_s: int = Field(default=5, ge=1, le=60)
    snooze_seconds: int = Field(default=600, ge=10, le=86400)
    confirmation_timeout_s: int = Field(default=120, ge=10, le=3600)
    # IANA timezone name for local-clock reminder schedules ("" = system
    # local zone). GATE-2.5 H2: naive due datetimes are LOCAL, never UTC.
    timezone: str = ""


class BrowserSection(BaseModel):
    model_config = _STRICT
    home_url: str = "https://www.youtube.com"
    # BROWSER-USE INTEGRATION: the agent's in-process, text-first browser
    # engine (local Chromium via CDP). engine_enabled=True replaces the
    # Electron round-trip as the agent's browser authority; the desktop
    # view stays the user's display (best-effort mirror). headless keeps
    # Chromium invisible (agent reads text, never screenshots).
    engine_enabled: bool = True
    engine_headless: bool = True


class MediaSection(BaseModel):
    model_config = _STRICT
    sample_video_url: str = (
        "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
    )


class DemoSection(BaseModel):
    model_config = _STRICT
    enabled: bool = False
    step_delay_s: float = Field(default=6.0, ge=1.0, le=120.0)


class ResolvedPaths:
    """Canonical absolute paths derived once at config load.

    Relative values resolve against the path anchor; absolute values are
    kept as-is (normalized). The process CWD is never consulted, so every
    subsystem sees the same directories regardless of where the service
    is started.
    """

    __slots__ = (
        "db_path",
        "library_dir",
        "documents_dir",
        "system_prompt_file",
        "wake_sound",
        "sleep_sound",
    )

    def __init__(
        self, anchor: Path, memory: MemorySection, agent: AgentSection, voice: VoiceSection
    ) -> None:
        # The log DB defaults to a STABLE, USER-OWNED location — never the
        # config's directory (configs can live in /tmp, which gets wiped).
        self.db_path = (
            _default_db_path()
            if memory.db_path is None
            else _canonical_path(anchor, memory.db_path)
        )
        self.library_dir = _canonical_path(anchor, memory.library_dir)
        self.documents_dir = _canonical_path(anchor, memory.documents_dir)
        self.system_prompt_file = _canonical_path(anchor, agent.system_prompt_file)
        self.wake_sound = _canonical_path(anchor, voice.wake_sound)
        self.sleep_sound = _canonical_path(anchor, voice.sleep_sound)


def _default_db_path() -> Path:
    """Stable user-owned SQLite path for the app's log store.

    ``ARSVOX_DATA_DIR`` wins; otherwise XDG data home; otherwise
    ``~/.local/share`` — the same XDG-aware pattern the voice package
    uses for its cache dir. The file lives under ``arsvox/`` so the
    directory is recognizable and survives /tmp cleanup, config moves,
    and app reinstalls.
    """
    override = os.environ.get("ARSVOX_DATA_DIR")
    if override:
        base = Path(override).expanduser()
    else:
        xdg = os.environ.get("XDG_DATA_HOME")
        base = Path(xdg).expanduser() if xdg else Path.home() / ".local" / "share"
    return (base / "arsvox" / "arsvox.db").resolve()


def _canonical_path(anchor: Path, value: str | None) -> Path | None:
    """Absolute, normalized path for a config value: relative values
    resolve against the anchor (repo root for the standard layout),
    absolute values pass through untouched. Never CWD-relative."""
    if value is None:
        return None
    return (anchor / Path(value)).resolve()


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

    # ---- H6: canonical path resolution (region: path resolution) ---- #
    _config_dir: Path | None = PrivateAttr(default=None)

    def anchor(self, config_file_dir: Path | str) -> "AppConfig":
        """Bind this config to its file location and derive the path anchor.

        Relative path fields resolve against the anchor: the repository
        root for the standard layout (``configs/app.yaml`` — the parent of
        the ``configs/`` directory), or the config file's own directory
        for configs placed elsewhere. The process CWD is never used.
        Returns self so callers can chain.
        """
        config_dir = Path(config_file_dir).resolve()
        self._config_dir = config_dir.parent if config_dir.name == "configs" else config_dir
        return self

    @property
    def resolved_paths(self) -> ResolvedPaths:
        """Canonical absolute paths for every path-typed config field.

        Requires :meth:`anchor` — performed by ``config_loader.load_config``
        and by the PATCH /config handler — so a caller can never silently
        fall back to CWD-relative resolution.
        """
        if self._config_dir is None:
            raise RuntimeError(
                "AppConfig is not anchored to a config file location; load it "
                "with arsvox_agent.config_loader.load_config() (or call "
                "config.anchor(config_file_dir)) before reading resolved_paths."
            )
        return ResolvedPaths(self._config_dir, self.memory, self.agent, self.voice)
