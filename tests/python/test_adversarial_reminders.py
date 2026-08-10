"""GATE-3.5 A10 — adversarial integration tests R44/R45: reminder snooze
across the full path.

R44 — one-shot reminder snooze: fired -> spoken "posponer" (local intent)
      -> occurrence snoozed, notification resolved, refire at the snooze
      target.
R45 — recurring reminder snooze: the OCCURRENCE moves to now+10m while the
      recurrence anchor stays intact (next occurrence still 08:00 local).

Two layers, both written by A10 (test-only agent):
  1. unit: snooze_top() — the EXACT function the spoken intent calls —
     with deterministic clocks, covering the occurrence lifecycle;
  2. e2e over /ws: the real scheduler fires a DB reminder, the spoken
     "posponer"/"snooze" utterance (local intent, LLM-free) snoozes it,
     and the state assertions land on the real stores.

The H2 unit suite (test_reminder_lifecycle.py) already proves the store
semantics; this file proves the PATH (intent -> scheduler -> store ->
notification) the contract's A10 family is about.
"""

import asyncio
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from tests.python.test_reminder_lifecycle import TZ, TZ_NAME, _setup
from tests.python.harness_fixtures import ws_collect


def _drain(q) -> list[dict]:
    """Drain an EventBus subscriber queue (payload dicts)."""
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out

# --------------------------------------------------------------------- #
# unit: snooze_top (the spoken-snooze handler) — occurrence lifecycle
# --------------------------------------------------------------------- #


def test_r44_one_shot_snooze_top_refires_at_target():
    import tempfile
    from pathlib import Path

    db, reminders, notifications, bus, scheduler = _setup(Path(tempfile.mkdtemp()))
    now = datetime.now(timezone.utc)
    rid = reminders.create(
        "pastilla", (now - timedelta(seconds=1)).isoformat(timespec="seconds"), "none"
    )
    asyncio.run(scheduler.tick())
    assert reminders.get(rid)["occ_status"] == "fired"

    # spoken snooze: the local-intent handler path (ws._handle_local_intent
    # calls scheduler.snooze_top(config.reminders.snooze_seconds))
    q = bus.subscribe()
    asyncio.run(scheduler.snooze_top(600))
    row = reminders.get(rid)
    assert row["status"] == "active"
    assert row["occ_status"] == "snoozed"
    assert not notifications.list_active()  # the fired notification resolved
    # the bus carried the confirmation message the UI speaks
    texts = [
        p["text"] for p in _drain(q) if p["type"] == "agent_message"
    ]
    assert any("pospuesto" in t for t in texts), texts
    snooze_target = row["due_at"]
    assert abs(
        (datetime.fromisoformat(snooze_target) - now).total_seconds() - 600
    ) < 10

    # at the snooze target the scheduler promotes and refires: one-shot
    # exhausted again, fresh notification
    asyncio.run(scheduler.tick(now_iso=snooze_target))
    row = reminders.get(rid)
    assert row["status"] == "fired"
    assert row["occ_status"] == "fired"
    assert len(notifications.list_active()) == 1
    assert [o["status"] for o in reminders.occurrences(rid)] == ["fired", "snoozed"]


def test_r45_recurring_snooze_top_keeps_daily_anchor():
    import tempfile
    from pathlib import Path

    db, reminders, notifications, bus, scheduler = _setup(Path(tempfile.mkdtemp()))
    # deterministic fire: daily 08:00 local (Kolkata) = 02:30 UTC
    rid = reminders.create("medicina", "2026-08-06T02:30:00+00:00", repeat_rule="daily")
    asyncio.run(scheduler.tick(now_iso="2026-08-06T02:30:01+00:00"))
    assert reminders.get(rid)["occ_status"] == "active"  # advanced to tomorrow
    assert len(notifications.list_active()) == 1  # today's occurrence fired

    # spoken snooze: occurrence -> now+10m, recurrence rule untouched.
    # Deterministic: pass the fixed fire instant (the tool defaults to the
    # real wall clock; the real-clock window flips the final assertion
    # depending on when the suite runs vs the 02:30 UTC daily anchor).
    fire_instant = datetime(2026, 8, 6, 2, 30, 1, tzinfo=timezone.utc)
    asyncio.run(scheduler.snooze_top(600, now=fire_instant))
    row = reminders.get(rid)
    assert row["occ_status"] == "snoozed"
    assert row["repeat_rule"] == "daily"
    assert not notifications.list_active()  # the fired notification resolved

    # the recurrence anchor is untouched: at the snooze target the next
    # occurrence is the daily 08:00 local, never 08:10
    snooze_target = row["due_at"]
    asyncio.run(scheduler.tick(now_iso=snooze_target))
    row = reminders.get(rid)
    assert row["occ_status"] == "active"
    nxt = datetime.fromisoformat(row["due_at"]).astimezone(TZ)
    assert nxt.strftime("%H:%M") == "08:00", row["due_at"]
    assert nxt.date().isoformat() > datetime.fromisoformat(snooze_target).date().isoformat()


# --------------------------------------------------------------------- #
# e2e: spoken snooze over the real /ws (mock agent, real stores)
# --------------------------------------------------------------------- #


def _wait_fired(services, deadline_s=6):
    """The app-loop scheduler fires within interval 1s; poll the store."""
    deadline = time.time() + deadline_s
    while not services.notifications.list_active() and time.time() < deadline:
        time.sleep(0.2)
    assert services.notifications.list_active(), "scheduler never fired the reminder"


def _drain_fired_turn(ws, max_events=60):
    """W1-TASKS (GATE-5): a fire now ALSO starts a fresh agent turn
    (cadence injection), whose frames land on the bus right after the
    notification. Drain them before the snooze exchange so the collected
    stream starts at the exchange: snapshot -> notification ->
    tasks.update -> thinking -> user_message -> tool_call -> agent_message
    -> listening (the fired turn settles)."""
    events = []
    for _ in range(max_events):
        ev = ws.receive_json()
        events.append(ev)
        if ev["type"] == "state_update" and ev["voice_state"] == "listening":
            break
    return events


def test_r44_spoken_snooze_one_shot_full_path(script_client):
    """One-shot reminder -> real scheduler fires -> spoken 'posponer' ->
    occurrence snoozed, notification resolved, message spoken."""
    from tests.python.test_reconnect_snapshot import _scripted

    c = script_client(_scripted("notes.add", {"text": "nada"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()  # state_update
        ws.receive_json()  # config_update
        services = c.app.state.services
        now = datetime.now(timezone.utc)
        rid = services.reminders.create(
            "pastilla",
            (now - timedelta(seconds=1)).isoformat(timespec="seconds"),
            "none",
        )
        _wait_fired(services)
        assert services.reminders.get(rid)["occ_status"] == "fired"
        # the fire's injected fresh turn (cadence) precedes the exchange
        _drain_fired_turn(ws)

        ws.send_json({"type": "user_text", "text": "posponer"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "agent_message",
        )
        texts = [e["text"] for e in events if e["type"] == "agent_message"]
        assert any("pospuesto" in t for t in texts)
        row = services.reminders.get(rid)
        assert row["occ_status"] == "snoozed"
        assert row["status"] == "active"
        assert not services.notifications.list_active()


def test_r45_spoken_snooze_recurring_full_path(script_client):
    """Daily reminder -> real scheduler fires -> spoken 'snooze diez
    minutos' -> occurrence snoozed, recurrence rule intact, due advanced
    by the snooze window (never the model)."""
    from tests.python.test_reconnect_snapshot import _scripted

    c = script_client(_scripted("notes.add", {"text": "nada"}))
    with c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        services = c.app.state.services
        now = datetime.now(timezone.utc)
        rid = services.reminders.create(
            "medicina",
            (now - timedelta(seconds=1)).isoformat(timespec="seconds"),
            "daily",
        )
        _wait_fired(services)
        # the fire's injected fresh turn (cadence) precedes the exchange
        _drain_fired_turn(ws)
        ws.send_json({"type": "user_text", "text": "snooze diez minutos"})
        events = ws_collect(
            client=c, ws=ws,
            expected_break=lambda e: e["type"] == "agent_message",
        )
        texts = [e["text"] for e in events if e["type"] == "agent_message"]
        assert any("pospuesto" in t for t in texts)
        row = services.reminders.get(rid)
        assert row["occ_status"] == "snoozed"
        assert row["repeat_rule"] == "daily"  # recurrence anchor intact
        # occurrence moved to now+10m — NOT the next daily slot
        delta = (
            datetime.fromisoformat(row["due_at"]) - datetime.now(timezone.utc)
        ).total_seconds()
        assert 590 < delta < 610, delta
        assert not services.notifications.list_active()


# --------------------------------------------------------------------- #
# fixture: the script_client pattern (mirrors test_reconnect_snapshot.py)
# --------------------------------------------------------------------- #

import pytest  # noqa: E402


@pytest.fixture
def script_client(client, monkeypatch):
    def _patch(model_builder):
        monkeypatch.setattr("arsvox_agent.runtime.build_model", lambda cfg: model_builder)
        return client

    return _patch
