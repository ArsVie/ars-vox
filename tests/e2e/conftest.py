"""tests/e2e pytest fixtures — reuse the tests/python harness wholesale.

The GATE-5 harness runs the SAME app fixture the python suite uses
(base_config + client + ws_collect), so the e2e wire probes exercise the
real config with the mock agent. The worktree import shim is the root
conftest.py (loads first), and the shared plugin is declared there too
(pytest >= 9 requires pytest_plugins at the top level).
"""
