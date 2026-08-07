"""Config loading/validation and the live PATCH /config endpoint."""

import yaml


def test_config_loads(client):
    cfg = client.get("/config").json()
    assert cfg["app"]["name"] == "Ars-Vox"
    assert cfg["agent"]["model"]["name"] == "deepseek-v4-flash"


def test_ui_templates_default_to_frozen_set():
    # B5: config advertises the frozen canonical set (aliases are valid
    # enum values but not advertised)
    from arsvox_contracts import UiSection

    assert UiSection().templates == ["focus", "split", "reading", "dashboard"]


def test_config_rejects_unknown_keys(config_path):
    raw = yaml.safe_load(config_path.read_text())
    raw["nonsense_key"] = True
    config_path.write_text(yaml.safe_dump(raw))
    from arsvox_contracts import AppConfig

    import pytest

    with pytest.raises(Exception):
        AppConfig.model_validate(raw)


def test_patch_config_valid(client):
    cfg = client.get("/config").json()
    cfg["tts"]["provider"] = "edge"
    resp = client.patch("/config", json=cfg)
    assert resp.status_code == 200
    assert resp.json()["tts"]["provider"] == "edge"
    # persisted to disk
    assert client.get("/config").json()["tts"]["provider"] == "edge"


def test_patch_config_invalid(client):
    cfg = client.get("/config").json()
    cfg["server"]["port"] = 999999
    resp = client.patch("/config", json=cfg)
    assert resp.status_code == 422
