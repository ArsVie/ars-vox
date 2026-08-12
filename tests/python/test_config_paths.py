"""H6 — canonical config path resolution.

The production config (configs/app.yaml) carries relative path values;
they must canonicalize to ABSOLUTE paths under the repo root exactly once
at load, independent of the process CWD, and no service code may build
paths from raw config values (grep guard).
"""

import re
from pathlib import Path

import pytest
import yaml

from arsvox_agent.config_loader import load_config
from arsvox_contracts import AppConfig

REPO_ROOT = Path(__file__).resolve().parents[2]
PROD_CONFIG = REPO_ROOT / "configs" / "app.yaml"


def _prod_config() -> AppConfig:
    cfg, config_path = load_config(PROD_CONFIG)
    assert config_path == PROD_CONFIG.resolve()
    return cfg


def test_production_paths_resolve_absolute_under_repo_root(monkeypatch, tmp_path):
    # db_path is null in the production config -> stable user-owned default
    monkeypatch.setenv("ARSVOX_DATA_DIR", str(tmp_path))
    cfg = _prod_config()
    paths = cfg.resolved_paths
    assert paths.db_path == tmp_path / "arsvox" / "arsvox.db"
    assert paths.library_dir == REPO_ROOT / "data" / "library"
    assert paths.documents_dir == REPO_ROOT / "data" / "documents"
    for p in (paths.db_path, paths.library_dir, paths.documents_dir):
        assert p.is_absolute()
        # never repo/configs/data/... and never the config's own dir
        assert REPO_ROOT / "configs" not in p.parents, p
    # system prompt is unset in the production config
    assert paths.system_prompt_file is None


def test_raw_values_kept_for_display_and_persistence():
    cfg = _prod_config()
    # the model keeps the raw values (GET /config, save_config); db_path
    # stays null so the stable default can never be written back as a
    # config-relative path
    assert cfg.memory.db_path is None
    assert cfg.memory.library_dir == "data/library"
    assert cfg.memory.documents_dir == "data/documents"
    assert cfg.agent.system_prompt_file is None


def test_absolute_config_values_pass_through(tmp_path):
    raw = yaml.safe_load(PROD_CONFIG.read_text(encoding="utf-8"))
    db = tmp_path / "custom" / "x.db"
    lib = tmp_path / "custom-lib"
    raw["memory"]["db_path"] = str(db)
    raw["memory"]["library_dir"] = str(lib)
    cfg = AppConfig.model_validate(raw).anchor(PROD_CONFIG.parent)
    assert cfg.resolved_paths.db_path == db.resolve()
    assert cfg.resolved_paths.library_dir == lib.resolve()
    assert cfg.resolved_paths.documents_dir == REPO_ROOT / "data" / "documents"


def test_resolved_paths_do_not_depend_on_cwd(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ARSVOX_DATA_DIR", str(tmp_path))
    cfg = _prod_config()
    assert cfg.resolved_paths.db_path == tmp_path / "arsvox" / "arsvox.db"
    assert cfg.resolved_paths.library_dir == REPO_ROOT / "data" / "library"
    assert cfg.resolved_paths.documents_dir == REPO_ROOT / "data" / "documents"


def test_default_db_path_precedence(monkeypatch, tmp_path):
    # ARSVOX_DATA_DIR wins over XDG_DATA_HOME
    monkeypatch.setenv("ARSVOX_DATA_DIR", str(tmp_path / "override"))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    cfg = AppConfig().anchor(tmp_path)
    assert cfg.resolved_paths.db_path == tmp_path / "override" / "arsvox" / "arsvox.db"
    # no ARSVOX_DATA_DIR -> XDG_DATA_HOME
    monkeypatch.delenv("ARSVOX_DATA_DIR")
    cfg = AppConfig().anchor(tmp_path)
    assert cfg.resolved_paths.db_path == tmp_path / "xdg" / "arsvox" / "arsvox.db"
    # neither -> ~/.local/share (user-owned, never the config's dir)
    monkeypatch.delenv("XDG_DATA_HOME")
    cfg = AppConfig().anchor(tmp_path)
    assert cfg.resolved_paths.db_path == (
        Path.home() / ".local" / "share" / "arsvox" / "arsvox.db"
    )
    assert tmp_path not in cfg.resolved_paths.db_path.parents


def test_explicit_relative_db_path_still_anchored(tmp_path):
    # An explicitly configured relative db_path keeps the old semantics:
    # resolved against the config anchor, so power users can opt back in.
    raw = yaml.safe_load(PROD_CONFIG.read_text(encoding="utf-8"))
    raw["memory"]["db_path"] = "data/custom.db"
    cfg = AppConfig.model_validate(raw).anchor(PROD_CONFIG.parent)
    assert cfg.resolved_paths.db_path == REPO_ROOT / "data" / "custom.db"


def test_unanchored_config_raises_instead_of_cwd_fallback():
    with pytest.raises(RuntimeError):
        AppConfig().resolved_paths


# --------------------------------------------------------------------- #
# Grep guard: services must consume canonical absolute paths
# (config.resolved_paths.*); raw values must never be wrapped in Path()
# (which would resolve against the process CWD).
# --------------------------------------------------------------------- #
_CWD_RELATIVE_PATTERNS = (
    re.compile(r"Path\(\s*config\.memory"),
    re.compile(r"Path\([^)]*memory\.[a-z_]*dir"),
    re.compile(r"config\.memory\.(db_path|library_dir|documents_dir)"),
)


def test_no_cwd_relative_path_resolution_in_services():
    offenders = []
    for package in ("agent", "memory"):
        for py in sorted((REPO_ROOT / "services" / package).rglob("*.py")):
            for lineno, line in enumerate(
                py.read_text(encoding="utf-8").splitlines(), 1
            ):
                for pattern in _CWD_RELATIVE_PATTERNS:
                    if pattern.search(line):
                        offenders.append(
                            f"{py.relative_to(REPO_ROOT)}:{lineno}: {line.strip()}"
                        )
    assert not offenders, (
        "CWD-relative path resolution in services:\n" + "\n".join(offenders)
    )
