"""
routes/__init__.py – Blueprint registration package for Smart Traffic Monitoring System.

This package collects all Flask blueprints so app.py can import and register
them in one place via register_blueprints(app).

Blueprints:
  pages_bp  (routes/pages.py)  – HTML page routes (/, /dashboard, /analytics,
                                   /settings, /about, /download/readme).
  api_bp    (routes/api.py)    – JSON REST endpoints (/api/v1/…).
  stream_bp (routes/stream.py) – Server-Sent Events (/stream/events).
"""

from routes.pages import pages_bp
from routes.api import api_bp
from routes.stream import stream_bp


def register_blueprints(app):
    """Register all application blueprints with the Flask app instance.

    Called once from the create_app() factory in app.py.
    """
    app.register_blueprint(pages_bp)
    app.register_blueprint(api_bp, url_prefix="/api")
    # Also register at /api/v1 for backward compatibility
    app.register_blueprint(api_bp, url_prefix="/api/v1", name="api_v1")
    app.register_blueprint(stream_bp, url_prefix="/stream")

