"""GATE-5 W1-CONFORMANCE — probe: browser line (Wave 2 — NOT_YET).

Vision line (panel-vision.md): "an integrated broser that the agent could
use the search bar and scroll through it with DOM and user manipulable
too, that could be used among other things for news."

Wave 2 owns the browser (W2-VIEW + W2-DRIVE); the brief says mark NOT_YET
or run if merged. This probe records the current state as evidence so the
row never silently becomes PASS: the renderer is an iframe demo, the
service hardcodes can_go_back=False, and there is no WebContentsView.
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
    record_verdict,
)

AGENT_DIR = WORKTREE / "services" / "agent"
ELECTRON_MAIN = WORKTREE / "apps" / "desktop" / "electron" / "main.ts"
BROWSER_PANEL = WORKTREE / "apps" / "desktop" / "src" / "components" / "BrowserPanel.tsx"


def main(record_dir: Path) -> int:
    ensure_worktree_paths()
    checks: list[dict] = []

    actions_src = (AGENT_DIR / "arsvox_agent" / "actions.py").read_text(encoding="utf-8")
    c1 = "can_go_back=False" in actions_src
    checks.append(
        {
            "id": "can_go_back_hardcoded",
            "label": "service hardcodes can_go_back=False (no browser-state source)",
            "pass": c1,
            "evidence": "arsvox_agent/actions.py _navigate_browser (read-only reference) — W2-VIEW owns the channel",
        }
    )

    panel_src = BROWSER_PANEL.read_text(encoding="utf-8") if BROWSER_PANEL.exists() else ""
    c2 = "<iframe" in panel_src
    checks.append(
        {
            "id": "iframe_renderer",
            "label": "renderer browser surface is the web-demo iframe (no WebContentsView)",
            "pass": c2,
            "evidence": "apps/desktop/src/components/BrowserPanel.tsx (read-only reference)",
        }
    )

    main_src = ELECTRON_MAIN.read_text(encoding="utf-8") if ELECTRON_MAIN.exists() else ""
    c3 = "WebContentsView" not in main_src
    checks.append(
        {
            "id": "webcontentsview_absent",
            "label": "Electron main has no WebContentsView yet (W2-VIEW not merged)",
            "pass": c3,
            "evidence": "apps/desktop/electron/main.ts (read-only reference)",
        }
    )

    record_verdict(
        record_dir,
        "browser",
        "NOT_YET",
        "Integrated agent-drivable browser is Wave 2 (W2-VIEW + W2-DRIVE). "
        "CDP snippets are ready in tests/e2e/cdp/; the row flips when W2 merges.",
        checks,
        evidence=[
            "tests/e2e/cdp/snippets/ (agent-drive placeholders)",
            "docs/plans/gate-5-vision-conformance-orchestration-2026-08-09.md (Wave 2)",
        ],
    )
    print("[browser] NOT_YET")
    for c in checks:
        print(f"  FACT  {c['id']}: {c['label']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--record-dir", type=Path, default=Path(__file__).resolve().parent.parent / "evidence")
    args = ap.parse_args()
    raise SystemExit(main(args.record_dir))
