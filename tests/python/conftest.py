"""tests/python pytest entry — loads the shared harness fixtures.

The fixtures themselves live in tests/python/harness_fixtures.py (a
plain module, not a conftest) so that tests/e2e/conftest.py can declare
the SAME plugin name without the double-registration collision that
broke ``pytest tests/python tests/e2e`` as a single command.
"""

pytest_plugins = ["tests.python.harness_fixtures"]
