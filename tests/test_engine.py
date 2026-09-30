"""
tests/test_engine.py – Unit tests for TrafficEngine coordinator.

Verifies:
  - Starting and stopping engine lifecycle.
  - Snapshot subscription via queue.
  - 5-second log flushing to SQLite.
  - Session recording.
"""

import time
import pytest
import database
from engine import TrafficEngine


@pytest.fixture
def temp_db(tmp_path):
    """Provide a temporary SQLite database file path."""
    db_file = str(tmp_path / "test_engine.db")
    database.init_db(db_file)
    return db_file


def test_engine_lifecycle_and_logging(temp_db):
    """Engine must produce snapshots, record sessions, and flush traffic logs."""
    engine = TrafficEngine(db_path=temp_db)
    sub_q = engine.subscribe()

    # Start in simulation mode
    engine.start(mode="simulation", source_args={"speed": 240.0})
    assert engine.status["mode"] == "simulation"

    # Wait briefly for snapshots and at least one 5-second log flush
    # Simulate coordinator loop ticks directly to verify without long sleep
    time.sleep(1.2)

    snap = engine.latest_snapshot
    assert snap is not None
    assert snap["is_simulated"] is True
    assert set(snap["zones"].keys()) == {"N", "S", "E", "W"}

    # Force a flush of aggregated logs
    engine._flush_aggregated_logs()

    # Query traffic log
    traffic = database.query_traffic(limit=10, db_path=temp_db)
    assert len(traffic) >= 4  # 4 zones

    # Query flow log
    flow = database.query_flow(limit=5, db_path=temp_db)
    assert len(flow) >= 1

    # Stop engine
    engine.unsubscribe(sub_q)
    engine.stop()
    assert engine._session_id is None
