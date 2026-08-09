"""GATE-5 W1-CONFORMANCE — probe: document shared-editing line (W1-DOC-SHARED).

Vision line (panel-vision.md): "a lightweight agent first document editor
that can produce docs and both the user and the agent can edit it."

Verified half (L3, this lane): PDF/EPUB/TXT reader — see test_wire_probe.py
test_document_kind_wire + store.test.ts reader row.

This probe decides the co-editing half: agent edits must reach the open
editor through document.changed (W0-CONTRACT member). Today
document_insert_text writes the file and the store but NEVER emits —
the user looking at the open document sees nothing (orchestration-plan
finding, GATE-5). Row status: PENDING (W1-DOC-SHARED). Verdict: FAIL.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Bootstrap: probes run as standalone scripts (sys.path[0] = probes/); the
# worktree root must be importable for tests.e2e.probe_core.
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from tests.e2e.probe_core import (
    ensure_worktree_paths,
    frames_of,
    make_app,
    record_verdict,
    run_scripted_turn,
)


def main(record_dir: Path) -> int:
    ensure_worktree_paths()
    checks: list[dict] = []

    app, tmp_root = make_app()

    # c1 — creating a document opens the editor (agent produces docs)
    create_events = run_scripted_turn(
        app, "document_create", {"title": "Nota de la conformance"}, user_text="crea un documento"
    )
    opens = [
        e["command"]
        for e in frames_of(create_events, "ui_command")
        if e.get("command", {}).get("action") == "panel.open"
        and e["command"].get("panel_type") == "document_editor"
    ]
    c1 = bool(opens)
    checks.append(
        {
            "id": "create_opens_editor",
            "label": "document.create emits panel.open(document_editor) — the agent can produce a doc",
            "pass": c1,
            "evidence": "scripted document.create -> panel.open frame" if c1 else "no panel.open frame",
        }
    )

    # c2 — an agent edit reaches the open editor (document.changed emission)
    # Fresh app on the SAME tmp_root: the first TestClient exit ran lifespan
    # shutdown (services.db.close()), so a second boot needs a new app
    # object; the shared tmp_root keeps the document created in c1.
    app, _ = make_app(tmp_root)
    edit_events = run_scripted_turn(
        app,
        "document_insert_text",
        {"title": "Nota de la conformance", "text": "Párrafo añadido por el agente. "},
        user_text="añade un párrafo",
    )
    changed = frames_of(edit_events, "document.changed")
    c2 = bool(changed)
    checks.append(
        {
            "id": "insert_emits_document_changed",
            "label": "document.insert_text emits document.changed so the open editor updates live",
            "pass": c2,
            "evidence": (
                f"{len(changed)} document.changed frame(s) collected"
                if changed
                else "NO document.changed frame — the agent edits the store, the user sees nothing "
                "(document_tools.py:105 writes without emitting)"
            ),
        }
    )

    verdict = "PASS" if all(c["pass"] for c in checks) else "FAIL"
    record_verdict(
        record_dir,
        "document_editor",
        verdict,
        "Agent produces docs (create opens the editor) but edits do not reach the open editor "
        "yet — document.changed emission is W1-DOC-SHARED's task.",
        checks,
        evidence=[
            "tests/e2e/probes/doc_shared.py",
            "services/agent/arsvox_agent/tools/document_tools.py (read-only reference)",
        ],
    )
    print(f"[document_editor] {verdict}")
    for c in checks:
        print(f"  {'PASS' if c['pass'] else 'FAIL'}  {c['id']}: {c['label']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--record-dir", type=Path, default=Path(__file__).resolve().parent.parent / "evidence")
    args = ap.parse_args()
    raise SystemExit(main(args.record_dir))
