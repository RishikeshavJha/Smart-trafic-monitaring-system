"""
routes/pages.py – HTML page route handlers for the Smart Traffic Monitoring System.

Blueprint: pages_bp (no URL prefix)

Routes served (all return rendered HTML templates):
  GET /              → index.html      – Landing page with "Launch Live Dashboard" CTA.
  GET /dashboard     → dashboard.html  – Live monitoring view.
  GET /analytics     → analytics.html  – Historical charts and trend view.
  GET /settings      → settings.html   – Configuration panel.
  GET /about         → about.html      – Project overview, team, references.
  GET /intersection  → intersection.html – 4-way interactive intersection simulator.
  GET /download/readme → Streams README.md as a text/plain download.

Rules:
  • No business logic here – just render templates and pass context.
  • All project text (team, college, etc.) comes from g.project injected
    by app.py's context processor, not hard-coded in these functions.
  • CSRF protection is handled globally by Flask-WTF; no per-route config needed.
"""

from flask import Blueprint, render_template, current_app, send_file, Response
from pathlib import Path

# Create the blueprint.  No URL prefix – these are the top-level page routes.
pages_bp = Blueprint("pages", __name__)


@pages_bp.route("/")
def index():
    """Render the landing page.

    Passes no extra context beyond what the template context processor
    already injects (g.project).
    """
    return render_template("index.html")


@pages_bp.route("/dashboard")
def dashboard():
    """Render the live monitoring dashboard.

    The dashboard template loads JS ES modules that connect to /stream/events
    and /api/v1/ endpoints.  No server-side data is pre-rendered here.
    """
    return render_template("dashboard.html")


@pages_bp.route("/video_feed")
def video_feed():
    """Top-level /video_feed route alias pointing to stream.video_feed."""
    from routes.stream import video_feed as stream_video_feed
    return stream_video_feed()


@pages_bp.route("/analytics")
def analytics():
    """Render the historical analytics page.

    Chart data is fetched client-side from /api/v1/analytics via fetch().
    """
    return render_template("analytics.html")


@pages_bp.route("/settings")
def settings():
    """Render the settings / configuration page.

    Settings are saved via POST to /api/v1/settings (implemented later).
    """
    return render_template("settings.html")


@pages_bp.route("/about")
def about():
    """Render the project overview / about page.

    All team and college text is injected automatically via g.project.
    """
    return render_template("about.html")


@pages_bp.route("/intersection")
def intersection():
    """Render the 4-way interactive intersection simulation page.

    A canvas-based real-time simulator with per-road vehicle sliders,
    animated vehicles (car/bus/truck/bike), adaptive signal timing via
    Webster's formula, and congestion indicators.
    """
    return render_template("intersection.html")


@pages_bp.route("/styleguide")
def styleguide():
    """Render the design tokens and component styleguide (debug only)."""
    if not current_app.config.get("DEBUG", False):
        return render_template("404.html"), 404
    return render_template("styleguide.html")


@pages_bp.route("/download/readme")
def download_readme():
    """Stream the project README.md as a downloadable plain-text file.

    Returns 404 if README.md does not exist yet.
    This is the secondary conversion action defined in project-rules.md.
    """
    readme_path = Path(current_app.root_path) / "README.md"
    if not readme_path.exists():
        return render_template("404.html"), 404
    return send_file(
        readme_path,
        mimetype="text/plain",
        as_attachment=True,
        download_name="Smart_Traffic_Monitoring_README.md",
    )


@pages_bp.route("/robots.txt")
def robots_txt():
    """Dynamically generate robots.txt file."""
    site_url = current_app.config.get("SITE_URL", "http://localhost:5000").rstrip("/")
    lines = [
        "User-agent: *",
        "Allow: /",
        "Disallow: /settings",
        "Disallow: /api/",
        f"Sitemap: {site_url}/sitemap.xml",
    ]
    return Response("\n".join(lines), mimetype="text/plain")


@pages_bp.route("/sitemap.xml")
def sitemap_xml():
    """Dynamically generate sitemap.xml listing public pages."""
    site_url = current_app.config.get("SITE_URL", "http://localhost:5000").rstrip("/")
    pages = [
        {"loc": f"{site_url}/", "changefreq": "daily", "priority": "1.0"},
        {"loc": f"{site_url}/dashboard", "changefreq": "always", "priority": "0.9"},
        {"loc": f"{site_url}/analytics", "changefreq": "hourly", "priority": "0.8"},
        {"loc": f"{site_url}/about", "changefreq": "monthly", "priority": "0.7"},
    ]

    xml_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for p in pages:
        xml_lines.append("  <url>")
        xml_lines.append(f"    <loc>{p['loc']}</loc>")
        xml_lines.append(f"    <changefreq>{p['changefreq']}</changefreq>")
        xml_lines.append(f"    <priority>{p['priority']}</priority>")
        xml_lines.append("  </url>")
    xml_lines.append("</urlset>")

    return Response("\n".join(xml_lines), mimetype="application/xml")
