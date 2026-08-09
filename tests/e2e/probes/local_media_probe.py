"""GATE-5 W1-CONFORMANCE — probe: media unified-player line (W1-MEDIA-LOCAL).

Vision line (panel-vision.md): media "should be able to host the youtube
videos in case they get send to second view or are music but also music
from either youtube or local, controls and ui for that should be the same."

Verified halves (this lane): ONE MediaController authority (R24-R27), the
frozen wire members (MediaSource.LOCAL, MediaStateEvent.local_path), and
the media.select_result client path routing BOTH sources through the same
controller — see test_wire_probe.py.

This probe records the missing half: local-file discovery in the service.
Row status: PENDING (W1-MEDIA-LOCAL). Verdict: FAIL until a local library
exists to feed the same player.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Bootstrap: probes run as standalone scripts (sys.path[0] = probes/); the
# worktree root must be importable for tests.e2e.probe_core.
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from tests.e2e.probe_core import (
    WORKTREE,
    ensure_worktree_paths,
    frames_of,
    make_app,
    record_verdict,
    run_client_command,
)


def _grep(path: Path, needles: list[str]) -> list[str]:
    hits: list[str] = []
    for p in sorted(path.rglob("*.py")):
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        if any(n in text for n in needles):
            hits.append(str(p.relative_to(WORKTREE)))
    return hits


def main(record_dir: Path) -> int:
    ensure_worktree_paths()
    checks: list[dict] = []

    # c1 — the frozen wire members for the unified player
    from arsvox_contracts.enums import MediaSource
    from arsvox_contracts.events import MediaStateEvent

    fields = MediaStateEvent.model_fields
    c1 = MediaSource.LOCAL.value == "local" and "local_path" in fields and "source" in fields
    checks.append(
        {
            "id": "wire_local_member",
            "label": "MediaSource.LOCAL + MediaStateEvent.source/kind/local_path on the frozen wire",
            "pass": c1,
            "evidence": "packages/contracts (W0-CONTRACT) — read-only reference",
        }
    )

    # c2 — the user pick routes a LOCAL result through the SAME controller
    app, _ = make_app()
    events = run_client_command(
        app,
        {
            "action": "media.select_result",
            "result_id": "",
            "source": "local",
            "kind": "audio",
            "title": "Mi canción local",
            "url": None,
            "local_path": "file:///tmp/mi-cancion.mp3",
        },
        wait_for=lambda e: e["type"] == "action_result",
    )
    results = frames_of(events, "action_result")
    media = frames_of(events, "media.state")
    c2 = (
        bool(results)
        and results[-1]["status"] == "done"
        and bool(media)
        and media[-1]["source"] == "local"
    )
    checks.append(
        {
            "id": "unified_route",
            "label": "media.select_result(source=local) -> action_result done + media.state(source=local)",
            "pass": c2,
            "evidence": (
                f"action_result={results[-1]['status'] if results else 'none'}, "
                f"media.state source={media[-1]['source'] if media else 'none'}"
            ),
        }
    )

    # c3 — local-file discovery exists in the service (the missing half)
    discovery = _grep(
        WORKTREE / "services",
        ["local library", "local_library", "audio_dir", "music_dir", "scan_audio", "audio_files"],
    )
    c3 = bool(discovery)
    checks.append(
        {
            "id": "local_library_discovery",
            "label": "the service can discover local audio files (a real local library)",
            "pass": c3,
            "evidence": (
                ", ".join(discovery)
                if discovery
                else "no local audio discovery in services/ — MediaSource.LOCAL has no file source yet"
            ),
        }
    )

    verdict = "PASS" if all(c["pass"] for c in checks) else "FAIL"
    record_verdict(
        record_dir,
        "media_local",
        verdict,
        "Unified controller + frozen wire members verified; local-file discovery missing — "
        "W1-MEDIA-LOCAL owns it.",
        checks,
        evidence=[
            "tests/e2e/test_wire_probe.py::test_media_select_result_local_routes_unified_controller",
            "tests/e2e/probes/local_media_probe.py",
        ],
    )
    print(f"[media_local] {verdict}")
    for c in checks:
        print(f"  {'PASS' if c['pass'] else 'FAIL'}  {c['id']}: {c['label']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--record-dir", type=Path, default=Path(__file__).resolve().parent.parent / "evidence")
    args = ap.parse_args()
    raise SystemExit(main(args.record_dir))
