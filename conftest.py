"""Worktree-local import path fix (GATE-2.5, H4 track).

The shared venv (/mnt/c/dev/ars-vox/.venv) contains editable installs
(``__editable__.arsvox_*`` meta path finders) whose MAPPING hardcodes the
MAIN repo's absolute paths for arsvox_agent / arsvox_memory / arsvox_tts /
arsvox_voice. Those packages live one level BELOW the ``services``
PYTHONPATH entry (services/agent/, services/memory/, ...), so the
path-based finder cannot see this worktree's copies and every import
falls through to the main repo — silently running tests against the
wrong code (this is why the H4 security boundary appeared "not
enforced": the gate's run imported the pre-H4 app.py from the main
repo).

This conftest runs before any test module imports (pytest loads the
rootdir conftest first) and:
  1. puts this worktree's package directories at the FRONT of sys.path
     (so the path-based finder wins for every arsvox_* package), and
  2. drops the venv's editable-install meta path finders, which would
     otherwise still shadow the worktree paths.
"""

import sys
from pathlib import Path

_WORKTREE = Path(__file__).resolve().parent

_PKG_DIRS = [
    _WORKTREE / "packages" / "contracts",
    _WORKTREE / "services" / "agent",
    _WORKTREE / "services" / "memory",
    _WORKTREE / "services" / "tts",
    _WORKTREE / "services" / "voice",
]

for _d in _PKG_DIRS:
    _s = str(_d)
    if _s in sys.path:
        sys.path.remove(_s)
    sys.path.insert(0, _s)

# Neutralize the venv's editable-install finders (they hardcode main-repo
# paths and would shadow the worktree packages inserted above).
sys.meta_path[:] = [
    _f
    for _f in sys.meta_path
    if not getattr(_f, "__module__", "").startswith("__editable___arsvox_")
]

# (intentionally leave module-level names; conftest globals are inert)

# Shared harness fixtures for BOTH test trees (tests/python and
# tests/e2e). pytest >= 9 only accepts pytest_plugins in the TOP-LEVEL
# conftest, so the declaration lives here — it used to be duplicated in
# the two sub-conftests, which pytest 9.1+ rejects at collection time.
pytest_plugins = ["tests.python.harness_fixtures"]
