"""
tests/test_smoke.py – Smoke tests for the Smart Traffic Monitoring System skeleton.

These tests verify the basic structure is correct before any real feature
is implemented.  They run as part of the Prompt 1 acceptance check.
"""


def test_index_returns_200(client):
    """GET / should return HTTP 200 and contain the project title."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"Smart Traffic" in response.data


def test_healthz_returns_ok_envelope(client):
    """GET /healthz should return the project JSON envelope with ok=True."""
    response = client.get("/healthz")
    assert response.status_code == 200
    json_data = response.get_json()
    assert json_data["ok"] is True
    assert json_data["error"] is None
    assert "status" in json_data["data"]
    assert json_data["data"]["status"] == "ok"


def test_api_healthz_returns_ok_envelope(client):
    """GET /api/v1/healthz should return the project JSON envelope."""
    response = client.get("/api/v1/healthz")
    assert response.status_code == 200
    json_data = response.get_json()
    assert json_data["ok"] is True


def test_404_returns_custom_page(client):
    """Unknown routes should return HTTP 404 and our custom error page."""
    response = client.get("/this-does-not-exist")
    assert response.status_code == 404
    assert b"404" in response.data


def test_stream_events_returns_200(client):
    """GET /stream/events should return HTTP 200 with text/event-stream."""
    response = client.get("/stream/events")
    assert response.status_code == 200
    assert "text/event-stream" in response.content_type


def test_dashboard_returns_200(client):
    """GET /dashboard should return HTTP 200."""
    response = client.get("/dashboard")
    assert response.status_code == 200


def test_about_returns_200(client):
    """GET /about should return HTTP 200."""
    response = client.get("/about")
    assert response.status_code == 200


def test_intersection_returns_200(client):
    """GET /intersection should return HTTP 200 and include simulation elements."""
    response = client.get("/intersection")
    assert response.status_code == 200
    assert b"4-Way Intersection Signal Simulator" in response.data
    assert b"intersection-canvas" in response.data


def test_analytics_returns_200(client):
    """GET /analytics should return HTTP 200."""
    response = client.get("/analytics")
    assert response.status_code == 200


def test_settings_returns_200(client):
    """GET /settings should return HTTP 200."""
    response = client.get("/settings")
    assert response.status_code == 200


def test_styleguide_returns_200_when_debug(client):
    """GET /styleguide should return HTTP 200 when DEBUG is True."""
    client.application.config["DEBUG"] = True
    response = client.get("/styleguide")
    assert response.status_code == 200
    assert b"Transit Signage Control Room" in response.data
    assert b"Contrast Audit" in response.data


def test_styleguide_returns_404_when_debug_false(client):
    """GET /styleguide should return HTTP 404 when DEBUG is False."""
    client.application.config["DEBUG"] = False
    response = client.get("/styleguide")
    assert response.status_code == 404


def test_static_tokens_and_base_css_served(client):
    """Static token and base stylesheets must be accessible."""
    res_tokens = client.get("/static/css/tokens.css")
    assert res_tokens.status_code == 200
    assert b"--canvas" in res_tokens.data
    assert b"--brand-primary" in res_tokens.data

    res_base = client.get("/static/css/base.css")
    assert res_base.status_code == 200
    assert b"sr-only" in res_base.data
    assert b"skip-link" in res_base.data

    res_components = client.get("/static/css/components.css")
    assert res_components.status_code == 200
    assert b"status-pill" in res_components.data
    assert b"toast-container" in res_components.data


def test_static_js_modules_served(client):
    """Static JS scripts and ES modules must be accessible."""
    for script in [
        "js/theme-init.js",
        "js/modules/theme.js",
        "js/modules/toast.js",
        "js/modules/connection.js",
        "js/modules/api.js",
        "js/modules/nav.js",
    ]:
        res = client.get(f"/static/{script}")
        assert res.status_code == 200, f"Failed to fetch {script}"


def test_base_layout_structure(client):
    """Base layout must include skip link, main#main, nav brand, footer with credits."""
    res = client.get("/")
    assert res.status_code == 200
    html = res.data.decode("utf-8")
    assert 'href="#main"' in html
    assert 'id="main"' in html
    assert "Smart Traffic Monitoring" in html
    assert "toast-container" in html
    assert "status-pill" in html
    assert "footer" in html


def test_landing_page_hero_and_assets(client):
    """Landing page must contain exact hero copy, single H1, and served assets."""
    res = client.get("/")
    assert res.status_code == 200
    html = res.data.decode("utf-8")
    assert "See your intersection" in html
    assert "think." in html
    assert "A camera-assisted traffic monitoring prototype" in html
    assert "Launch Live Dashboard" in html
    assert "Read the Project Overview" in html
    assert "Real-time counting" in html
    assert "Low / Medium / High density" in html
    assert "Rule-based signal suggestion"
    assert "SIMULATED" in html
    assert html.count("<h1") == 1

    res_css = client.get("/static/css/landing.css")
    assert res_css.status_code == 200
    assert b"hero-grid" in res_css.data
    assert b"problem-grid" in res_css.data
    assert b"tech-grid" in res_css.data
    assert b"features-grid" in res_css.data

    res_js = client.get("/static/js/landing.js")
    assert res_js.status_code == 200


def test_landing_page_sections_and_copy(client):
    """Landing page must include problem statement, built-with strip, and 6 feature cards."""
    res = client.get("/")
    assert res.status_code == 200
    html = res.data.decode("utf-8")

    # Section IDs
    assert 'id="built-with"' in html
    assert 'id="problem"' in html
    assert 'id="features"' in html

    # Technology strip
    assert "Built with open, well-documented tools" in html
    assert "Python" in html
    assert "OpenCV" in html
    assert "YOLOv8" in html
    assert "Flask" in html
    assert "SQLite" in html
    assert "Chart.js" in html

    # Problem statement
    assert "Why static signals fail dynamic traffic." in html
    assert "Waiting time" in html
    assert "Fuel use" in html
    assert "Emergency delays" in html
    assert "This prototype observes traffic patterns and shows, at a basic level, how live data could support better signal timing." in html

    # 6 Features
    assert "Vehicle detection and counting" in html
    assert "Density zones" in html
    assert "Congestion alerts" in html
    assert "Signal timing suggestion" in html
    assert "Pattern analytics" in html
    assert "Privacy-first" in html
    assert "No number plates, no faces, no saved frames." in html

    # How It Works (3 Steps)
    assert 'id="how-it-works"' in html
    assert "STEP 01" in html
    assert "STEP 02" in html
    assert "STEP 03" in html
    assert "Input: video file, bundled sample, webcam or simulation mode." in html
    assert "AI analysis: detection, tracking, counting, density and congestion logic." in html
    assert "Output: live dashboard, alerts, signal suggestion, logged history." in html

    # Estimator Section & Assumption Tooltip
    assert 'id="estimator"' in html
    assert "Signal Timing &amp; Delay Estimator" in html or "Signal Timing & Delay Estimator" in html
    assert "ESTIMATE, not measured" in html or "ESTIMATE, NOT MEASURED" in html
    assert "Webster" in html
    assert 'id="est-vehicle-count"' in html
    assert 'id="est-traffic-light"' in html

    # Estimator JS Assets
    res_est_js = client.get("/static/js/estimator.js")
    assert res_est_js.status_code == 200
    assert b"suggestGreen" in res_est_js.data

    res_sig_js = client.get("/static/js/modules/signal-logic.js")
    assert res_sig_js.status_code == 200
    assert b"estimateDelay" in res_sig_js.data

    # Who It Helps (4 Personas)
    assert 'id="who-it-helps"' in html
    assert "Traffic Police Officer" in html
    assert "City Planner" in html
    assert "Daily Commuter" in html
    assert "Faculty Evaluator" in html
    assert "Prototype use case" in html
    assert "Illustrative personas, not real testimonials." in html

    # Tech Stack and Hardware
    assert 'id="tech-stack"' in html
    assert "Python 3.10+" in html
    assert "OpenCV" in html
    assert "YOLOv8n (Ultralytics)" in html
    assert "ByteTrack" in html
    assert "Flask" in html
    assert "SQLite" in html
    assert "Chart.js" in html
    assert "scikit-learn" in html
    assert "A laptop (no GPU needed)" in html
    assert "A webcam or recorded traffic video" in html
    assert "pretrained COCO model is used and no custom training is done" in html

    # FAQ Accordion (6 Questions & Answers)
    assert 'id="faq"' in html
    assert "What does it detect?" in html
    assert "Cars, motorcycles, buses and trucks using a pretrained YOLOv8n model." in html
    assert "Does it control real traffic signals?" in html
    assert "No. It only suggests timings on screen." in html
    assert "How accurate is it?" in html
    assert "Accuracy depends on camera angle, lighting and traffic" in html
    assert "What about night, rain and auto-rickshaws?" in html
    assert "Is any personal data stored?" in html
    assert "No number plates or faces are read or stored, and frames are not saved." in html
    assert "Can I run it without a video?" in html
    assert "Simulation mode generates synthetic data, always labelled \"Simulated\"." in html

    # Final Conversion Banner
    assert "conversion-banner" in html
    assert "Watch the intersection in real time" in html
    assert 'id="cta-banner-dashboard"' in html
    assert 'id="cta-banner-readme"' in html
    assert "/download/readme" in html

    # Exact Single H1 rule check
    assert html.count("<h1") == 1
    assert 'id="hero-title"' in html


def test_download_readme_route(client):
    """GET /download/readme should stream README.md with download_name."""
    res = client.get("/download/readme")
    assert res.status_code == 200
    assert "text/plain" in res.content_type
    assert b"Smart Traffic Monitoring System" in res.data
    assert "attachment" in res.headers.get("Content-Disposition", "")
    assert "Smart_Traffic_Monitoring_README.md" in res.headers.get("Content-Disposition", "")

