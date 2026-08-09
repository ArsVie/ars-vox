"""Search providers (GATE-5): library modules behind agent search tools.

- ``local_library`` — local music library discovery (W1-MEDIA-LOCAL).
- ``youtube`` — real YouTube search behind a provider seam (W1-YOUTUBE).

These are LIBRARY modules, not tools modules: they own no SPECS and never
touch the tool registry. The agent-facing tools consume them.
"""
