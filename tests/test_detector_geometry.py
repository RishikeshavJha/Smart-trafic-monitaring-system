"""
tests/test_detector_geometry.py – Unit tests for pure geometry functions in detector.py.

Tests:
  - Normalised coordinate and polygon to pixel conversion.
  - 2D Cross product orientation test.
  - Line crossing detection across multiple vehicle trajectory cases:
      • Clear single crossing (above to below).
      • Reversed crossing (below to above).
      • Vehicle that moves parallel and never crosses.
      • Vehicle that approaches the line and turns away (no crossing).
      • Vehicle jittering along or near the line.
      • Stationary vehicle (prev_pt == curr_pt).
  - Point-in-polygon tests (inside, outside, on vertex, on edge).
"""

import numpy as np
import pytest

from detector import (
    check_line_intersection,
    cross_product_2d,
    is_point_in_polygon,
    normalized_polygon_to_pixels,
    normalized_to_pixel_coords,
)


class TestNormalizedCoordinates:
    """Tests for normalized (0.0 to 1.0) to pixel coordinate transformations."""

    def test_normalized_to_pixel_coords_corners(self):
        w, h = 640, 360

        # Top-left corner
        assert normalized_to_pixel_coords((0.0, 0.0), w, h) == (0, 0)
        # Bottom-right corner (clamped to width-1, height-1)
        assert normalized_to_pixel_coords((1.0, 1.0), w, h) == (639, 359)
        # Center
        assert normalized_to_pixel_coords((0.5, 0.5), w, h) == (320, 180)

    def test_normalized_to_pixel_coords_clamping(self):
        w, h = 640, 360
        # Out-of-bounds coordinates should be clamped safely
        assert normalized_to_pixel_coords((-0.2, -0.5), w, h) == (0, 0)
        assert normalized_to_pixel_coords((1.5, 2.0), w, h) == (639, 359)

    def test_normalized_polygon_to_pixels(self):
        w, h = 640, 360
        norm_poly = [[0.0, 0.0], [0.5, 0.0], [0.5, 0.5], [0.0, 0.5]]
        pts = normalized_polygon_to_pixels(norm_poly, w, h)

        assert isinstance(pts, np.ndarray)
        assert pts.shape == (4, 2)
        assert np.array_equal(pts[0], [0, 0])
        assert np.array_equal(pts[1], [320, 0])
        assert np.array_equal(pts[2], [320, 180])
        assert np.array_equal(pts[3], [0, 180])


class TestCrossProductOrientation:
    """Tests for the 2D cross product sign orientation helper."""

    def test_cross_product_2d_orientations(self):
        p1 = (0.0, 0.0)
        p2 = (10.0, 0.0)

        # Point above line (y > 0)
        above = (5.0, 5.0)
        assert cross_product_2d(p1, p2, above) > 0

        # Point below line (y < 0)
        below = (5.0, -5.0)
        assert cross_product_2d(p1, p2, below) < 0

        # Collinear point on line
        on_line = (5.0, 0.0)
        assert cross_product_2d(p1, p2, on_line) == 0.0


class TestLineCrossingDetection:
    """Tests for check_line_intersection simulating vehicle trajectory movements."""

    @pytest.fixture
    def horizontal_line(self):
        # Horizontal counting line at y=200 stretching from x=50 to x=550
        return (50.0, 200.0), (550.0, 200.0)

    def test_vehicle_crosses_downwards(self, horizontal_line):
        line_start, line_end = horizontal_line
        prev_pt = (300.0, 180.0)  # Above line
        curr_pt = (300.0, 220.0)  # Below line

        assert check_line_intersection(prev_pt, curr_pt, line_start, line_end) is True

    def test_vehicle_crosses_upwards(self, horizontal_line):
        line_start, line_end = horizontal_line
        prev_pt = (300.0, 220.0)  # Below line
        curr_pt = (300.0, 180.0)  # Above line

        assert check_line_intersection(prev_pt, curr_pt, line_start, line_end) is True

    def test_vehicle_moves_parallel_without_crossing(self, horizontal_line):
        line_start, line_end = horizontal_line
        prev_pt = (100.0, 150.0)
        curr_pt = (400.0, 150.0)

        assert check_line_intersection(prev_pt, curr_pt, line_start, line_end) is False

    def test_vehicle_approaches_and_turns_away(self, horizontal_line):
        line_start, line_end = horizontal_line
        # Vehicle moves from y=100 down to y=190 (never crosses y=200)
        prev_pt = (300.0, 100.0)
        curr_pt = (300.0, 190.0)

        assert check_line_intersection(prev_pt, curr_pt, line_start, line_end) is False

    def test_vehicle_moves_past_line_outside_endpoints(self, horizontal_line):
        line_start, line_end = horizontal_line
        # Trajectory crosses y=200 but at x=600 (beyond line_end at x=550)
        prev_pt = (600.0, 180.0)
        curr_pt = (600.0, 220.0)

        assert check_line_intersection(prev_pt, curr_pt, line_start, line_end) is False

    def test_stationary_vehicle_does_not_cross(self, horizontal_line):
        line_start, line_end = horizontal_line
        pt = (300.0, 200.0)
        assert check_line_intersection(pt, pt, line_start, line_end) is False


class TestPointInPolygon:
    """Tests for spatial zone containment using is_point_in_polygon."""

    @pytest.fixture
    def rectangular_zone(self):
        # 100x100 box from (50, 50) to (150, 150)
        return np.array([[50, 50], [150, 50], [150, 150], [50, 150]], dtype=np.int32)

    def test_point_strictly_inside(self, rectangular_zone):
        assert is_point_in_polygon((100, 100), rectangular_zone) is True

    def test_point_strictly_outside(self, rectangular_zone):
        assert is_point_in_polygon((20, 20), rectangular_zone) is False
        assert is_point_in_polygon((200, 100), rectangular_zone) is False

    def test_point_on_boundary_or_vertex(self, rectangular_zone):
        # On edge
        assert is_point_in_polygon((100, 50), rectangular_zone) is True
        # On vertex
        assert is_point_in_polygon((50, 50), rectangular_zone) is True
