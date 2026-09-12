"""Settings for Ars-Vox. Environment driven, one place, no secret in the tree."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE_URL = "https://api.commandcode.ai/provider/v1"
DEFAULT_MODEL = "deepseek/deepseek-v4-flash"
API_KEY_VARS = ("ARSVOX_API_KEY", "LILY_TOKEN", "COMMANDCODE_API_KEY", "OPENCODE_GO_API_KEY")
ENV_FILES = (Path.home() / ".hermes" / ".env", REPO_ROOT / ".env")


class ConfigError(RuntimeError):
    pass


def load_env_files() -> None:
    """Read KEY=VALUE files into the environment without overriding real variables."""
    for path in ENV_FILES:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def resolve_api_key() -> str:
    load_env_files()
    for name in API_KEY_VARS:
        value = os.environ.get(name)
        if value:
            return value
    raise ConfigError(f"no API key found; set one of {', '.join(API_KEY_VARS)}")


@dataclass(frozen=True, slots=True)
class Settings:
    base_url: str
    model: str
    api_key: str
    db_path: Path
    temperature: float = 1.0
    max_tokens: int = 1024
    timeout_s: float = 90.0
    max_steps: int = 6
    language: str = "es"
    session: str = "cli"

    def local_time(self) -> datetime:
        return datetime.now().astimezone()


def load_settings(session: str = "cli", db_path: Path | None = None) -> Settings:
    load_env_files()
    return Settings(
        base_url=os.environ.get("ARSVOX_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        model=os.environ.get("ARSVOX_MODEL", DEFAULT_MODEL),
        api_key=resolve_api_key(),
        db_path=Path(db_path or os.environ.get("ARSVOX_DB", REPO_ROOT / "data" / "arsvox.db")),
        temperature=float(os.environ.get("ARSVOX_TEMPERATURE", 1.0)),
        max_tokens=int(os.environ.get("ARSVOX_MAX_TOKENS", 1024)),
        max_steps=int(os.environ.get("ARSVOX_MAX_STEPS", 6)),
        session=session,
    )
