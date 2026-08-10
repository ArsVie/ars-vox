"""GATE-5 W1-CONFORMANCE — shared probe machinery.

The harness has two execution modes that share ONE assertion core:

- CI mode (pytest, mock agent):  tests/e2e/test_wire_probe.py drives the
  real app (FastAPI TestClient) with a SCRIPTED FunctionModel — no live
  model, fully deterministic.
- Packaged mode (GATE-1): tests/e2e/wire_probe_live.py connects to the
  packaged build's service over a real WebSocket (Bearer token) and runs
  the same deterministic wire assertions against live frames; the CDP
  scripts (tests/e2e/cdp/) assert the rendered DOM.

This module owns: the worktree import shim (so probes run from anywhere),
a temp app boot (mock config, scripted model), the scripted-model turn
driver, and the verdict/evidence recorder the standalone probes write.
"""

from __future__ import annotations

import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

WORKTREE = Path(__file__).resolve().parents[2]

# Vision-line identifiers used by the checklist (docs/vision-conformance.md)
# and the consistency test (test_harness_consistency.py). Keep in sync.
PROBE_IDS = [
    "conversation_time",
    "document_reader",
    "document_editor",
    "tasks",
    "media_local",
    "youtube",
    "browser",
    "memory",
]


def ensure_worktree_paths() -> None:
    """Put this worktree's packages at the FRONT of sys.path and drop the
    venv's editable-install finders (they hardcode the main repo's paths).

    Mirror of the root conftest.py shim — standalone probes run without
    pytest, so they must fix the import path themselves.
    """
    pkg_dirs = [
        WORKTREE / "packages" / "contracts",
        WORKTREE / "services" / "agent",
        WORKTREE / "services" / "memory",
        WORKTREE / "services" / "tts",
        WORKTREE / "services" / "voice",
    ]
    for d in pkg_dirs:
        s = str(d)
        if s in sys.path:
            sys.path.remove(s)
        sys.path.insert(0, s)
    sys.meta_path[:] = [
        f
        for f in sys.meta_path
        if not getattr(f, "__module__", "").startswith("__editable___arsvox_")
    ]
    if str(WORKTREE) not in sys.path:
        sys.path.insert(0, str(WORKTREE))


def make_app(tmp_root: Path | None = None):
    """Boot the real app with the shared mock config (no live model).

    Uses tests/python/harness_fixtures.base_config (the single source of truth for
    test overrides) so the harness exercises the same app the python suite
    does. Returns (app, tmp_root).
    """
    from tests.python.harness_fixtures import base_config

    import yaml

    tmp_root = tmp_root or Path(tempfile.mkdtemp(prefix="gate5-w1-conf-"))
    cfg = base_config(tmp_root)
    path = tmp_root / "app.yaml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")

    from arsvox_agent.app import create_app

    return create_app(str(path)), tmp_root


# --------------------------------------------------------------------------- #
# Scripted-model turn driver (CI mode)
# --------------------------------------------------------------------------- #

def scripted_model(tool_name: str, args: dict, text: str = "Listo."):
    """FunctionModel that calls one tool, then answers with text.

    Same shape as tests/python/test_ws_e2e._scripted — the harness keeps a
    local copy so tests/e2e is self-contained.
    """
    from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    state = {"step": 0}

    def handler(messages, info):
        if state["step"] == 0:
            state["step"] += 1
            return ModelResponse(parts=[ToolCallPart(tool_name=tool_name, args=args)])
        return ModelResponse(parts=[TextPart(content=text)])

    return FunctionModel(handler)


def run_scripted_turn(
    app,
    tool_name: str,
    args: dict,
    user_text: str = "hazlo",
    text: str = "Listo.",
    max_events: int = 80,
):
    """Connect a WS client, patch the runtime's build_model with the
    scripted model, send user_text, and collect frames until the turn
    settles (the SECOND listening state_update — the first wakes the
    pipeline, the second closes the turn).

    Returns the collected event list (list[dict]).
    """
    import arsvox_agent.runtime as runtime
    from tests.python.harness_fixtures import ws_collect

    from fastapi.testclient import TestClient

    original = runtime.build_model
    runtime.build_model = lambda cfg: scripted_model(tool_name, args, text)
    try:
        with TestClient(app) as c:
            with c.websocket_connect("/ws") as ws:
                ws.receive_json()  # state_update
                ws.receive_json()  # config_update
                ws.send_json({"type": "user_text", "text": user_text})
                seen = {"n": 0}

                def _break(e):
                    if e["type"] == "state_update" and e["voice_state"] == "listening":
                        seen["n"] += 1
                        return seen["n"] >= 2
                    return False

                return ws_collect(client=c, ws=ws, expected_break=_break, max_events=max_events)
    finally:
        runtime.build_model = original


def run_client_command(app, command: dict, wait_for=None, timeout_s: float = 6.0):
    """Send one client ui_command frame over WS and collect the response.

    Used by probes for client-driven wire paths (media.select_result,
    memory.search, browser.navigate) that do not go through the model.
    Returns the collected event list (breaks early when wait_for(ev) is
    true, or after timeout_s).
    """
    import time as _time

    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        with c.websocket_connect("/ws") as ws:
            ws.receive_json()  # state_update
            ws.receive_json()  # config_update
            ws.send_json({"type": "ui_command", "command": command})
            events: list[dict] = []
            deadline = _time.monotonic() + timeout_s
            while _time.monotonic() < deadline:
                try:
                    ev = ws.receive_json()
                except Exception:  # socket closed mid-collect
                    break
                events.append(ev)
                if wait_for is not None and wait_for(ev):
                    break
            return events


def make_deps(**overrides):
    """A Deps with inert fakes — mirrors tests/python/test_time_injection.py.

    Only config + sessions/reminders/panels/pending are live fakes; every
    other dependency is None (unit probes never run tools through the
    registry). Override any field with keyword arguments.
    """
    from arsvox_contracts import AppConfig
    from arsvox_agent.deps import Deps

    class _Panels:
        def list(self):
            return []

    class _Pending:
        def list_pending(self):
            return []

    class _Reminders:
        def list_active(self):
            return []

    class _Sessions:
        def recent_turns(self, session_id, limit):
            return []

    deps = Deps(
        config=AppConfig(),
        db=None,
        sessions=_Sessions(),
        notes=None,
        tasks=None,
        reminders=_Reminders(),
        notifications=None,
        panels=_Panels(),
        preferences=None,
        progress=None,
        pending=_Pending(),
        documents=None,
        audit=None,
        bus=None,
        policy=None,
        confirmations=None,
        tts=None,
        telegram=None,
    )
    for key, value in overrides.items():
        setattr(deps, key, value)
    return deps


def frames_of(events: list[dict], *types: str) -> list[dict]:
    return [e for e in events if e["type"] in types]


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# Evidence recorder (standalone probes + GATE-1)
# --------------------------------------------------------------------------- #

VERDICTS = ("PASS", "FAIL", "NOT_YET")


def record_verdict(
    record_dir: Path,
    probe_id: str,
    verdict: str,
    summary: str,
    checks: list[dict[str, Any]],
    evidence: list[str] | None = None,
) -> Path:
    """Write one probe's evidence JSON.

    - record_dir: where evidence lands (default tests/e2e/evidence).
    - probe_id:  must be a PROBE_IDS member (consistency test enforces).
    - verdict:   PASS | FAIL | NOT_YET.
    - checks:    [{id, label, pass, evidence}] — per-check verdicts.
    """
    assert verdict in VERDICTS, f"bad verdict {verdict!r}"
    assert probe_id in PROBE_IDS, f"unknown probe id {probe_id!r}"
    record_dir = Path(record_dir)
    record_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "probe": probe_id,
        "verdict": verdict,
        "summary": summary,
        "checks": checks,
        "evidence": evidence or [],
        "recorded_at_utc": utcnow_iso(),
        "harness": "tests/e2e (GATE-5 W1-CONFORMANCE)",
    }
    out = record_dir / f"{probe_id}.json"
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def load_verdict(record_dir: Path, probe_id: str) -> dict[str, Any]:
    return json.loads((Path(record_dir) / f"{probe_id}.json").read_text(encoding="utf-8"))
