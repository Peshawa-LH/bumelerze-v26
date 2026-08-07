"""station_observations — stationlist.json parsing/dedup, instrumental
sigma assignment, and combined (station + DYFI) observation building with
one shared in-domain policy + floor counting."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from shake_service import dyfi_observations as dyfi
from shake_service import station_observations as stations


def _feature(
    *, lon=45.0, lat=35.0, source="TU", station_type="seismic", network="TU", code="ABC",
    distance=50.0, pga=0.05, pgv=1.2,
):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "source": source, "station_type": station_type, "network": network, "code": code,
            "distance": distance, "pga": pga, "pgv": pgv,
        },
    }


def _collection(*features):
    return json.dumps({"type": "FeatureCollection", "features": list(features)})


# ---------------------------------------------------------------------------
# Parsing + dedup rule
# ---------------------------------------------------------------------------


def test_parse_rejects_non_feature_collection():
    with pytest.raises(ValueError, match="FeatureCollection"):
        stations.parse_stationlist_json('{"type": "Feature", "features": []}')


def test_parse_rejects_missing_features_key():
    with pytest.raises(ValueError, match="features"):
        stations.parse_stationlist_json('{"type": "FeatureCollection"}')


def test_parse_keeps_real_instrumental_station():
    text = _collection(_feature(source="TU", station_type="seismic", pga=0.05, pgv=1.2))
    records = stations.parse_stationlist_json(text)
    assert len(records) == 1
    r = records[0]
    assert r.network == "TU"
    assert r.pga_g == pytest.approx(0.0005)  # 0.05 %g -> g
    assert r.pgv_cms == pytest.approx(1.2)


def test_parse_drops_dyfi_source_row():
    text = _collection(_feature(source="DYFI", station_type="macroseismic", pga="null", pgv="null"))
    assert stations.parse_stationlist_json(text) == []


def test_parse_drops_macroseismic_station_type_even_if_source_is_not_literally_dyfi():
    # Dedup rule is OR'd across both fields (module docstring) -- a payload
    # that only sets station_type is caught too, not just literal source=="DYFI".
    text = _collection(_feature(source="something-else", station_type="macroseismic"))
    assert stations.parse_stationlist_json(text) == []


def test_parse_mixed_feed_keeps_only_the_instrumental_rows():
    text = _collection(
        _feature(source="TU", station_type="seismic", code="A"),
        _feature(source="DYFI", station_type="macroseismic", code="B", pga="null", pgv="null"),
        _feature(source="IV", station_type="seismic", code="C"),
    )
    records = stations.parse_stationlist_json(text)
    assert sorted(r.code for r in records) == ["A", "C"]


def test_parse_handles_string_null_readings_as_missing():
    text = _collection(_feature(pga="null", pgv="null"))
    records = stations.parse_stationlist_json(text)
    assert records[0].pga_g is None
    assert records[0].pgv_cms is None


def test_parse_skips_feature_with_missing_coordinates():
    doc = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": []}, "properties": {"source": "TU", "station_type": "seismic", "distance": 10}},
            ],
        }
    )
    assert stations.parse_stationlist_json(doc) == []


def test_parse_skips_feature_with_non_numeric_distance():
    text = _collection(_feature(distance="not-a-number"))
    assert stations.parse_stationlist_json(text) == []


# ---------------------------------------------------------------------------
# StationRecord -> mvn.StationObservation
# ---------------------------------------------------------------------------


def test_station_records_to_observations_uses_default_instrument_sigma():
    records = stations.parse_stationlist_json(_collection(_feature(pga=0.05, pgv=1.2)))
    obs_pga = stations.station_records_to_observations(records, imt="PGA")
    obs_pgv = stations.station_records_to_observations(records, imt="PGV")
    assert obs_pga[0].sigma_obs == pytest.approx(stations.INSTRUMENT_SIGMA_LN_PGA)
    assert obs_pgv[0].sigma_obs == pytest.approx(stations.INSTRUMENT_SIGMA_LN_PGV)
    assert obs_pga[0].value_ln == pytest.approx(math.log(0.05 * 0.01))
    assert obs_pgv[0].value_ln == pytest.approx(math.log(1.2))


def test_station_records_to_observations_honors_custom_sigma():
    records = stations.parse_stationlist_json(_collection(_feature()))
    obs = stations.station_records_to_observations(records, imt="PGA", sigma_ln=0.05)
    assert obs[0].sigma_obs == pytest.approx(0.05)


def test_station_records_to_observations_drops_records_with_no_reading_for_imt():
    records = stations.parse_stationlist_json(_collection(_feature(pga="null", pgv=1.2)))
    assert stations.station_records_to_observations(records, imt="PGA") == []
    assert len(stations.station_records_to_observations(records, imt="PGV")) == 1


def test_station_records_to_observations_rejects_unsupported_imt():
    records = stations.parse_stationlist_json(_collection(_feature()))
    with pytest.raises(ValueError, match="unsupported imt"):
        stations.station_records_to_observations(records, imt="SA(0.3)")


def test_instrument_sigma_is_smaller_than_typical_dyfi_sigma():
    # Documents the module docstring's core claim numerically: a typical
    # DYFI-derived sigma_ln (moderate nresp, Worden GMICE) is well above the
    # fixed instrumental sigma.
    box = dyfi.DyfiBox(lon=45.9, lat=34.9, cdi=7.0, nresp=5, dist_km=50.0, stddev_usgs=0.29, name="test")
    dyfi_obs = dyfi.dyfi_box_to_station_observation(box, imt="PGA")
    assert stations.INSTRUMENT_SIGMA_LN_PGA < dyfi_obs.sigma_obs


# ---------------------------------------------------------------------------
# Combined observations: shared in-domain policy + floor counting
# ---------------------------------------------------------------------------


def _dyfi_box(dist_km, nresp=5, cdi=7.0):
    return dyfi.DyfiBox(lon=45.5, lat=34.5, cdi=cdi, nresp=nresp, dist_km=dist_km, stddev_usgs=0.29, name="b")


def test_combined_observations_merges_stations_first_then_dyfi():
    station_records = stations.parse_stationlist_json(_collection(_feature(distance=10.0)))
    boxes = [_dyfi_box(dist_km=20.0)]
    combined = stations.combined_station_observations(
        station_records=station_records, dyfi_boxes=boxes, imt="PGA", half_extent_km=100.0,
    )
    assert len(combined) == 2
    # station observation's lon/lat matches the parsed station record (first).
    assert combined[0].lon == pytest.approx(station_records[0].lon)
    assert combined[0].lat == pytest.approx(station_records[0].lat)


def test_combined_observations_domain_restriction_applies_to_both_sources():
    near_station = stations.parse_stationlist_json(_collection(_feature(distance=10.0)))
    far_station = stations.parse_stationlist_json(_collection(_feature(distance=500.0)))
    near_box = _dyfi_box(dist_km=20.0)
    far_box = _dyfi_box(dist_km=500.0)

    combined = stations.combined_station_observations(
        station_records=near_station + far_station, dyfi_boxes=[near_box, far_box],
        imt="PGA", half_extent_km=100.0, restrict_to_domain=True,
    )
    # Only the in-domain station + in-domain box survive.
    assert len(combined) == 2


def test_combined_observations_unrestricted_domain_keeps_everything_in_range():
    far_station = stations.parse_stationlist_json(_collection(_feature(distance=500.0)))
    far_box = _dyfi_box(dist_km=500.0)
    combined = stations.combined_station_observations(
        station_records=far_station, dyfi_boxes=[far_box], imt="PGA",
        half_extent_km=None, restrict_to_domain=False,
    )
    assert len(combined) == 2


def test_combined_observations_requires_half_extent_when_restricting():
    with pytest.raises(ValueError, match="half_extent_km"):
        stations.combined_station_observations(
            station_records=[], dyfi_boxes=[], imt="PGA", half_extent_km=None, restrict_to_domain=True,
        )


def test_combined_observations_applies_dyfi_nresp_floor():
    thin_box = _dyfi_box(dist_km=20.0, nresp=1)  # below DEFAULT_MIN_NRESP=3
    thick_box = _dyfi_box(dist_km=20.0, nresp=10)
    combined = stations.combined_station_observations(
        station_records=[], dyfi_boxes=[thin_box, thick_box], imt="PGA", half_extent_km=100.0,
    )
    assert len(combined) == 1


def test_combined_observations_count_feeds_conditioning_floor_source_agnostically():
    # Not a mvn call here (that's conditioned_forward's job) -- just proves
    # the combined list's LENGTH is what a floor check downstream would
    # compare against config.MIN_CONDITIONING_OBSERVATIONS, regardless of
    # how many came from stations vs. DYFI.
    station_records = stations.parse_stationlist_json(
        _collection(*[_feature(distance=10.0, code=str(i)) for i in range(6)])
    )
    boxes = [_dyfi_box(dist_km=20.0, nresp=10) for _ in range(4)]
    combined = stations.combined_station_observations(
        station_records=station_records, dyfi_boxes=boxes, imt="PGA", half_extent_km=100.0,
    )
    assert len(combined) == 10
    for o in combined:
        assert np.isfinite(o.value_ln)
        assert np.isfinite(o.sigma_obs) and o.sigma_obs > 0.0
