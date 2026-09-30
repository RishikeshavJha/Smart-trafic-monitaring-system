"""
tests/test_simulator.py – Unit tests for the synthetic traffic simulator.

Verifies:
  - Generated snapshots match the strict canonical contract.
  - Diurnal curve produces higher counts during peak rush hours than at night.
  - Vehicle type breakdowns are sensible.
  - Output is strictly flagged is_simulated = True.
  - seed_demo_history back-fills 7 days idempotently.
"""

from datetime import datetime, timezone
import pytest
import database
from simulator import TrafficSimulator, seed_demo_history


def test_simulator_snapshot_contract():
    """Verify that every generated snapshot satisfies the exact snapshot contract."""
    sim = TrafficSimulator(speed=1.0, seed=123)
    snapshot = sim.read_snapshot()

    assert snapshot is not None
    assert "ts" in snapshot
    assert snapshot["source"] == "simulation"
    assert snapshot["is_simulated"] is True

    # Zones contract
    zones = snapshot["zones"]
    assert set(zones.keys()) == {"N", "S", "E", "W"}
    for z, zdata in zones.items():
        assert isinstance(zdata["count"], int)
        assert zdata["count"] >= 0
        assert zdata["level"] in ("Low", "Medium", "High")

    # Flow contract
    flow = snapshot["flow"]
    assert isinstance(flow["crossed_total"], int)
    by_type = flow["by_type"]
    assert set(by_type.keys()) == {"car", "motorcycle", "bus", "truck"}
    assert sum(by_type.values()) == flow["crossed_total"]

    # Signal contract
    signal = snapshot["signal"]
    assert signal["driver_zone"] in ("N", "S", "E", "W")
    assert isinstance(signal["suggested_green"], int)
    assert isinstance(signal["fixed_green"], int)
    assert isinstance(signal["est_delay_fixed"], float)
    assert isinstance(signal["est_delay_suggested"], float)
    assert "active_alerts" in snapshot


def test_diurnal_curve_peak_vs_night():
    """Demand at 08:30 rush hour must be significantly higher than at 03:00 at night."""
    sim = TrafficSimulator(speed=1.0, seed=42)

    peak_time = datetime(2026, 9, 30, 8, 30, tzinfo=timezone.utc)
    night_time = datetime(2026, 9, 30, 3, 0, tzinfo=timezone.utc)

    peak_demand = sim._compute_base_demand(peak_time)
    night_demand = sim._compute_base_demand(night_time)

    assert peak_demand > night_demand
    assert peak_demand >= 0.8
    assert night_demand <= 0.25


def test_seed_demo_history_idempotent(tmp_path):
    """Verify 7-day back-filling and idempotency protection."""
    db_file = str(tmp_path / "seed_test.db")

    # First run: seed 7 days
    intervals_seeded = seed_demo_history(days=7, db_path=db_file, force=False)
    assert intervals_seeded > 0

    # Verify rows in database
    traffic_rows = database.query_traffic(limit=10, db_path=db_file)
    assert len(traffic_rows) == 10
    assert all(r["is_simulated"] is True for r in traffic_rows)

    flow_rows = database.query_flow(limit=10, db_path=db_file)
    assert len(flow_rows) == 10
    assert all(r["is_simulated"] is True for r in flow_rows)

    # Second run without force should skip (idempotent)
    second_run = seed_demo_history(days=7, db_path=db_file, force=False)
    assert second_run == 0

    # With force=True it seeds again
    forced_run = seed_demo_history(days=1, db_path=db_file, force=True)
    assert forced_run > 0
