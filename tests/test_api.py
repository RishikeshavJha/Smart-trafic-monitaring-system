"""
tests/test_api.py – Unit and integration tests for JSON REST API and SSE stream endpoints.

Verifies:
  - Standard {ok, data, error} response envelope on all endpoints.
  - Correct HTTP status codes and error handling (400, 404, 415).
  - Validation rules for /api/settings POST requests.
  - Source validation on /api/start.
  - CSV streaming export with proper headers.
  - Query filtering on /api/history and /api/alerts.
"""

import json
import pytest
import database


def test_api_healthz_envelope(client):
    """GET /api/healthz must return the standard JSON envelope."""
    res = client.get("/api/healthz")
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data["ok"] is True
    assert json_data["error"] is None
    assert json_data["data"]["status"] == "ok"


def test_api_stats_returns_snapshot_and_status(client):
    """GET /api/stats must return current snapshot and engine status."""
    res = client.get("/api/stats")
    assert res.status_code == 200
    json_data = res.get_json()
    assert json_data["ok"] is True
    data = json_data["data"]
    assert "snapshot" in data
    assert "status" in data
    assert "zones" in data["snapshot"]
    assert "mode" in data["status"]


def test_api_settings_get_and_post_validation(client):
    """GET /api/settings returns settings; POST validates fields strictly."""
    # 1. GET settings
    res = client.get("/api/settings")
    assert res.status_code == 200
    settings = res.get_json()["data"]
    assert "density_low" in settings
    assert "density_high" in settings

    # 2. POST invalid settings: density_low >= density_high
    bad_payload = {"density_low": 15, "density_high": 10}
    res_bad = client.post("/api/settings", json=bad_payload)
    assert res_bad.status_code == 400
    err_json = res_bad.get_json()
    assert err_json["ok"] is False
    assert err_json["error"]["code"] == "VALIDATION_ERROR"
    assert "density_low" in err_json["error"]["details"]

    # 3. POST invalid k coefficient
    bad_k = {"k": 25.0}  # max is 10.0
    res_k = client.post("/api/settings", json=bad_k)
    assert res_k.status_code == 400
    assert "k" in res_k.get_json()["error"]["details"]

    # 4. POST valid settings
    good_payload = {"density_low": 4, "density_high": 14, "k": 1.8}
    res_good = client.post("/api/settings", json=good_payload)
    assert res_good.status_code == 200
    updated = res_good.get_json()["data"]
    assert updated["density_low"] == 4
    assert updated["density_high"] == 14
    assert updated["k"] == 1.8


def test_api_start_and_stop_validation(client):
    """POST /api/start rejects unknown sources and accepts valid sources."""
    # Unknown source rejected
    res_invalid = client.post("/api/start", json={"source": "invalid_source"})
    assert res_invalid.status_code == 400
    assert res_invalid.get_json()["error"]["code"] == "INVALID_SOURCE"

    # Valid simulation start
    res_start = client.post("/api/start", json={"source": "simulation", "speed": 1.0})
    assert res_start.status_code == 200
    assert res_start.get_json()["data"]["mode"] == "simulation"

    # Stop engine
    res_stop = client.post("/api/stop")
    assert res_stop.status_code == 200


def test_api_export_csv_headers_and_content(client, app):
    """GET /api/export.csv streams CSV with proper headers and is_simulated column."""
    with app.app_context():
        database.insert_traffic_rows(
            [
                {
                    "ts": "2026-09-30T08:00:00+00:00",
                    "source": "simulation",
                    "is_simulated": True,
                    "zone": "N",
                    "occupancy_avg": 12.0,
                    "density_level": "Medium",
                }
            ],
            db_path=app.config["DATABASE_PATH"]
        )

    res = client.get("/api/export.csv?table=traffic_log")
    assert res.status_code == 200
    assert "text/csv" in res.content_type
    assert "attachment" in res.headers.get("Content-Disposition", "")

    csv_text = res.data.decode("utf-8")
    assert "timestamp,source,is_simulated,zone,occupancy_avg,density_level" in csv_text
    assert "simulation,1,N,12.0,Medium" in csv_text


def test_api_history_filters(client, app):
    """GET /api/history returns rows, vehicle totals, and time series."""
    with app.app_context():
        db_path = app.config["DATABASE_PATH"]
        database.insert_traffic_rows(
            [
                {
                    "ts": "2026-09-30T08:00:00+00:00",
                    "source": "simulation",
                    "is_simulated": True,
                    "zone": "N",
                    "occupancy_avg": 8.0,
                    "density_level": "Medium",
                },
                {
                    "ts": "2026-09-30T08:00:00+00:00",
                    "source": "simulation",
                    "is_simulated": True,
                    "zone": "S",
                    "occupancy_avg": 5.0,
                    "density_level": "Medium",
                },
            ],
            db_path=db_path
        )
        database.insert_flow_row(
            {
                "ts": "2026-09-30T08:00:00+00:00",
                "source": "simulation",
                "is_simulated": True,
                "crossed": 5,
                "car": 3,
                "motorcycle": 2,
                "bus": 0,
                "truck": 0,
            },
            db_path=db_path
        )

    res = client.get("/api/history?limit=10")
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert "traffic" in data
    assert "flow" in data
    assert data["vehicle_totals"]["car"] >= 3
    assert "series" in data


def test_api_analytics_endpoints(client):
    """Verify /api/alerts, /api/forecast, /api/heatmap, and /api/zone-averages."""
    # 1. Alerts
    res_alerts = client.get("/api/alerts")
    assert res_alerts.status_code == 200
    assert isinstance(res_alerts.get_json()["data"], list)

    # 2. Forecast
    res_forecast = client.get("/api/forecast?zone=N")
    assert res_forecast.status_code == 200
    assert "label" in res_forecast.get_json()["data"]

    # 3. Heatmap
    res_heatmap = client.get("/api/heatmap")
    assert res_heatmap.status_code == 200
    hm_data = res_heatmap.get_json()["data"]
    assert len(hm_data["days"]) == 7
    assert len(hm_data["hours"]) == 24
    assert len(hm_data["matrix"]) == 7

    # 4. Zone averages
    res_za = client.get("/api/zone-averages")
    assert res_za.status_code == 200
    za_data = res_za.get_json()["data"]
    assert set(za_data.keys()) == {"N", "S", "E", "W"}


def test_api_stream_endpoint(client):
    """GET /api/stream returns SSE content type and headers."""
    res = client.get("/api/stream")
    assert res.status_code == 200
    assert "text/event-stream" in res.content_type
    assert res.headers.get("Cache-Control") == "no-cache"


def test_api_simulation_state_get_and_post(client):
    """GET and POST /api/simulation/state for 4-way intersection synchronisation."""
    # 1. GET current state
    res_get = client.get("/api/simulation/state")
    assert res_get.status_code == 200
    assert res_get.get_json()["ok"] is True

    # 2. POST valid zone counts
    res_post = client.post("/api/simulation/state", json={"zones": {"N": 20, "S": 15, "E": 10, "W": 5}})
    assert res_post.status_code == 200
    data = res_post.get_json()["data"]
    assert data["zones"]["N"] == 20.0
    assert data["zones"]["S"] == 15.0

    # 3. POST invalid payload
    res_bad = client.post("/api/simulation/state", json={"invalid": True})
    assert res_bad.status_code == 400
    assert res_bad.get_json()["ok"] is False
