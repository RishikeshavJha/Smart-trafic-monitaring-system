"""
detector.py – Computer Vision Video Source & Detection Pipeline for Smart Traffic Monitoring System.

Pipeline Architecture:
  1. Capture: Reads frames from video file, sample in static/samples, or webcam index via cv2.VideoCapture.
  2. Frame Preprocessing: Scales frame to fixed width (640px) maintaining aspect ratio.
  3. YOLOv8n Lazy Loading: Lazy-loaded on first start (CPU inference, classes=[2,3,5,7]).
  4. Tracking (ByteTrack): Associates high-score and low-score detection bounding boxes across
     consecutive frames using Kalman filtering and bipartite matching.
  5. Line Crossing: Tracks past centroid against configured counting line using 2D cross-product orientation.
  6. Multi-Zone Spatial Analysis: Evaluates bottom-center of bounding boxes inside N/S/E/W polygons
     via cv2.pointPolygonTest, computing queue occupancies and classifying density.
  7. HUD Annotation: Renders bounding boxes with class colors, IDs, counting lines, zone outlines,
     and translucent fills without blocking inference or web stream consumers.
  8. Canonical Snapshot: Emits 1 Hz canonical snapshot dictionary with is_simulated=False.

ByteTrack Plain Language Summary:
  ByteTrack is an association tracker that preserves track continuity in dense traffic. Unlike
  standard trackers that discard low-confidence detections (which frequently occur due to occlusion,
  motion blur, or distance), ByteTrack first associates high-confidence detections, and then
  matches the remaining unmatched tracks with the lower-confidence detections. This prevents
  dropped track IDs when vehicles pass behind signs or under bridges.
"""

import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Tuple

import cv2
import numpy as np

import analytics
from config import BASE_DIR, DEFAULT_SETTINGS

logger = logging.getLogger(__name__)

# COCO Vehicle Class ID Mapping
CLASS_MAP = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}

# Color palette for vehicle bounding boxes (BGR format for OpenCV)
CLASS_COLORS = {
    "car": (246, 130, 59),        # Blue #3B82F6
    "motorcycle": (68, 68, 239),  # Red #EF4444
    "bus": (233, 165, 14),        # Sky #0EA5E9
    "truck": (23, 160, 212),      # Gold #D4A017
}

# Zone outline & fill colors (BGR)
ZONE_BGR_COLORS = {
    "Low": (94, 197, 34),       # Green #22C55E
    "Medium": (11, 158, 245),   # Amber #F59E0B
    "High": (68, 68, 239),      # Red #EF4444
}


# ============================================================================
# Pure Geometry Helpers (Unit-Testable without YOLO or Camera)
# ============================================================================

def normalized_to_pixel_coords(norm_pt: list[float] | Tuple[float, float], width: int, height: int) -> Tuple[int, int]:
    """Convert a normalized (0.0 to 1.0) coordinate pair into absolute pixel coordinates."""
    x = int(round(float(norm_pt[0]) * width))
    y = int(round(float(norm_pt[1]) * height))
    return max(0, min(width - 1, x)), max(0, min(height - 1, y))


def normalized_polygon_to_pixels(norm_poly: list[list[float]], width: int, height: int) -> np.ndarray:
    """Convert a normalized polygon [[x1, y1], [x2, y2], ...] into an integer pixel NumPy array."""
    pts = [[int(round(p[0] * width)), int(round(p[1] * height))] for p in norm_poly]
    return np.array(pts, dtype=np.int32)


def cross_product_2d(p1: Tuple[float, float], p2: Tuple[float, float], p: Tuple[float, float]) -> float:
    """Calculate the 2D cross product of vector (p2 - p1) with vector (p - p1).

    Positive indicates point p is on one side, negative on the other, and 0 on the line.
    """
    return (p2[0] - p1[0]) * (p[1] - p1[1]) - (p2[1] - p1[1]) * (p[0] - p1[0])


def check_line_intersection(
    prev_pt: Tuple[float, float],
    curr_pt: Tuple[float, float],
    line_start: Tuple[float, float],
    line_end: Tuple[float, float],
) -> bool:
    """Determine whether the segment from prev_pt to curr_pt intersects the segment line_start to line_end.

    Uses orientation tests (sign of 2D cross products) for robust line-crossing determination.
    """
    # If the vehicle has not moved, no crossing occurred
    if prev_pt[0] == curr_pt[0] and prev_pt[1] == curr_pt[1]:
        return False

    cp1 = cross_product_2d(line_start, line_end, prev_pt)
    cp2 = cross_product_2d(line_start, line_end, curr_pt)

    # If both points are on the exact same non-zero side of the line, no crossing
    if (cp1 > 0 and cp2 > 0) or (cp1 < 0 and cp2 < 0):
        return False

    # Check that line endpoints straddle the trajectory segment as well
    cp3 = cross_product_2d(prev_pt, curr_pt, line_start)
    cp4 = cross_product_2d(prev_pt, curr_pt, line_end)

    if (cp3 > 0 and cp4 > 0) or (cp3 < 0 and cp4 < 0):
        return False

    return True


def is_point_in_polygon(point: Tuple[float, float], polygon_pts: np.ndarray) -> bool:
    """Check whether a (x, y) point is inside or on the contour of a polygon."""
    dist = cv2.pointPolygonTest(polygon_pts, (float(point[0]), float(point[1])), False)
    return dist >= 0


# ============================================================================
# VideoSource: YOLOv8 Computer Vision Pipeline
# ============================================================================

class VideoSource:
    """Real-time or file-based video detection source implementing the engine's TrafficSource interface.

    Lifecycle:
      1. start() -> Initializes background capture & inference thread.
      2. stop() -> Releases capture, shuts down thread, clears caches.
      3. read_snapshot() -> Returns latest canonical 1 Hz snapshot dictionary.
      4. get_latest_jpeg() -> Returns latest annotated JPEG byte array for /video_feed MJPEG stream.
    """

    def __init__(
        self,
        source_type: str = "sample",
        source_path: str | int | None = None,
        settings: dict[str, Any] | None = None,
    ):
        """Initialize VideoSource.

        Parameters
        ----------
        source_type : str
            One of 'sample', 'upload', or 'webcam'.
        source_path : str | int | None
            File path or webcam index. If None for 'sample', defaults to static/samples/sample.mp4.
        settings : dict | None
            System configuration thresholds for counting line, zones, and density rules.
        """
        self.source_type = source_type
        self.source_path = source_path
        self.settings = settings or DEFAULT_SETTINGS.copy()

        # Threading & status flags
        self._running = False
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

        # YOLO Model (lazy loaded)
        self._model = None
        self._model_load_error: str | None = None

        # JPEG output buffer (thread-safe copy for /video_feed stream)
        self._jpeg_lock = threading.Lock()
        self._latest_jpeg: bytes | None = None

        # Tracking state
        self._prev_centroids: dict[int, Tuple[float, float]] = {}  # {track_id: (x, y)}
        self._counted_ids: set[int] = set()                       # Track IDs already counted
        self._recent_track_ts: dict[int, float] = {}              # {track_id: timestamp} for pruning

        # 1-second snapshot accumulators
        self._flow_counts_1s = {"car": 0, "motorcycle": 0, "bus": 0, "truck": 0}
        self._total_crossed_1s = 0
        self._current_zone_counts = {"N": 0, "S": 0, "E": 0, "W": 0}
        self._current_class_counts = {"car": 0, "motorcycle": 0, "bus": 0, "truck": 0}

        # Latest canonical snapshot
        self._latest_snapshot: dict[str, Any] | None = None
        self._last_snapshot_time = time.time()

    def _resolve_source_target(self) -> str | int:
        """Resolve the OpenCV VideoCapture target based on source type and parameters."""
        if self.source_type == "webcam":
            try:
                return int(self.source_path if self.source_path is not None else 0)
            except (ValueError, TypeError):
                return 0

        if self.source_path:
            p = Path(self.source_path)
            if p.is_absolute():
                return str(p)
            return str(BASE_DIR / p)

        # Default sample video fallback
        sample_path = BASE_DIR / "static" / "samples" / "sample.mp4"
        return str(sample_path)

    def _load_model(self) -> Any:
        """Lazily load Ultralytics YOLOv8n model on CPU.

        Raises RuntimeError with helpful message if download or loading fails.
        """
        if self._model is not None:
            return self._model

        try:
            from ultralytics import YOLO
            # Load yolov8n weights (downloads automatically to current dir or cache if missing)
            weights_path = "yolov8n.pt"
            logger.info("Loading YOLOv8n weights (%s)...", weights_path)
            model = YOLO(weights_path)
            self._model = model
            self._model_load_error = None
            return model
        except Exception as exc:
            err_msg = (
                f"Failed to load YOLOv8 model: {exc}. "
                "Internet access is required once to download yolov8n.pt."
            )
            logger.error(err_msg)
            self._model_load_error = err_msg
            raise RuntimeError(err_msg) from exc

    def start(self) -> None:
        """Start the background video capture and inference loop."""
        with self._lock:
            if self._running:
                return
            self._running = True
            self._thread = threading.Thread(
                target=self._capture_and_infer_loop,
                name="VideoSourceInferenceThread",
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        """Stop capture, release camera/file handle, and join thread."""
        with self._lock:
            self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
            self._thread = None

    def read_snapshot(self) -> dict[str, Any] | None:
        """Return the latest canonical snapshot dictionary."""
        with self._lock:
            return self._latest_snapshot

    def get_latest_jpeg(self) -> bytes | None:
        """Thread-safe getter for the latest annotated JPEG frame."""
        with self._jpeg_lock:
            return self._latest_jpeg

    def _capture_and_infer_loop(self) -> None:
        """Main processing thread: Capture -> Preprocess -> YOLO Track -> Count -> Annotate -> Snapshot."""
        target = self._resolve_source_target()
        logger.info("Opening VideoCapture on target: %s", target)

        cap = cv2.VideoCapture(target)
        if not cap.isOpened():
            logger.error("Could not open video source at %s", target)
            self._running = False
            return

        # Load YOLO model
        try:
            model = self._load_model()
        except Exception:
            cap.release()
            self._running = False
            return

        # Extract capture properties
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_delay = 1.0 / fps if (fps and fps > 0 and fps < 120) else 0.033
        is_file_source = isinstance(target, str) and not target.isdigit()

        target_width = int(self.settings.get("frame_width", 640))
        last_frame_time = time.time()
        self._last_snapshot_time = time.time()

        while self._running:
            start_iter = time.time()

            ret, frame = cap.read()
            if not ret or frame is None:
                if is_file_source and self._running:
                    # Loop video so demo continues indefinitely
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    time.sleep(0.01)
                    continue
                else:
                    logger.warning("Video stream ended or frame unreadable.")
                    break

            # 1. Scale frame to standard width preserving aspect ratio
            orig_h, orig_w = frame.shape[:2]
            if orig_w != target_width:
                aspect = orig_h / orig_w
                target_height = int(round(target_width * aspect))
                frame = cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_LINEAR)
            else:
                target_height = orig_h

            # 2. Run ByteTrack tracking with YOLOv8n (classes: 2=car, 3=motorcycle, 5=bus, 7=truck)
            try:
                results = model.track(
                    frame,
                    persist=True,
                    tracker="bytetrack.yaml",
                    classes=[2, 3, 5, 7],
                    conf=0.3,
                    imgsz=640,
                    verbose=False,
                )
            except Exception as e:
                logger.error("Error during model.track(): %s", e)
                results = []

            # 3. Process detections, spatial zones, line crossing & vehicle counting
            annotated_frame = self._process_detections_and_spatial(
                frame=frame,
                results=results,
                width=target_width,
                height=target_height,
            )

            # 4. Compress to JPEG (quality ~70) and update thread-safe buffer for MJPEG stream
            encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 70]
            success, enc_img = cv2.imencode(".jpg", annotated_frame, encode_param)
            if success:
                with self._jpeg_lock:
                    self._latest_jpeg = enc_img.tobytes()

            # 5. Emit 1 Hz canonical snapshot
            now = time.time()
            if now - self._last_snapshot_time >= 1.0:
                self._emit_snapshot()
                self._last_snapshot_time = now

            # 6. Throttle file playback to nominal source FPS (avoids CPU spinning)
            if is_file_source:
                elapsed = time.time() - start_iter
                sleep_time = max(0.0, frame_delay - elapsed)
                if sleep_time > 0:
                    time.sleep(sleep_time)

        # Cleanup on loop exit
        cap.release()
        logger.info("VideoCapture released.")

    def _process_detections_and_spatial(
        self,
        frame: np.ndarray,
        results: Any,
        width: int,
        height: int,
    ) -> np.ndarray:
        """Evaluate tracking centroids against counting line and polygon zones, then draw HUD overlay."""
        display = frame.copy()
        now = time.time()

        # Configured counting line in pixel coords
        cfg_line = self.settings.get("counting_line", [[0.1, 0.55], [0.9, 0.55]])
        line_p1 = normalized_to_pixel_coords(cfg_line[0], width, height)
        line_p2 = normalized_to_pixel_coords(cfg_line[1], width, height)

        # Configured zone polygons
        cfg_zones = self.settings.get("zones", {})
        pixel_zones: dict[str, np.ndarray] = {}
        for z_key, norm_poly in cfg_zones.items():
            pixel_zones[z_key] = normalized_polygon_to_pixels(norm_poly, width, height)

        # Zone occupancy counters for this frame
        zone_occupancies = {z: 0 for z in cfg_zones}
        active_class_counts = {"car": 0, "motorcycle": 0, "bus": 0, "truck": 0}

        # Parse ByteTrack bounding boxes & tracks
        if results and len(results) > 0 and results[0].boxes is not None:
            boxes = results[0].boxes
            for i in range(len(boxes)):
                box = boxes[i]
                xyxy = box.xyxy[0].cpu().numpy()
                x1, y1, x2, y2 = map(int, xyxy)

                cls_id = int(box.cls[0].item()) if box.cls is not None else 2
                cls_name = CLASS_MAP.get(cls_id, "car")
                active_class_counts[cls_name] = active_class_counts.get(cls_name, 0) + 1

                track_id = int(box.id[0].item()) if (box.id is not None and len(box.id) > 0) else None

                # Bottom-center represents footprint on the road surface
                bottom_center = ((x1 + x2) / 2.0, float(y2))
                centroid = ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

                # Check which zone vehicle is inside
                for z_key, poly_pts in pixel_zones.items():
                    if is_point_in_polygon(bottom_center, poly_pts):
                        zone_occupancies[z_key] += 1
                        break

                # Line crossing count logic (only if tracking ID exists)
                if track_id is not None:
                    self._recent_track_ts[track_id] = now
                    if track_id in self._prev_centroids:
                        prev_c = self._prev_centroids[track_id]
                        if track_id not in self._counted_ids:
                            if check_line_intersection(prev_c, centroid, line_p1, line_p2):
                                self._counted_ids.add(track_id)
                                self._flow_counts_1s[cls_name] += 1
                                self._total_crossed_1s += 1
                    self._prev_centroids[track_id] = centroid

                # Draw vehicle bounding box with class color
                bgr_color = CLASS_COLORS.get(cls_name, (246, 130, 59))
                cv2.rectangle(display, (x1, y1), (x2, y2), bgr_color, 2)

                # Label tag (Class + ID)
                tag = f"#{track_id} {cls_name}" if track_id is not None else cls_name
                (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                cv2.rectangle(display, (x1, max(0, y1 - th - 6)), (x1 + tw + 6, y1), bgr_color, -1)
                cv2.putText(
                    display,
                    tag,
                    (x1 + 3, max(th + 2, y1 - 3)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.45,
                    (255, 255, 255),
                    1,
                    cv2.LINE_AA,
                )

        # Update running tallies
        self._current_zone_counts = zone_occupancies
        self._current_class_counts = active_class_counts

        # Prune stale tracking centroids older than 15 seconds to bound memory
        stale_cutoff = now - 15.0
        stale_ids = [tid for tid, ts in self._recent_track_ts.items() if ts < stale_cutoff]
        for tid in stale_ids:
            self._prev_centroids.pop(tid, None)
            self._recent_track_ts.pop(tid, None)

        # Draw translucent polygon overlays for zones
        overlay = display.copy()
        for z_key, poly_pts in pixel_zones.items():
            occ = zone_occupancies.get(z_key, 0)
            level = analytics.classify_density(
                occ,
                low=self.settings.get("density_low", 5),
                high=self.settings.get("density_high", 12),
            )
            zone_color = ZONE_BGR_COLORS.get(level, (94, 197, 34))

            # Fill translucent polygon
            cv2.fillPoly(overlay, [poly_pts], zone_color)

            # Zone label at polygon centroid
            m = cv2.moments(poly_pts)
            if m["m00"] != 0:
                cx = int(m["m10"] / m["m00"])
                cy = int(m["m01"] / m["m00"])
                z_tag = f"Zone {z_key}: {occ} ({level})"
                cv2.putText(
                    display,
                    z_tag,
                    (cx - 40, cy),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.45,
                    (255, 255, 255),
                    1,
                    cv2.LINE_AA,
                )

        # Alpha blend zone overlay (opacity ~ 0.20)
        cv2.addWeighted(overlay, 0.20, display, 0.80, 0, display)

        # Draw Zone Polygons outline
        for z_key, poly_pts in pixel_zones.items():
            occ = zone_occupancies.get(z_key, 0)
            level = analytics.classify_density(
                occ,
                low=self.settings.get("density_low", 5),
                high=self.settings.get("density_high", 12),
            )
            zone_color = ZONE_BGR_COLORS.get(level, (94, 197, 34))
            cv2.polylines(display, [poly_pts], isClosed=True, color=zone_color, thickness=2)

        # Draw Counting Line with high-contrast outline
        cv2.line(display, line_p1, line_p2, (0, 0, 0), 4, cv2.LINE_AA)
        cv2.line(display, line_p1, line_p2, (255, 255, 0), 2, cv2.LINE_AA)  # Cyan/Yellow #00FFFF
        cv2.putText(
            display,
            f"COUNT LINE [Total Crossed: {len(self._counted_ids)}]",
            (line_p1[0] + 5, max(20, line_p1[1] - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

        return display

    def _emit_snapshot(self) -> dict[str, Any]:
        """Construct the canonical 1 Hz snapshot dictionary from current real-world detections."""
        zones_data: dict[str, dict[str, Any]] = {}
        max_zone = "N"
        max_count = -1

        for z in ["N", "S", "E", "W"]:
            count = self._current_zone_counts.get(z, 0)
            level = analytics.classify_density(
                count,
                low=self.settings.get("density_low", 5),
                high=self.settings.get("density_high", 12),
            )
            zones_data[z] = {
                "count": count,
                "level": level,
            }
            if count > max_count:
                max_count = count
                max_zone = z

        # Flow counts crossing the line in this 1-second interval
        flow_data = {
            "crossed_total": self._total_crossed_1s,
            "by_type": self._flow_counts_1s.copy(),
        }

        # Reset 1-second interval accumulators
        self._total_crossed_1s = 0
        self._flow_counts_1s = {"car": 0, "motorcycle": 0, "bus": 0, "truck": 0}

        # Signal plan calculation
        sug_green = analytics.suggest_green(
            max_count,
            base=self.settings.get("base_green", 30),
            k=self.settings.get("k", 1.5),
            min_g=self.settings.get("min_green", 10),
            max_g=self.settings.get("max_green", 60),
        )
        fixed_g = self.settings.get("fixed_green", 30)
        other_phase = self.settings.get("other_phase_seconds", 30)

        cycle_sug = analytics.cycle_length(sug_green, other_phase)
        cycle_fixed = analytics.cycle_length(fixed_g, other_phase)

        est_delay_sug = analytics.estimate_delay(cycle_sug, sug_green)
        est_delay_fixed = analytics.estimate_delay(cycle_fixed, fixed_g)

        signal_data = {
            "driver_zone": max_zone,
            "suggested_green": sug_green,
            "fixed_green": fixed_g,
            "est_delay_fixed": est_delay_fixed,
            "est_delay_suggested": est_delay_sug,
        }

        # Canonical snapshot contract
        snapshot = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "source": self.source_type,
            "is_simulated": False,
            "zones": zones_data,
            "flow": flow_data,
            "classes": self._current_class_counts.copy(),
            "signal": signal_data,
            "active_alerts": 0,
        }

        with self._lock:
            self._latest_snapshot = snapshot
        return snapshot
