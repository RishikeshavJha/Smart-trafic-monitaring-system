  PROJECT BRIEF
  - Product: Smart Traffic Monitoring System, a camera-assisted prototype that counts vehicles, classifies density (Low/Medium/High), flags congestion and SUGGESTS rule-based signal timing on a dashboard. It never controls real signals.
  - Core value proposition: turn any intersection video into live vehicle counts, density levels, congestion alerts and a suggested signal timing, on an ordinary laptop.
  - Primary conversion action: click "Launch Live Dashboard" (goes to /dashboard).
  - Secondary conversion action: "Download Project README" (route /download/readme) or "Read the Project Overview" (/about).
  - Target audience: faculty evaluators, engineering students, and city-planning / traffic-police stakeholders who want to see the idea working quickly.
  - Fixed tech stack (do not suggest alternatives): Python 3.10+, Flask (app factory + blueprints), OpenCV, Ultralytics YOLOv8n (COCO weights; COCO class ids: car=2, motorcycle=3, bus=5, truck=7) with built-in ByteTrack tracking, SQLite (sqlite3, parameterised queries only), semantic HTML5, modern CSS (variables, Grid, Flexbox), vanilla JavaScript ES modules, Chart.js (self-hosted), scikit-learn LinearRegression for the optional basic forecast, pytest.

  HONESTY RULES (very important)
  - Never invent testimonials, statistics, client logos, user counts, accuracy numbers, papers, authors, DOIs, volume or page numbers.
  - Any synthetic data must be labelled "Simulated" everywhere it appears (UI badge, API field is_simulated, CSV column).
  - Estimated waiting time must always be labelled "ESTIMATE, not measured".
  - The forecast must be labelled "basic forecast, indicative only".
  - Privacy: never read, detect, store or display number plates or faces. Never save video frames to disk.

  ENGINEERING RULES
  - Comment every module and every non-trivial function in plain language so a student can explain it in a viva.
  - Pure functions for logic (density, congestion, signal timing, estimate) so they can be unit-tested. No business logic inside route handlers.
  - Every JSON API response uses the envelope {"ok": bool, "data": ..., "error": null | {"code": str, "message": str}} with correct HTTP status codes.
  - No inline <script> and no inline style="" attributes in templates (the Content-Security-Policy will forbid them). No CDN dependencies at runtime: fonts and Chart.js are self-hosted.
  - No placeholders, TODO stubs, "..." or truncated code in delivered files. Every file you create must be complete and runnable.
  - All project text (team, college, references, dates) is read from content/project.json, never hard-coded in templates.

  DESIGN RULES
  - Style: "Transit Signage Control Room". Dark theme is default; light theme is supported; both use CSS variables from static/css/tokens.css.
  - WCAG 2.1 AA: visible focus rings, keyboard access for everything, ARIA where needed, prefers-reduced-motion respected, never rely on colour alone (always add an icon and a text label for Low/Medium/High).
  - Fully responsive from 360px to 2560px.

  WORKFLOW RULES
  - Work only on the current prompt. Do not start later prompts.
  - After finishing each prompt: run the app and/or tests, fix errors, then reply with (1) files created or changed, (2) how you verified it, (3) any deviation from the prompt and why. Then stop.
