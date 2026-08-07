"""export.py: marching-squares contour golden case, contour/round-trip
correctness, and the three product builders (`cont_mi.json`/`info.json`/
`grid.json`) against a real `ForwardMap`."""

from __future__ import annotations

import json

import numpy as np
import pytest
from shapely.geometry import Point, Polygon

from shake_service import config, export, forward


# ---------------------------------------------------------------------------
# Golden case: a single radially-symmetric Gaussian hill has exactly one
# closed ring per level, strictly nested by level (higher level = smaller,
# fully-contained ring) — the textbook marching-squares sanity check.
# ---------------------------------------------------------------------------


def _gaussian_hill_grid(ny: int = 41, nx: int = 41, half_extent: float = 4.0):
    lat_axis = np.linspace(-half_extent, half_extent, ny)
    lon_axis = np.linspace(-half_extent, half_extent, nx)
    lon2d, lat2d = np.meshgrid(lon_axis, lat_axis)  # shape (ny, nx), row = lat
    z = 10.0 * np.exp(-(lon2d**2 + lat2d**2) / 4.0)
    return z, lon_axis, lat_axis


def test_gaussian_hill_one_closed_ring_per_level():
    z, lon_axis, lat_axis = _gaussian_hill_grid()
    fc = export.contour_geojson(z, lon_axis, lat_axis, levels=[1.0, 3.0, 5.0, 7.0, 9.0])
    assert len(fc["features"]) == 5
    for feature in fc["features"]:
        rings = feature["geometry"]["coordinates"]
        assert len(rings) == 1, f"level {feature['properties']['value']}: expected 1 ring"
        ring = rings[0]
        assert ring[0] == ring[-1], "a fully-interior contour must be closed (first == last point)"
        assert len(ring) >= 3


def test_gaussian_hill_rings_strictly_nested_by_level():
    z, lon_axis, lat_axis = _gaussian_hill_grid()
    levels = [1.0, 3.0, 5.0, 7.0, 9.0]
    fc = export.contour_geojson(z, lon_axis, lat_axis, levels=levels)
    polys_by_level = {
        f["properties"]["value"]: Polygon(f["geometry"]["coordinates"][0]) for f in fc["features"]
    }
    for lo, hi in zip(levels, levels[1:]):
        assert polys_by_level[lo].contains(polys_by_level[hi]), (
            f"level {hi} ring should be strictly inside level {lo} ring"
        )
        assert polys_by_level[hi].area < polys_by_level[lo].area


def test_gaussian_hill_off_center_peak_gives_open_boundary_contour():
    # A peak right at the grid corner: any contour around it gets cut off by
    # the array edge -> open (first != last point), the real-USGS-fixture
    # case the app's `cont_mi.trimmed.json` deliberately preserves.
    ny, nx = 21, 21
    lat_axis = np.linspace(-4, 4, ny)
    lon_axis = np.linspace(-4, 4, nx)
    lon2d, lat2d = np.meshgrid(lon_axis, lat_axis)
    z = 10.0 * np.exp(-((lon2d - 4) ** 2 + (lat2d - 4) ** 2) / 4.0)
    fc = export.contour_geojson(z, lon_axis, lat_axis, levels=[3.0])
    assert len(fc["features"]) == 1
    ring = fc["features"][0]["geometry"]["coordinates"][0]
    assert ring[0] != ring[-1]


# ---------------------------------------------------------------------------
# Round-trip: a re-parsed contour ring at level v separates grid cells with
# mean >= v from cells with mean < v, within tolerance.
# ---------------------------------------------------------------------------


def test_contour_round_trip_separates_grid_cells_by_level():
    z, lon_axis, lat_axis = _gaussian_hill_grid()
    level = 5.0
    fc = export.contour_geojson(z, lon_axis, lat_axis, levels=[level])
    polys = [Polygon(ring) for ring in fc["features"][0]["geometry"]["coordinates"]]

    mismatches = 0
    total = 0
    for i, lat in enumerate(lat_axis):
        for j, lon in enumerate(lon_axis):
            total += 1
            point = Point(lon, lat)
            inside = any(poly.contains(point) or poly.touches(point) for poly in polys)
            above = z[i, j] >= level
            if inside != above:
                mismatches += 1
    # A handful of exact-boundary disagreements (cells sitting almost
    # exactly on the interpolated ring) are expected; the bulk of the grid
    # must agree.
    assert mismatches / total < 0.02


def test_contour_geojson_rejects_shape_mismatch():
    z = np.zeros((3, 4))
    lon_axis = np.linspace(0, 1, 4)
    lat_axis = np.linspace(0, 1, 5)  # deliberately wrong length
    with pytest.raises(ValueError):
        export.contour_geojson(z, lon_axis, lat_axis)


def test_default_contour_levels_are_half_intensity_steps():
    z = np.array([[2.3, 4.1], [3.0, 6.8]])
    levels = export.default_contour_levels(z)
    assert levels[0] <= 2.3
    assert levels[-1] >= 6.8
    for level in levels:
        # every level lands on a 0.5 grid (2.0, 2.5, 3.0, ...)
        assert abs(round(level * 2) - level * 2) < 1e-9


def test_out_of_range_levels_produce_no_feature():
    z, lon_axis, lat_axis = _gaussian_hill_grid()
    fc = export.contour_geojson(z, lon_axis, lat_axis, levels=[-5.0, 999.0])
    assert fc["features"] == []


# ---------------------------------------------------------------------------
# Feature-property shape: must match what `contours.ts` parses (`value`
# required; extras like `units` are tolerated/ignored by that zod schema).
# ---------------------------------------------------------------------------


def test_contour_feature_properties_shape_matches_app_schema():
    z, lon_axis, lat_axis = _gaussian_hill_grid()
    fc = export.contour_geojson(z, lon_axis, lat_axis, levels=[3.0])
    feature = fc["features"][0]
    assert feature["type"] == "Feature"
    assert isinstance(feature["properties"]["value"], float)
    assert feature["geometry"]["type"] == "MultiLineString"
    assert isinstance(feature["geometry"]["coordinates"], list)
    ring = feature["geometry"]["coordinates"][0]
    lon, lat = ring[0]
    assert isinstance(lon, float) and isinstance(lat, float)


# ---------------------------------------------------------------------------
# Product builders against a real ForwardMap (small band, fast).
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def small_forward_map():
    return forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=4.0)


def test_build_cont_mi_product_is_valid_feature_collection(small_forward_map):
    product = export.build_cont_mi_product(small_forward_map)
    assert product["type"] == "FeatureCollection"
    assert len(product["features"]) > 0
    for feature in product["features"]:
        assert feature["properties"]["units"] == "ems"
        assert feature["geometry"]["type"] == "MultiLineString"


def test_build_cont_mi_product_mmi_channel(small_forward_map):
    product = export.build_cont_mi_product(small_forward_map, channel="mmi")
    for feature in product["features"]:
        assert feature["properties"]["units"] == "mmi"


def test_build_cont_mi_product_json_serializable(small_forward_map):
    product = export.build_cont_mi_product(small_forward_map)
    # round-trips through json without error (no numpy scalars leaking through)
    reparsed = json.loads(json.dumps(product))
    assert reparsed["type"] == "FeatureCollection"


def test_build_info_product_shape(small_forward_map):
    info = export.build_info_product(small_forward_map)
    assert info["producer"] == "bumelerze-shake-service"
    assert info["event"]["mag_mw"] == 4.0
    assert info["band"] == small_forward_map.band
    branch_keys = {b["key"] for b in info["engine"]["gmpe_forward"]["logic_tree"]}
    assert branch_keys == set(config.GSIM_KEYS)
    for branch in info["engine"]["gmpe_forward"]["logic_tree"]:
        assert branch["weight"] == pytest.approx(small_forward_map.weights[branch["key"]])
    assert info["intensity"]["scale"] == "EMS-98"
    assert info["engine"]["conditioning"] is None
    # JSON-serializable end to end (tuples in extrapolation flags, etc.)
    json.dumps(info)


def test_build_info_product_ims25_public_scale_label(small_forward_map):
    # D22 "IMS-25 as the app's public scale" — a new top-level field,
    # distinct from (and additive to) the pre-existing internal
    # `intensity.scale` label.
    info = export.build_info_product(small_forward_map)
    assert info["intensity_scale"] == "IMS-25 (EMS-98)"


def test_build_info_product_mmi_channel_scale_label(small_forward_map):
    info = export.build_info_product(small_forward_map, contour_channel="mmi")
    assert info["intensity"]["scale"] == "MMI"
    assert info["intensity_scale"] == "MMI"


def test_build_info_product_defaults_to_automatic_review_status(small_forward_map):
    info = export.build_info_product(small_forward_map)
    assert info["review_status"] == "automatic"
    assert info["reviewed_by"] is None
    assert info["reviewed_at"] is None
    assert export.DEFAULT_REVIEW_STATUS == "automatic"


def test_build_info_product_accepts_reviewed_status_with_metadata(small_forward_map):
    info = export.build_info_product(
        small_forward_map, review_status="reviewed", reviewed_by="peshawa", reviewed_at="2026-08-07T00:00:00+00:00",
    )
    assert info["review_status"] == "reviewed"
    assert info["reviewed_by"] == "peshawa"
    assert info["reviewed_at"] == "2026-08-07T00:00:00+00:00"


def test_build_info_product_rejects_unknown_review_status(small_forward_map):
    with pytest.raises(ValueError, match="review_status"):
        export.build_info_product(small_forward_map, review_status="pending")


def test_build_grid_product_shape_and_lengths(small_forward_map):
    grid = export.build_grid_product(small_forward_map)
    ny, nx = small_forward_map.grid_meta["shape"]
    n = ny * nx
    for key in ("lon", "lat", "ems", "ems_sigma", "mmi", "mmi_sigma", "pga_g", "pga_sigma_ln", "pgv_cms", "pgv_sigma_ln"):
        assert len(grid[key]) == n, key
    json.dumps(grid)


def test_write_products_creates_three_files(tmp_path, small_forward_map):
    paths = export.write_products(small_forward_map, tmp_path)
    assert set(paths) == {"cont_mi", "info", "grid"}
    for path in paths.values():
        assert path.exists()
        json.loads(path.read_text())  # valid JSON
    assert (tmp_path / "cont_mi.json").exists()
    assert (tmp_path / "info.json").exists()
    assert (tmp_path / "grid.json").exists()
    info = json.loads((tmp_path / "info.json").read_text())
    assert info["review_status"] == "automatic"


def test_write_products_passes_through_review_status(tmp_path, small_forward_map):
    paths = export.write_products(
        small_forward_map, tmp_path, review_status="reviewed", reviewed_by="peshawa", reviewed_at="2026-08-07T00:00:00+00:00",
    )
    info = json.loads(paths["info"].read_text())
    assert info["review_status"] == "reviewed"
    assert info["reviewed_by"] == "peshawa"


# ---------------------------------------------------------------------------
# Idempotency: exporting the same ForwardMap twice yields the same contours
# (deterministic marching squares — no reliance on set/dict ordering).
# ---------------------------------------------------------------------------


def test_export_is_deterministic(small_forward_map):
    a = export.build_cont_mi_product(small_forward_map)
    b = export.build_cont_mi_product(small_forward_map)
    assert a == b
