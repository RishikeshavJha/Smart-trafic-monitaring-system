"""
tests/test_database.py – Unit tests for SQLite database operations and helpers.

Verifies:
  - Table creation and startup migration idempotency.
  - CRUD operations for traffic logs, flow logs, alerts, and sessions.
  - Filtering and pagination in range queries.
  - Settings key-value JSON storage round-trip.
  - Streaming CSV export with is_simulated column.
"""

import os
import pytest
import database
from config import DEFAULT_SETTINGS


@pytest.fixture
def temp_db(tmp_path):
    """Provide a temporary SQLite database file path."""
    db_file = str(tmp_path / "test_traffic.db")
    database.init_db(db_file)
    return db_file


def test_init_db_creates_tables_and_is_idempotent(temp_db):
    """Running init_db multiple times must not crash or wipe existing records."""
    # Insert a test setting
    database.save_settings({"test_key": "test_val"}, db_path=temp_db)

    # Re-run init_db (migration guard check)
    database.init_db(temp_db)

    settings = database.get_settings(db_path=temp_db)
    assert settings["test_key"] == "test_val"


def test_traffic_log_insert_and_query(temp_db):
    """Verify inserting and querying 5-second traffic log batches."""
    rows = [
        {
            "ts": "2026-09-30T08:00:00+00:00",
            "source": "simulation",
            "is_simulated": True,
            "zone": "N",
            "occupancy_avg": 14.2,
            "density_level": "High",
        },
        {
            "ts": "2026-09-30T08:00:00+00:00",
            "source": "simulation",
            "is_simulated": True,
            "zone": "S",
            "occupancy_avg": 7.0,
            "density_level": "Medium",
        },
        {
            "ts": "2026-09-30T08:00:05+00:00",
            "source": "simulation",
            "is_simulated": True,
            "zone": "N",
            "occupancy_avg": 3.5,
            "density_level": "Low",
        },
    ]
    database.insert_traffic_rows(rows, db_path=temp_db)

    # Query all
    all_res = database.query_traffic(db_path=temp_db)
    assert len(all_res) == 3

    # Filter by zone
    n_res = database.query_traffic(zone="N", db_path=temp_db)
    assert len(n_res) == 2
    assert all(r["zone"] == "N" for r in n_res)

    # Filter by time range
    time_res = database.query_traffic(
        start_ts="2026-09-30T08:00:05+00:00",
        end_ts="2026-09-30T08:00:10+00:00",
        db_path=temp_db
    )
    assert len(time_res) == 1
    assert time_res[0]["density_level"] == "Low"


def test_flow_log_insert_and_query(temp_db):
    """Verify inserting and querying vehicle crossing flow log rows."""
    flow_row = {
        "ts": "2026-09-30T08:00:00+00:00",
        "source": "simulation",
        "is_simulated": True,
        "crossed": 6,
        "car": 4,
        "motorcycle": 1,
        "bus": 1,
        "truck": 0,
    }
    row_id = database.insert_flow_row(flow_row, db_path=temp_db)
    assert row_id > 0

    results = database.query_flow(db_path=temp_db)
    assert len(results) == 1
    r = results[0]
    assert r["crossed"] == 6
    assert r["car"] == 4
    assert r["is_simulated"] is True


def test_alerts_lifecycle(temp_db):
    """Verify creating, querying, and resolving congestion alerts."""
    alert_id = database.insert_alert(
        ts="2026-09-30T08:30:00+00:00",
        zone="N",
        message="Sustained High density congestion on N approach",
        is_simulated=True,
        db_path=temp_db
    )
    assert alert_id > 0

    # Query active
    active = database.query_alerts(active_only=True, db_path=temp_db)
    assert len(active) == 1
    assert active[0]["zone"] == "N"
    assert active[0]["resolved_at"] is None

    # Resolve alert
    database.resolve_alert(alert_id, resolved_at="2026-09-30T08:32:00+00:00", db_path=temp_db)

    active_after = database.query_alerts(active_only=True, db_path=temp_db)
    assert len(active_after) == 0

    all_alerts = database.query_alerts(active_only=False, db_path=temp_db)
    assert len(all_alerts) == 1
    assert all_alerts[0]["resolved_at"] == "2026-09-30T08:32:00+00:00"


def test_session_lifecycle(temp_db):
    """Verify recording monitoring session start and end."""
    sess_id = database.start_session("simulation", "2026-09-30T08:00:00+00:00", db_path=temp_db)
    assert sess_id > 0

    database.end_session(sess_id, "2026-09-30T08:15:00+00:00", db_path=temp_db)

    conn = database.get_connection(temp_db)
    cur = conn.execute("SELECT started_at, ended_at FROM sessions WHERE id = ?;", (sess_id,))
    row = cur.fetchone()
    conn.close()

    assert row["started_at"] == "2026-09-30T08:00:00+00:00"
    assert row["ended_at"] == "2026-09-30T08:15:00+00:00"


def test_settings_round_trip(temp_db):
    """Verify settings dictionary save and load with default fallbacks."""
    defaults = database.get_settings(db_path=temp_db)
    assert defaults["density_low"] == 5
    assert defaults["density_high"] == 12

    # Update settings
    custom = {"density_low": 4, "k": 2.0, "custom_zone_label": "Downtown"}
    database.save_settings(custom, db_path=temp_db)

    reloaded = database.get_settings(db_path=temp_db)
    assert reloaded["density_low"] == 4
    assert reloaded["k"] == 2.0
    assert reloaded["custom_zone_label"] == "Downtown"
    # Existing untouched keys remain
    assert reloaded["density_high"] == 12


def test_export_csv_rows_includes_is_simulated(temp_db):
    """CSV streaming export must include is_simulated column."""
    database.insert_traffic_rows(
        [
            {
                "ts": "2026-09-30T08:00:00+00:00",
                "source": "simulation",
                "is_simulated": True,
                "zone": "W",
                "occupancy_avg": 9.5,
                "density_level": "Medium",
            }
        ],
        db_path=temp_db
    )

    csv_output = "".join(database.export_csv_rows(table="traffic_log", db_path=temp_db))
    lines = csv_output.strip().splitlines()

    assert len(lines) == 2
    header = lines[0].split(",")
    data_row = lines[1].split(",")

    assert "is_simulated" in header
    sim_idx = header.index("is_simulated")
    assert data_row[sim_idx] == "1"
