"""Configuration loading/saving. Relative path fields are canonicalized to
absolute paths exactly once at load — against the config's path anchor
(the repo root for the standard ``configs/app.yaml`` layout). The process
CWD is never used. Raw values stay in the model for display/persistence;
canonical absolute values live in ``config.resolved_paths``."""

from pathlib import Path

import yaml

from arsvox_contracts import AppConfig


def load_config(path: Path | str) -> tuple[AppConfig, Path]:
    config_path = Path(path).resolve()
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    config = AppConfig.model_validate(raw)
    config.anchor(config_path.parent)
    return config, config_path


def save_config(path: Path, config: AppConfig) -> None:
    dumped = yaml.safe_dump(
        config.model_dump(mode="json"), sort_keys=False, allow_unicode=True
    )
    path.write_text(dumped, encoding="utf-8")
