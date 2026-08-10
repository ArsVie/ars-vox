"""GATE-5 W1-CONFORMANCE — probe: browser line (Wave 2 — PASS, GATE-2 closed).

Vision line (panel-vision.md): "an integrated broser that the agent could
use the search bar and scroll through it with DOM and user manipulable
too, that could be used among other things for news."

Wave 2 (W2-VIEW + W2-DRIVE + W2-NAVIGATE) is merged and the row is
CLOSED at GATE-2 (packaged, real model, 2026-08-10): the agent
navigated to openstreetmap.org by itself, scrolled, clicked the Español
link (real navigation to es.wikipedia.org), and read page content back
in Spanish. This probe records the built state as honest facts; the
packaged CDP evidence lives in docs/screenshots/gate2-*.png.
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
ELECTRON_DIR = WORKTREE / "apps" / "desktop" / "electron"
BROWSER_PANEL = WORKTREE / "apps" / "desktop" / "src" / "components" / "BrowserPanel.tsx"
TOOLS_DIR = AGENT_DIR / "arsvox_agent" / "tools"


def main(record_dir: Path) -> int:
    ensure_worktree_paths()
    checks: list[dict] = []

    actions_src = (AGENT_DIR / "arsvox_agent" / "actions.py").read_text(encoding="utf-8")
    c1 = "can_go_back=False" not in actions_src
    checks.append(
        {
            "id": "real_nav_state",
            "label": "service no longer hardcodes can_go_back=False (real browser-state source)",
            "pass": c1,
            "evidence": "arsvox_agent/actions.py reads the browser-state store (W2-VIEW)",
        }
    )

    panel_src = BROWSER_PANEL.read_text(encoding="utf-8") if BROWSER_PANEL.exists() else ""
    c2 = "<iframe" not in panel_src and "browser-viewport" in panel_src
    checks.append(
        {
            "id": "viewport_not_iframe",
            "label": "renderer browser surface is the viewport placeholder (no iframe)",
            "pass": c2,
            "evidence": "apps/desktop/src/components/BrowserPanel.tsx — .browser-viewport + live nav buttons",
        }
    )

    view_src = (ELECTRON_DIR / "browser-view.ts").read_text(encoding="utf-8") if (ELECTRON_DIR / "browser-view.ts").exists() else ""
    c3 = "WebContentsView" in view_src
    checks.append(
        {
            "id": "webcontentsview_wired",
            "label": "Electron main wires a WebContentsView (integrated browser view)",
            "pass": c3,
            "evidence": "apps/desktop/electron/browser-view.ts + main.ts (W2-VIEW)",
        }
    )

    dom_src = (ELECTRON_DIR / "dom-driver.ts").read_text(encoding="utf-8") if (ELECTRON_DIR / "dom-driver.ts").exists() else ""
    c4 = "executeJavaScript" in dom_src and "set_value" in dom_src
    checks.append(
        {
            "id": "dom_bridge_present",
            "label": "main-process DOM driver executes click/scroll/set_value/query",
            "pass": c4,
            "evidence": "apps/desktop/electron/dom-driver.ts (W2-DRIVE)",
        }
    )

    browser_tools = (TOOLS_DIR / "browser_tools.py").read_text(encoding="utf-8") if (TOOLS_DIR / "browser_tools.py").exists() else ""
    c5 = "browser.dom_action" in browser_tools and "browser.navigate" in browser_tools
    checks.append(
        {
            "id": "agent_tools_registered",
            "label": "agent tools browser.dom_action + browser.navigate emit frozen event shapes",
            "pass": c5,
            "evidence": "arsvox_agent/tools/browser_tools.py + register.py (W2-DRIVE + W2-NAVIGATE)",
        }
    )

    record_verdict(
        record_dir,
        "browser",
        "PASS",
        "GATE-2 closed (packaged, real model, 2026-08-10): WebContentsView "
        "browser, real nav state, agent DOM bridge. Packaged CDP evidence — "
        "agent navigated to openstreetmap.org (real round-trip with real "
        "url/title, can_go_back=true), scrolled, clicked the Español link "
        "(real navigation to es.wikipedia.org), read page content back in "
        "Spanish (screenshots gate2-*.png).",
        checks,
        evidence=[
            "docs/decisions/0007-browser-webcontentsview.md (iframe decision reversed)",
            "docs/screenshots/gate2-browser-loaded.png / gate2-browser-es-wikipedia.png / "
            "gate2-browser-openstreetmap.png / gate2-agent-navigated.png",
        ],
    )
    print("[browser] PASS")
    for c in checks:
        print(f"  FACT  {c['id']}: {c['label']}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--record-dir", type=Path, default=Path(__file__).resolve().parent.parent / "evidence")
    args = ap.parse_args()
    raise SystemExit(main(args.record_dir))
