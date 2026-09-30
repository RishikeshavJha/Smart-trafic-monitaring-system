"""
tests/test_analytics.py – Unit tests for pure deterministic analysis algorithms.

Verifies:
  - classify_density boundary behavior and error validation.
  - detect_congestion unbroken run duration checks and reset behavior.
  - suggest_green_time Webster green duration and clamping.
  - estimate_wait uniform delay calculation and edge cases.
  - basic_forecast linear trend prediction and clamping.
"""

import pytest
import analytics


# ------------------------------------------------------------------ #
# 1. Density Classification Tests                                     #
# ------------------------------------------------------------------ #

def test_classify_density_boundaries():
    """Verify strict density boundaries for Low, Medium, and High."""
    # Count 0, 4 -> Low
    assert analytics.classify_density(0, low=5, high=12) == "Low"
    assert analytics.classify_density(4, low=5, high=12) == "Low"

    # Count 5, 12 -> Medium
    assert analytics.classify_density(5, low=5, high=12) == "Medium"
    assert analytics.classify_density(12, low=5, high=12) == "Medium"

    # Count 13 -> High
    assert analytics.classify_density(13, low=5, high=12) == "High"
    assert analytics.classify_density(40, low=5, high=12) == "High"

    # Negative count safely treated as 0 (Low)
    assert analytics.classify_density(-5, low=5, high=12) == "Low"


def test_classify_density_invalid_thresholds():
    """Raising ValueError when low threshold exceeds high threshold."""
    with pytest.raises(ValueError):
        analytics.classify_density(10, low=15, high=10)


# ------------------------------------------------------------------ #
# 2. Congestion Detection Tests                                       #
# ------------------------------------------------------------------ #

def test_detect_congestion_scenarios():
    """Verify unbroken High run requirements."""
    threshold = 10.0

    # 1. Empty history returns False
    assert analytics.detect_congestion([], threshold_seconds=threshold) is False

    # 2. High run exactly at threshold (e.g. 10.0 seconds) -> False (must strictly exceed)
    run_exact = [(0.0, "High"), (5.0, "High"), (10.0, "High")]
    assert analytics.detect_congestion(run_exact, threshold_seconds=threshold) is False

    # 3. High run strictly greater than threshold (e.g. 10.1 seconds) -> True
    run_over = [(0.0, "High"), (5.0, "High"), (10.1, "High")]
    assert analytics.detect_congestion(run_over, threshold_seconds=threshold) is True

    # 4. A Medium entry in the middle resets the unbroken run
    run_interrupted = [
        (0.0, "High"),
        (5.0, "High"),
        (8.0, "Medium"),  # Resets run!
        (9.0, "High"),
        (15.0, "High"),   # 15.0 - 9.0 = 6.0s (<= 10.0s threshold)
    ]
    assert analytics.detect_congestion(run_interrupted, threshold_seconds=threshold) is False

    # 5. Newest entry is not High -> False
    not_high = [(0.0, "High"), (5.0, "High"), (15.0, "Medium")]
    assert analytics.detect_congestion(not_high, threshold_seconds=threshold) is False


# ------------------------------------------------------------------ #
# 3. Signal Timing Recommendation Tests                               #
# ------------------------------------------------------------------ #

def test_suggest_green_time_values():
    """Verify formula calculations and clamping constraints."""
    # (0) -> base=30
    assert analytics.suggest_green_time(0, base=30, k=1.5, min_g=10, max_g=60) == 30

    # (10) -> 30 + 1.5 * 10 = 45
    assert analytics.suggest_green_time(10, base=30, k=1.5, min_g=10, max_g=60) == 45

    # (40) -> 30 + 1.5 * 40 = 90 -> clamped to max_g=60
    assert analytics.suggest_green_time(40, base=30, k=1.5, min_g=10, max_g=60) == 60

    # Negative count -> clamped to 0 -> base=30
    assert analytics.suggest_green_time(-10, base=30, k=1.5, min_g=10, max_g=60) == 30

    # min_g > max_g raises ValueError
    with pytest.raises(ValueError):
        analytics.suggest_green_time(10, min_g=50, max_g=40)


# ------------------------------------------------------------------ #
# 4. Wait Time Estimation Tests                                       #
# ------------------------------------------------------------------ #

def test_estimate_wait_calculations():
    """Verify Webster delay formula test vectors and guards."""
    # (60, 30) -> (60-30)^2 / (2*60) = 900 / 120 = 7.5
    assert analytics.estimate_wait(60.0, 30.0) == 7.5

    # (90, 60) -> (90-60)^2 / (2*90) = 900 / 180 = 5.0
    assert analytics.estimate_wait(90.0, 60.0) == 5.0

    # cycle <= 0 guarded
    assert analytics.estimate_wait(0.0, 30.0) == 0.0
    assert analytics.estimate_wait(-10.0, 30.0) == 0.0

    # green above cycle clamped to cycle (delay = 0.0)
    assert analytics.estimate_wait(60.0, 75.0) == 0.0


# ------------------------------------------------------------------ #
# 5. Linear Regression Forecast Tests                                 #
# ------------------------------------------------------------------ #

def test_basic_forecast_trend_and_constraints():
    """Verify minimum data points, rising trend prediction, and non-negative clamping."""
    # Fewer than 3 points returns None
    assert analytics.basic_forecast([]) is None
    assert analytics.basic_forecast([10]) is None
    assert analytics.basic_forecast([10, 12]) is None

    # Rising series: [10, 12, 14, 16] -> next should be 18
    res = analytics.basic_forecast([10, 12, 14, 16])
    assert res is not None
    assert res["prediction"] == 18
    assert res["points_used"] == 4
    assert res["label"] == "basic forecast, indicative only"

    # Rapidly falling series: [10, 5, 1] -> would project negative, clamped to 0
    res_falling = analytics.basic_forecast([10, 5, 1])
    assert res_falling is not None
    assert res_falling["prediction"] == 0
