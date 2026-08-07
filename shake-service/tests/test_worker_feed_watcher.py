"""feed_watcher.py: GeoJSON parsing + trigger-decision logic, fully
mocked/synthetic — no network."""

from __future__ import annotations

import pytest

from shake_service import config
from shake_service.worker import feed_watcher as fw
from shake_service.worker.state import EventState, WorkerState

REGION_LAT = 35.5  # inside REGION_BBOX (33.0-38.5, 41.0-48.5)
REGION_LON = 45.0
OUTSIDE_LAT = 10.0  # far south, outside bbox
OUTSIDE_LON = 45.0


def _feature(
    *, event_id="us1234", mag=4.0, lat=REGION_LAT, lon=REGION_LON, depth_km=10.0,
    place="Halabja region", time_ms=1_000, updated_ms=1_000,
) -> dict:
    return {
        "type": "Feature",
        "id": event_id,
        "properties": {"mag": mag, "place": place, "time": time_ms, "updated": updated_ms},
        "geometry": {"type": "Point", "coordinates": [lon, lat, depth_km]},
    }


def _payload(*features: dict) -> dict:
    return {"type": "FeatureCollection", "features": list(features)}


# ---------------------------------------------------------------------------
# parse_usgs_geojson
# ---------------------------------------------------------------------------


def test_parse_usgs_geojson_extracts_all_fields():
    payload = _payload(_feature(event_id="us2000bmcg", mag=6.3, lat=35.0, lon=45.0, depth_km=19.0))
    events = fw.parse_usgs_geojson(payload)
    assert len(events) == 1
    e = events[0]
    assert e.external_id == "us2000bmcg"
    assert e.source == "usgs"
    assert e.mag == 6.3
    assert e.lat == 35.0
    assert e.lon == 45.0
    assert e.depth_km == 19.0
    assert e.place == "Halabja region"
    assert e.time_ms == 1000
    assert e.updated_ms == 1000


def test_parse_usgs_geojson_skips_malformed_features():
    missing_mag = {"id": "bad1", "properties": {"place": "x"}, "geometry": {"coordinates": [45.0, 35.0, 10.0]}}
    missing_coords = {"id": "bad2", "properties": {"mag": 4.0}, "geometry": {}}
    good = _feature(event_id="good1")
    payload = _payload(missing_mag, missing_coords, good)
    events = fw.parse_usgs_geojson(payload)
    assert [e.external_id for e in events] == ["good1"]


def test_parse_usgs_geojson_empty_features_list_returns_empty():
    assert fw.parse_usgs_geojson({"type": "FeatureCollection", "features": []}) == []


def test_parse_usgs_geojson_missing_features_key_returns_empty():
    assert fw.parse_usgs_geojson({"type": "FeatureCollection"}) == []


# ---------------------------------------------------------------------------
# in_region
# ---------------------------------------------------------------------------


def test_in_region_true_for_kurdistan_bbox_point():
    event = fw.FeedEvent("id", "usgs", 4.0, REGION_LAT, REGION_LON, 10.0, "p", 0, 0)
    assert fw.in_region(event, config.REGION_BBOX) is True


def test_in_region_false_outside_bbox():
    event = fw.FeedEvent("id", "usgs", 4.0, OUTSIDE_LAT, OUTSIDE_LON, 10.0, "p", 0, 0)
    assert fw.in_region(event, config.REGION_BBOX) is False


# ---------------------------------------------------------------------------
# evaluate_feed_events — new event
# ---------------------------------------------------------------------------


def test_new_qualifying_event_in_region_above_floor():
    payload = _payload(_feature(mag=4.0))
    events = fw.parse_usgs_geojson(payload)
    ws = WorkerState()
    decisions = fw.evaluate_feed_events(events, ws)
    assert len(decisions) == 1
    assert decisions[0].kind == "new"


def test_event_out_of_region_is_skipped_even_above_floor():
    payload = _payload(_feature(mag=6.0, lat=OUTSIDE_LAT, lon=OUTSIDE_LON))
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, WorkerState())
    assert decisions[0].kind == "skip"
    assert "region" in decisions[0].reason


def test_event_below_magnitude_floor_is_skipped_even_in_region():
    payload = _payload(_feature(mag=3.4))  # just under 3.5
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, WorkerState())
    assert decisions[0].kind == "skip"
    assert "magnitude" in decisions[0].reason


def test_event_exactly_at_magnitude_floor_qualifies():
    payload = _payload(_feature(mag=3.5))
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, WorkerState())
    assert decisions[0].kind == "new"


# ---------------------------------------------------------------------------
# evaluate_feed_events — dedup against state
# ---------------------------------------------------------------------------


def _known_state(
    *, external_id="us1234", mag=4.0, lat=REGION_LAT, lon=REGION_LON, depth_km=10.0, updated_ms=1_000,
) -> EventState:
    return EventState(
        external_id=external_id, source="usgs", mag=mag, lat=lat, lon=lon, depth_km=depth_km,
        last_version=1, params_hash="hash1", product_paths={},
        last_feed_updated_ms=updated_ms,
        first_seen_at="2026-08-07T00:00:00+00:00", last_computed_at="2026-08-07T00:00:00+00:00",
    )


def test_known_event_with_unchanged_updated_ms_is_skipped_dedup():
    ws = WorkerState()
    ws.upsert_event(_known_state(updated_ms=1_000))
    payload = _payload(_feature(mag=4.0, updated_ms=1_000))  # same updated timestamp
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "skip"
    assert "dedup" in decisions[0].reason


def test_known_event_with_older_updated_ms_is_skipped():
    ws = WorkerState()
    ws.upsert_event(_known_state(updated_ms=5_000))
    payload = _payload(_feature(mag=4.0, updated_ms=1_000))  # feed somehow older than known
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "skip"


# ---------------------------------------------------------------------------
# evaluate_feed_events — update crossing thresholds
# ---------------------------------------------------------------------------


def test_update_triggers_on_magnitude_delta_at_or_above_threshold():
    ws = WorkerState()
    ws.upsert_event(_known_state(mag=4.0, updated_ms=1_000))
    payload = _payload(_feature(mag=4.1, updated_ms=2_000))  # delta 0.1
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "update"
    assert decisions[0].delta_mag == pytest.approx(0.1, abs=1e-9)


def test_update_triggers_on_location_delta_at_or_above_5km():
    ws = WorkerState()
    ws.upsert_event(_known_state(lat=35.0, lon=45.0, updated_ms=1_000))
    # ~5.5 km east at this latitude (~0.06 deg lon * 111.32*cos(35) ~5.47km)
    payload = _payload(_feature(mag=4.0, lat=35.0, lon=45.06, updated_ms=2_000))
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "update"
    assert decisions[0].delta_location_km >= 5.0


def test_update_triggers_on_depth_delta_at_or_above_5km():
    ws = WorkerState()
    ws.upsert_event(_known_state(depth_km=10.0, updated_ms=1_000))
    payload = _payload(_feature(mag=4.0, depth_km=15.0, updated_ms=2_000))
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "update"
    assert decisions[0].delta_depth_km == pytest.approx(5.0, abs=1e-9)


def test_update_not_triggered_below_all_thresholds():
    ws = WorkerState()
    ws.upsert_event(_known_state(mag=4.0, lat=35.0, lon=45.0, depth_km=10.0, updated_ms=1_000))
    payload = _payload(_feature(mag=4.05, lat=35.001, lon=45.001, depth_km=10.5, updated_ms=2_000))
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "skip"
    assert "below" in decisions[0].reason


# ---------------------------------------------------------------------------
# multiple events in one payload
# ---------------------------------------------------------------------------


def test_multiple_events_each_get_their_own_decision():
    payload = _payload(
        _feature(event_id="new1", mag=4.0),
        _feature(event_id="lowmag", mag=3.0),
        _feature(event_id="outside", mag=6.0, lat=OUTSIDE_LAT, lon=OUTSIDE_LON),
    )
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, WorkerState())
    by_id = {d.event.external_id: d.kind for d in decisions}
    assert by_id == {"new1": "new", "lowmag": "skip", "outside": "skip"}
