"""Introspection tool: what the application currently looks like."""

import json

from arsvox_agent.tools.context import ToolContext


async def app_get_state(tctx: ToolContext) -> str:
    panels = tctx.deps.panels.list()
    pending = tctx.deps.pending.list_pending()
    reminders = tctx.deps.reminders.list_active()
    snapshot = {
        "panels": [{"type": p["panel_type"], "title": p["title"]} for p in panels],
        "pending_confirmations": [
            {"id": p["id"], "tool": p["tool"], "title": p["title"]} for p in pending
        ],
        "active_reminders": [
            {"id": r["id"], "text": r["text"], "due_at": r["due_at"]} for r in reminders
        ],
        "model": tctx.deps.config.agent.model.name,
        "mock": tctx.deps.config.agent.mock,
        "tts_provider": tctx.deps.config.tts.provider,
        "telegram_mock": tctx.deps.config.telegram.mock,
    }
    return json.dumps(snapshot, ensure_ascii=False)


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec(
        "app.get_state",
        "Return a compact JSON snapshot of the application: open panels, pending"
        " confirmations, active reminders, active model. Use it when the user's"
        " request depends on what is currently on screen.",
        app_get_state,
        PolicyKind.READ_ONLY,
    ),
]
