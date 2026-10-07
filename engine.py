"""
engine.py – Single pipeline coordinator for the Smart Traffic Monitoring System.

=============================================================================
THE SNAPSHOT CONTRACT
=============================================================================
Once per second (1 Hz), the active source produces a canonical snapshot dictionary:
{
  "ts": "2026-09-30T08:30:00+00:00",               # ISO-8601 UTC timestamp
  "source": "simulation|upload|sample|webcam",      # Active video or generator source
  "is_simulated": true,                             # Boolean: true for synthetic data
  "zones": {
    "N": {"count": 14, "level": "High"},            # Approach zone vehicle count & level
    "S": {"count": 8,  "level": "Medium"},
    "E": {"count": 3,  "level": "Low"},
    "W": {"count": 4,  "level": "Low"}
  },
  "flow": {
    "crossed_total": 2,                             # Vehicles crossing count line this second
    "by_type": {
      "car": 1,
      "motorcycle": 1,
      "bus": 0,
      "truck": 0
    }
  },
  "signal": {
    "driver_zone": "N",                             # Approach with highest demand
    "suggested_green": 51,                          # Rule-based Webster green time (seconds)
    "fixed_green": 30,                              # Baseline comparison duration (seconds)
    "est_delay_fixed": 7.5,                         # Estimated delay under fixed timing (s/veh)
    "est_delay_suggested": 4.8                      # Estimated delay under adaptive timing (s/veh)
  },
  "active_alerts": 1                                # Number of active unresolved congestion alerts
}
=============================================================================

Responsibilities:
  - Coordinate active input sources (simulation, upload, sample, webcam) with graceful fallback.
  - Maintain rolling 5-minute per-zone density history for persistence checks.
  - Aggregate 1 Hz snapshots into 5-second interval database log rows.
  - Manage session lifecycle (start_session / end_session).
  - Raise and resolve congestion alerts per episode (not once per second).
  - Distribute live snapshots to thread-safe SSE subscriber queues.
"""

import collections
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Any, Protocol

import analytics
import database
from simulator import TrafficSimulator


class TrafficSource(Protocol):
    """Protocol defining the interface required of any traffic video or simulation source."""

    def start(self) -> None:
        ...

    def stop(self) -> None:
        ...

    def read_snapshot(self) -> dict[str, Any] | None:
        ...


class TrafficEngine:
    """Thread-safe orchestrator coordinating sources, analytics, logging, and SSE feeds."""

    def __init__(self, db_path: str | None = None):
        self.db_path = db_path
        self._lock = threading.RLock()
        self._running = False
        self._worker_thread: threading.Thread | None = None

        # Active data source & fallback state
        self._active_source: Any = None
        self._mode = "simulation"
        self._status = {
            "mode": "simulation",
            "message": "Running simulated traffic data (default)",
            "fallback_reason": None,
        }

        # Session tracking
        self._session_id: int | None = None

        # Rolling 5-minute (300 samples at 1 Hz) history per zone: deque of (epoch_seconds, level)
        self._zone_history: dict[str, collections.deque[tuple[float, str]]] = {
            "N": collections.deque(maxlen=300),
            "S": collections.deque(maxlen=300),
            "E": collections.deque(maxlen=300),
            "W": collections.deque(maxlen=300),
        }

        # Active alert IDs per zone: {zone: alert_id}
        self._active_alerts: dict[str, int] = {}

        # 5-second aggregation buffer
        self._agg_buffer: list[dict[str, Any]] = []
        self._last_log_time = time.time()

        # Latest canonical snapshot cache
        self._latest_snapshot: dict[str, Any] | None = None

        # SSE subscriber queues (maxsize 30, drops oldest on overflow)
        self._subscribers: set[queue.Queue] = set()

    @property
    def status(self) -> dict[str, Any]:
        """Return engine status dictionary."""
        with self._lock:
            return self._status.copy()

    @property
    def latest_snapshot(self) -> dict[str, Any] | None:
        """Return the most recent snapshot."""
        with self._lock:
            return self._latest_snapshot

    @property
    def active_source(self) -> Any:
        """Return the active traffic source object."""
        with self._lock:
            return self._active_source

    def start(self, mode: str = "simulation", source_args: dict[str, Any] | None = None) -> None:
        """Start the engine and activate the specified traffic source."""
        with self._lock:
            if self._running:
                self.stop()

            # Ensure tables exist
            database.init_db(self.db_path)

            self._mode = mode
            settings = database.get_settings(db_path=self.db_path)
            args = source_args or {}

            if mode == "simulation":
                speed = args.get("speed", 240.0)
                self._active_source = TrafficSimulator(speed=speed)
                self._status = {
                    "mode": "simulation",
                    "message": "Running realistic simulated traffic model",
                    "fallback_reason": None,
                }
            elif mode in ("sample", "upload", "webcam"):
                try:
                    from detector import VideoSource
                    source_path = args.get("path")
                    if mode == "webcam" and source_path is None:
                        source_path = args.get("camera_index", 0)

                    self._active_source = VideoSource(
                        source_type=mode,
                        source_path=source_path,
                        settings=settings,
                    )
                    self._status = {
                        "mode": mode,
                        "message": f"Running {mode} video source with YOLOv8n & ByteTrack",
                        "fallback_reason": None,
                    }
                except Exception as exc:
                    # Graceful fallback to simulation
                    speed = args.get("speed", 240.0)
                    self._active_source = TrafficSimulator(speed=speed)
                    self._mode = "simulation"
                    self._status = {
                        "mode": "simulation",
                        "message": f"Failed to initialize '{mode}' source: {exc}. Falling back to simulation.",
                        "fallback_reason": str(exc),
                    }
            else:
                self._active_source = TrafficSimulator(speed=240.0)
                self._mode = "simulation"
                self._status = {
                    "mode": "simulation",
                    "message": f"Requested mode '{mode}' unknown, fell back to simulation",
                    "fallback_reason": f"Unknown source mode '{mode}'",
                }

            # Start source and recording session
            self._active_source.start()
            now_iso = datetime.now(timezone.utc).isoformat()
            self._session_id = database.start_session(self._mode, now_iso, db_path=self.db_path)

            self._running = True
            self._worker_thread = threading.Thread(
                target=self._coordinator_loop,
                name="TrafficEngineCoordinator",
                daemon=True
            )
            self._worker_thread.start()

    def stop(self) -> None:
        """Stop the engine and close the active session."""
        with self._lock:
            self._running = False

            if self._active_source:
                try:
                    self._active_source.stop()
                except Exception:
                    pass
                self._active_source = None

            if self._session_id:
                now_iso = datetime.now(timezone.utc).isoformat()
                database.end_session(self._session_id, now_iso, db_path=self.db_path)
                self._session_id = None

        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=2.0)
            self._worker_thread = None

    def set_simulation_counts(self, counts: dict[str, float]) -> dict[str, Any] | None:
        """Dynamically update zone counts from interactive simulator and broadcast immediately."""
        with self._lock:
            if self._active_source and hasattr(self._active_source, "set_zone_counts"):
                raw_snap = self._active_source.set_zone_counts(counts)
                if raw_snap:
                    processed_snap = self._process_snapshot(raw_snap)
                    self._latest_snapshot = processed_snap
                    self._publish_snapshot(processed_snap)
                    return processed_snap
            return self._latest_snapshot

    def subscribe(self) -> queue.Queue:
        """Register a new SSE client subscriber queue."""
        q: queue.Queue = queue.Queue(maxsize=30)
        with self._lock:
            self._subscribers.add(q)
            # Send latest snapshot immediately if available
            if self._latest_snapshot:
                q.put(self._latest_snapshot)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        """Remove an SSE client subscriber queue."""
        with self._lock:
            self._subscribers.discard(q)

    def _publish_snapshot(self, snapshot: dict[str, Any]) -> None:
        """Broadcast snapshot to all SSE subscriber queues, dropping oldest if full."""
        with self._lock:
            dead_queues = set()
            for q in self._subscribers:
                try:
                    q.put_nowait(snapshot)
                except queue.Full:
                    try:
                        q.get_nowait()  # Drop oldest frame
                        q.put_nowait(snapshot)
                    except Exception:
                        dead_queues.add(q)
                except Exception:
                    dead_queues.add(q)
            self._subscribers.difference_update(dead_queues)

    def _coordinator_loop(self) -> None:
        """Main 1 Hz coordinator loop: ingest, check alerts, aggregate, publish."""
        while True:
            with self._lock:
                if not self._running:
                    break

                source = self._active_source
                if not source:
                    break

                raw_snap = source.read_snapshot()
                if raw_snap:
                    # Process snapshot and check congestion
                    processed_snap = self._process_snapshot(raw_snap)
                    self._latest_snapshot = processed_snap

                    # Buffer for 5-second persistence aggregation
                    self._agg_buffer.append(processed_snap)

                    # Publish to SSE subscribers
                    self._publish_snapshot(processed_snap)

                # Check if 5-second aggregation window elapsed
                now = time.time()
                if now - self._last_log_time >= 5.0:
                    self._flush_aggregated_logs()
                    self._last_log_time = now

            time.sleep(1.0)

    def _process_snapshot(self, snap: dict[str, Any]) -> dict[str, Any]:
        """Update rolling zone history and evaluate congestion alerts."""
        settings = database.get_settings(db_path=self.db_path)
        cong_threshold_sec = float(settings.get("congestion_seconds", 10))

        zones = snap.get("zones", {})
        now_iso = snap.get("ts", datetime.now(timezone.utc).isoformat())
        now_epoch = time.time()
        is_sim = snap.get("is_simulated", True)

        for zone_name, zdata in zones.items():
            level = zdata.get("level", "Low")
            history = self._zone_history[zone_name]
            history.append((now_epoch, level))

            # Check congestion persistence
            congested = analytics.detect_congestion(list(history), threshold_seconds=cong_threshold_sec)

            if congested and (zone_name not in self._active_alerts):
                # Trigger new congestion episode alert
                msg = f"Sustained High density congestion on {zone_name} approach (> {int(cong_threshold_sec)}s)"
                alert_id = database.insert_alert(
                    ts=now_iso,
                    zone=zone_name,
                    message=msg,
                    is_simulated=is_sim,
                    db_path=self.db_path
                )
                self._active_alerts[zone_name] = alert_id
            elif (not congested) and (zone_name in self._active_alerts):
                # Congestion cleared; resolve the open alert episode
                alert_id = self._active_alerts.pop(zone_name)
                database.resolve_alert(alert_id, resolved_at=now_iso, db_path=self.db_path)

        # Update active_alerts count on snapshot
        snap["active_alerts"] = len(self._active_alerts)
        return snap


    def _flush_aggregated_logs(self) -> None:
        """Aggregate buffered 1 Hz snapshots and write 5-second logs to SQLite."""
        if not self._agg_buffer:
            return

        now_iso = datetime.now(timezone.utc).isoformat()
        sample_count = len(self._agg_buffer)
        source_name = self._mode
        is_sim = any(s.get("is_simulated", True) for s in self._agg_buffer)

        # 1. Aggregate zone occupancy averages
        traffic_rows: list[dict[str, Any]] = []
        for z in ["N", "S", "E", "W"]:
            total_occ = sum(s.get("zones", {}).get(z, {}).get("count", 0) for s in self._agg_buffer)
            avg_occ = round(total_occ / sample_count, 1)
            int_avg = int(round(avg_occ))
            level = analytics.classify_density(int_avg)
            traffic_rows.append({
                "ts": now_iso,
                "source": source_name,
                "is_simulated": is_sim,
                "zone": z,
                "occupancy_avg": avg_occ,
                "density_level": level,
            })
        database.insert_traffic_rows(traffic_rows, db_path=self.db_path)

        # 2. Aggregate line crossing flow counts during the 5-second interval
        total_crossed = sum(s.get("flow", {}).get("crossed_total", 0) for s in self._agg_buffer)
        car_sum = sum(s.get("flow", {}).get("by_type", {}).get("car", 0) for s in self._agg_buffer)
        moto_sum = sum(s.get("flow", {}).get("by_type", {}).get("motorcycle", 0) for s in self._agg_buffer)
        bus_sum = sum(s.get("flow", {}).get("by_type", {}).get("bus", 0) for s in self._agg_buffer)
        truck_sum = sum(s.get("flow", {}).get("by_type", {}).get("truck", 0) for s in self._agg_buffer)

        flow_row = {
            "ts": now_iso,
            "source": source_name,
            "is_simulated": is_sim,
            "crossed": total_crossed,
            "car": car_sum,
            "motorcycle": moto_sum,
            "bus": bus_sum,
            "truck": truck_sum,
        }
        database.insert_flow_row(flow_row, db_path=self.db_path)

        self._agg_buffer.clear()


# Global engine singleton
_engine_instance: TrafficEngine | None = None
_engine_lock = threading.Lock()


def get_engine(db_path: str | None = None) -> TrafficEngine:
    """Get or instantiate the global TrafficEngine singleton."""
    global _engine_instance
    with _engine_lock:
        if _engine_instance is None:
            _engine_instance = TrafficEngine(db_path=db_path)
        elif db_path is not None and _engine_instance.db_path != db_path:
            _engine_instance.db_path = db_path
        return _engine_instance
