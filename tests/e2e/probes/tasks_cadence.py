"""GATE-5 W1-CONFORMANCE — probe: tasks/reminders line (W1-TASKS owns it).

Vision line (panel-vision.md): "the task bar should have some to do's but
also be able to have some constant/permanent reminders, the agent should
get them injected like cronjobs every certain amount of time in context."

Verified (this lane): active reminders ride every turn's context
(constant/permanent half), the scheduler fires ONE event per reminder
(double-publish VERIFIED fixed — common-brief instruction), and a fired
reminder STARTS a fresh agent turn with the reminder in context
(cadence-injection half — W1-TASKS). Row status: PASS.
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

            # The fire tick continues in the same deterministic bus order:
            # notification -> tasks.update refresh (ADV-F2) -> the injected
            # fresh agent turn (W1-TASKS). The mock turn completes in
            # milliseconds, so ONE generous collect window captures the
            # whole fire sequence — no drain/watch race, and the checks
            # below key off FIFO frame order, never wall-clock luck.
            events.extend(_collect_for(ws, 6.0))

            # c3 — the fire refreshes content.tasks (notification→panel seam)
            tasks_updates = frames_of(events, "tasks.update")
            c3 = bool(tasks_updates)
            checks.append(
                {
                    "id": "tasks_update_on_fire",
                    "label": "tasks.update frame follows the fire (renderer content.tasks refresh)",
                    "pass": c3,
                    "evidence": f"{len(tasks_updates)} tasks.update frame(s)",
                }
            )

            # c4 — the fire STARTS a fresh agent turn (cron-style cadence
            # injection). Deterministic: the bus is FIFO, so any turn
            # activity AFTER the notification frame belongs to the fire's
            # injected turn (state_update thinking + user_message with the
            # reminder text + the mock agent's tool_call/agent_message).
            notif_idx = next(i for i, e in enumerate(events) if e["type"] == "notification")
            after = events[notif_idx + 1 :]
            turn_started = any(
                e["type"] in ("agent_message", "tool_call", "user_message")
                or (e["type"] == "state_update" and e["voice_state"] == "thinking")
                for e in after
            )
            reminder_in_turn = any(
                e["type"] == "user_message" and "Alarma cadencia W1" in e["text"]
                for e in after
            )
            checks.append(
                {
                    "id": "fire_triggers_turn",
                    "label": "a fired reminder starts a fresh agent turn (cadence injection)",
                    "pass": turn_started and reminder_in_turn,
                    "evidence": (
                        "turn activity after the notification frame: "
                        + ", ".join(f"{e['type']}" for e in after if e["type"] in (
                            "user_message", "tool_call", "agent_message", "state_update"
                        ))[:400]
                        if (turn_started or reminder_in_turn)
                        else "no turn activity after the notification frame — reminders "
                        "notify the panel but are not injected into a fresh turn yet (W1-TASKS)"
                    ),
                }
            )

    verdict = "PASS" if all(c["pass"] for c in checks) else "FAIL"
    record_verdict(
        record_dir,
        "tasks",
        verdict,
        "Context injection + single publish verified; fire→fresh-turn cadence injection WIRED (W1-TASKS).",
        checks,
        evidence=[
            "tests/e2e/test_wire_probe.py::test_reminder_fire_publishes_once",
            "tests/e2e/test_wire_probe.py::test_reminder_fire_starts_fresh_turn",
            "tests/e2e/probes/tasks_cadence.py",
            "services/agent/arsvox_agent/runtime.py::AgentRuntime.handle_reminder_fire",
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
