"""Application configuration model.

Single source of truth for configs/app.yaml. Unknown keys are rejected
(``extra="forbid"``) so a typo surfaces at startup instead of being
silently ignored. The UI mirrors this through GET /config and persists
changes through PATCH /config.
"""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

_STRICT = ConfigDict(extra="forbid")


class AppSection(BaseModel):
    model_config = _STRICT
    name: str = "Ars-Vox"
    locale: str = "es"


class ServerSection(BaseModel):
    model_config = _STRICT
    host: str = "127.0.0.1"
    port: int = Field(default=8765, ge=1, le=65535)


class ModelSection(BaseModel):
    model_config = _STRICT
    provider: str = "opencode-go"
    base_url: str = "https://opencode.ai/zen/go/v1/"
    api_key_env: str = "OPENCODE_GO_API_KEY"
    name: str = "deepseek-v4-flash"
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    timeout_s: int = Field(default=90, ge=5, le=600)
    max_steps: int = Field(default=8, ge=1, le=50)


class AgentSection(BaseModel):
    model_config = _STRICT
    mock: bool = False
    model: ModelSection = ModelSection()
    system_prompt_file: str | None = None
    recent_turns_in_context: int = Field(default=6, ge=0, le=50)


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
        self.db_path = _canonical_path(anchor, memory.db_path)
        self.library_dir = _canonical_path(anchor, memory.library_dir)
        self.documents_dir = _canonical_path(anchor, memory.documents_dir)
        self.system_prompt_file = _canonical_path(anchor, agent.system_prompt_file)
        self.wake_sound = _canonical_path(anchor, voice.wake_sound)
        self.sleep_sound = _canonical_path(anchor, voice.sleep_sound)


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
