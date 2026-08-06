"""Geodetic distance sanity + ps2ff monotonicity/variance-positivity checks."""

import numpy as np
import pytest

from shake_service import distances as d


def test_repi_zero_at_epicentre():
    r = d.repi_km(34.9, 45.9, np.array([34.9]), np.array([45.9]))
    assert r[0] == pytest.approx(0.0, abs=1e-9)


def test_repi_known_distance_erbil_to_slemani_roughly_right():
    # Erbil (36.19, 44.01) to Sulaymaniyah (35.56, 45.43) is ~140 km in
    # reality (great-circle, ignoring topography) — sanity band only.
    r = d.repi_km(36.19, 44.01, np.array([35.56]), np.array([45.43]))
    assert 100.0 < r[0] < 180.0


def test_repi_symmetric():
    r_ab = d.repi_km(34.9, 45.9, np.array([36.0]), np.array([44.0]))
    r_ba = d.repi_km(36.0, 44.0, np.array([34.9]), np.array([45.9]))
    assert r_ab[0] == pytest.approx(r_ba[0], rel=1e-9)


def test_rhyp_geq_repi_and_depth():
    repi = np.array([0.0, 10.0, 50.0])
    depth = 15.0
    rhyp = d.rhyp_km(repi, depth)
    assert np.all(rhyp >= repi)
    assert np.all(rhyp >= depth - 1e-9)
    # at repi=0, rhyp == depth exactly
    assert rhyp[0] == pytest.approx(depth)


@pytest.mark.parametrize("in_zagros", [True, False])
def test_ps2ff_rjb_and_rrup_monotone_increasing_with_repi(in_zagros):
    repi = np.array([1.0, 10.0, 30.0, 60.0, 120.0, 250.0])
    est = d.expected_rjb_rrup(repi, mag=6.0, in_zagros_polygon=in_zagros)
    assert np.all(np.diff(est.rjb_km) > 0)
    assert np.all(np.diff(est.rrup_km) > 0)


@pytest.mark.parametrize("in_zagros", [True, False])
def test_ps2ff_rjb_leq_rrup_pointwise(in_zagros):
    # Rjb is a horizontal distance to the surface projection; Rrup is the
    # closest 3-D distance to the rupture surface, so Rrup >= Rjb always.
    repi = np.array([1.0, 10.0, 30.0, 60.0, 120.0])
    est = d.expected_rjb_rrup(repi, mag=6.0, in_zagros_polygon=in_zagros)
    assert np.all(est.rrup_km >= est.rjb_km - 1e-6)


@pytest.mark.parametrize("in_zagros", [True, False])
def test_ps2ff_variances_are_positive(in_zagros):
    repi = np.array([1.0, 10.0, 30.0, 60.0, 120.0])
    est = d.expected_rjb_rrup(repi, mag=6.0, in_zagros_polygon=in_zagros)
    assert np.all(est.rjb_var > 0)
    assert np.all(est.rrup_var > 0)


def test_ps2ff_at_large_repi_ratio_approaches_one():
    # Far from a small rupture, the point-to-finite-rupture distance ratio
    # should approach 1 (finite-rupture extent becomes negligible).
    repi = np.array([300.0])
    est = d.expected_rjb_rrup(repi, mag=5.0, in_zagros_polygon=True)
    assert est.rjb_km[0] / repi[0] > 0.85


def test_mechanism_mapping_matches_rake_policy():
    from ps2ff.constants import Mechanism

    assert d.mechanism_for_ps2ff(True) == Mechanism.R
    assert d.mechanism_for_ps2ff(False) == Mechanism.SS


def test_expected_rjb_rrup_handles_zero_repi_without_error():
    repi = np.array([0.0, 5.0])
    est = d.expected_rjb_rrup(repi, mag=6.0, in_zagros_polygon=True)
    assert np.all(np.isfinite(est.rjb_km))
    assert np.all(np.isfinite(est.rrup_km))
