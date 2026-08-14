"""Register every tool module's SPECS into the shared registry.

Each tools module exposes SPECS (list of ToolSpec) next to its handlers;
this module is the single registration point so the agent factory never
touches tool internals.
"""

import importlib

from arsvox_agent.tools import ToolRegistry

_MODULES = [
    "arsvox_agent.tools.app_tools",
    "arsvox_agent.tools.ui_tools",
    "arsvox_agent.tools.media_tools",
    "arsvox_agent.tools.library_tools",
    "arsvox_agent.tools.document_tools",
    "arsvox_agent.tools.telegram_tools",
    "arsvox_agent.tools.notes_tasks_tools",
    "arsvox_agent.tools.memory_tools",
    "arsvox_agent.tools.local_media_tools",
    "arsvox_agent.tools.reminder_tools",
    "arsvox_agent.tools.demo_tools",
    "arsvox_agent.tools.browser_tools",
]

# Tool-surface collapse: the dispatcher module registers the 11
# model-visible umbrella tools (48 granular + 11 dispatchers = 59).
# Guarded append: if the parallel surface.py author also adds the module
# to the literal above, this stays a no-op — register() raises on
# duplicates, so double registration would crash startup.
if "arsvox_agent.tools.surface" not in _MODULES:
    _MODULES.append("arsvox_agent.tools.surface")


def register_all(registry: ToolRegistry) -> int:
    count = 0
    for module_name in _MODULES:
        module = importlib.import_module(module_name)
        for spec in getattr(module, "SPECS", []):
            registry.register(spec)
            count += 1
    return count
