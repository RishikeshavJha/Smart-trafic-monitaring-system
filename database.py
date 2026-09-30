"""
database.py – SQLite database helpers for the Smart Traffic Monitoring System.

Principles:
  - Parameterised queries ONLY (sqlite3 ? placeholders). Never string-build SQL.
  - Thread-safety: open a connection per operation/thread; never share across threads.
  - Pragmas: Enable WAL mode and 5000ms busy timeout on every connection.
  - Idempotent migration guard: init_db() creates tables if missing without wiping data.
  - Settings values stored as JSON strings.
  - Streaming CSV generator includes is_simulated column.
"""

import csv
import io
import json
import sqlite3
from typing import Any, Generator
from flask import current_app, has_app_context
from config import DEFAULT_SETTINGS, Config


def get_db_path(db_path: str | None = None) -> str:
    """Resolve database path from argument, Flask current_app config, or default Config."""
    if db_path is not None:
        return db_path
    if has_app_context():
        return current_app.config.get("DATABASE_PATH", Config.DATABASE_PATH)
    return Config.DATABASE_PATH


def get_connection(db_path: str | None = None) -> sqlite3.Connection:
    """Create and configure a new sqlite3 connection for the calling thread."""
    path = get_db_path(db_path)
    conn = sqlite3.connect(path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    # Enable WAL mode and busy timeout (unless using in-memory SQLite)
    if path != ":memory:":
        conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db(db_path: str | None = None) -> None:
    """Create database tables and indexes idempotently if they do not exist."""
    conn = get_connection(db_path)
    with conn:
        conn.executescript("""
            -- Settings key-value store (values stored as JSON text)
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- 5-second aggregated zone occupancy logs
            CREATE TABLE IF NOT EXISTS traffic_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                source TEXT NOT NULL,
                is_simulated INTEGER NOT NULL,
                zone TEXT NOT NULL CHECK (zone IN ('N', 'S', 'E', 'W')),
                occupancy_avg REAL NOT NULL,
                density_level TEXT NOT NULL CHECK (density_level IN ('Low', 'Medium', 'High'))
            );

            -- 5-second interval line crossing flow logs
            CREATE TABLE IF NOT EXISTS flow_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                source TEXT NOT NULL,
                is_simulated INTEGER NOT NULL,
                crossed INTEGER NOT NULL,
                car INTEGER NOT NULL,
                motorcycle INTEGER NOT NULL,
                bus INTEGER NOT NULL,
                truck INTEGER NOT NULL
            );

            -- Congestion alerts
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                zone TEXT NOT NULL,
                message TEXT NOT NULL,
                is_simulated INTEGER NOT NULL,
                resolved_at TEXT NULL
            );

            -- Monitoring sessions
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT NULL
            );

            -- Timestamp & lookup indexes
            CREATE INDEX IF NOT EXISTS idx_traffic_log_ts ON traffic_log(ts);
            CREATE INDEX IF NOT EXISTS idx_traffic_log_zone ON traffic_log(zone);
            CREATE INDEX IF NOT EXISTS idx_flow_log_ts ON flow_log(ts);
            CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);
            CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved_at);
            CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
        """)

        # Ensure default settings are populated if table is empty
        cur = conn.execute("SELECT COUNT(*) FROM settings;")
        if cur.fetchone()[0] == 0:
            for k, v in DEFAULT_SETTINGS.items():
                conn.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?);",
                    (k, json.dumps(v))
                )
    conn.close()


def insert_traffic_rows(rows: list[dict[str, Any]], db_path: str | None = None) -> None:
    """Insert batch of 5-second zone traffic log rows."""
    if not rows:
        return
    conn = get_connection(db_path)
    with conn:
        conn.executemany(
            """
            INSERT INTO traffic_log (ts, source, is_simulated, zone, occupancy_avg, density_level)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            [
                (
                    r["ts"],
                    r["source"],
                    1 if r.get("is_simulated", False) else 0,
                    r["zone"],
                    float(r["occupancy_avg"]),
                    r["density_level"],
                )
                for r in rows
            ]
        )
    conn.close()


def insert_flow_row(row: dict[str, Any], db_path: str | None = None) -> int:
    """Insert a single 5-second vehicle crossing flow log row and return its ID."""
    conn = get_connection(db_path)
    with conn:
        cur = conn.execute(
            """
            INSERT INTO flow_log (ts, source, is_simulated, crossed, car, motorcycle, bus, truck)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (
                row["ts"],
                row["source"],
                1 if row.get("is_simulated", False) else 0,
                int(row.get("crossed", 0)),
                int(row.get("car", 0)),
                int(row.get("motorcycle", 0)),
                int(row.get("bus", 0)),
                int(row.get("truck", 0)),
            )
        )
        row_id = cur.lastrowid
    conn.close()
    return row_id


def insert_alert(ts: str, zone: str, message: str, is_simulated: bool, db_path: str | None = None) -> int:
    """Insert a new congestion alert and return its ID."""
    conn = get_connection(db_path)
    with conn:
        cur = conn.execute(
            """
            INSERT INTO alerts (ts, zone, message, is_simulated, resolved_at)
            VALUES (?, ?, ?, ?, NULL);
            """,
            (ts, zone, message, 1 if is_simulated else 0)
        )
        alert_id = cur.lastrowid
    conn.close()
    return alert_id


def resolve_alert(alert_id: int, resolved_at: str, db_path: str | None = None) -> None:
    """Mark an active alert as resolved at the given ISO timestamp."""
    conn = get_connection(db_path)
    with conn:
        conn.execute(
            """
            UPDATE alerts
            SET resolved_at = ?
            WHERE id = ? AND resolved_at IS NULL;
            """,
            (resolved_at, alert_id)
        )
    conn.close()


def resolve_active_alerts_for_zone(zone: str, resolved_at: str, db_path: str | None = None) -> int:
    """Resolve any open alerts for a specific approach zone. Returns count of resolved alerts."""
    conn = get_connection(db_path)
    with conn:
        cur = conn.execute(
            """
            UPDATE alerts
            SET resolved_at = ?
            WHERE zone = ? AND resolved_at IS NULL;
            """,
            (resolved_at, zone)
        )
        count = cur.rowcount
    conn.close()
    return count


def start_session(source: str, started_at: str, db_path: str | None = None) -> int:
    """Record the start of a monitoring session. Returns the session ID."""
    conn = get_connection(db_path)
    with conn:
        cur = conn.execute(
            "INSERT INTO sessions (source, started_at, ended_at) VALUES (?, ?, NULL);",
            (source, started_at)
        )
        session_id = cur.lastrowid
    conn.close()
    return session_id


def end_session(session_id: int, ended_at: str, db_path: str | None = None) -> None:
    """Record the conclusion of a monitoring session."""
    conn = get_connection(db_path)
    with conn:
        conn.execute(
            "UPDATE sessions SET ended_at = ? WHERE id = ?;",
            (ended_at, session_id)
        )
    conn.close()


def query_traffic(
    start_ts: str | None = None,
    end_ts: str | None = None,
    zone: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db_path: str | None = None
) -> list[dict[str, Any]]:
    """Query historical traffic log rows with optional time range and zone filters."""
    conn = get_connection(db_path)
    conditions = []
    params: list[Any] = []

    if start_ts:
        conditions.append("ts >= ?")
        params.append(start_ts)
    if end_ts:
        conditions.append("ts <= ?")
        params.append(end_ts)
    if zone:
        conditions.append("zone = ?")
        params.append(zone)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, ts, source, is_simulated, zone, occupancy_avg, density_level
        FROM traffic_log
        {where_clause}
        ORDER BY ts DESC
        LIMIT ? OFFSET ?;
    """
    params.extend([limit, offset])

    cur = conn.execute(sql, params)
    rows = [
        {
            "id": r["id"],
            "ts": r["ts"],
            "source": r["source"],
            "is_simulated": bool(r["is_simulated"]),
            "zone": r["zone"],
            "occupancy_avg": r["occupancy_avg"],
            "density_level": r["density_level"],
        }
        for r in cur.fetchall()
    ]
    conn.close()
    return rows


def query_flow(
    start_ts: str | None = None,
    end_ts: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db_path: str | None = None
) -> list[dict[str, Any]]:
    """Query historical vehicle crossing flow logs."""
    conn = get_connection(db_path)
    conditions = []
    params: list[Any] = []

    if start_ts:
        conditions.append("ts >= ?")
        params.append(start_ts)
    if end_ts:
        conditions.append("ts <= ?")
        params.append(end_ts)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT id, ts, source, is_simulated, crossed, car, motorcycle, bus, truck
        FROM flow_log
        {where_clause}
        ORDER BY ts DESC
        LIMIT ? OFFSET ?;
    """
    params.extend([limit, offset])

    cur = conn.execute(sql, params)
    rows = [
        {
            "id": r["id"],
            "ts": r["ts"],
            "source": r["source"],
            "is_simulated": bool(r["is_simulated"]),
            "crossed": r["crossed"],
            "car": r["car"],
            "motorcycle": r["motorcycle"],
            "bus": r["bus"],
            "truck": r["truck"],
        }
        for r in cur.fetchall()
    ]
    conn.close()
    return rows


def query_alerts(
    active_only: bool = False,
    limit: int = 50,
    db_path: str | None = None
) -> list[dict[str, Any]]:
    """Query alerts, optionally filtering for unresolved active alerts."""
    conn = get_connection(db_path)
    where_clause = "WHERE resolved_at IS NULL" if active_only else ""
    sql = f"""
        SELECT id, ts, zone, message, is_simulated, resolved_at
        FROM alerts
        {where_clause}
        ORDER BY ts DESC
        LIMIT ?;
    """
    cur = conn.execute(sql, (limit,))
    rows = [
        {
            "id": r["id"],
            "ts": r["ts"],
            "zone": r["zone"],
            "message": r["message"],
            "is_simulated": bool(r["is_simulated"]),
            "resolved_at": r["resolved_at"],
        }
        for r in cur.fetchall()
    ]
    conn.close()
    return rows


def get_settings(db_path: str | None = None) -> dict[str, Any]:
    """Retrieve all configuration settings as a parsed Python dictionary."""
    init_db(db_path)
    conn = get_connection(db_path)
    cur = conn.execute("SELECT key, value FROM settings;")
    settings = DEFAULT_SETTINGS.copy()
    for row in cur.fetchall():
        try:
            settings[row["key"]] = json.loads(row["value"])
        except Exception:
            settings[row["key"]] = row["value"]
    conn.close()
    return settings



def save_settings(settings_dict: dict[str, Any], db_path: str | None = None) -> None:
    """Save or update configuration settings into the settings table."""
    conn = get_connection(db_path)
    with conn:
        for k, v in settings_dict.items():
            conn.execute(
                """
                INSERT INTO settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value;
                """,
                (k, json.dumps(v))
            )
    conn.close()


def export_csv_rows(
    table: str = "traffic_log",
    start_ts: str | None = None,
    end_ts: str | None = None,
    db_path: str | None = None
) -> Generator[str, None, None]:
    """Streaming generator yielding formatted CSV text rows including is_simulated column."""
    conn = get_connection(db_path)

    conditions = []
    params: list[Any] = []
    if start_ts:
        conditions.append("ts >= ?")
        params.append(start_ts)
    if end_ts:
        conditions.append("ts <= ?")
        params.append(end_ts)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    if table == "traffic_log":
        sql = f"""
            SELECT ts, source, is_simulated, zone, occupancy_avg, density_level
            FROM traffic_log
            {where_clause}
            ORDER BY ts ASC;
        """
        headers = ["timestamp", "source", "is_simulated", "zone", "occupancy_avg", "density_level"]
    elif table == "flow_log":
        sql = f"""
            SELECT ts, source, is_simulated, crossed, car, motorcycle, bus, truck
            FROM flow_log
            {where_clause}
            ORDER BY ts ASC;
        """
        headers = ["timestamp", "source", "is_simulated", "crossed", "car", "motorcycle", "bus", "truck"]
    elif table == "alerts":
        sql = f"""
            SELECT ts, zone, message, is_simulated, resolved_at
            FROM alerts
            {where_clause}
            ORDER BY ts ASC;
        """
        headers = ["timestamp", "zone", "message", "is_simulated", "resolved_at"]
    else:
        conn.close()
        raise ValueError(f"Unsupported export table: {table}")

    # Yield header
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(headers)
    yield out.getvalue()

    cur = conn.execute(sql, params)
    while True:
        chunk = cur.fetchmany(100)
        if not chunk:
            break
        out = io.StringIO()
        writer = csv.writer(out)
        for row in chunk:
            writer.writerow(list(row))
        yield out.getvalue()

    conn.close()
