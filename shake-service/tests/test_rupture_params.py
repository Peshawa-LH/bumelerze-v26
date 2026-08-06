"""Point-in-polygon mechanism logic: inside -> reverse (90), outside -> 0."""

import pytest

from shake_service import rupture_params as rp


@pytest.mark.parametrize(
    "lat,lon",
    [
        (34.9, 45.9),  # Halabja/Sarpol-e Zahab 2017 epicentre — the D9/D20 validation anchor
        (36.19, 44.01),  # Erbil
        (35.56, 45.43),  # Sulaymaniyah
        (34.31, 47.06),  # Kermanshah
    ],
)
def test_belt_cities_are_inside_polygon(lat, lon):
    assert rp.in_zagros_belt(lat, lon) is True


@pytest.mark.parametrize(
    "lat,lon",
    [
        (33.3, 44.4),  # Baghdad — Mesopotamian foreland, should be outside
        (30.0, 30.0),  # far away, sanity control
        (25.0, 55.0),  # Gulf, sanity control
    ],
)
def test_far_field_points_are_outside_polygon(lat, lon):
    assert rp.in_zagros_belt(lat, lon) is False


def test_inside_polygon_gets_reverse_rake_and_45_dip():
    params = rp.derive_rupture_params(34.9, 45.9, depth_km=19.0)
    assert params.in_zagros_polygon is True
    assert params.rake_deg == rp.ZAGROS_REVERSE_RAKE_DEG == 90.0
    assert params.dip_deg == rp.ZAGROS_DIP_DEG == 45.0
    assert params.review_flags == ()


def test_outside_polygon_gets_neutral_rake_and_90_dip():
    params = rp.derive_rupture_params(33.3, 44.4, depth_km=10.0)
    assert params.in_zagros_polygon is False
    assert params.rake_deg == rp.NEUTRAL_STRIKE_SLIP_RAKE_DEG == 0.0
    assert params.dip_deg == rp.ELSEWHERE_DIP_DEG == 90.0
    assert "outside_zagros_polygon_neutral_mechanism" in params.review_flags


def test_ztor_inside_polygon_backs_out_half_width_and_floors_at_zero():
    # depth 19 - half_width 5 = 14
    params = rp.derive_rupture_params(34.9, 45.9, depth_km=19.0, assumed_half_width_km=5.0)
    assert params.ztor_km == pytest.approx(14.0)

    # shallow event: depth < half_width must floor at 0, never go negative
    shallow = rp.derive_rupture_params(34.9, 45.9, depth_km=2.0, assumed_half_width_km=5.0)
    assert shallow.ztor_km == 0.0


def test_ztor_outside_polygon_equals_depth():
    params = rp.derive_rupture_params(33.3, 44.4, depth_km=12.5)
    assert params.ztor_km == 12.5


def test_rx_and_z1pt0_and_vs30measured_defaults_always_apply():
    for lat, lon in [(34.9, 45.9), (33.3, 44.4)]:
        params = rp.derive_rupture_params(lat, lon, depth_km=10.0)
        assert params.rx_km == 0.0
        assert params.z1pt0 == rp.CY14_Z1PT0_SENTINEL == -999.0
        assert params.vs30measured is False


def test_point_in_polygon_handles_unclosed_ring():
    ring = ((0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0))  # a simple square, not closed
    assert rp.point_in_polygon(1.0, 1.0, ring) is True  # inside
    assert rp.point_in_polygon(5.0, 5.0, ring) is False  # outside
