"""rupture_model.py: rupture.json parsing (real fixtures) + finite-fault
Rjb/Rrup math against hand-computed simple geometries (horizontal square,
vertical plane) + dip/rake override policy."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from shake_service import rupture_model as rm
from shake_service import rupture_params

FIXTURES = Path(__file__).parent / "fixtures"

# Matches rupture_model.py's own flat-Earth convention, at ref_lat=0 so
# cos(ref_lat) == 1 and 1 deg == 111.32 km in BOTH axes -- lets every hand-
# computed geometry below be specified directly in km and converted with
# simple division, no lat-scaling arithmetic to get wrong.
_KM_PER_DEG = 111.32


def _lonlat(x_km: float, y_km: float) -> tuple[float, float]:
    return x_km / _KM_PER_DEG, y_km / _KM_PER_DEG


def _corner(x_km: float, y_km: float, z_km: float) -> tuple[float, float, float]:
    lon, lat = _lonlat(x_km, y_km)
    return (lon, lat, z_km)


def _model(quads: tuple[rm.Quad, ...], *, rake=0.0, mech="ALL") -> rm.RuptureModel:
    meta = rm.RuptureMetadata(event_id="test", mag=6.0, depth_km=10.0, rake_deg=rake, mech=mech, reference="test")
    return rm.RuptureModel(metadata=meta, quads=quads)


# ---------------------------------------------------------------------------
# Real-fixture parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fixture_name,expected_n_quads,expected_mag",
    [
        ("us2000bmcg_rupture.trimmed.json", 1, 7.3),  # N=2 top/bottom vertices -> 1 quad
        ("us6000jllz_rupture.trimmed.json", 15, 7.8),  # N=16 -> 15 quads
        ("us6000jlqa_rupture.trimmed.json", 9, 7.5),  # N=10 -> 9 quads
    ],
)
def test_parse_real_rupture_fixture(fixture_name, expected_n_quads, expected_mag):
    model = rm.load_rupture_json(str(FIXTURES / fixture_name))
    assert model.n_quads == expected_n_quads
    assert model.metadata.mag == pytest.approx(expected_mag)
    assert model.metadata.mech == "ALL"
    assert model.metadata.rake_deg == pytest.approx(0.0)
    assert model.top_depth_km is not None
    assert model.top_depth_km >= 0.0


def test_parse_real_fixture_metadata_rake_never_overrides_generic_mech():
    # All three real fixtures carry mech="ALL" -- module docstring policy:
    # the sentinel means "not a real determination", so the metadata rake
    # override must never fire for any of them.
    model = rm.load_rupture_json(str(FIXTURES / "us2000bmcg_rupture.trimmed.json"))
    assert rm.rake_from_metadata(model) is None


def test_parse_rupture_json_raises_on_missing_features_key():
    with pytest.raises(ValueError):
        rm.parse_rupture_json('{"metadata": {}}')


def test_parse_rupture_json_tolerates_a_malformed_ring():
    # A ring with an odd vertex count (after dropping the closing point)
    # doesn't fit the top/bottom split -- skipped, not raised.
    doc = {
        "metadata": {"mag": 5.0},
        "features": [
            {
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": [[[[0, 0, 1], [1, 0, 1], [1, 1, 2], [0, 0, 1]]]],  # 3 pts (odd)
                }
            }
        ],
        "type": "FeatureCollection",
    }
    import json

    model = rm.parse_rupture_json(json.dumps(doc))
    assert model.n_quads == 0


# ---------------------------------------------------------------------------
# Rjb/Rrup — hand-computed horizontal square
# ---------------------------------------------------------------------------


def _horizontal_square_model(depth_km: float = 10.0, half_side_km: float = 10.0) -> rm.RuptureModel:
    quad = rm.Quad(
        top_left=_corner(-half_side_km, -half_side_km, depth_km),
        top_right=_corner(half_side_km, -half_side_km, depth_km),
        bottom_right=_corner(half_side_km, half_side_km, depth_km),
        bottom_left=_corner(-half_side_km, half_side_km, depth_km),
    )
    return _model((quad,))


def test_horizontal_square_site_directly_above_center():
    model = _horizontal_square_model(depth_km=10.0, half_side_km=10.0)
    lon, lat = _lonlat(0.0, 0.0)
    est = rm.finite_fault_distances(
        model, site_lons=np.array([lon]), site_lats=np.array([lat]), ref_lon=0.0, ref_lat=0.0,
    )
    assert est.rjb_km[0] == pytest.approx(0.0, abs=1e-6)
    assert est.rrup_km[0] == pytest.approx(10.0, abs=1e-6)
    assert est.rjb_var[0] == 0.0
    assert est.rrup_var[0] == 0.0


def test_horizontal_square_site_outside_footprint():
    model = _horizontal_square_model(depth_km=10.0, half_side_km=10.0)
    lon, lat = _lonlat(30.0, 0.0)  # 20 km east of the square's right edge (x=10)
    est = rm.finite_fault_distances(
        model, site_lons=np.array([lon]), site_lats=np.array([lat]), ref_lon=0.0, ref_lat=0.0,
    )
    assert est.rjb_km[0] == pytest.approx(20.0, abs=1e-6)
    assert est.rrup_km[0] == pytest.approx(np.hypot(20.0, 10.0), abs=1e-6)


# ---------------------------------------------------------------------------
# Rjb/Rrup — hand-computed vertical plane (dip = 90)
# ---------------------------------------------------------------------------


def _vertical_plane_model(top_depth_km: float = 0.0, bottom_depth_km: float = 15.0, half_len_km: float = 10.0) -> rm.RuptureModel:
    quad = rm.Quad(
        top_left=_corner(-half_len_km, 0.0, top_depth_km),
        top_right=_corner(half_len_km, 0.0, top_depth_km),
        bottom_right=_corner(half_len_km, 0.0, bottom_depth_km),
        bottom_left=_corner(-half_len_km, 0.0, bottom_depth_km),
    )
    return _model((quad,))


def test_vertical_plane_surface_site_lateral_offset_rjb_equals_rrup():
    # A site at the surface (z=0), perpendicular offset 20 km from the
    # fault trace, within its along-strike extent: Rjb == Rrup == 20 (the
    # closest point on the plane sits at the site's own depth, z=0).
    model = _vertical_plane_model(top_depth_km=0.0, bottom_depth_km=15.0, half_len_km=10.0)
    lon, lat = _lonlat(0.0, 20.0)
    est = rm.finite_fault_distances(
        model, site_lons=np.array([lon]), site_lats=np.array([lat]), ref_lon=0.0, ref_lat=0.0,
    )
    assert est.rjb_km[0] == pytest.approx(20.0, abs=1e-6)
    assert est.rrup_km[0] == pytest.approx(20.0, abs=1e-6)


def test_vertical_plane_deep_site_on_strike_line_rjb_zero_rrup_vertical():
    # A site directly on the fault's surface trace (x=0, y=0) but BELOW
    # the fault's bottom edge (z=25 > bottom_depth=15): Rjb=0 (its surface
    # projection sits exactly on the degenerate trace line), Rrup=10 (the
    # vertical distance down to the fault's bottom edge, the nearest point
    # on the plane).
    model = _vertical_plane_model(top_depth_km=0.0, bottom_depth_km=15.0, half_len_km=10.0)
    lon, lat = _lonlat(0.0, 0.0)
    # finite_fault_distances always queries at the surface (z=0 in the
    # projected site frame, per its own docstring) -- to probe a site at
    # depth we go one level down and call the quad helper directly.
    site_xyz = np.array([[0.0, 0.0, 25.0]])
    quad = model.quads[0]
    rrup = rm._quad_rrup_km(quad, site_xyz, ref_lon=0.0, ref_lat=0.0)
    assert rrup[0] == pytest.approx(10.0, abs=1e-6)

    rjb = rm._quad_rjb_km(quad, np.array([0.0]), np.array([0.0]), ref_lon=0.0, ref_lat=0.0)
    assert rjb[0] == pytest.approx(0.0, abs=1e-6)


def test_rrup_geq_rjb_on_real_fixture_grid():
    model = rm.load_rupture_json(str(FIXTURES / "us6000jllz_rupture.trimmed.json"))
    lons = np.linspace(35.5, 39.0, 6)
    lats = np.linspace(36.0, 38.5, 6)
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    est = rm.finite_fault_distances(
        model, site_lons=lon_grid.ravel(), site_lats=lat_grid.ravel(), ref_lon=37.0143, ref_lat=37.2256,
    )
    assert np.all(est.rrup_km >= est.rjb_km - 1e-6)
    assert np.all(np.isfinite(est.rjb_km))
    assert np.all(np.isfinite(est.rrup_km))


def test_finite_fault_distances_raises_on_empty_model():
    empty = _model(())
    with pytest.raises(ValueError):
        rm.finite_fault_distances(empty, site_lons=np.array([0.0]), site_lats=np.array([0.0]), ref_lon=0.0, ref_lat=0.0)


# ---------------------------------------------------------------------------
# dip_from_geometry — hand-computed 45-degree quad
# ---------------------------------------------------------------------------


def test_dip_from_geometry_45_degrees():
    quad = rm.Quad(
        top_left=_corner(-5.0, 0.0, 5.0),
        top_right=_corner(5.0, 0.0, 5.0),
        bottom_right=_corner(5.0, 10.0, 15.0),
        bottom_left=_corner(-5.0, 10.0, 15.0),
    )
    model = _model((quad,))
    assert rm.dip_from_geometry(model) == pytest.approx(45.0, abs=1e-3)


def test_dip_from_geometry_horizontal_is_zero():
    model = _horizontal_square_model()
    assert rm.dip_from_geometry(model) == pytest.approx(90.0 - 90.0, abs=1e-6) or rm.dip_from_geometry(model) == pytest.approx(0.0, abs=1e-3)


def test_dip_from_geometry_vertical_is_ninety():
    model = _vertical_plane_model()
    assert rm.dip_from_geometry(model) == pytest.approx(90.0, abs=1e-3)


def test_dip_from_geometry_none_for_empty_model():
    assert rm.dip_from_geometry(_model(())) is None


# ---------------------------------------------------------------------------
# override_rupture_params
# ---------------------------------------------------------------------------


def test_override_rupture_params_replaces_dip_and_ztor_keeps_rake_for_generic_mech():
    base = rupture_params.derive_rupture_params(lat=34.9109, lon=45.9592, depth_km=19.0)
    model = _vertical_plane_model(top_depth_km=2.0, bottom_depth_km=15.0)  # mech="ALL" by default
    overridden = rm.override_rupture_params(base, model)

    assert overridden.dip_deg == pytest.approx(90.0, abs=1e-3)
    assert overridden.ztor_km == pytest.approx(2.0)
    assert overridden.rake_deg == base.rake_deg  # generic mech -- never overridden
    assert "finite_fault_geometry_dip_ztor" in overridden.review_flags
    assert "finite_fault_metadata_rake" not in overridden.review_flags


def test_override_rupture_params_applies_metadata_rake_for_a_real_mechanism():
    base = rupture_params.derive_rupture_params(lat=34.9109, lon=45.9592, depth_km=19.0)
    quad = rm.Quad(
        top_left=_corner(-5.0, 0.0, 2.0), top_right=_corner(5.0, 0.0, 2.0),
        bottom_right=_corner(5.0, 0.0, 15.0), bottom_left=_corner(-5.0, 0.0, 15.0),
    )
    model = _model((quad,), rake=75.0, mech="RS")
    overridden = rm.override_rupture_params(base, model)

    assert overridden.rake_deg == pytest.approx(75.0)
    assert "finite_fault_metadata_rake" in overridden.review_flags


def test_override_rupture_params_returns_base_unchanged_for_empty_model():
    base = rupture_params.derive_rupture_params(lat=34.9109, lon=45.9592, depth_km=19.0)
    overridden = rm.override_rupture_params(base, _model(()))
    assert overridden == base
