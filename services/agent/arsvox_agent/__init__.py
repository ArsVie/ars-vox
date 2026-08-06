"""Ars-Vox agent service.

FastAPI app exposing:
  GET  /health     — liveness + active model
  GET  /config     — the validated configuration (single source)
  PATCH /config    — persist a new configuration (tuneable at runtime)
  GET  /api/*      — read endpoints the UI polls directly (books, notes,
                     tasks, reminders, documents, progress)
  WS   /ws         — agent events out, client messages in

The runtime (AgentRuntime) owns the LLM loop; the ToolRegistry gates every
tool through the PolicyEngine; ConfirmationCoordinator implements the
two-phase human approval flow.
"""

from arsvox_agent.runtime import AgentRuntime
from arsvox_agent.config_loader import load_config

__all__ = ["AgentRuntime", "load_config"]
