"""
simulator.py – Realistic synthetic traffic generator for the Smart Traffic Monitoring System.

Features:
  - Realistic diurnal rush-hour curve (peaks around 08:30 and 18:00).
  - Directional lane asymmetry (North-South busier in morning, East-West in evening).
  - Realistic vehicle-type distribution (mostly cars & motorcycles, few buses & trucks).
  - Smooth count transitions (random walk with momentum, no wild jumps).
  - Demo clock with adjustable compression speed (default 240x: 24h in 6 real minutes).
  - All output strictly flagged is_simulated = True.
  - seed_demo_history() function for back-filling 7 days of 5-minute data.
"""

import math
import random
import threading
import time
from datetime import datetime, timezone, timedelta
from typing import Any

from config import DEFAULT_SETTINGS
import analytics


class TrafficSimulator:
    """Background simulator producing 1 Hz traffic snapshots according to diurnal patterns."""

    def __init__(self, speed: float = 240.0, seed: int | None = None):
        """Initialize simulator.

        Parameters
        ----------
        speed : float
            Time acceleration factor. 240.0 compresses 24 hours into 6 minutes (360 seconds).
            1.0 corresponds to real-time 1-second-per-second progression.
        seed : int | None
            Random seed for deterministic testing.
        """
        self.speed = float(speed)
        self._rng = random.Random(seed)
        self._running = False
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

        # Simulated clock starts at 07:45 AM today for immediate interesting rush hour
        now = datetime.now(timezone.utc)
        self._sim_time = now.replace(hour=7, minute=45, second=0, microsecond=0)

        # Smoothed vehicle counts per zone to ensure continuous, non-jumpy trajectories
        self._zone_counts = {"N": 6.0, "S": 7.0, "E": 4.0, "W": 4.0}
        self._latest_snapshot: dict[str, Any] | None = None
        self._generate_snapshot()  # Generate initial frame immediately

    def start(self) -> None:
        """Start the background simulator generation thread."""
        with self._lock:
            if self._running:
                return
            self._running = True
            self._thread = threading.Thread(target=self._run_loop, name="TrafficSimulatorThread", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        """Stop the background simulator thread."""
        with self._lock:
            self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
            self._thread = None

    def read_snapshot(self) -> dict[str, Any] | None:
        """Return the most recently generated snapshot."""
        with self._lock:
            return self._latest_snapshot

    def _run_loop(self) -> None:
        """Background 1 Hz simulation loop."""
        while True:
            with self._lock:
                if not self._running:
                    break
                self._tick()
                self._generate_snapshot()
            time.sleep(1.0)

    def _tick(self) -> None:
        """Advance the simulated clock by self.speed seconds."""
        self._sim_time += timedelta(seconds=self.speed)

    def _compute_base_demand(self, sim_dt: datetime) -> float:
        """Calculate diurnal traffic demand multiplier between 0.08 (night) and 1.0 (peak)."""
        hour_float = sim_dt.hour + (sim_dt.minute / 60.0) + (sim_dt.second / 3600.0)

        # Morning peak centered at 08:30 (std dev ~ 1.2 hours)
        morning_peak = math.exp(-0.5 * ((hour_float - 8.5) / 1.2) ** 2)

        # Evening peak centered at 18:00 (std dev ~ 1.5 hours)
        evening_peak = math.exp(-0.5 * ((hour_float - 18.0) / 1.5) ** 2)

        # Base demand across time-of-day
        if hour_float < 5.5 or hour_float > 22.5:
            base = 0.08
        elif 9.5 <= hour_float <= 16.5:
            base = 0.40
        else:
            base = 0.20

        raw_demand = base + (0.65 * morning_peak) + (0.65 * evening_peak)
        return min(1.0, max(0.08, raw_demand))


    def _generate_snapshot(self) -> dict[str, Any]:
        """Generate one snapshot matching the canonical system contract."""
        demand = self._compute_base_demand(self._sim_time)
        hour_float = self._sim_time.hour + (self._sim_time.minute / 60.0)

        # Directional weights based on time of day
        # Morning inbound: North & South busier
        # Evening outbound: East & West busier
        if 6.0 <= hour_float <= 12.0:
            zone_weights = {"N": 1.25, "S": 1.15, "E": 0.85, "W": 0.75}
        elif 15.0 <= hour_float <= 21.0:
            zone_weights = {"N": 0.85, "S": 0.80, "E": 1.25, "W": 1.20}
        else:
            zone_weights = {"N": 1.0, "S": 1.0, "E": 1.0, "W": 1.0}

        zones_data: dict[str, dict[str, Any]] = {}
        max_zone = "N"
        max_count = -1

        # Smooth evolution of queue counts
        for z in ["N", "S", "E", "W"]:
            target = 18.0 * demand * zone_weights[z]
            noise = self._rng.uniform(-1.2, 1.2)
            # Smooth momentum update
            current = self._zone_counts[z]
            new_val = max(0.0, current + 0.25 * (target - current) + noise)
            self._zone_counts[z] = new_val
            int_count = int(round(new_val))

            density_level = analytics.classify_density(
                int_count,
                DEFAULT_SETTINGS["density_low"],
                DEFAULT_SETTINGS["density_high"]
            )
            zones_data[z] = {
                "count": int_count,
                "level": density_level
            }

            if int_count > max_count:
                max_count = int_count
                max_zone = z

        # Realistic vehicle type breakdown for line crossing flow during 1-sec step
        # Crossing flow proportional to overall junction activity
        crossed_prob = min(0.9, demand * 0.8 + 0.1)
        num_crossed = self._rng.randint(0, 3) if self._rng.random() < crossed_prob else 0

        car_count = 0
        moto_count = 0
        bus_count = 0
        truck_count = 0

        for _ in range(num_crossed):
            r = self._rng.random()
            if r < 0.65:
                car_count += 1
            elif r < 0.88:
                moto_count += 1
            elif r < 0.95:
                bus_count += 1
            else:
                truck_count += 1

        flow_data = {
            "crossed_total": num_crossed,
            "by_type": {
                "car": car_count,
                "motorcycle": moto_count,
                "bus": bus_count,
                "truck": truck_count,
            }
        }

        # Signal timing recommendation based on the driver (busiest) zone
        sug_green = analytics.suggest_green(
            max_count,
            base=DEFAULT_SETTINGS["base_green"],
            k=DEFAULT_SETTINGS["k"],
            min_g=DEFAULT_SETTINGS["min_green"],
            max_g=DEFAULT_SETTINGS["max_green"]
        )
        fixed_g = DEFAULT_SETTINGS["fixed_green"]
        other_phase = DEFAULT_SETTINGS["other_phase_seconds"]

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

        snapshot = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "source": "simulation",
            "is_simulated": True,
            "zones": zones_data,
            "flow": flow_data,
            "signal": signal_data,
            "active_alerts": 0,  # Engine calculates and populates active_alerts
        }

        self._latest_snapshot = snapshot
        return snapshot


def seed_demo_history(days: int = 7, db_path: str | None = None, force: bool = False) -> int:
    """Back-fill 7 days of 5-minute resolution synthetic traffic and flow history.

    Parameters
    ----------
    days : int
        Number of past days of history to generate.
    db_path : str | None
        Target SQLite database path.
    force : bool
        If True, insert data even if traffic_log already contains records.

    Returns
    -------
    int
        Total number of 5-minute traffic intervals written.
    """
    import database

    # Migration check / ensure tables exist
    database.init_db(db_path)

    if not force:
        existing = database.query_traffic(limit=1, db_path=db_path)
        if existing:
            return 0  # Already seeded; skip

    rng = random.Random(42)
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=days)

    interval_minutes = 5
    current_time = start_time

    traffic_batch: list[dict[str, Any]] = []
    total_intervals = 0

    while current_time <= end_time:
        iso_ts = current_time.isoformat()
        hour_float = current_time.hour + (current_time.minute / 60.0)

        # Diurnal rush-hour curve
        morning_peak = math.exp(-0.5 * ((hour_float - 8.5) / 1.2) ** 2)
        evening_peak = math.exp(-0.5 * ((hour_float - 18.0) / 1.5) ** 2)
        midday_base = 0.40 if (9.5 <= hour_float <= 16.5) else 0.20
        night_base = 0.08 if (hour_float < 5.5 or hour_float > 22.5) else 0.15
        demand = max(night_base, midday_base + (0.55 * morning_peak) + (0.60 * evening_peak))

        # Weekend reduction (Saturday=5, Sunday=6)
        if current_time.weekday() in (5, 6):
            demand *= 0.70

        # Zone occupancies
        for zone, weight in [("N", 1.1), ("S", 1.05), ("E", 0.95), ("W", 0.9)]:
            occ = max(0.5, (16.0 * demand * weight) + rng.uniform(-1.5, 1.5))
            occ_rounded = round(occ, 1)
            level = analytics.classify_density(
                int(round(occ_rounded)),
                DEFAULT_SETTINGS["density_low"],
                DEFAULT_SETTINGS["density_high"]
            )
            traffic_batch.append({
                "ts": iso_ts,
                "source": "simulation",
                "is_simulated": True,
                "zone": zone,
                "occupancy_avg": occ_rounded,
                "density_level": level,
            })

        # Flow crossings in 5-minute window
        total_crossings = int(max(0, (demand * 45.0) + rng.randint(-5, 8)))
        car_c = int(total_crossings * rng.uniform(0.60, 0.70))
        moto_c = int((total_crossings - car_c) * rng.uniform(0.60, 0.80))
        rem = max(0, total_crossings - car_c - moto_c)
        bus_c = int(rem * 0.6)
        truck_c = max(0, rem - bus_c)

        flow_row = {
            "ts": iso_ts,
            "source": "simulation",
            "is_simulated": True,
            "crossed": total_crossings,
            "car": car_c,
            "motorcycle": moto_c,
            "bus": bus_c,
            "truck": truck_c,
        }
        database.insert_flow_row(flow_row, db_path=db_path)

        total_intervals += 1
        current_time += timedelta(minutes=interval_minutes)

        # Batch insert traffic logs in chunks of 500
        if len(traffic_batch) >= 500:
            database.insert_traffic_rows(traffic_batch, db_path=db_path)
            traffic_batch.clear()

    if traffic_batch:
        database.insert_traffic_rows(traffic_batch, db_path=db_path)

    return total_intervals
