# Smart Traffic Monitoring System

> **Academic Computer Science & Engineering Final-Year Capstone Project**  
> Camera-assisted vehicle counting, density classification, congestion detection, and adaptive signal timing advisory system.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Screenshots & Visual Assets](#screenshots--visual-assets)
3. [Prerequisites](#prerequisites)
4. [Setup & Installation](#setup--installation)
5. [Running the Application](#running-the-application)
6. [3-Minute Live Demonstration Script](#3-minute-live-demonstration-script)
7. [Repository Structure](#repository-structure)
8. [API Summary](#api-summary)
9. [Mathematical Models & Worked Examples](#mathematical-models--worked-examples)
10. [Known Limitations](#known-limitations)
11. [Future Scope](#future-scope)
12. [Privacy & Ethics Statement](#privacy--ethics-statement)
13. [Troubleshooting & FAQs](#troubleshooting--faqs)
14. [Deployment Notes](#deployment-notes)
15. [10 Likely Viva Questions & Answers](#10-likely-viva-questions--answers)

---

## Project Overview

Traditional fixed-time traffic lights operate on static pre-programmed timers that cannot respond to unexpected surges, directional imbalances, or sudden gridlocks. This project implements a **vision-assisted traffic monitoring and signal timing advisory prototype** that:
- Ingests video streams from webcams, pre-recorded sample files, user video uploads, or a 24-hour diurnal mathematical simulator.
- Tracks and classifies vehicles across four COCO categories (`car`, `motorcycle`, `bus`, `truck`) using **Ultralytics YOLOv8n** and **ByteTrack**.
- Detects counting-line crossings using 2D cross-product segment intersection algorithms.
- Classifies approach-zone queue density into three operational levels: `Low`, `Medium`, and `High`.
- Triggers persistent congestion alerts when severe queuing persists beyond configured thresholds.
- Computes real-time **suggested green-phase durations** (Webster-inspired linear scaling) compared against a static 30-second baseline.
- Streams live telemetry via **Server-Sent Events (SSE)** at 1 Hz to an accessible web control-room interface.

---

## Screenshots & Visual Assets

| Target Screenshot | Recommended Caption / File Path |
| :--- | :--- |
| **Landing Page Hero & Estimator** | `docs/screenshots/01-landing-hero-estimator.png` – Brand hero, benefits, and interactive ROI signal estimator. |
| **Live Control Room Dashboard** | `docs/screenshots/02-dashboard-live-control-room.png` – Live video feed with HUD bounding boxes, 4 approach cards, and rolling chart. |
| **Congestion Alert Banner** | `docs/screenshots/03-dashboard-congestion-alert.png` – Active episode banner with audio chime and suggested timing shift. |
| **Retrospective Heatmap & Analytics** | `docs/screenshots/04-analytics-diurnal-heatmap.png` – 24×7 diurnal density heatmap and linear regression forecast. |
| **Canvas Calibration ROI Editor** | `docs/screenshots/05-settings-roi-canvas.png` – Interactive polygon zone editor with keyboard nudging. |

*(Capture these 5 screenshots during your local demo for project documentation and viva presentations.)*

---

## Prerequisites

- **Python**: Version `3.10` to `3.12` recommended (`Python 3.14` supported with standard wheels).
- **Git**: For version control cloning.
- **Node.js**: (Optional) Version `18+` for executing clientside unit tests.
- **Hardware**: Any modern standard laptop or desktop CPU (no GPU required). Minimum 4 GB RAM.

---

## Setup & Installation

### Windows (PowerShell)

```powershell
# 1. Clone or navigate to the repository
cd "C:\Users\...\Smart-Traffic-Monitoring"

# 2. Create a virtual environment
python -m venv .venv

# 3. Activate the virtual environment
.\.venv\Scripts\Activate.ps1

# 4. Install dependencies
pip install -r requirements.txt

# 5. Initialize environment variables
Copy-Item .env.example .env
```

### macOS / Linux (Bash)

```bash
# 1. Navigate to the repository
cd Smart-Traffic-Monitoring

# 2. Create a virtual environment
python3 -m venv .venv

# 3. Activate the virtual environment
source .venv/bin/activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Initialize environment variables
cp .env.example .env
```

---

## Running the Application

### 1. Seed Historical Demonstration Data (Optional)
To populate 7 days of realistic 24-hour diurnal historical traffic logs for the Analytics page:
```bash
flask --app app seed-demo
```

### 2. Start the Local Server
```bash
flask --app app run --port 5000
```
Open your browser and navigate to: **`http://localhost:5000`**

> **Note on First Run**: The first time you start computer-vision detection (`Sample`, `Upload`, or `Webcam`), the system will automatically download the 6.2 MB pretrained `yolov8n.pt` weights file from Ultralytics. Ensure an active internet connection for this one-off download.

---

## 3-Minute Live Demonstration Script

Use this exact timing guide for viva or evaluator presentations:

- **0:00 – 0:45 | Landing Page & Interactive Estimator**
  - Open `http://localhost:5000`. Show the "Transit Signage Control Room" branding.
  - Scroll down to the **Interactive Signal Delay Estimator**. Move the queue slider from 4 to 18 vehicles. Explain: *"Notice how our linear Webster formulation adjusts green time from 30s to 57s, dropping simulated approach delay from 12.1s to 7.2s."*
  - Click **"Launch Live Dashboard"**.

- **0:45 – 1:15 | Simulated Traffic Engine & Real-Time SSE**
  - Explain: *"The dashboard defaults to a safe mathematical simulator streaming 1 Hz snapshots over Server-Sent Events."*
  - Highlight the 4 approach cards (North, South, East, West), the active status badge, and the zero-flicker rolling occupancy line chart.
  - Note the explicit **"Simulated"** badge ensuring full academic transparency.

- **1:15 – 2:00 | Real Computer Vision Detection (Sample Video)**
  - In the top segmented bar, switch source to **"Sample Video"** and click **Start Engine**.
  - Show the live MJPEG `/video_feed` stream. Point out:
    1. The YOLOv8 bounding boxes with ByteTrack tracking IDs.
    2. The 4 color-coded approach zones (N/S/E/W).
    3. The counting line flashing green as vehicles cross downwards.
  - Explain: *"Classifications are restricted to 4 vehicle classes: cars, motorcycles, buses, and trucks."*

- **2:00 – 2:30 | Congestion Alert & Adaptive Signal Advisory**
  - Point to the **Signal Timing Advisor** card. Show how the suggested green phase adapts dynamically based on the highest approach queue.
  - Explain: *"When an approach stays in High density (>12 vehicles) for over 10 consecutive seconds, a non-overlapping congestion alert is logged and displayed in the alert feed."*

- **2:30 – 2:50 | Retrospective Analytics & Heatmap**
  - Navigate to `/analytics`.
  - Present the **24×7 Diurnal Peak-Hour Heatmap** showing morning (08:00–10:00) and evening (17:00–19:00) traffic peaks.
  - Point to the **Next-Interval Linear Regression Forecast** and click **"Download CSV"** to demonstrate raw data export with the `is_simulated` audit column.

- **2:50 – 3:00 | Limitations & Wrap-Up**
  - Conclude: *"This is a proof-of-concept advisory system running on CPU. It provides advisory timing rather than direct electrical actuator control, and respects privacy with zero facial or license plate capture."*

---

## Repository Structure

```
.
├── app.py                      # Application factory, security headers, context processor & error handlers
├── config.py                   # 3-tier configuration (Config, DevConfig, TestConfig)
├── database.py                 # SQLite WAL-mode persistence, schema management & thread-safe queries
├── engine.py                   # Central unified pipeline orchestrator coordinating sources & database logging
├── simulator.py                # 24-hour diurnal mathematical curve simulation generator
├── detector.py                 # YOLOv8n + ByteTrack CV engine, 2D line-crossing & polygon ROI geometry
├── security.py                 # Upload sniffing (magic bytes, MIME), rate-limiting & 24h file cleanup
├── analytics.py                # Pure testable formulas for density, congestion, Webster green & regression
├── content/
│   └── project.json            # Authoritative project metadata (team, college, objectives, references)
├── routes/
│   ├── __init__.py             # Blueprint registration
│   ├── pages.py                # HTML page routes (/, /dashboard, /analytics, /settings, /about, /sitemap.xml)
│   ├── api.py                  # REST API v1 endpoints (/api/stats, /api/start, /api/settings, /api/upload)
│   └── stream.py               # SSE live event stream (/api/stream) & MJPEG feed (/video_feed)
├── static/
│   ├── css/                    # Control-room design tokens, layout, components & page stylesheets
│   ├── js/                     # Modular vanilla ES6 JS (dashboard.js, analytics.js, settings.js, live.js)
│   ├── img/                    # Favicon set, brand icons & OpenGraph 1200x630 cover image
│   └── vendor/                 # Self-hosted Chart.js UMD bundle (no external CDNs)
├── templates/                  # Jinja2 semantic templates with accessible WCAG 2.1 AA markup
│   ├── base.html               # Master layout with skip links, nav, footer, SEO & JSON-LD
│   ├── index.html              # Marketing landing page with interactive estimator
│   ├── dashboard.html          # Live monitoring control room view
│   ├── analytics.html          # Retrospective 24x7 heatmap, forecast & paginated logs
│   ├── settings.html           # Parameters form & Canvas ROI zone calibration editor
│   ├── about.html              # Academic overview, literature table, methodology SVG & references
│   ├── 404.html & 500.html     # Custom "Signal Red" control-room error pages
│   └── partials/icons.html     # Accessible inline SVG icon macros
├── tests/                      # 65 automated pytest suites + Node.js math validation
└── tools/
    └── minify.py               # Asset minification utility bundling into static/dist
```

---

## API Summary

All endpoints return the uniform JSON envelope: `{"ok": bool, "data": ..., "error": ...}`.

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `GET /api/v1/healthz` | `GET` | Health check endpoint returning uptime, engine state, and active source. |
| `GET /api/v1/stats` | `GET` | Returns the latest 1 Hz snapshot and system status. |
| `POST /api/v1/start` | `POST` | Starts the pipeline. Body: `{"source": "simulation"|"sample"|"upload"|"webcam", "file_id": ...}` |
| `POST /api/v1/stop` | `POST` | Safely stops the active source and pipeline. |
| `GET /api/v1/settings` | `GET` | Fetches active system thresholds and ROI coordinates. |
| `POST /api/v1/settings` | `POST` | Validates and persists new operational parameters. |
| `POST /api/v1/upload` | `POST` | Secure multipart video upload (max 100 MB, magic-byte validated). |
| `GET /api/v1/samples` | `GET` | Lists verified sample video files available in `static/samples/`. |
| `GET /api/v1/history` | `GET` | Paginated traffic log queries with timestamp and zone filters. |
| `GET /api/v1/analytics/heatmap` | `GET` | 24×7 diurnal average occupancy matrix. |
| `GET /api/v1/analytics/zone_averages` | `GET` | Aggregate occupancy per approach zone. |
| `GET /api/v1/analytics/forecast` | `GET` | Next-interval indicative linear regression projection. |
| `GET /api/export.csv` | `GET` | CSV export of traffic logs including the `is_simulated` audit column. |
| `GET /api/stream` | `GET` | Server-Sent Events (SSE) 1 Hz live snapshot broadcast stream. |
| `GET /video_feed` | `GET` | MJPEG video stream with real-time CV bounding box overlays. |

---

## Mathematical Models & Worked Examples

### 1. Density Classification
- **Rule**:
  $$\text{Level} = \begin{cases} \text{Low} & \text{if } \text{count} < \text{density\_low} \\ \text{Medium} & \text{if } \text{density\_low} \le \text{count} \le \text{density\_high} \\ \text{High} & \text{if } \text{count} > \text{density\_high} \end{cases}$$
- **Default Parameters**: $\text{density\_low} = 5$, $\text{density\_high} = 12$.
- **Example**: If 9 vehicles are detected in the North zone, $5 \le 9 \le 12 \implies \textbf{Medium}$.

### 2. Webster Adaptive Green-Phase Formula
- **Formula**:
  $$g_{\text{suggested}} = \text{round}\Big(\text{clamp}\big(\text{base\_green} + k \cdot \max(\text{count}, 0), \; \text{min\_green}, \; \text{max\_green}\big)\Big)$$
- **Default Parameters**: $\text{base\_green} = 30\text{s}$, $k = 1.5\text{s/veh}$, $\text{min\_green} = 10\text{s}$, $\text{max\_green} = 60\text{s}$.
- **Worked Example**:
  Suppose the driving approach queue is $n = 14$ vehicles:
  $$g = \text{clamp}(30 + 1.5 \times 14, \; 10, \; 60) = \text{clamp}(30 + 21, \; 10, \; 60) = \text{clamp}(51, 10, 60) = \mathbf{51\text{s}}$$

### 3. Webster Uniform Delay Model
- **Formula**:
  $$d = \frac{(C - g)^2}{2C}$$
  where $C = g + \text{other\_phase\_seconds}$ is the total cycle length.
- **Worked Example**:
  Comparing fixed baseline ($g_1 = 30\text{s}$, $C_1 = 60\text{s}$) vs. adaptive allocation ($g_2 = 51\text{s}$, $C_2 = 81\text{s}$):
  $$d_{\text{fixed}} = \frac{(60 - 30)^2}{2 \times 60} = \frac{900}{120} = \mathbf{7.50\text{s / vehicle}}$$
  $$d_{\text{adaptive}} = \frac{(81 - 51)^2}{2 \times 81} = \frac{900}{162} \approx \mathbf{5.56\text{s / vehicle}} \quad (\text{a } 25.9\% \text{ reduction})$$

---

## Known Limitations

1. **Pretrained COCO Weights**: The YOLOv8n model is trained on standard COCO classes. While effective for cars, buses, and trucks, it classifies Indian auto-rickshaws as cars or motorcycles.
2. **Adverse Weather & Lighting**: Accuracy decreases under heavy rain, dense fog, or unlit night conditions without infrared illumination.
3. **CPU-Bound Latency**: On entry-level dual-core CPUs, processing 640px frames can dip below 15 FPS; adaptive frame skipping is enabled to maintain real-time telemetry.
4. **Delay Simplification**: The Webster model calculates delay for the served approach assuming uniform arrivals, ignoring saturation overflow terms.
5. **Advisory Scope**: This prototype does not directly interface with electrical traffic signal controllers (NEMA TS2 / 2070).

---

## Future Scope

- **Custom YOLO Fine-Tuning**: Train a custom model on Indian traffic datasets (e.g., IDD - India Driving Dataset) for specific classes (auto-rickshaws, e-rickshaws).
- **Emergency Vehicle Priority (EVP)**: Audio-visual detection of emergency sirens/flashers to force instantaneous green clearance.
- **Multi-Junction Coordination**: Implement Reinforcement Learning (e.g., Deep Q-Networks) or SCATS/SCOOT integration for green-wave coordination across corridors.
- **Hardware Acceleration**: Deploy on NVIDIA Jetson Orin Nano or Raspberry Pi 5 with Google Coral TPU edge accelerators.

---

## Privacy & Ethics Statement

- **Zero Facial / License Plate Recognition**: The pipeline performs object-level detection and tracking only. No facial recognition or Automatic Number Plate Recognition (ANPR) algorithms are implemented.
- **Ephemeral Frame Processing**: Video frames are processed in volatile RAM and immediately discarded. No video frames are ever saved to disk.
- **Secure File Storage**: User-uploaded videos are stored in an isolated directory with UUID filenames and automatically purged after 24 hours.

---

## Troubleshooting & FAQs

### 1. Webcam Not Found / Black Screen
- Ensure no other application (Zoom, Teams) is using the webcam.
- In `config.py` or Settings, test webcam index `0` or `1`. If running in a headless VM or container, webcam mode will display a clear "Hardware not found" fallback notice.

### 2. YOLO Model Download Fails
- Ensure your network has internet access during the first start.
- Manually place `yolov8n.pt` in the project root directory if operating in an air-gapped network.

### 3. Port 5000 Already in Use
- Run with a different port:
  ```bash
  flask --app app run --port 5050
  ```

### 4. Slow Video Playback / CPU Bottleneck
- Go to `/settings` and verify `frame_width` is set to `640`.
- The adaptive frame-dropper will automatically skip intermediate frames to maintain near real-time HUD rendering.

---

## Deployment Notes

### Production Caveats
- **Local / Edge Deployment (Recommended)**: The application is designed to run locally or on on-premise edge devices with direct access to camera streams.
- **Cloud Hosting (Render / Railway / Fly.io)**:
  - If deploying to free cloud tiers, use **Simulation Mode only**. Real-time computer vision processing requires dedicated CPU/GPU resources not suitable for shared free tiers.
  - Run using Gunicorn with threaded workers to support concurrent SSE connections:
    ```bash
    gunicorn --workers 1 --threads 8 --bind 0.0.0.0:$PORT "app:create_app('production')"
    ```
  - Mount a persistent disk if SQLite database retention is required across container restarts.

---

## 10 Likely Viva Questions & Answers

1. **Q: What is the main objective of your project?**  
   *A: To build an end-to-end prototype that uses computer vision to detect vehicles at an intersection, estimate queue density, and compute responsive green-light durations to reduce delay compared to static timers.*

2. **Q: Why use YOLOv8n instead of older architectures like Haar Cascades or YOLOv3?**  
   *A: YOLOv8n (nano) provides an optimal speed-accuracy tradeoff on standard CPUs (~20–30 FPS), with anchor-free detection and lightweight weights (~6.2 MB).*

3. **Q: How does vehicle counting prevent duplicate counts for the same vehicle?**  
   *A: ByteTrack assigns a persistent tracking ID to each bounding box. We track the vehicle centroid across frames and register a crossing only when the centroid path intersects the counting line segment (calculated via 2D vector cross-products).*

4. **Q: What algorithm classifies vehicles into N/S/E/W approaches?**  
   *A: Ray-casting Point-in-Polygon (PIP) containment testing against configured polygon coordinates.*

5. **Q: How does Server-Sent Events (SSE) differ from WebSockets here?**  
   *A: SSE is lightweight, unidirectional (server-to-client), operates over standard HTTP with automatic reconnection, and is ideal for 1 Hz dashboard telemetry without WebSocket handshake overhead.*

6. **Q: What is the significance of the `is_simulated` column in your database and CSV?**  
   *A: Full academic and data integrity: it ensures synthetic simulated data is never confused with empirical computer vision observations during audit or reporting.*

7. **Q: Explain how congestion alerts are triggered and debounced.**  
   *A: An alert triggers only when an approach maintains "High" density continuously for $\ge 10$ seconds. To prevent alert fatigue, only one active alert is created per congestion episode until traffic subsides.*

8. **Q: How does the system handle an unavailable webcam or corrupted upload?**  
   *A: It validates magic bytes on upload, checks video capture readability, and gracefully falls back to the mathematical simulator with user toast notices.*

9. **Q: What mathematical model is used for signal timing?**  
   *A: A linear responsive Webster model: $g = \text{clamp}(\text{base} + k \times \text{count}, \text{min}, \text{max})$, accompanied by Webster's uniform delay equation $d = (C-g)^2 / (2C)$.*

10. **Q: What are the primary ethical considerations implemented?**  
    *A: Privacy by design: no license plate or face recognition, zero frame persistence on disk, and automated 24-hour cleanup of temporary video uploads.*
