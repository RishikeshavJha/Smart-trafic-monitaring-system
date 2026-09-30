"""
analytics.py – Pure, deterministic analysis algorithms for the Smart Traffic Monitoring System.

All functions in this module are pure functions without side-effects, I/O, or Flask context.
"""

from typing import Any, Sequence


def classify_density(count: int, low: int = 5, high: int = 12) -> str:
    """Classify vehicle count into Low, Medium, or High density levels.

    Parameters
    ----------
    count : int
        Current vehicle count. Negative values are safely clamped to 0.
    low : int
        Upper threshold for Low density (inclusive boundary for Medium).
    high : int
        Upper threshold for Medium density (exclusive boundary for High).

    Returns
    -------
    str
        "Low" if count < low, "Medium" if low <= count <= high, "High" if count > high.

    Raises
    ------
    ValueError
        If low > high.
    """
    if low > high:
        raise ValueError(f"Low threshold ({low}) cannot exceed High threshold ({high})")

    safe_count = max(0, int(count))
    if safe_count < low:
        return "Low"
    if safe_count <= high:
        return "Medium"
    return "High"


def detect_congestion(
    zone_history: Sequence[tuple[float, str]],
    threshold_seconds: float = 10.0
) -> bool:
    """Detect if an approach zone has sustained an unbroken run of 'High' density.

    Parameters
    ----------
    zone_history : Sequence[tuple[float, str]]
        List of (epoch_seconds, level) tuples ordered chronologically from oldest to newest.
    threshold_seconds : float
        Duration in seconds that the unbroken High density run must strictly exceed.

    Returns
    -------
    bool
        True only if the newest entry is 'High' and the unbroken 'High' run duration
        ending at the newest entry is strictly greater than threshold_seconds.
        Returns False if history is empty or newest entry is not 'High'.
    """
    if not zone_history:
        return False

    history_list = list(zone_history)
    newest_ts, newest_level = history_list[-1]
    if newest_level != "High":
        return False

    # Walk backwards to find the start of the continuous High run
    run_start_ts = newest_ts
    for ts, level in reversed(history_list):
        if level == "High":
            run_start_ts = ts
        else:
            break

    run_duration = newest_ts - run_start_ts
    return run_duration > threshold_seconds


def suggest_green_time(
    count: int,
    base: int = 30,
    k: float = 1.5,
    min_g: int = 10,
    max_g: int = 60
) -> int:
    """Compute recommended green phase duration in seconds.

    Formula:
        suggestGreen(count, base, k, minG, maxG) = round(clamp(base + k * max(count, 0), minG, maxG))

    Parameters
    ----------
    count : int
        Vehicle queue count on the served approach. Negative counts clamped to 0.
    base : int
        Nominal green allocation baseline.
    k : float
        Proportional scaling coefficient (seconds added per vehicle).
    min_g : int
        Floor green duration constraint.
    max_g : int
        Ceiling green duration constraint.

    Returns
    -------
    int
        Calculated green time in seconds.

    Raises
    ------
    ValueError
        If min_g > max_g.
    """
    if min_g > max_g:
        raise ValueError(f"min_g ({min_g}) cannot be greater than max_g ({max_g})")

    safe_count = max(0, int(count))
    raw_green = float(base) + (float(k) * safe_count)
    clamped = max(float(min_g), min(float(max_g), raw_green))
    return int(round(clamped))


def estimate_wait(cycle: float, green: float) -> float:
    """Estimate average vehicle delay in seconds per vehicle.

    Mathematical Model & Assumptions:
      - Uses Webster's simplified uniform-delay term: d = (C - g)^2 / (2 * C).
      - Assumes uniform vehicle arrivals and low-to-moderate saturation.
      - Calculates delay strictly for the served approach phase; excludes cross-street delays.
      - Labelled "ESTIMATE, not measured" in all system interfaces.

    Parameters
    ----------
    cycle : float
        Total signal cycle length in seconds (green + opposing phases).
    green : float
        Effective green phase duration in seconds.

    Returns
    -------
    float
        Average estimated delay in seconds per vehicle, rounded to 2 decimal places.
        Returns 0.0 if cycle <= 0.
    """
    if cycle <= 0:
        return 0.0

    safe_green = max(0.0, min(float(cycle), float(green)))
    delay = ((float(cycle) - safe_green) ** 2) / (2.0 * float(cycle))
    return round(delay, 2)


def cycle_length(green: float, other_phase: float = 30.0) -> float:
    """Calculate total cycle length given green phase and clearance/opposing times."""
    return max(0.0, float(green) + float(other_phase))


try:
    from sklearn.linear_model import LinearRegression
    import numpy as np
    _HAS_SKLEARN = True
except ImportError:
    _HAS_SKLEARN = False


def basic_forecast(last_counts: Sequence[float | int]) -> dict[str, Any] | None:
    """Fit a linear regression trend model on recent 5-second interval vehicle counts.

    Parameters
    ----------
    last_counts : Sequence[float | int]
        Chronological list of recent observations. Requires at least 3 data points.
        Uses at most the last 10 points.

    Returns
    -------
    dict[str, Any] | None
        Dictionary with prediction, points_used, and label, or None if < 3 points.
    """
    vals = list(last_counts)
    if len(vals) < 3:
        return None

    recent_vals = [float(x) for x in vals[-10:]]
    n_points = len(recent_vals)

    if _HAS_SKLEARN:
        X = np.arange(n_points).reshape(-1, 1)
        y = np.array(recent_vals)
        model = LinearRegression()
        model.fit(X, y)
        next_x = np.array([[n_points]])
        pred_raw = float(model.predict(next_x)[0])
    else:
        # Exact analytical Ordinary Least Squares (OLS) fallback
        x_mean = (n_points - 1) / 2.0
        y_mean = sum(recent_vals) / n_points
        numerator = sum((i - x_mean) * (val - y_mean) for i, val in enumerate(recent_vals))
        denominator = sum((i - x_mean) ** 2 for i in range(n_points))
        slope = (numerator / denominator) if denominator != 0 else 0.0
        intercept = y_mean - (slope * x_mean)
        pred_raw = (slope * n_points) + intercept

    pred_clamped = max(0, int(round(pred_raw)))

    return {
        "prediction": pred_clamped,
        "points_used": n_points,
        "label": "basic forecast, indicative only"
    }



# Backward-compatibility aliases
suggest_green = suggest_green_time
estimate_delay = estimate_wait
