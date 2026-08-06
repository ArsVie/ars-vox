"""Configuration loading/saving. Paths resolve against the config file
directory (repo root by default)."""

from pathlib import Path

import yaml

from arsvox_contracts import AppConfig


def load_config(path: Path | str) -> tuple[AppConfig, Path]:
    config_path = Path(path).resolve()
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    config = AppConfig.model_validate(raw)
    return config, config_path


def save_config(path: Path, config: AppConfig) -> None:
    dumped = yaml.safe_dump(
        config.model_dump(mode="json"), sort_keys=False, allow_unicode=True
    )
    path.write_text(dumped, encoding="utf-8")


def resolve_path(config_path: Path, value: str) -> Path:
    p = Path(value)
    return p if p.is_absolute() else (config_path.parent / p)
