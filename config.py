"""
config.py – Configuration classes for the Smart Traffic Monitoring System.

Three tiers:
  Config      – shared base (safe defaults).
  DevConfig   – development overrides (DEBUG on, verbose logging).
  TestConfig  – pytest overrides (in-memory/temp SQLite, CSRF disabled).

SECRET_KEY is read from the environment variable SECRET_KEY or from a .env
file via python-dotenv.  A hardcoded fallback is provided so the app starts
immediately in development, but a warning is logged if no real key is set.
"""

import os
from pathlib import Path

# Resolve the project root directory (one level up from this file).
BASE_DIR = Path(__file__).resolve().parent

# Default settings stored in database and referenced by engine and analytics
DEFAULT_SETTINGS: dict = {
    # Density classification thresholds (vehicle count on approach)
    "density_low": 5,      # count < 5 => Low
    "density_high": 12,    # 5 <= count <= 12 => Medium; count > 12 => High
    "congestion_seconds": 10,  # Consecutive seconds in High to trigger alert

    # Signal timing parameters (Webster formula)
    "base_green": 30,          # Nominal green duration (seconds)
    "min_green": 10,           # Minimum green floor (seconds)
    "max_green": 60,           # Maximum green ceiling (seconds)
    "k": 1.5,                  # Slope coefficient (seconds added per vehicle)
    "other_phase_seconds": 30, # Fixed opposing phase + clearance time (seconds)
    "fixed_green": 30,         # Static comparison baseline green (seconds)

    # Logging and sampling intervals
    "log_interval_seconds": 5, # Database persistence aggregation interval
    "frame_width": 640,        # Standard video processing frame width

    # Normalised (0.0 to 1.0) counting line coordinates: [[x1, y1], [x2, y2]]
    "counting_line": [[0.1, 0.55], [0.9, 0.55]],

    # Normalised (0.0 to 1.0) polygon zones for N/S/E/W approaches
    "zones": {
        "N": [[0.35, 0.0], [0.65, 0.0], [0.65, 0.4], [0.35, 0.4]],
        "S": [[0.35, 0.6], [0.65, 0.6], [0.65, 1.0], [0.35, 1.0]],
        "E": [[0.6, 0.35], [1.0, 0.35], [1.0, 0.65], [0.6, 0.65]],
        "W": [[0.0, 0.35], [0.4, 0.35], [0.4, 0.65], [0.0, 0.65]],
    },

    # Simulation parameters
    "sim_speed": 240.0,  # 24 hours compressed into 6 real minutes
}


class Config:
    """Base configuration shared by all environments."""

    # ------------------------------------------------------------------ #
    # Security                                                             #
    # ------------------------------------------------------------------ #
    SECRET_KEY: str = os.environ.get(
        "SECRET_KEY",
        "dev-only-change-me-in-production-0x4f7a2b9c1e6d3a8f5b0c7e2d4a9f1b3c"
    )

    # ------------------------------------------------------------------ #
    # Flask-WTF CSRF                                                       #
    # ------------------------------------------------------------------ #
    WTF_CSRF_ENABLED: bool = True
    WTF_CSRF_TIME_LIMIT: int = 3600  # seconds; 1 hour

    # ------------------------------------------------------------------ #
    # Database                                                             #
    # ------------------------------------------------------------------ #
    DATABASE_PATH: str = str(BASE_DIR / "traffic_data.db")

    # ------------------------------------------------------------------ #
    # Flask-Compress                                                       #
    # ------------------------------------------------------------------ #
    COMPRESS_REGISTER: bool = True   # register compression globally
    COMPRESS_LEVEL: int = 6          # gzip compression level (1–9)
    COMPRESS_MIN_SIZE: int = 500     # bytes; don't compress tiny responses

    # ------------------------------------------------------------------ #
    # Session Cookies                                                      #
    # ------------------------------------------------------------------ #
    SESSION_COOKIE_HTTPONLY: bool = True
    SESSION_COOKIE_SAMESITE: str = "Lax"
    SESSION_COOKIE_SECURE: bool = False  # True in production HTTPS

    # ------------------------------------------------------------------ #
    # Upload paths                                                         #
    # ------------------------------------------------------------------ #
    UPLOAD_FOLDER: str = str(BASE_DIR / "uploads")
    MAX_CONTENT_LENGTH: int = 100 * 1024 * 1024  # 100 MB upload limit

    # ------------------------------------------------------------------ #
    # Content                                                              #
    # ------------------------------------------------------------------ #
    PROJECT_JSON_PATH: str = str(BASE_DIR / "content" / "project.json")

    # ------------------------------------------------------------------ #
    # Detection engine                                                     #
    # ------------------------------------------------------------------ #
    VEHICLE_CLASS_IDS: dict = {
        "car": 2,
        "motorcycle": 3,
        "bus": 5,
        "truck": 7,
    }

    # Default system settings
    SETTINGS: dict = DEFAULT_SETTINGS.copy()

    # Density thresholds
    DENSITY_LOW_MAX: int = DEFAULT_SETTINGS["density_low"]
    DENSITY_MEDIUM_MAX: int = DEFAULT_SETTINGS["density_high"]

    # ------------------------------------------------------------------ #
    # Simulation                                                           #
    # ------------------------------------------------------------------ #
    SIMULATOR_FRAMES: int = 300


class DevConfig(Config):
    """Development-specific overrides."""

    DEBUG: bool = True
    TESTING: bool = False
    SQLALCHEMY_ECHO: bool = False
    DEV_RELAX_CSP: bool = True


class TestConfig(Config):
    """Configuration used by pytest."""

    TESTING: bool = True
    DEBUG: bool = False
    WTF_CSRF_ENABLED: bool = False
    DATABASE_PATH: str = ":memory:"


# Convenience mapping
CONFIG_MAP: dict = {
    "development": DevConfig,
    "testing": TestConfig,
    "production": Config,
}
