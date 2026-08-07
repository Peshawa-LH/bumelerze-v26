"""dyfi_observations — real-fixture parsing, nresp filtering, CDI<->GM
round trip, sigma chain-rule vs. an independent hand calculation, and the
degenerate/edge-case guards (non-finite conversions dropped, not
fabricated)."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest

from shake_service import dyfi_observations as dyfi
from shake_service import gmice

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "dyfi_geo_10km.trimmed.geojson"


# ---------------------------------------------------------------------------
# Parsing the real fixture
# ---------------------------------------------------------------------------


def test_parse_real_fixture_has_expected_box_count_and_fields():
    boxes = dyfi.load_dyfi_geo_geojson(str(FIXTURE_PATH))
    assert len(boxes) == 10
    nresps = sorted(b.nresp for b in boxes)
    assert nresps == [1, 2, 3, 3, 3, 4, 5, 11, 23, 49]
    for b in boxes:
        assert 0.0 < b.cdi <= 12.0
        assert b.dist_km > 0.0
        assert b.stddev_usgs > 0.0
        assert -180.0 <= b.lon <= 180.0
        assert -90.0 <= b.lat <= 90.0


def test_parse_real_fixture_centroid_matches_hand_mean_of_corners():
    import json

    raw = json.loads(FIXTURE_PATH.read_text())
    # The Pol-e-Zahab box (nresp=4, cdi=8.5, dist=53) -- find it by properties.
    feature = next(f for f in raw["features"] if f["properties"]["nresp"] == 4)
    ring = feature["geometry"]["coordinates"][0]
    expected_lon = sum(p[0] for p in ring) / len(ring)
    expected_lat = sum(p[1] for p in ring) / len(ring)

    boxes = dyfi.load_dyfi_geo_geojson(str(FIXTURE_PATH))
    box = next(b for b in boxes if b.nresp == 4)
    assert box.lon == pytest.approx(expected_lon, abs=1e-9)
    assert box.lat == pytest.approx(expected_lat, abs=1e-9)
    assert box.cdi == pytest.approx(8.5)
    assert box.dist_km == pytest.approx(53.0)


def test_parse_rejects_non_feature_collection():
    with pytest.raises(ValueError, match="FeatureCollection"):
        dyfi.parse_dyfi_geo_geojson('{"type": "Feature", "features": []}')


def test_parse_rejects_missing_features_key():
    with pytest.raises(ValueError, match="features"):
        dyfi.parse_dyfi_geo_geojson('{"type": "FeatureCollection"}')


def test_parse_rejects_non_polygon_geometry():
    doc = '{"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [1,2]}, "properties": {"cdi": 3, "nresp": 1, "dist": 10, "stddev": 0.3}}]}'
    with pytest.raises(ValueError, match="Polygon"):
        dyfi.parse_dyfi_geo_geojson(doc)


def test_parse_rejects_missing_property_key():
    doc = (
        '{"type": "FeatureCollection", "features": [{"type": "Feature", '
        '"geometry": {"type": "Polygon", "coordinates": [[[1,2],[1,3],[2,3],[2,2]]]}, '
        '"properties": {"cdi": 3, "nresp": 1, "dist": 10}}]}'  # missing "stddev"
    )
    with pytest.raises(ValueError, match="stddev"):
        dyfi.parse_dyfi_geo_geojson(doc)


# ---------------------------------------------------------------------------
# nresp filtering
# ---------------------------------------------------------------------------


def test_filter_by_nresp_default_floor_is_three():
    boxes = dyfi.load_dyfi_geo_geojson(str(FIXTURE_PATH))
    filtered = dyfi.filter_by_nresp(boxes)
    assert dyfi.DEFAULT_MIN_NRESP == 3
    assert sorted(b.nresp for b in filtered) == [3, 3, 3, 4, 5, 11, 23, 49]


def test_filter_by_nresp_sensitivity_floor_is_two():
    boxes = dyfi.load_dyfi_geo_geojson(str(FIXTURE_PATH))
    filtered = dyfi.filter_by_nresp(boxes, min_nresp=dyfi.SENSITIVITY_MIN_NRESP)
    assert dyfi.SENSITIVITY_MIN_NRESP == 2
    assert sorted(b.nresp for b in filtered) == [2, 3, 3, 3, 4, 5, 11, 23, 49]


def test_filter_by_nresp_empty_when_floor_too_high():
    boxes = dyfi.load_dyfi_geo_geojson(str(FIXTURE_PATH))
    assert dyfi.filter_by_nresp(boxes, min_nresp=1000) == []


# ---------------------------------------------------------------------------
# dyfi_sigma_intensity: 1/sqrt(nresp) decay with a floor
# ---------------------------------------------------------------------------


def test_dyfi_sigma_intensity_decays_as_inverse_sqrt_nresp_above_floor():
    # base=1.0 by default, floor=0.30 -- nresp=4 gives 1.0/2=0.5, well above floor.
    assert dyfi.dyfi_sigma_intensity(4) == pytest.approx(0.5)
    assert dyfi.dyfi_sigma_intensity(1) == pytest.approx(1.0)


def test_dyfi_sigma_intensity_never_drops_below_floor():
    huge = dyfi.dyfi_sigma_intensity(100_000)
    assert huge == pytest.approx(dyfi.DYFI_SIGMA_INTENSITY_FLOOR)


def test_dyfi_sigma_intensity_custom_base_and_floor():
    val = dyfi.dyfi_sigma_intensity(9, base=3.0, floor=0.1)
    assert val == pytest.approx(1.0)  # 3.0/sqrt(9) = 1.0, above the 0.1 floor


# ---------------------------------------------------------------------------
# CDI -> GM conversion: value_ln matches an independent gmice call
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("imt,unit,model", [
    ("PGA", "g", dyfi.DEFAULT_MODEL),
    ("PGV", "cm/s", dyfi.DEFAULT_MODEL),
    ("PGA", "g", dyfi.SENSITIVITY_MODEL),
    ("PGV", "cm/s", dyfi.SENSITIVITY_MODEL),
])
def test_dyfi_box_to_station_observation_value_matches_independent_gmice_call(imt, unit, model):
    box = dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=7.0, nresp=5, dist_km=50.0, stddev_usgs=0.29, name="test")
    obs = dyfi.dyfi_box_to_station_observation(box, imt=imt, model=model)

    expected_y = gmice.convert_from_intensity(np.array([7.0]), imt=imt, unit_out=unit, model=model)[0]
    assert np.exp(obs.value_ln) == pytest.approx(expected_y, rel=1e-10)


def test_dyfi_box_to_station_observation_round_trips_through_forward_gmice():
    # value_ln -> linear GM -> forward GMICE should recover ~ the original CDI
    # (Zanini/Worden are each individually invertible by construction; this
    # is the "CDI -> GM -> CDI" round-trip the task asks for).
    box = dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=6.5, nresp=10, dist_km=80.0, stddev_usgs=0.25, name="test")
    for imt, unit, model in (
        ("PGA", "g", dyfi.DEFAULT_MODEL),
        ("PGV", "cm/s", dyfi.DEFAULT_MODEL),
    ):
        obs = dyfi.dyfi_box_to_station_observation(box, imt=imt, model=model)
        y_native = np.exp(obs.value_ln)
        recovered_cdi = gmice.convert_to_intensity(np.array([y_native]), imt=imt, unit_in=unit, model=model)[0]
        assert recovered_cdi == pytest.approx(6.5, abs=1e-6)


def test_station_observation_lon_lat_match_box_centroid():
    box = dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=6.0, nresp=5, dist_km=50.0, stddev_usgs=0.29, name="test")
    obs = dyfi.dyfi_box_to_station_observation(box, imt="PGA")
    assert obs.lon == pytest.approx(45.9)
    assert obs.lat == pytest.approx(34.9)


# ---------------------------------------------------------------------------
# sigma chain rule vs. an independent hand calculation
# ---------------------------------------------------------------------------


def test_sigma_ln_matches_hand_chain_rule_computation():
    box = dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=7.0, nresp=9, dist_km=60.0, stddev_usgs=0.27, name="test")
    imt, unit, model = "PGA", "g", dyfi.DEFAULT_MODEL

    obs = dyfi.dyfi_box_to_station_observation(box, imt=imt, model=model)

    # Independent hand computation: NOT calling dyfi_box_to_station_observation
    # a second time, calling gmice directly + dyfi.dyfi_sigma_intensity directly.
    y_native = gmice.convert_from_intensity(np.array([7.0]), imt=imt, unit_out=unit, model=model)
    deriv = gmice.dintensity_dlny(y_native, imt=imt, unit_in=unit, model=model)[0]
    sigma_gmice_val = gmice.sigma_gmice(model, imt)
    sigma_box = 1.0 / math.sqrt(9)  # base=1.0, nresp=9 -> 1/3, above the 0.30 floor
    expected_sigma_ln = math.sqrt(sigma_box**2 + sigma_gmice_val**2) / abs(deriv)

    assert obs.sigma_obs == pytest.approx(expected_sigma_ln, rel=1e-8)


def test_sigma_ln_uses_floor_for_high_nresp():
    box_low_n = dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=7.0, nresp=1, dist_km=60.0, stddev_usgs=0.33, name="a")
    box_high_n = dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=7.0, nresp=500, dist_km=60.0, stddev_usgs=0.1, name="b")
    obs_low = dyfi.dyfi_box_to_station_observation(box_low_n, imt="PGA")
    obs_high = dyfi.dyfi_box_to_station_observation(box_high_n, imt="PGA")
    # More responses -> smaller (or equal) sigma, never below the floor-driven value.
    assert obs_high.sigma_obs < obs_low.sigma_obs


def test_custom_sigma_intensity_fn_is_honored():
    box = dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=6.0, nresp=5, dist_km=50.0, stddev_usgs=0.29, name="test")
    obs_default = dyfi.dyfi_box_to_station_observation(box, imt="PGA")
    obs_tiny_sigma = dyfi.dyfi_box_to_station_observation(box, imt="PGA", sigma_intensity_fn=lambda n: 1e-9)
    assert obs_tiny_sigma.sigma_obs < obs_default.sigma_obs


# ---------------------------------------------------------------------------
# Batch conversion: drops non-finite conversions rather than raising/fabricating
# ---------------------------------------------------------------------------


def test_dyfi_boxes_to_station_observations_drops_non_finite_conversions():
    boxes = [
        dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=7.0, nresp=5, dist_km=50.0, stddev_usgs=0.29, name="good"),
        # cdi<0 -> Zanini's own guarded zero-floor (gmice._zanini_ems_to_pga:
        # "ems < 0 -> 0.0") -> y_native=0 -> ln(0)=-inf. Worden (this
        # module's DEFAULT_MODEL) has no such guard for any finite cdi, so
        # this test exercises the Zanini/EMS sensitivity model explicitly.
        dyfi.DyfiBox(lon=46.0, lat=35.0, cdi=-1.0, nresp=5, dist_km=60.0, stddev_usgs=0.29, name="degenerate"),
    ]
    with np.errstate(divide="ignore"):  # the ln(0) below is the point of this test, not a bug
        obs = dyfi.dyfi_boxes_to_station_observations(boxes, imt="PGA", model=dyfi.SENSITIVITY_MODEL)
    assert len(obs) == 1
    assert np.isfinite(obs[0].value_ln)


def test_dyfi_boxes_to_station_observations_on_real_fixture_yields_one_per_box():
    boxes = dyfi.load_dyfi_geo_geojson(str(FIXTURE_PATH))
    filtered = dyfi.filter_by_nresp(boxes)
    obs_pga = dyfi.dyfi_boxes_to_station_observations(filtered, imt="PGA")
    obs_pgv = dyfi.dyfi_boxes_to_station_observations(filtered, imt="PGV")
    assert len(obs_pga) == len(filtered)
    assert len(obs_pgv) == len(filtered)
    for o in obs_pga + obs_pgv:
        assert np.isfinite(o.value_ln)
        assert np.isfinite(o.sigma_obs) and o.sigma_obs > 0.0


def test_dyfi_box_to_station_observation_rejects_unsupported_imt():
    box = dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=6.0, nresp=5, dist_km=50.0, stddev_usgs=0.29, name="test")
    with pytest.raises(ValueError, match="unsupported imt"):
        dyfi.dyfi_box_to_station_observation(box, imt="SA(0.3)")
