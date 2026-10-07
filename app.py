"""
app.py – Application factory for the Smart Traffic Monitoring System.

Usage:
    flask --app app run --debug          # development
    flask --app app seed-demo            # populate demo data (stub, completed later)

This module:
  1. Defines create_app(env) – the Flask application factory.
  2. Loads project.json once and injects it into all templates via a
     context processor so templates can access {{ project.college }} etc.
  3. Registers all blueprints via routes.register_blueprints().
  4. Enables Flask-WTF CSRFProtect and Flask-Compress globally.
  5. Sets security headers on every response (CSP, X-Frame-Options, etc.).
  6. Registers custom error handlers for 404 and 500.
  7. Provides the "seed-demo" CLI command stub (completed in a later prompt).
"""

import json
import logging
import os
from pathlib import Path

import click
from dotenv import load_dotenv
from flask import Flask, g, render_template, jsonify, request
from flask_compress import Compress
from flask_wtf.csrf import CSRFProtect

from config import CONFIG_MAP, DevConfig

# Load .env file before anything else so environment variables are available.
load_dotenv()

# Module-level logger – Flask will configure handlers after create_app() runs.
logger = logging.getLogger(__name__)

# Extensions are created here (without an app) so they can be imported by
# other modules and initialised in create_app().
csrf = CSRFProtect()
compress = Compress()


def _load_project_json(path: str) -> dict:
    """Load content/project.json and warn about any unfilled placeholder values.

    Any value that is a string and contains the literal text "FILL" is logged
    as a warning so the developer knows to update it before the presentation.

    Returns the parsed dict, or an empty dict if the file is missing/invalid.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        logger.error("content/project.json not found at %s – all project text will be empty.", path)
        return {}
    except json.JSONDecodeError as exc:
        logger.error("content/project.json is not valid JSON: %s", exc)
        return {}

    # Walk the parsed structure and warn about FILL placeholders.
    def _check(node, path_hint=""):
        if isinstance(node, dict):
            for k, v in node.items():
                _check(v, f"{path_hint}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                _check(v, f"{path_hint}[{i}]")
        elif isinstance(node, str) and "FILL" in node:
            logger.warning(
                "⚠  project.json placeholder not filled: %s = %r  "
                "← update content/project.json before presentation.",
                path_hint,
                node,
            )

    _check(data, root_path := "project.json")
    return data


def _build_csp_header(app: Flask) -> str:
    """Build a strict Content-Security-Policy header string.

    All assets (fonts, JS, CSS, images) come from 'self'.
    No CDN, no inline scripts, no inline styles.
    """
    directives = {
        "default-src": "'self'",
        "script-src": "'self'",
        "style-src": "'self'",
        "font-src": "'self'",
        "img-src": "'self' data: blob:",
        "connect-src": "'self'",
        "media-src": "'self' blob:",
        "object-src": "'none'",
        "frame-ancestors": "'none'",
        "base-uri": "'self'",
        "form-action": "'self'",
    }
    return "; ".join(f"{k} {v}" for k, v in directives.items())


def create_app(env: str | None = None) -> Flask:
    """Create and configure the Flask application.

    Parameters
    ----------
    env : str | None
        One of "development", "testing", or "production".
        Defaults to the FLASK_ENV environment variable, then "development".
    """
    if env is None:
        env = os.environ.get("FLASK_ENV", "development")

    app = Flask(__name__)

    # ------------------------------------------------------------------ #
    # Configuration                                                        #
    # ------------------------------------------------------------------ #
    config_class = CONFIG_MAP.get(env, DevConfig)
    app.config.from_object(config_class)

    # ------------------------------------------------------------------ #
    # Extensions                                                           #
    # ------------------------------------------------------------------ #
    csrf.init_app(app)
    compress.init_app(app)

    # ------------------------------------------------------------------ #
    # Project JSON – loaded once, injected into all templates             #
    # ------------------------------------------------------------------ #
    project_data = _load_project_json(app.config["PROJECT_JSON_PATH"])

    @app.context_processor
    def inject_project():
        """Make {{ project }} available in every Jinja2 template."""
        return {"project": project_data}

    # ------------------------------------------------------------------ #
    # Security headers on every response                                  #
    # ------------------------------------------------------------------ #
    csp_value = _build_csp_header(app)

    @app.after_request
    def set_security_headers(response):
        """Attach security headers to every HTTP response."""
        response.headers["Content-Security-Policy"] = csp_value
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"

        # Cache-Control headers: no-store on /api/* (except SSE stream), long-lived caching on static assets
        if request.path.startswith("/api/") and request.path != "/api/stream":
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"

        return response

    # ------------------------------------------------------------------ #
    # Blueprints                                                           #
    # ------------------------------------------------------------------ #
    from routes import register_blueprints
    register_blueprints(app)

    # ------------------------------------------------------------------ #
    # Top-level /healthz alias (also available at /api/v1/healthz)        #
    # ------------------------------------------------------------------ #
    @app.route("/healthz")
    def healthz_root():
        """Top-level health-check route – mirrors /api/v1/healthz."""
        return jsonify({
            "ok": True,
            "data": {
                "status": "ok",
                "project": "Smart Traffic Monitoring System",
                "version": "0.1.0-skeleton",
            },
            "error": None,
        }), 200

    # ------------------------------------------------------------------ #
    # Error handlers                                                       #
    # ------------------------------------------------------------------ #
    from flask_wtf.csrf import CSRFError

    @app.errorhandler(CSRFError)
    def handle_csrf_error(e):
        """Handle CSRF token validation failures gracefully."""
        if request.path.startswith("/api/") or request.is_json:
            return jsonify({
                "ok": False,
                "data": None,
                "error": {
                    "code": "CSRF_ERROR",
                    "message": "CSRF token validation failed. Please refresh the page.",
                    "details": {"reason": e.description if hasattr(e, "description") else str(e)},
                },
            }), 400
        return render_template("404.html"), 400

    @app.errorhandler(413)
    def request_entity_too_large(error):
        """Handle upload file exceeding MAX_CONTENT_LENGTH."""
        if request.path.startswith("/api/") or request.is_json:
            return jsonify({
                "ok": False,
                "data": None,
                "error": {
                    "code": "FILE_TOO_LARGE",
                    "message": "Uploaded file exceeds the maximum allowed size of 100 MB.",
                },
            }), 413
        return render_template("404.html"), 413

    @app.errorhandler(404)
    def not_found(error):
        """Return a 404 page for unknown routes."""
        return render_template("404.html"), 404

    @app.errorhandler(500)
    def internal_error(error):
        """Return a 500 page for unhandled exceptions."""
        logger.exception("Unhandled 500 error: %s", error)
        return render_template("500.html"), 500

    # ------------------------------------------------------------------ #
    # Database Initialization (Idempotent)                               #
    # ------------------------------------------------------------------ #
    with app.app_context():
        import database
        database.init_db(app.config["DATABASE_PATH"])

    # ------------------------------------------------------------------ #
    # CLI commands                                                         #
    # ------------------------------------------------------------------ #
    @app.cli.command("seed-demo")
    @click.option("--days", default=7, show_default=True,
                  help="Number of days of 5-minute historical traffic logs to seed.")
    @click.option("--force", is_flag=True, default=False,
                  help="Force seeding even if data already exists.")
    def seed_demo(days, force):
        """Populate the database with simulated demo traffic data."""
        from simulator import seed_demo_history
        count = seed_demo_history(days=days, db_path=app.config["DATABASE_PATH"], force=force)
        if count > 0:
            click.echo(f"Successfully seeded {count} simulated 5-minute intervals ({days} days) into database.")
        else:
            click.echo("Database already contains traffic logs. Use --force to seed anyway.")

    # ------------------------------------------------------------------ #
    # Upload folder                                                        #
    # ------------------------------------------------------------------ #
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)

    logger.info("create_app() complete – environment: %s", env)
    return app


if __name__ == "__main__":
    app = create_app("development")
    app.run(host="0.0.0.0", port=5000, debug=True)

