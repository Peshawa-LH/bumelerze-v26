"""Unit tests for `scripts/run_validation.py`'s PARAMETERIZATION — event-id
in, band/product-discovery/distance-bins/rake-classification out — using a
fully mocked event (no network, no real USGS fetch). This is the "unit test
on its parameterization (mock event)" item from the 2018-pair validation
task; end-to-end real-network runs against actual USGS events are covered
separately (`validation/us1000hwdw/`, `validation/us1000ghda/`,
`validation/halabja/` — generated artifacts, not pytest-gated here, same
policy as the superseded `test_halabja_smoke.py`/
`test_halabja_conditioned_smoke.py`: a legitimate scientific FAIL is not a
test failure).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import run_validation  # noqa: E402

# ---------------------------------------------------------------------------
# A fully synthetic mock event: a small-band (Mw 4.2) event with a shakemap
# (atlas + a "us" fallback), a dyfi product, a moment-tensor product, and a
# stationlist mixing one real instrumental station with one DYFI-derived
# macroseismic entry -- everything `fetch_event_inputs`/`run_validation`
# needs, small enough to hand-construct and reason about exactly.
# ---------------------------------------------------------------------------

MOCK_EVENT_ID = "mockevt01"
MOCK_LAT = 35.0
MOCK_LON = 45.0
MOCK_DEPTH_KM = 10.0
MOCK_MAG = 4.2  # < 5.0 -> "small" band per config.MAGNITUDE_BAND_EDGES


def _mock_detail_json(*, with_shakemap: bool = True, with_dyfi: bool = True, with_mt: bool = True) -> str:
    import json

    products: dict[str, list[dict]] = {}
    if with_shakemap:
        products["shakemap"] = [
            {
                "id": "urn:usgs-product:us:shakemap:mockevt01:1",
                "source": "us",
                "preferredWeight": 100,
                "contents": {
                    "download/grid.xml": {"url": "mock://grid.xml"},
                    "download/stationlist.json": {"url": "mock://stationlist.json"},
                },
            },
            {
                "id": "urn:usgs-product:atlas:shakemap:mockevt01:2",
                "source": "atlas",
                "preferredWeight": 200,
                "contents": {
                    "download/grid.xml": {"url": "mock://grid.xml"},
                    "download/stationlist.json": {"url": "mock://stationlist.json"},
                },
            },
        ]
    if with_dyfi:
        products["dyfi"] = [
            {
                "id": "urn:usgs-product:us:dyfi:mockevt01:1",
                "source": "us",
                "preferredWeight": 100,
                "contents": {"dyfi_geo_10km.geojson": {"url": "mock://dyfi_geo_10km.geojson"}},
            }
        ]
    if with_mt:
        products["moment-tensor"] = [
            {
                "source": "us",
                "preferredWeight": 200,
                "properties": {
                    "nodal-plane-2-strike": "10.0",
                    "nodal-plane-2-dip": "60.0",
                    "nodal-plane-2-rake": "-90.0",  # near-pure normal
                },
            }
        ]

    return json.dumps(
        {
            "geometry": {"type": "Point", "coordinates": [MOCK_LON, MOCK_LAT, MOCK_DEPTH_KM]},
            "properties": {
                "mag": MOCK_MAG,
                "place": "mock place, mockland",
                "time": 1234567890000,
                "products": products,
            },
        }
    )


def _mock_grid_xml() -> str:
    # A tiny 3x3 grid (real Atlas-style header, per `tests/fixtures/
    # us2000bmcg_grid.trimmed.xml`), centered on the mock event, well inside
    # a "small" band's 100 km half-extent site grid so `comparison.py`'s
    # resampling has real (non-NaN) points to compare.
    lons = [44.95, 45.00, 45.05]
    lats = [34.95, 35.00, 35.05]
    rows = []
    for lat in lats:
        for lon in lons:
            rows.append(f"{lon} {lat} 5.0 3.5 2.0")
    data = "\n".join(rows)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<shakemap_grid event_id="{MOCK_EVENT_ID}">
<event event_id="{MOCK_EVENT_ID}" magnitude="{MOCK_MAG}" depth="{MOCK_DEPTH_KM}" lat="{MOCK_LAT}" lon="{MOCK_LON}" intensity_observations="4" seismic_stations="1" />
<grid_specification lon_min="44.95" lat_min="34.95" lon_max="45.05" lat_max="35.05" nominal_lon_spacing="0.05" nominal_lat_spacing="0.05" nlon="3" nlat="3"/>
<grid_field index="1" name="LON" units="dd" />
<grid_field index="2" name="LAT" units="dd" />
<grid_field index="3" name="PGA" units="%g" />
<grid_field index="4" name="PGV" units="cm/s" />
<grid_field index="5" name="MMI" units="intensity" />
<grid_data>
{data}
</grid_data>
</shakemap_grid>
"""


def _mock_stationlist_json() -> str:
    import json

    return json.dumps(
        {
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [45.01, 35.01]},
                    "properties": {
                        "network": "XX", "code": "MOCK1", "name": "Mock Instrumental Station",
                        "source": "XX", "pga": 2.5, "distance": 1.4,
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [45.5, 35.5]},
                    "properties": {
                        "network": "DYFI", "code": "UTM:MOCK", "name": None,
                        "source": "DYFI", "pga": "null", "distance": 70.0,
                    },
                },
            ]
        }
    )


def _mock_dyfi_geo_10km_geojson() -> str:
    import json

    def box(center_lon: float, center_lat: float, cdi: float, nresp: int, dist_km: float) -> dict:
        d = 0.02
        ring = [
            [center_lon - d, center_lat - d], [center_lon + d, center_lat - d],
            [center_lon + d, center_lat + d], [center_lon - d, center_lat + d],
        ]
        return {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {"cdi": cdi, "nresp": nresp, "dist": dist_km, "stddev": 0.3, "name": "mockbox"},
        }

    features = [
        box(45.01, 35.01, cdi=5.5, nresp=5, dist_km=1.5),  # in-domain, nresp>=3
        box(45.05, 35.05, cdi=4.0, nresp=3, dist_km=7.0),  # in-domain, nresp>=3
        box(45.10, 35.10, cdi=3.0, nresp=2, dist_km=14.0),  # in-domain, nresp<3 (nresp>=2 sensitivity only)
        box(50.0, 40.0, cdi=6.0, nresp=10, dist_km=650.0),  # WAY outside a small-band 100km domain
    ]
    return json.dumps({"type": "FeatureCollection", "features": features})


@pytest.fixture
def mock_fetch(monkeypatch):
    """Monkeypatch `run_validation._cached_get` to serve the mock event's
    fixtures by cache-path filename, keyed off closures set per-test."""

    responses: dict[str, str] = {}

    def fake_cached_get(url: str, cache_path):
        name = cache_path.name
        if name not in responses:
            raise AssertionError(f"mock_fetch: no canned response registered for {name!r} (url={url!r})")
        return responses[name]

    monkeypatch.setattr(run_validation, "_cached_get", fake_cached_get)
    return responses


# ---------------------------------------------------------------------------
# resolve_product
# ---------------------------------------------------------------------------


def test_resolve_product_prefers_named_source():
    detail = {"properties": {"products": {"shakemap": [
        {"source": "us", "preferredWeight": 300},
        {"source": "atlas", "preferredWeight": 100},
    ]}}}
    product = run_validation.resolve_product(detail, "shakemap", preferred_source="atlas")
    assert product["source"] == "atlas"


def test_resolve_product_falls_back_to_highest_weight_when_preferred_source_absent():
    detail = {"properties": {"products": {"shakemap": [
        {"source": "us", "preferredWeight": 100},
        {"source": "us2", "preferredWeight": 300},
    ]}}}
    product = run_validation.resolve_product(detail, "shakemap", preferred_source="atlas")
    assert product["preferredWeight"] == 300


def test_resolve_product_returns_none_when_product_type_missing():
    detail = {"properties": {"products": {}}}
    assert run_validation.resolve_product(detail, "shakemap", preferred_source="atlas") is None
    assert run_validation.resolve_product(detail, "dyfi", preferred_source="us") is None


# ---------------------------------------------------------------------------
# mechanism note / rake classification
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "rake,expected",
    [
        (90.0, "near-pure reverse/thrust"),
        (85.0, "near-pure reverse/thrust"),
        (-90.0, "near-pure normal"),
        (0.0, "predominantly strike-slip"),
        (180.0, "predominantly strike-slip"),
        (-179.9, "predominantly strike-slip"),
        (40.0, "oblique"),
        (-40.0, "oblique"),
    ],
)
def test_classify_rake(rake, expected):
    assert run_validation._classify_rake(rake) == expected


def test_resolve_moment_tensor_note_reports_no_mt_when_absent():
    detail = {"properties": {"products": {}}}
    note = run_validation.resolve_moment_tensor_note(detail)
    assert "no moment-tensor product available" in note


def test_resolve_moment_tensor_note_classifies_real_nodal_plane():
    import json

    detail = json.loads(_mock_detail_json())
    note = run_validation.resolve_moment_tensor_note(detail)
    assert "near-pure normal" in note
    assert "strike 10.0" in note


# ---------------------------------------------------------------------------
# distance bins scale with band
# ---------------------------------------------------------------------------


def test_distance_bins_scale_by_band():
    small = run_validation.distance_bins_for_band("small")
    moderate = run_validation.distance_bins_for_band("moderate")
    major = run_validation.distance_bins_for_band("major")
    assert small[-1][1] == 100.0
    assert moderate[-1][1] == 200.0
    assert major[-1][1] == 300.0
    # every band's bins are contiguous and start at 0
    for bins in (small, moderate, major):
        assert bins[0][0] == 0.0
        for (_, hi), (lo2, _) in zip(bins, bins[1:]):
            assert hi == lo2


# ---------------------------------------------------------------------------
# instrumental-station spot-check filtering
# ---------------------------------------------------------------------------


def test_find_instrumental_stations_excludes_dyfi_and_requires_numeric_pga():
    import json

    stationlist = json.loads(_mock_stationlist_json())
    found = run_validation.find_instrumental_stations(stationlist)
    assert len(found) == 1
    assert found[0]["properties"]["network"] == "XX"


def test_find_instrumental_stations_returns_empty_for_none():
    assert run_validation.find_instrumental_stations(None) == []


def test_find_instrumental_stations_respects_max_n_and_sorts_by_distance():
    stations = {
        "features": [
            {"properties": {"source": "YY", "pga": 1.0, "distance": 50.0}},
            {"properties": {"source": "YY", "pga": 2.0, "distance": 10.0}},
            {"properties": {"source": "YY", "pga": 3.0, "distance": 30.0}},
        ]
    }
    found = run_validation.find_instrumental_stations(stations, max_n=2)
    assert len(found) == 2
    assert [f["properties"]["distance"] for f in found] == [10.0, 30.0]


# ---------------------------------------------------------------------------
# End-to-end parameterization: mocked event -> run_validation()
# ---------------------------------------------------------------------------


def test_run_validation_end_to_end_on_mock_event_selects_small_band_and_runs_full_pipeline(mock_fetch, tmp_path):
    mock_fetch["detail.json"] = _mock_detail_json()
    mock_fetch["grid.xml"] = _mock_grid_xml()
    mock_fetch["stationlist.json"] = _mock_stationlist_json()
    mock_fetch["dyfi_geo_10km.geojson"] = _mock_dyfi_geo_10km_geojson()

    results, fm, grid_xml, bare, conditioned = run_validation.run_validation(MOCK_EVENT_ID, tmp_path)

    assert results["event"]["id"] == MOCK_EVENT_ID
    assert results["event"]["mag_mw"] == pytest.approx(MOCK_MAG)
    assert results["band"] == "small"  # Mw 4.2 < 5.0 edge -> small band, auto-selected
    assert fm.band == "small"
    assert results["grid_half_extent_km"] == pytest.approx(100.0)  # config.GRID_EXTENT_KM["small"]

    assert results["product_availability"]["shakemap_available"] is True
    assert results["product_availability"]["dyfi_available"] is True
    assert bare is not None
    assert results["bare"]["comparison"]["n_compared"] > 0

    # one real instrumental station (MOCK1), the DYFI-macroseismic entry excluded
    assert len(results["spot_checks"]) == 1
    assert results["spot_checks"][0]["code"] == "MOCK1"

    # conditioning: 2 of 4 dyfi boxes pass nresp>=3 AND the small-band 100km
    # domain restriction (the 3rd box is nresp<3, the 4th is 650 km away).
    primary = conditioned["variants"]["primary"]
    assert primary["n_boxes_selected"] == 2
    # sensitivity_nresp2 relaxes the nresp floor to >=2 -> picks up the 3rd box too.
    assert conditioned["variants"]["sensitivity_nresp2"]["n_boxes_selected"] == 3
    # unrestricted domain only relaxes the domain cap, NOT the nresp>=3 floor
    # -- picks up the 650 km outlier (nresp=10) but still excludes the
    # nresp=2 box, so 3 of 4 (not all 4).
    assert conditioned["variants"]["sensitivity_unrestricted"]["n_boxes_selected"] == 3

    report_text = run_validation.render_report(results)
    assert MOCK_EVENT_ID in report_text
    assert "small band" in report_text
    assert "MOCK1" in report_text


def test_run_validation_degrades_gracefully_with_no_shakemap_product(mock_fetch, tmp_path):
    mock_fetch["detail.json"] = _mock_detail_json(with_shakemap=False, with_dyfi=False)

    results, fm, grid_xml, bare, conditioned = run_validation.run_validation(MOCK_EVENT_ID, tmp_path)

    assert results["product_availability"]["shakemap_available"] is False
    assert bare is None
    assert conditioned is None  # conditioning needs a grid to judge against
    assert grid_xml is None

    report_text = run_validation.render_report(results)
    assert "No ShakeMap product for this event" in report_text
    # nothing below product availability should be rendered
    assert "Conditioned comparison" not in report_text


def test_run_validation_documents_missing_dyfi_as_bare_prior_only(mock_fetch, tmp_path):
    mock_fetch["detail.json"] = _mock_detail_json(with_shakemap=True, with_dyfi=False)
    mock_fetch["grid.xml"] = _mock_grid_xml()
    mock_fetch["stationlist.json"] = _mock_stationlist_json()

    results, fm, grid_xml, bare, conditioned = run_validation.run_validation(MOCK_EVENT_ID, tmp_path)

    assert results["product_availability"]["dyfi_available"] is False
    assert bare is not None  # bare comparison still runs
    assert conditioned is None

    report_text = run_validation.render_report(results)
    assert "No DYFI product for this event" in report_text
    assert "bare-prior-only comparison is still valuable" in report_text
