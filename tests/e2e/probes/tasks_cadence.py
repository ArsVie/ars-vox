"""GATE-5 W1-CONFORMANCE — probe: tasks/reminders line (W1-TASKS owns it).

Vision line (panel-vision.md): "the task bar should have some to do's but
also be able to have some constant/permanent reminders, the agent should
get them injected like cronjobs every certain amount of time in context."

Verified halves (this lane): active reminders ride every turn's context
(constant/permanent half) and the scheduler fires ONE event per reminder
(double-publish VERIFIED fixed — common-brief instruction).

Remaining (W1-TASKS): a fired reminder must START a fresh agent turn
(cadence injection), not just notify. Row status: PENDING. Verdict: FAIL
until the fire→turn path exists.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Bootstrap: probes run as standalone scripts (sys.path[0] = probes/); the
# worktree root must be importable for tests.e2e.probe_core.
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from tests.e2e.probe_core import (
    ensure_worktree_paths,
    frames_of,
    make_app,
    record_verdict,
)

from fastapi.testclient import TestClient


def _collect_for(ws, seconds: float, max_events: int = 200) -> list[dict]:
    events: list[dict] = []
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline and len(events) < max_events:
        try:
            events.append(ws.receive_json())
        except Exception:
            break
    return events


def main(record_dir: Path) -> int:
    ensure_worktree_paths()
    checks: list[dict] = []

    # c1 — active reminders are injected into every turn's context
    from arsvox_agent.context import build_context

    from tests.e2e.probe_core import make_deps

    class _Reminders:
        def list_active(self):
            return [{"id": 1, "due_at": "2026-08-09T12:00:00+00:00", "text": "recordatorio permanente"}]

    deps = make_deps(reminders=_Reminders())
    ctx = build_context(deps.config, deps)
    c1 = "Recordatorios activos:" in ctx and "recordatorio permanente" in ctx
    c1 = c1 and ctx.splitlines()[0].startswith("Hora actual: ")
    checks.append(
        {
            "id": "context_carries_reminders",
            "label": "build_context injects active reminders (after the time line) every turn",
            "pass": c1,
            "evidence": "arsvox_agent/context.py build_context() — read-only reference",
        }
    )

    app, _ = make_app()
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.receive_json()
            ws.receive_json()
            services = client.app.state.services
            now = datetime.now(timezone.utc)
            services.reminders.create(
                "Alarma cadencia W1",
                (now - timedelta(seconds=1)).isoformat(timespec="seconds"),
                "none",
            )
            events: list[dict] = []
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline and not frames_of(events, "notification"):
                events.extend(_collect_for(ws, 1.0))

            # c2 — one notification event per fire (double-publish VERIFY)
            notifications = frames_of(events, "notification")
            c2 = len(notifications) == 1 and notifications[0]["text"] == "Alarma cadencia W1"
            checks.append(
                {
                    "id": "single_publish",
                    "label": "one `notification` event per fired reminder (GATE-3.5 double-publish VERIFIED fixed)",
                    "pass": c2,
                    "evidence": f"{len(notifications)} notification event(s) collected",
                }
            )

            # the fire's tasks.update refresh lands right after the
            # notification in the same tick — drain a little more, then
            # keep watching for any fresh-turn activity (c4)
            events.extend(_collect_for(ws, 1.0))
            post = _collect_for(ws, 3.0)

            # c3 — the fire refreshes content.tasks (notification→panel seam)
            tasks_updates = frames_of(events + post, "tasks.update")
            c3 = bool(tasks_updates)
            checks.append(
                {
                    "id": "tasks_update_on_fire",
                    "label": "tasks.update frame follows the fire (renderer content.tasks refresh)",
                    "pass": c3,
                    "evidence": f"{len(tasks_updates)} tasks.update frame(s)",
                }
            )

            # c4 — the fire STARTS a fresh agent turn (cron-style cadence injection)
            turn_started = any(
                e["type"] in ("agent_message", "tool_call")
                or (e["type"] == "state_update" and e["voice_state"] == "thinking")
                for e in post
            )
            checks.append(
                {
                    "id": "fire_triggers_turn",
                    "label": "a fired reminder starts a fresh agent turn (cadence injection)",
                    "pass": turn_started,
                    "evidence": (
                        "turn activity observed after the fire"
                        if turn_started
                        else "no turn activity within 3s of the fire — reminders notify the panel but "
                        "are not injected into a fresh turn yet (W1-TASKS)"
                    ),
                }
            )

    verdict = "PASS" if all(c["pass"] for c in checks) else "FAIL"
    record_verdict(
        record_dir,
        "tasks",
        verdict,
        "Context injection + single publish verified; fire→fresh-turn cadence missing — W1-TASKS.",
        checks,
        evidence=[
            "tests/e2e/test_wire_probe.py::test_reminder_fire_publishes_once",
            "tests/e2e/probes/tasks_cadence.py",
        ],
    )
    print(f"[tasks] {verdict}")
    for c in checks:
        print(f"  {'PASS' if c['pass'] else 'FAIL'}  {c['id']}: {c['label']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--record-dir", type=Path, default=Path(__file__).resolve().parent.parent / "evidence")
    args = ap.parse_args()
    raise SystemExit(main(args.record_dir))
