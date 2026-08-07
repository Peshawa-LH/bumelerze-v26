"""pipeline.py: versioned product export + idempotent restarts, on a
mocked small event. Speed: `config.grid_extent_km`/`forward_grid_spacing_km`
are monkeypatched to force a tiny (2x2-site) grid — the REAL gmm/hazardlib
compute still runs (this is not a mocked GMM), just over 4 sites instead of
the full ~100x100 a small-band event would normally build, per the task's
"patch the gmm compute with a tiny grid for speed" instruction.
"""

from __future__ import annotations

import json

import pytest

from shake_service import config
from shake_service.worker.feed_watcher import FeedEvent, TriggerDecision
from shake_service.worker.pipeline import PipelineResult, params_hash, run_pipeline
from shake_service.worker.state import WorkerState
from shake_service.worker.uploader import LocalOnlyUploader


@pytest.fixture(autouse=True)
def tiny_grid(monkeypatch):
    """Force every band onto a 2x2 site grid (half_extent=10 km,
    spacing=50 km -> n_steps = max(round(20/50)+1, 2) = 2) so the real
    forward-map pipeline runs in milliseconds, not seconds."""
    monkeypatch.setattr(config, "grid_extent_km", lambda band: 10.0)
    monkeypatch.setattr(config, "forward_grid_spacing_km", lambda band: 50.0)


def _new_decision(
    *, event_id="us_pipe_1", mag=4.0, lat=35.5, lon=45.0, depth_km=10.0, updated_ms=1_000,
) -> TriggerDecision:
    event = FeedEvent(
        external_id=event_id, source="usgs", mag=mag, lat=lat, lon=lon, depth_km=depth_km,
        place="test", time_ms=updated_ms, updated_ms=updated_ms,
    )
    return TriggerDecision(kind="new", event=event, reason="new qualifying event")


def _update_decision(base: TriggerDecision, **overrides) -> TriggerDecision:
    event = base.event
    fields = dict(
        external_id=event.external_id, source=event.source, mag=event.mag, lat=event.lat,
        lon=event.lon, depth_km=event.depth_km, place=event.place, time_ms=event.time_ms,
        updated_ms=event.updated_ms,
    )
    fields.update(overrides)
    return TriggerDecision(kind="update", event=FeedEvent(**fields), reason="revision crosses recompute threshold")


def _uploader():
    calls: list[dict] = []

    class RecordingUploader(LocalOnlyUploader):
        def upload_products(self, **kwargs):
            calls.append(kwargs)
            return super().upload_products(**kwargs)

    return RecordingUploader(log_fn=lambda *_: None), calls


def test_new_event_produces_v1_products_and_updates_state(tmp_path):
    ws = WorkerState()
    uploader, calls = _uploader()
    decision = _new_decision()

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)

    assert isinstance(result, PipelineResult)
    assert result.recomputed is True
    assert result.version == 1
    assert result.event_id == "us_pipe_1"
    v1_dir = tmp_path / "us_pipe_1" / "v1"
    assert (v1_dir / "cont_mi.json").exists()
    assert (v1_dir / "info.json").exists()
    assert (v1_dir / "grid.json").exists()

    known = ws.get_event("us_pipe_1")
    assert known is not None
    assert known.last_version == 1
    assert known.product_paths["info"] == str(v1_dir / "info.json")
    assert len(calls) == 1
    assert len(result.upload_records) == 3


def test_replaying_the_same_new_decision_is_idempotent_no_new_version(tmp_path):
    ws = WorkerState()
    uploader, calls = _uploader()
    decision = _new_decision()

    first = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)
    second = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)

    assert first.recomputed is True
    assert second.recomputed is False
    assert second.version == 1
    assert not (tmp_path / "us_pipe_1" / "v2").exists()
    assert len(calls) == 1  # uploader only invoked on the real compute


def test_update_with_changed_params_bumps_version_and_retains_old(tmp_path):
    ws = WorkerState()
    uploader, calls = _uploader()
    first_decision = _new_decision(mag=4.0)
    run_pipeline(first_decision, ws, products_root=tmp_path, uploader=uploader)

    changed_decision = _update_decision(first_decision, mag=4.5, updated_ms=2_000)
    result = run_pipeline(changed_decision, ws, products_root=tmp_path, uploader=uploader)

    assert result.recomputed is True
    assert result.version == 2
    v1_dir = tmp_path / "us_pipe_1" / "v1"
    v2_dir = tmp_path / "us_pipe_1" / "v2"
    assert v1_dir.exists() and (v1_dir / "info.json").exists()  # old version retained (D9)
    assert v2_dir.exists() and (v2_dir / "info.json").exists()
    assert len(calls) == 2

    known = ws.get_event("us_pipe_1")
    assert known.last_version == 2
    assert known.mag == 4.5


def test_update_replaying_identical_params_after_a_real_bump_is_idempotent(tmp_path):
    ws = WorkerState()
    uploader, calls = _uploader()
    decision = _new_decision(mag=4.0)
    run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)

    bump = _update_decision(decision, mag=4.5, updated_ms=2_000)
    run_pipeline(bump, ws, products_root=tmp_path, uploader=uploader)

    replay = _update_decision(decision, mag=4.5, updated_ms=3_000)  # same params, different feed updated_ms
    result = run_pipeline(replay, ws, products_root=tmp_path, uploader=uploader)

    assert result.recomputed is False
    assert result.version == 2
    assert not (tmp_path / "us_pipe_1" / "v3").exists()
    assert len(calls) == 2  # no third upload


def test_params_hash_is_stable_for_identical_rounded_inputs():
    a = params_hash(lat=35.0001, lon=45.0001, depth_km=10.001, mag=4.001)
    b = params_hash(lat=35.0001, lon=45.0001, depth_km=10.001, mag=4.001)
    assert a == b


def test_params_hash_differs_for_a_real_magnitude_change():
    a = params_hash(lat=35.0, lon=45.0, depth_km=10.0, mag=4.0)
    b = params_hash(lat=35.0, lon=45.0, depth_km=10.0, mag=4.5)
    assert a != b


def test_written_info_json_is_valid_json_with_expected_event_fields(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision(mag=4.0, lat=35.5, lon=45.0, depth_km=10.0)
    run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)

    info = json.loads((tmp_path / "us_pipe_1" / "v1" / "info.json").read_text())
    assert info["event"]["mag_mw"] == pytest.approx(4.0)
    assert info["event"]["lat"] == pytest.approx(35.5)
    assert info["producer"] == "bumelerze-shake-service"


# ---------------------------------------------------------------------------
# D21: USGS product fetch wiring — conditioning + automatic comparison
# ---------------------------------------------------------------------------

import json as _json

from shake_service.worker import usgs_products


def _grid_xml_text(*, lon, lat, pga_pctg=10.0, pgv_cms=5.0, mmi=6.0):
    return (
        "<shakemap_grid>"
        f'<event event_id="test" magnitude="4.0" depth="10.0" lat="{lat}" lon="{lon}" />'
        f'<grid_specification lon_min="{lon - 1}" lat_min="{lat - 1}" lon_max="{lon + 1}" '
        f'lat_max="{lat + 1}" nominal_lon_spacing="1.0" nominal_lat_spacing="1.0" nlon="1" nlat="1" />'
        '<grid_field index="1" name="LON" />'
        '<grid_field index="2" name="LAT" />'
        '<grid_field index="3" name="PGA" />'
        '<grid_field index="4" name="PGV" />'
        '<grid_field index="5" name="MMI" />'
        f"<grid_data>{lon} {lat} {pga_pctg} {pgv_cms} {mmi}</grid_data>"
        "</shakemap_grid>"
    )


def _stationlist_text(*, lon, lat, distance=1.0, pga=0.05, pgv=1.0):
    return _json.dumps({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "TU", "station_type": "seismic", "network": "TU", "code": "AAA",
                "distance": distance, "pga": pga, "pgv": pgv,
            },
        }],
    })


def _dyfi_geo_text(*, lon, lat, dist=2.0, nresp=5, cdi=6.0):
    d = 0.01
    return _json.dumps({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[lon - d, lat - d], [lon - d, lat + d], [lon + d, lat + d], [lon + d, lat - d]]],
            },
            "properties": {"cdi": cdi, "nresp": nresp, "dist": dist, "stddev": 0.3},
        }],
    })


def _rupture_json_text(*, lon, lat):
    d = 0.05  # ~5.5 km at this latitude -- comfortably inside the tiny 10 km-half-extent test grid
    return _json.dumps({
        "metadata": {"mag": 4.0, "depth": 10.0, "rake": 0.0, "mech": "ALL", "reference": "test"},
        "features": [{
            "type": "Feature",
            "properties": {"rupture type": "rupture extent"},
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [[[
                    [lon - d, lat - d, 5.0],
                    [lon - d, lat + d, 5.0],
                    [lon + d, lat + d, 15.0],
                    [lon + d, lat - d, 15.0],
                    [lon - d, lat - d, 5.0],
                ]]],
            },
        }],
        "type": "FeatureCollection",
    })


def _counting_fetcher(products: usgs_products.UsgsEventProducts):
    calls = []

    def fetch(event_id: str) -> usgs_products.UsgsEventProducts:
        calls.append(event_id)
        return products

    return fetch, calls


def test_default_fetcher_makes_zero_network_calls(tmp_path):
    # No usgs_products_fetcher passed at all -- must never touch the network
    # or attempt any USGS parsing (backward-compatible default).
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision()
    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)
    assert result.has_comparison is False
    assert result.comparison_path is None
    assert result.conditioning_sources == ()
    assert not (tmp_path / "us_pipe_1" / "v1" / "compatibility.json").exists()


def test_no_usgs_shakemap_grid_means_no_comparison(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision()
    products = usgs_products.UsgsEventProducts(event_id="us_pipe_1")  # nothing available
    fetch, calls = _counting_fetcher(products)

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    assert calls == ["us_pipe_1"]
    assert result.has_comparison is False
    known = ws.get_event("us_pipe_1")
    assert known.has_comparison is False
    assert known.comparison_path is None


def test_usgs_shakemap_grid_present_triggers_automatic_comparison(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision(lat=35.5, lon=45.0)
    grid_text = _grid_xml_text(lon=45.0, lat=35.5)
    products = usgs_products.UsgsEventProducts(
        event_id="us_pipe_1", shakemap_available=True, shakemap_product_id="urn:test:1", grid_xml_text=grid_text,
    )
    fetch, _ = _counting_fetcher(products)

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    assert result.has_comparison is True
    compat_path = tmp_path / "us_pipe_1" / "v1" / "compatibility.json"
    assert result.comparison_path == compat_path
    assert compat_path.exists()
    payload = _json.loads(compat_path.read_text())
    assert payload["usgs_shakemap_product_id"] == "urn:test:1"
    assert payload["our_version"] == 1
    assert "verdict" in payload and "comparison" in payload

    known = ws.get_event("us_pipe_1")
    assert known.has_comparison is True
    assert known.comparison_path == str(compat_path)


def test_malformed_grid_xml_does_not_abort_the_recompute(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision()
    products = usgs_products.UsgsEventProducts(
        event_id="us_pipe_1", shakemap_available=True, grid_xml_text="<not valid grid xml>",
    )
    fetch, _ = _counting_fetcher(products)

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    assert result.recomputed is True
    assert result.has_comparison is False
    assert (tmp_path / "us_pipe_1" / "v1" / "info.json").exists()


def test_station_and_dyfi_data_condition_the_map_and_record_sources(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision(lat=35.5, lon=45.0)
    products = usgs_products.UsgsEventProducts(
        event_id="us_pipe_1",
        stationlist_text=_stationlist_text(lon=45.0, lat=35.5),
        dyfi_available=True,
        dyfi_geo_10km_text=_dyfi_geo_text(lon=45.0, lat=35.5),
    )
    fetch, _ = _counting_fetcher(products)

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    assert set(result.conditioning_sources) == {"stations", "dyfi"}
    info = _json.loads((tmp_path / "us_pipe_1" / "v1" / "info.json").read_text())
    assert info["data_used"]["usgs_stationlist_available"] is True
    assert info["data_used"]["usgs_dyfi_available"] is True
    assert info["data_used"]["instrument_stations_parsed"] == 1
    assert info["data_used"]["dyfi_boxes_parsed"] == 1


def test_no_station_or_dyfi_data_means_empty_conditioning_sources(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision()
    products = usgs_products.UsgsEventProducts(event_id="us_pipe_1")
    fetch, _ = _counting_fetcher(products)

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    assert result.conditioning_sources == ()
    info = _json.loads((tmp_path / "us_pipe_1" / "v1" / "info.json").read_text())
    assert info["data_used"]["instrument_stations_parsed"] == 0
    assert info["data_used"]["dyfi_boxes_parsed"] == 0


def test_idempotent_replay_never_refetches_usgs_products_or_rewrites_compatibility(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision(lat=35.5, lon=45.0)
    grid_text = _grid_xml_text(lon=45.0, lat=35.5)
    products = usgs_products.UsgsEventProducts(
        event_id="us_pipe_1", shakemap_available=True, grid_xml_text=grid_text,
    )
    fetch, calls = _counting_fetcher(products)

    first = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)
    compat_path = tmp_path / "us_pipe_1" / "v1" / "compatibility.json"
    written_at_first = compat_path.read_text()

    second = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    assert calls == ["us_pipe_1"]  # fetched exactly once, never again on replay
    assert first.recomputed is True
    assert second.recomputed is False
    assert second.has_comparison is True  # carried over from known state, not recomputed
    assert compat_path.read_text() == written_at_first


def test_info_json_review_status_is_automatic_by_default(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision()
    run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)
    info = _json.loads((tmp_path / "us_pipe_1" / "v1" / "info.json").read_text())
    assert info["review_status"] == "automatic"


def test_upload_records_carry_automatic_review_status(tmp_path):
    ws = WorkerState()
    uploader, calls = _uploader()
    decision = _new_decision()
    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)
    assert all(r.review_status == "automatic" for r in result.upload_records)


# ---------------------------------------------------------------------------
# D22: rupture.json wiring — finite-fault distance method selection
# ---------------------------------------------------------------------------


def test_rupture_model_available_selects_finite_fault_distance_method(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision(lat=35.5, lon=45.0)
    products = usgs_products.UsgsEventProducts(
        event_id="us_pipe_1", rupture_available=True, rupture_json_text=_rupture_json_text(lon=45.0, lat=35.5),
    )
    fetch, _ = _counting_fetcher(products)

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    info = _json.loads((tmp_path / "us_pipe_1" / "v1" / "info.json").read_text())
    assert info["data_used"]["distance_method"] == "finite-fault"
    assert info["data_used"]["rupture_quads_used"] == 1
    assert info["data_used"]["usgs_rupture_available"] is True
    assert result.recomputed is True


def test_no_rupture_model_keeps_ps2ff_distance_method(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision()
    products = usgs_products.UsgsEventProducts(event_id="us_pipe_1")
    fetch, _ = _counting_fetcher(products)

    run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    info = _json.loads((tmp_path / "us_pipe_1" / "v1" / "info.json").read_text())
    assert info["data_used"]["distance_method"] == "ps2ff"
    assert info["data_used"]["rupture_quads_used"] == 0
    assert info["data_used"]["usgs_rupture_available"] is False


def test_malformed_rupture_json_does_not_abort_the_recompute(tmp_path):
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision()
    products = usgs_products.UsgsEventProducts(
        event_id="us_pipe_1", rupture_available=True, rupture_json_text="{not valid json",
    )
    fetch, _ = _counting_fetcher(products)

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    assert result.recomputed is True
    info = _json.loads((tmp_path / "us_pipe_1" / "v1" / "info.json").read_text())
    assert info["data_used"]["distance_method"] == "ps2ff"


def test_finite_fault_distance_method_survives_conditioning(tmp_path):
    # D22: conditioned_forward.py must MERGE, not replace, data_used --
    # distance_method/rupture_quads_used must still be present after
    # station+DYFI conditioning is applied on top of a finite-fault prior.
    ws = WorkerState()
    uploader, _ = _uploader()
    decision = _new_decision(lat=35.5, lon=45.0)
    products = usgs_products.UsgsEventProducts(
        event_id="us_pipe_1",
        rupture_available=True, rupture_json_text=_rupture_json_text(lon=45.0, lat=35.5),
        stationlist_text=_stationlist_text(lon=45.0, lat=35.5),
        dyfi_available=True, dyfi_geo_10km_text=_dyfi_geo_text(lon=45.0, lat=35.5),
    )
    fetch, _ = _counting_fetcher(products)

    run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fetch)

    info = _json.loads((tmp_path / "us_pipe_1" / "v1" / "info.json").read_text())
    assert info["data_used"]["source"] == "catalog+dyfi"  # conditioning did run
    assert info["data_used"]["distance_method"] == "finite-fault"  # and survived it
    assert info["data_used"]["rupture_quads_used"] == 1


# ---------------------------------------------------------------------------
# D22: force= bypasses the params-hash short circuit
# ---------------------------------------------------------------------------


def test_force_bumps_version_even_with_unchanged_params(tmp_path):
    ws = WorkerState()
    uploader, calls = _uploader()
    decision = _new_decision()
    run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader, force=True)

    assert result.recomputed is True
    assert result.version == 2
    v1_dir = tmp_path / "us_pipe_1" / "v1"
    v2_dir = tmp_path / "us_pipe_1" / "v2"
    assert v1_dir.exists() and (v1_dir / "info.json").exists()  # old version retained
    assert v2_dir.exists() and (v2_dir / "info.json").exists()
    assert len(calls) == 2


def test_without_force_unchanged_params_still_short_circuits(tmp_path):
    ws = WorkerState()
    uploader, calls = _uploader()
    decision = _new_decision()
    run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)

    result = run_pipeline(decision, ws, products_root=tmp_path, uploader=uploader)  # force defaults False

    assert result.recomputed is False
    assert result.version == 1
    assert len(calls) == 1
