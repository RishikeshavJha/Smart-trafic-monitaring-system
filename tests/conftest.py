"""
tests/conftest.py – Shared pytest fixtures for the Smart Traffic Monitoring System.

Provides:
  app     – A Flask application instance configured with TestConfig.
             DATABASE_PATH is set to a temporary SQLite file that is
             created fresh for each test session and deleted on teardown.

  client  – A Flask test client bound to the test app.
             CSRF is disabled (WTF_CSRF_ENABLED=False in TestConfig) so
             test POST requests work without generating real tokens.

Usage in any test file:
    def test_healthz(client):
        response = client.get("/healthz")
        assert response.status_code == 200
"""

import os
import pytest

from app import create_app


@pytest.fixture(scope="session")
def app(tmp_path_factory):
    """Create a Flask app with TestConfig and a temporary database.

    scope="session" so the app is created once for the whole test run
    (faster than per-function, safe because tests don't mutate shared state).
    """
    # Create a temp directory for the test database.
    tmp_dir = tmp_path_factory.mktemp("test_db")
    db_path = str(tmp_dir / "test_traffic.db")

    import database
    database.init_db(db_path)

    # create_app() with "testing" picks up TestConfig.
    flask_app = create_app("testing")

    # Override DATABASE_PATH to use the temp file.
    flask_app.config["DATABASE_PATH"] = db_path

    yield flask_app

    # Teardown: remove the temp database file safely on Windows
    try:
        if os.path.exists(db_path):
            os.remove(db_path)
    except OSError:
        pass



@pytest.fixture(scope="session")
def client(app):
    """Return a Flask test client for the test app."""
    return app.test_client()
