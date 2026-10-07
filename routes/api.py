"""
routes/api.py – JSON REST API and Server-Sent Events endpoints for Smart Traffic Monitoring System.

All JSON responses strictly follow the envelope format:
  {"ok": bool, "data": <payload> | null, "error": null | {"code": str, "message": str, "details"?: dict}}
"""

import json
import os
import queue
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context

import analytics
import database
from engine import get_engine

api_bp = Blueprint("api", __name__)
_start_time = time.time()


# ------------------------------------------------------------------ #
# Response Envelope Helpers                                           #
# ------------------------------------------------------------------ #

def ok_response(data: Any = None, status: int = 200) -> tuple[Response, int]:
    """Return a success response wrapped in the project JSON envelope."""
    return jsonify({"ok": True, "data": data, "error": None}), status


def err_response(
    code: str,
    message: str,
    status: int = 400,
    details: dict[str, Any] | None = None
) -> tuple[Response, int]:
    """Return an error response wrapped in the project JSON envelope."""
    err_obj: dict[str, Any] = {"code": code, "message": message}
    if details:
        err_obj["details"] = details
    return jsonify({"ok": False, "data": None, "error": err_obj}), status


# ------------------------------------------------------------------ #
# Global Error Handlers for API Blueprint                            #
# ------------------------------------------------------------------ #

@api_bp.errorhandler(400)
def handle_bad_request(e):
    return err_response("BAD_REQUEST", str(e.description if hasattr(e, "description") else "Bad request"), 400)


@api_bp.errorhandler(404)
def handle_not_found(e):
    return err_response("NOT_FOUND", "The requested API endpoint was not found", 404)


@api_bp.errorhandler(405)
def handle_method_not_allowed(e):
    return err_response("METHOD_NOT_ALLOWED", "HTTP method not allowed for this endpoint", 405)


@api_bp.errorhandler(413)
def handle_payload_too_large(e):
    return err_response("PAYLOAD_TOO_LARGE", "Request payload exceeds maximum allowable size", 413)


@api_bp.errorhandler(415)
def handle_unsupported_media_type(e):
    return err_response("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", 415)


@api_bp.errorhandler(500)
def handle_internal_error(e):
    return err_response("INTERNAL_ERROR", "An unexpected server error occurred", 500)


@api_bp.route("/healthz")
def healthz():
    """Health-check endpoint reporting uptime and service status."""
    uptime_seconds = round(time.time() - _start_time, 2)
    return ok_response({
        "status": "ok",
        "uptime_seconds": uptime_seconds,
        "project": "Smart Traffic Monitoring System",
        "version": "0.1.0",
    })


@api_bp.route("/snapshot")
def get_single_snapshot_image():
    """Return a single JPEG frame from the active video source or a neutral placeholder."""
    import cv2
    import numpy as np
    from engine import get_engine

    engine = get_engine(current_app.config.get("DATABASE_PATH"))
    active_source = engine.active_source
    frame_bytes = None

    if active_source and hasattr(active_source, "get_latest_jpeg"):
        frame_bytes = active_source.get_latest_jpeg()

    if not frame_bytes:
        # Generate a clean neutral placeholder frame for ROI editor
        w, h = 640, 360
        canvas = np.full((h, w, 3), (28, 20, 14), dtype=np.uint8)  # Dark slate
        # Draw perspective road guide lines
        cv2.line(canvas, (0, h), (w // 2 - 40, h // 2), (50, 40, 30), 2)
        cv2.line(canvas, (w, h), (w // 2 + 40, h // 2), (50, 40, 30), 2)
        cv2.line(canvas, (w // 2 - 20, h), (w // 2, h // 2), (80, 70, 60), 1, cv2.LINE_AA)
        cv2.putText(
            canvas,
            "Reference Calibration Frame (640x360)",
            (w // 2 - 160, h // 2 - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (232, 238, 247),
            1,
            cv2.LINE_AA,
        )
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 80]
        _, enc = cv2.imencode(".jpg", canvas, encode_param)
        frame_bytes = enc.tobytes()

    response = Response(frame_bytes, mimetype="image/jpeg")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@api_bp.route("/stats")
def stats():
    """Return the latest canonical traffic snapshot and engine execution status."""
    engine = get_engine(current_app.config.get("DATABASE_PATH"))
    snap = engine.latest_snapshot
    if snap is None:
        # If engine hasn't started yet, generate on-demand initial snapshot
        from simulator import TrafficSimulator
        sim = TrafficSimulator(speed=1.0)
        snap = sim.read_snapshot()

    return ok_response({
        "snapshot": snap,
        "status": engine.status,
    })


@api_bp.route("/history")
def history():
    """Query historical traffic and vehicle crossing logs.

    Query Parameters:
      from: ISO start timestamp
      to: ISO end timestamp
      zone: Approach filter ("N", "S", "E", "W")
      limit: Max rows (default 100, max 1000)
      offset: Pagination offset (default 0)
    """
    db_path = current_app.config.get("DATABASE_PATH")
    start_ts = request.args.get("from")
    end_ts = request.args.get("to")
    zone = request.args.get("zone")

    try:
        limit = min(1000, max(1, int(request.args.get("limit", 100))))
        offset = max(0, int(request.args.get("offset", 0)))
    except ValueError:
        return err_response("INVALID_PAGINATION", "limit and offset must be valid integers", 400)

    traffic_rows = database.query_traffic(
        start_ts=start_ts,
        end_ts=end_ts,
        zone=zone,
        limit=limit,
        offset=offset,
        db_path=db_path
    )
    flow_rows = database.query_flow(
        start_ts=start_ts,
        end_ts=end_ts,
        limit=limit,
        offset=offset,
        db_path=db_path
    )

    # Compute vehicle-type cumulative totals
    car_total = sum(r["car"] for r in flow_rows)
    moto_total = sum(r["motorcycle"] for r in flow_rows)
    bus_total = sum(r["bus"] for r in flow_rows)
    truck_total = sum(r["truck"] for r in flow_rows)

    # Build chronological line chart series data
    sorted_traffic = list(reversed(traffic_rows))
    timestamps = sorted(list({r["ts"] for r in sorted_traffic}))

    occ_series = {"N": [], "S": [], "E": [], "W": []}
    for t in timestamps:
        t_records = {r["zone"]: r["occupancy_avg"] for r in sorted_traffic if r["ts"] == t}
        for z in ["N", "S", "E", "W"]:
            occ_series[z].append(t_records.get(z, 0.0))

    return ok_response({
        "traffic": traffic_rows,
        "flow": flow_rows,
        "vehicle_totals": {
            "car": car_total,
            "motorcycle": moto_total,
            "bus": bus_total,
            "truck": truck_total,
        },
        "series": {
            "labels": timestamps,
            "occupancy": occ_series,
        },
    })


@api_bp.route("/alerts")
def alerts():
    """Query recent or active congestion alerts."""
    db_path = current_app.config.get("DATABASE_PATH")
    active_only = request.args.get("active_only", "false").lower() in ("true", "1", "yes")
    try:
        limit = min(500, max(1, int(request.args.get("limit", 50))))
    except ValueError:
        limit = 50

    alert_rows = database.query_alerts(active_only=active_only, limit=limit, db_path=db_path)
    return ok_response(alert_rows)


@api_bp.route("/settings", methods=["GET", "POST"])
def settings_route():
    """Retrieve or validate and update system settings."""
    db_path = current_app.config.get("DATABASE_PATH")

    if request.method == "GET":
        current_settings = database.get_settings(db_path=db_path)
        return ok_response(current_settings)

    # POST: Validate and update settings
    if not request.is_json:
        return err_response("UNSUPPORTED_MEDIA_TYPE", "Request body must be JSON", 415)

    payload = request.get_json()
    if not isinstance(payload, dict):
        return err_response("INVALID_BODY", "Settings payload must be a JSON object", 400)

    errors: dict[str, str] = {}
    validated: dict[str, Any] = {}

    # 1. Density thresholds
    d_low = payload.get("density_low")
    d_high = payload.get("density_high")
    if d_low is not None:
        if not isinstance(d_low, int) or d_low < 0:
            errors["density_low"] = "density_low must be an integer >= 0"
        else:
            validated["density_low"] = d_low
    if d_high is not None:
        if not isinstance(d_high, int) or d_high <= 0:
            errors["density_high"] = "density_high must be an integer > 0"
        else:
            validated["density_high"] = d_high

    if ("density_low" in validated) and ("density_high" in validated):
        if validated["density_low"] >= validated["density_high"]:
            errors["density_low"] = "density_low must be strictly less than density_high"

    # 2. Congestion persistence
    cong_sec = payload.get("congestion_seconds")
    if cong_sec is not None:
        if not (isinstance(cong_sec, (int, float)) and 1 <= cong_sec <= 300):
            errors["congestion_seconds"] = "congestion_seconds must be between 1 and 300 seconds"
        else:
            validated["congestion_seconds"] = int(cong_sec)

    # 3. Green timing bounds & coefficient k
    k_val = payload.get("k")
    if k_val is not None:
        if not (isinstance(k_val, (int, float)) and 0.0 <= k_val <= 10.0):
            errors["k"] = "k coefficient must be a float between 0.0 and 10.0"
        else:
            validated["k"] = float(k_val)

    min_g = payload.get("min_green")
    max_g = payload.get("max_green")
    base_g = payload.get("base_green")
    if min_g is not None:
        if not (isinstance(min_g, int) and 5 <= min_g <= 120):
            errors["min_green"] = "min_green must be between 5 and 120 seconds"
        else:
            validated["min_green"] = min_g
    if max_g is not None:
        if not (isinstance(max_g, int) and 5 <= max_g <= 180):
            errors["max_green"] = "max_green must be between 5 and 180 seconds"
        else:
            validated["max_green"] = max_g
    if base_g is not None:
        if not (isinstance(base_g, int) and 5 <= base_g <= 180):
            errors["base_green"] = "base_green must be between 5 and 180 seconds"
        else:
            validated["base_green"] = base_g

    if ("min_green" in validated) and ("max_green" in validated):
        if validated["min_green"] > validated["max_green"]:
            errors["min_green"] = "min_green cannot exceed max_green"

    # 4. Opposing & baseline durations
    other_p = payload.get("other_phase_seconds")
    if other_p is not None:
        if not (isinstance(other_p, int) and 5 <= other_p <= 120):
            errors["other_phase_seconds"] = "other_phase_seconds must be between 5 and 120 seconds"
        else:
            validated["other_phase_seconds"] = other_p

    fixed_g = payload.get("fixed_green")
    if fixed_g is not None:
        if not (isinstance(fixed_g, int) and 5 <= fixed_g <= 120):
            errors["fixed_green"] = "fixed_green must be between 5 and 120 seconds"
        else:
            validated["fixed_green"] = fixed_g

    # 5. Normalised coordinates validation helper
    def _validate_points(pts: Any) -> bool:
        if not isinstance(pts, list) or len(pts) < 2:
            return False
        for pt in pts:
            if not (isinstance(pt, list) and len(pt) == 2):
                return False
            x, y = pt
            if not (isinstance(x, (int, float)) and isinstance(y, (int, float))):
                return False
            if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                return False
        return True

    count_line = payload.get("counting_line")
    if count_line is not None:
        if not _validate_points(count_line):
            errors["counting_line"] = "counting_line must be a list of 2 normalised [x, y] coordinates in [0.0, 1.0]"
        else:
            validated["counting_line"] = count_line

    zones_dict = payload.get("zones")
    if zones_dict is not None:
        if not (isinstance(zones_dict, dict) and set(zones_dict.keys()) == {"N", "S", "E", "W"}):
            errors["zones"] = "zones must be a dictionary with keys 'N', 'S', 'E', 'W'"
        else:
            for z_key, poly in zones_dict.items():
                if not _validate_points(poly):
                    errors[f"zones.{z_key}"] = f"Zone {z_key} must be a valid polygon with normalised coordinates in [0.0, 1.0]"
            if not any(k.startswith("zones.") for k in errors):
                validated["zones"] = zones_dict

    if errors:
        return err_response("VALIDATION_ERROR", "One or more settings fields failed validation", 400, details=errors)

    # Persist and return merged settings
    database.save_settings(validated, db_path=db_path)
    updated = database.get_settings(db_path=db_path)
    return ok_response(updated)


@api_bp.route("/samples")
def list_samples():
    """List available sample video files in static/samples."""
    samples_dir = Path(current_app.root_path) / "static" / "samples"
    samples_list = []
    if samples_dir.exists():
        for f in sorted(samples_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in (".mp4", ".avi"):
                samples_list.append({
                    "name": f.name,
                    "size_bytes": f.stat().st_size,
                })
    return ok_response({"samples": samples_list})


@api_bp.route("/upload", methods=["POST"])
def upload_video():
    """Upload a video file for computer-vision traffic analysis."""
    import security

    client_ip = request.remote_addr or "127.0.0.1"
    if not security.upload_limiter.is_allowed(client_ip, max_requests=20, window_seconds=60.0):
        return err_response("RATE_LIMIT_EXCEEDED", "Upload rate limit exceeded. Please wait before uploading again.", 429)

    if "file" not in request.files:
        return err_response("NO_FILE", "Missing 'file' field in multipart form upload", 400)

    file_obj = request.files["file"]
    is_valid, ext, err_msg = security.validate_upload_file(file_obj)
    if not is_valid:
        return err_response("INVALID_FILE", err_msg or "File validation failed", 400)

    upload_folder = current_app.config.get("UPLOAD_FOLDER")
    try:
        file_id, saved_path, size_bytes = security.save_secure_upload(file_obj, upload_folder)
    except Exception as exc:
        return err_response("SAVE_ERROR", f"Could not save uploaded file: {exc}", 500)

    # Verify the video can be opened and decoded
    if not security.verify_video_frames(saved_path):
        try:
            os.remove(saved_path)
        except Exception:
            pass
        return err_response("CORRUPT_VIDEO", "Uploaded video file could not be read or contains no valid video frames.", 400)

    sanitized_name = security.sanitize_display_name(file_obj.filename)
    return ok_response({
        "file_id": file_id,
        "original_name": sanitized_name,
        "size_bytes": size_bytes,
    }, status=201)


@api_bp.route("/start", methods=["POST"])
def start_engine_route():
    """Start the processing engine with the specified source mode."""
    import security

    client_ip = request.remote_addr or "127.0.0.1"
    if not security.start_limiter.is_allowed(client_ip, max_requests=30, window_seconds=60.0):
        return err_response("RATE_LIMIT_EXCEEDED", "Too many start/stop requests. Please slow down.", 429)

    data = request.get_json(silent=True) or {}
    source = data.get("source", "simulation")
    valid_sources = ("simulation", "upload", "sample", "webcam")
    if source not in valid_sources:
        return err_response(
            "INVALID_SOURCE",
            f"Source '{source}' is invalid. Allowed: {', '.join(valid_sources)}",
            400
        )

    # Validate upload source file_id
    if source == "upload":
        file_id = data.get("file_id")
        if not file_id:
            return err_response("MISSING_FILE_ID", "source 'upload' requires a valid 'file_id'", 400)
        upload_folder = current_app.config.get("UPLOAD_FOLDER")
        valid, real_path = security.validate_file_id(file_id, upload_folder)
        if not valid:
            return err_response("FILE_NOT_FOUND", "Specified file_id does not exist or is invalid", 400)
        data["path"] = real_path

    # Validate sample source file
    elif source == "sample":
        sample_name = data.get("sample_name")
        samples_dir = Path(current_app.root_path) / "static" / "samples"
        if sample_name:
            # Prevent directory traversal
            clean_name = os.path.basename(sample_name)
            target_path = samples_dir / clean_name
            if not target_path.is_file():
                return err_response("SAMPLE_NOT_FOUND", f"Sample '{clean_name}' not found", 400)
            data["path"] = str(target_path)
        else:
            # Default sample video if available
            default_sample = samples_dir / "sample.mp4"
            data["path"] = str(default_sample) if default_sample.is_file() else None

    # Validate webcam source
    elif source == "webcam":
        cam_idx = data.get("camera_index", 0)
        try:
            data["camera_index"] = int(cam_idx)
        except (ValueError, TypeError):
            data["camera_index"] = 0

    engine = get_engine(current_app.config.get("DATABASE_PATH"))
    engine.start(mode=source, source_args=data)
    return ok_response(engine.status)


@api_bp.route("/stop", methods=["POST"])
def stop_engine_route():
    """Stop the processing engine and perform upload lifecycle cleanup."""
    import security
    engine = get_engine(current_app.config.get("DATABASE_PATH"))
    engine.stop()

    # Opportunistically clean up old uploads
    upload_folder = current_app.config.get("UPLOAD_FOLDER")
    if upload_folder:
        security.cleanup_old_uploads(upload_folder, max_age_hours=24.0)

    return ok_response(engine.status)


@api_bp.route("/export.csv")
def export_csv():
    """Stream database traffic or flow logs as a downloadable CSV file."""
    db_path = current_app.config.get("DATABASE_PATH")
    table = request.args.get("table", "traffic_log")
    start_ts = request.args.get("from")
    end_ts = request.args.get("to")

    if table not in ("traffic_log", "flow_log", "alerts"):
        return err_response("INVALID_TABLE", "Table must be traffic_log, flow_log, or alerts", 400)

    def generate():
        for chunk in database.export_csv_rows(table=table, start_ts=start_ts, end_ts=end_ts, db_path=db_path):
            yield chunk

    filename = f"{table}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        stream_with_context(generate()),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@api_bp.route("/forecast")
def forecast():
    """Compute trend forecast for a specific zone or total traffic using recent 5-second intervals."""
    db_path = current_app.config.get("DATABASE_PATH")
    zone = request.args.get("zone")

    recent_traffic = database.query_traffic(zone=zone, limit=10, db_path=db_path)
    if not recent_traffic:
        return ok_response({
            "prediction": None,
            "points_used": 0,
            "label": "insufficient history (need at least 3 points)",
        })

    # Oldest to newest counts
    counts = [r["occupancy_avg"] for r in reversed(recent_traffic)]
    result = analytics.basic_forecast(counts)
    if result is None:
        return ok_response({
            "prediction": None,
            "points_used": len(counts),
            "label": "insufficient history (need at least 3 points)",
        })

    return ok_response(result)


@api_bp.route("/heatmap")
def heatmap():
    """Aggregate traffic occupancy into a 24-hour x 7-day matrix for heatmap analytics."""
    db_path = current_app.config.get("DATABASE_PATH")
    conn = database.get_connection(db_path)

    # SQLite strftime('%w', ts) returns 0=Sunday..6=Saturday; strftime('%H', ts) returns 00..23
    sql = """
        SELECT
            strftime('%w', ts) as dow,
            strftime('%H', ts) as hour,
            AVG(occupancy_avg) as avg_occ
        FROM traffic_log
        GROUP BY dow, hour;
    """
    cur = conn.execute(sql)
    matrix: list[list[float]] = [[0.0 for _ in range(24)] for _ in range(7)]

    for row in cur.fetchall():
        if row["dow"] is not None and row["hour"] is not None:
            dow_idx = int(row["dow"])
            hour_idx = int(row["hour"])
            if 0 <= dow_idx < 7 and 0 <= hour_idx < 24:
                matrix[dow_idx][hour_idx] = round(float(row["avg_occ"] or 0.0), 1)

    conn.close()
    return ok_response({
        "days": ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        "hours": list(range(24)),
        "matrix": matrix,
    })


@api_bp.route("/zone-averages")
def zone_averages():
    """Calculate average occupancy and dominant density level per approach in a date range."""
    db_path = current_app.config.get("DATABASE_PATH")
    start_ts = request.args.get("from")
    end_ts = request.args.get("to")

    traffic_rows = database.query_traffic(start_ts=start_ts, end_ts=end_ts, limit=1000, db_path=db_path)
    zone_stats = {"N": [], "S": [], "E": [], "W": []}

    for r in traffic_rows:
        z = r["zone"]
        if z in zone_stats:
            zone_stats[z].append(r["occupancy_avg"])

    results = {}
    settings = database.get_settings(db_path=db_path)
    low_th = settings.get("density_low", 5)
    high_th = settings.get("density_high", 12)

    for z in ["N", "S", "E", "W"]:
        samples = zone_stats[z]
        if samples:
            avg_val = round(sum(samples) / len(samples), 1)
            dom_level = analytics.classify_density(int(round(avg_val)), low=low_th, high=high_th)
        else:
            avg_val = 0.0
            dom_level = "Low"

        results[z] = {
            "average_occupancy": avg_val,
            "dominant_density": dom_level,
            "sample_count": len(samples),
        }

    return ok_response(results)


@api_bp.route("/stream")
def sse_stream():
    """Server-Sent Events stream yielding live 1 Hz traffic snapshots and keep-alive pings."""
    engine = get_engine(current_app.config.get("DATABASE_PATH"))
    sub_q = engine.subscribe()

    def event_stream() -> Generator[str, None, None]:
        last_keep_alive = time.time()
        try:
            while True:
                now = time.time()
                try:
                    # Non-blocking or 1-second timeout wait for new snapshot
                    snap = sub_q.get(timeout=1.0)
                    yield f"event: snapshot\ndata: {json.dumps(snap)}\n\n"
                    last_keep_alive = now
                except queue.Empty:
                    pass

                # Send keep-alive comment every 15 seconds
                if now - last_keep_alive >= 15.0:
                    yield ": keep-alive\n\n"
                    last_keep_alive = now
        except GeneratorExit:
            engine.unsubscribe(sub_q)
        except Exception:
            engine.unsubscribe(sub_q)

    response = Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream"
    )
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    response.headers["Connection"] = "keep-alive"
    return response


@api_bp.route("/simulation/state", methods=["GET", "POST"])
def simulation_state():
    """Get or update interactive 4-way intersection simulation state.

    GET: Returns current simulated vehicle counts per approach zone and signal state.
    POST: Accepts {"zones": {"N": int, "S": int, "E": int, "W": int}} to synchronize
          the interactive simulator with the live backend telemetry & dashboard.
    """
    engine = get_engine(current_app.config.get("DATABASE_PATH"))

    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        zones = payload.get("zones")
        if not isinstance(zones, dict):
            return err_response("INVALID_PAYLOAD", "Payload must contain a 'zones' dictionary with N, S, E, W counts", 400)

        counts = {
            "N": float(zones.get("N", 0)),
            "S": float(zones.get("S", 0)),
            "E": float(zones.get("E", 0)),
            "W": float(zones.get("W", 0)),
        }
        updated_snap = engine.set_simulation_counts(counts)
        return ok_response({
            "message": "Simulation counts synchronized",
            "snapshot": updated_snap,
            "zones": counts,
        })

    # GET request
    snap = engine.latest_snapshot
    if not snap and engine.active_source:
        snap = engine.active_source.read_snapshot()

    return ok_response({
        "status": engine.status,
        "snapshot": snap,
    })
