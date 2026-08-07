#!/usr/bin/env python3
"""Export the contracts as JSON Schema for the TypeScript side.

Usage:  .venv/bin/python packages/contracts/scripts/export_schemas.py
Output: packages/contracts/schemas/*.schema.json

The Electron UI mirrors these with hand-written types in
apps/desktop/src/contracts.ts plus a conformance test
(apps/desktop/tests/conformance.test.ts).
"""

import json
from pathlib import Path

from pydantic import TypeAdapter

from arsvox_contracts import (
    AgentEvent,
    AppConfig,
    ClientMessage,
    LayoutSpec,
    SurfaceRegistration,
    UiCommand,
)

OUT_DIR = Path(__file__).resolve().parents[1] / "schemas"

MODELS = {
    "agent-events": AgentEvent,
    "ui-commands": UiCommand,
    "client-messages": ClientMessage,
    "app-config": AppConfig,
    "adaptive-layout": LayoutSpec,
    "adaptive-surface-registration": SurfaceRegistration,
}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, model in MODELS.items():
        schema = TypeAdapter(model).json_schema()
        path = OUT_DIR / f"{name}.schema.json"
        path.write_text(json.dumps(schema, indent=2) + "\n")
        print(f"wrote {path.relative_to(OUT_DIR.parents[1])}")


if __name__ == "__main__":
    main()
