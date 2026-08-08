"""Application configuration model.

Single source of truth for configs/app.yaml. Unknown keys are rejected
(``extra="forbid"``) so a typo surfaces at startup instead of being
silently ignored. The UI mirrors this through GET /config and persists
changes through PATCH /config.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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
    # IANA timezone name for local-clock reminder schedules ("" = system
    # local zone). GATE-2.5 H2: naive due datetimes are LOCAL, never UTC.
    timezone: str = ""


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
