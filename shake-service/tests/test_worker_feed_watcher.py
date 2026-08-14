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
    *, external_id="us1234", source="usgs", mag=4.0, lat=REGION_LAT, lon=REGION_LON,
    depth_km=10.0, updated_ms=1_000, origin_time_ms=0,
) -> EventState:
    return EventState(
        external_id=external_id, source=source, mag=mag, lat=lat, lon=lon, depth_km=depth_km,
        last_version=1, params_hash="hash1", product_paths={},
        last_feed_updated_ms=updated_ms, origin_time_ms=origin_time_ms,
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


# ---------------------------------------------------------------------------
# EMSC completeness sweep: parse_emsc_geojson
# ---------------------------------------------------------------------------

# The real missed earthquake this wave exists for: 2026-08-13 22:28 UTC,
# M4.0 mb, "IRAN-IRAQ BORDER REGION" -- in EMSC's fdsnws, absent from USGS
# (below NEIC's ~M4.5 regional completeness).
BORDER_UNID = "20260813_0000321"
BORDER_TIME_ISO = "2026-08-13T22:28:04.0Z"
BORDER_TIME_MS = int(
    __import__("datetime").datetime(
        2026, 8, 13, 22, 28, 4, tzinfo=__import__("datetime").timezone.utc
    ).timestamp() * 1000
)


def _emsc_feature(
    *, unid=BORDER_UNID, mag=4.0, magtype="mb", lat=34.9, lon=45.9, depth=10.0,
    time_iso=BORDER_TIME_ISO, lastupdate_iso="2026-08-13T22:41:00.0Z",
    flynn_region="IRAN-IRAQ BORDER REGION",
) -> dict:
    return {
        "type": "Feature",
        "id": unid,
        "properties": {
            "unid": unid, "time": time_iso, "lastupdate": lastupdate_iso,
            "lat": lat, "lon": lon, "depth": depth, "mag": mag, "magtype": magtype,
            "flynn_region": flynn_region, "auth": "EMSC", "evtype": "ke",
        },
    }


def test_parse_emsc_geojson_maps_unid_iso_times_and_properties_coords():
    payload = _payload(_emsc_feature())
    events = fw.parse_emsc_geojson(payload)
    assert len(events) == 1
    e = events[0]
    assert e.external_id == BORDER_UNID
    assert e.source == "emsc"
    assert e.mag == 4.0
    assert e.lat == 34.9
    assert e.lon == 45.9
    assert e.depth_km == 10.0
    assert e.place == "IRAN-IRAQ BORDER REGION"
    assert e.time_ms == BORDER_TIME_MS
    # lastupdate is 12 min 56 s after origin.
    assert e.updated_ms == BORDER_TIME_MS + (12 * 60 + 56) * 1000


def test_parse_emsc_geojson_skips_malformed_features():
    no_mag = _emsc_feature(unid="bad1")
    no_mag["properties"]["mag"] = None
    no_unid = _emsc_feature()
    del no_unid["properties"]["unid"]
    bad_time = _emsc_feature(unid="bad3", time_iso="not-a-timestamp")
    good = _emsc_feature(unid="good1")
    events = fw.parse_emsc_geojson(_payload(no_mag, no_unid, bad_time, good))
    assert [e.external_id for e in events] == ["good1"]


def test_parse_emsc_geojson_unparseable_lastupdate_falls_back_to_origin_time():
    feature = _emsc_feature(lastupdate_iso="garbage")
    events = fw.parse_emsc_geojson(_payload(feature))
    assert events[0].updated_ms == events[0].time_ms


def test_parse_emsc_geojson_empty_or_missing_features_returns_empty():
    assert fw.parse_emsc_geojson({"type": "FeatureCollection", "features": []}) == []
    assert fw.parse_emsc_geojson({"type": "FeatureCollection"}) == []


# ---------------------------------------------------------------------------
# same_earthquake -- shared §2 dedup helper (16 s / 100 km / |dM| 1.5)
# ---------------------------------------------------------------------------


def _pair_kwargs(**overrides):
    base = dict(
        time_ms_a=BORDER_TIME_MS, lat_a=34.9, lon_a=45.9, mag_a=4.0,
        time_ms_b=BORDER_TIME_MS, lat_b=34.9, lon_b=45.9, mag_b=4.0,
    )
    base.update(overrides)
    return base


def test_same_earthquake_identical_params_match():
    assert fw.same_earthquake(**_pair_kwargs()) is True


def test_same_earthquake_time_boundary_16s_inclusive():
    assert fw.same_earthquake(**_pair_kwargs(time_ms_b=BORDER_TIME_MS + 16_000)) is True
    assert fw.same_earthquake(**_pair_kwargs(time_ms_b=BORDER_TIME_MS + 16_001)) is False


def test_same_earthquake_distance_boundary_100km():
    # dlat 0.89 deg ~= 98.97 km (inside); dlat 0.91 deg ~= 101.19 km (outside).
    assert fw.same_earthquake(**_pair_kwargs(lat_b=34.9 + 0.89)) is True
    assert fw.same_earthquake(**_pair_kwargs(lat_b=34.9 + 0.91)) is False


def test_same_earthquake_magnitude_boundary_1p5_inclusive():
    assert fw.same_earthquake(**_pair_kwargs(mag_b=5.5)) is True
    assert fw.same_earthquake(**_pair_kwargs(mag_b=5.51)) is False


# ---------------------------------------------------------------------------
# evaluate_feed_events -- cross-provider dedup via state
# ---------------------------------------------------------------------------


def test_emsc_record_of_a_usgs_tracked_event_is_skipped():
    # The same physical quake, already tracked under its USGS id: EMSC's
    # record (4 s later, ~5 km away, dM 0.1) must NOT re-trigger.
    ws = WorkerState()
    ws.upsert_event(
        _known_state(external_id="us7000abcd", source="usgs", mag=4.1,
                     lat=34.93, lon=45.9, origin_time_ms=BORDER_TIME_MS - 4_000)
    )
    events = fw.parse_emsc_geojson(_payload(_emsc_feature()))
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "skip"
    assert "cross-provider" in decisions[0].reason
    assert "usgs:us7000abcd" in decisions[0].reason


def test_usgs_record_of_an_emsc_tracked_event_is_skipped_vice_versa():
    # First seen via EMSC (USGS published later): the USGS record must not
    # create a second event entry either.
    ws = WorkerState()
    ws.upsert_event(
        _known_state(external_id=BORDER_UNID, source="emsc", mag=4.0,
                     lat=34.9, lon=45.9, origin_time_ms=BORDER_TIME_MS)
    )
    payload = _payload(_feature(
        event_id="us7000abcd", mag=4.1, lat=34.93, lon=45.9,
        time_ms=BORDER_TIME_MS - 4_000, updated_ms=BORDER_TIME_MS,
    ))
    events = fw.parse_usgs_geojson(payload)
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "skip"
    assert "cross-provider" in decisions[0].reason
    assert f"emsc:{BORDER_UNID}" in decisions[0].reason


def test_distinct_emsc_event_near_a_tracked_usgs_event_still_triggers():
    # Same area but 3 hours later -- a different quake, must trigger.
    ws = WorkerState()
    ws.upsert_event(
        _known_state(external_id="us7000abcd", source="usgs", mag=4.1,
                     lat=34.9, lon=45.9, origin_time_ms=BORDER_TIME_MS - 3 * 3600 * 1000)
    )
    events = fw.parse_emsc_geojson(_payload(_emsc_feature()))
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "new"


def test_legacy_state_without_origin_time_never_cross_matches():
    # Pre-upgrade state entries carry origin_time_ms == 0 (unknown): they
    # must never satisfy the time criterion, so a same-place EMSC record is
    # treated as new rather than silently swallowed on distance alone.
    ws = WorkerState()
    ws.upsert_event(
        _known_state(external_id="us_legacy", source="usgs", mag=4.0,
                     lat=34.9, lon=45.9, origin_time_ms=0)
    )
    events = fw.parse_emsc_geojson(_payload(_emsc_feature()))
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "new"


def test_same_provider_records_never_use_cross_provider_matching():
    # Two USGS ids for near-identical params: same-provider dedup is by id
    # (exact match, step 1) -- the spatial-temporal step must not apply, so
    # a genuinely distinct USGS id triggers.
    ws = WorkerState()
    ws.upsert_event(
        _known_state(external_id="us_a", source="usgs", mag=4.0,
                     lat=34.9, lon=45.9, origin_time_ms=BORDER_TIME_MS)
    )
    payload = _payload(_feature(
        event_id="us_b", mag=4.0, lat=34.9, lon=45.9,
        time_ms=BORDER_TIME_MS + 2_000, updated_ms=BORDER_TIME_MS,
    ))
    decisions = fw.evaluate_feed_events(fw.parse_usgs_geojson(payload), ws)
    assert decisions[0].kind == "new"


# ---------------------------------------------------------------------------
# evaluate_feed_events -- EMSC-only events against the trigger gates
# ---------------------------------------------------------------------------


def test_emsc_only_m4_border_event_triggers_the_pipeline():
    # REGRESSION -- the real missed earthquake: M4.0 >= the 3.5 floor,
    # inside the region bbox, absent from USGS/state. The USGS-only watcher
    # never saw it; the EMSC sweep must produce a "new" trigger for it.
    events = fw.parse_emsc_geojson(_payload(_emsc_feature()))
    decisions = fw.evaluate_feed_events(events, WorkerState())
    assert len(decisions) == 1
    assert decisions[0].kind == "new"
    assert decisions[0].event.external_id == BORDER_UNID
    assert decisions[0].event.source == "emsc"
    assert decisions[0].event.mag == 4.0


def test_emsc_event_below_magnitude_floor_is_skipped():
    events = fw.parse_emsc_geojson(_payload(_emsc_feature(unid="small", mag=3.4)))
    decisions = fw.evaluate_feed_events(events, WorkerState())
    assert decisions[0].kind == "skip"
    assert "magnitude" in decisions[0].reason


def test_emsc_event_outside_region_bbox_is_skipped():
    events = fw.parse_emsc_geojson(
        _payload(_emsc_feature(unid="far_away", mag=5.0, lat=10.0, lon=45.0))
    )
    decisions = fw.evaluate_feed_events(events, WorkerState())
    assert decisions[0].kind == "skip"
    assert "region" in decisions[0].reason


# ---------------------------------------------------------------------------
# GEOFON completeness sweep: parse_geofon_text
# ---------------------------------------------------------------------------

# The header line the live service emits plus a VERIFIED live data row
# (fetched from geofon.gfz.de/fdsnws/event/1/query with format=text on
# 2026-08-14): an intermediate-depth (55 km) mb 4.48 under Iraq. Note the
# empty Author/Catalog/MagAuthor columns -- real GEOFON rows carry empties.
GEOFON_HEADER = (
    "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor"
    "|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType"
)
GEOFON_VERIFIED_ROW = (
    "gfz2026oyxe|2026-08-01T20:27:43.07|35.406|44.659|55.0|||GFZ"
    "|gfz2026oyxe|mb|4.48||Iraq|earthquake"
)
GEOFON_TIME_MS = int(
    __import__("datetime").datetime(
        2026, 8, 1, 20, 27, 43, 70_000, tzinfo=__import__("datetime").timezone.utc
    ).timestamp() * 1000
)


def _geofon_row(
    *, event_id="gfz2026test", time_iso="2026-08-13T22:28:04.0", lat=34.9, lon=45.9,
    depth=10.0, magtype="mb", mag="4.0", place="Iraq",
) -> str:
    return f"{event_id}|{time_iso}|{lat}|{lon}|{depth}|||GFZ|{event_id}|{magtype}|{mag}||{place}|earthquake"


def _geofon_text(*rows: str) -> str:
    return "\n".join([GEOFON_HEADER, *rows]) + "\n"


def test_parse_geofon_text_maps_the_verified_live_row():
    events = fw.parse_geofon_text(_geofon_text(GEOFON_VERIFIED_ROW))
    assert len(events) == 1
    e = events[0]
    assert e.external_id == "gfz2026oyxe"
    assert e.source == "geofon"
    assert e.mag == 4.48
    assert e.lat == 35.406
    assert e.lon == 44.659
    assert e.depth_km == 55.0
    assert e.place == "Iraq"
    # Zone-less FDSN time read as UTC (the fractional ".07" s = 70 ms) --
    # NEVER local time.
    assert e.time_ms == GEOFON_TIME_MS
    # The text format has no update-timestamp column: falls back to origin.
    assert e.updated_ms == GEOFON_TIME_MS


def test_parse_geofon_text_skips_header_blank_lines_and_empty_body():
    assert fw.parse_geofon_text("") == []
    assert fw.parse_geofon_text(GEOFON_HEADER + "\n") == []
    assert fw.parse_geofon_text("\n\n" + GEOFON_HEADER + "\n\n") == []


def test_parse_geofon_text_skips_malformed_rows_keeping_good_ones():
    too_few_fields = "gfzbad1|2026-08-13T22:00:00|34.9|45.9"
    empty_magnitude = _geofon_row(event_id="gfzbad2", mag="")  # not-yet-reviewed placeholder
    bad_latitude = _geofon_row(event_id="gfzbad3", lat="not-a-number")
    bad_time = _geofon_row(event_id="gfzbad4", time_iso="not-a-timestamp")
    empty_id = _geofon_row(event_id="")
    good = GEOFON_VERIFIED_ROW
    events = fw.parse_geofon_text(
        _geofon_text(too_few_fields, empty_magnitude, bad_latitude, bad_time, empty_id, good)
    )
    assert [e.external_id for e in events] == ["gfz2026oyxe"]


def test_parse_geofon_text_accepts_a_13_column_row_without_event_type():
    # A strict 13-column FDSN text source (another SeisComP deployment,
    # e.g. the future Kurdistan/Iraq data center) must parse too -- the
    # parser is deliberately reusable (provider-architecture.md).
    thirteen = "kur2026abcd|2026-08-13T22:28:04.0|35.5|45.5|12.0|||KUR|kur2026abcd|ml|3.9||Kurdistan Region, Iraq"
    events = fw.parse_geofon_text(_geofon_text(thirteen))
    assert len(events) == 1
    assert events[0].external_id == "kur2026abcd"
    assert events[0].mag == 3.9


# ---------------------------------------------------------------------------
# evaluate_feed_events -- three-way cross-provider dedup with GEOFON
# ---------------------------------------------------------------------------


def test_geofon_record_of_a_usgs_tracked_event_is_skipped():
    ws = WorkerState()
    ws.upsert_event(
        _known_state(external_id="us7000abcd", source="usgs", mag=4.1,
                     lat=34.93, lon=45.9, origin_time_ms=BORDER_TIME_MS - 4_000)
    )
    events = fw.parse_geofon_text(_geofon_text(_geofon_row(event_id="gfz2026dupe")))
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "skip"
    assert "cross-provider" in decisions[0].reason
    assert "usgs:us7000abcd" in decisions[0].reason


def test_geofon_record_of_an_emsc_tracked_event_is_skipped():
    # Canonical order USGS > EMSC > GEOFON: an event USGS never published
    # but EMSC's sweep already tracked must not re-trigger from GEOFON.
    ws = WorkerState()
    ws.upsert_event(
        _known_state(external_id=BORDER_UNID, source="emsc", mag=4.0,
                     lat=34.9, lon=45.9, origin_time_ms=BORDER_TIME_MS)
    )
    events = fw.parse_geofon_text(_geofon_text(_geofon_row(event_id="gfz2026dupe")))
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "skip"
    assert f"emsc:{BORDER_UNID}" in decisions[0].reason


def test_emsc_record_of_a_geofon_tracked_event_is_skipped_vice_versa():
    # GEOFON published first (it can be fastest for regional events): the
    # later EMSC record must dedup against the geofon-keyed entry.
    ws = WorkerState()
    ws.upsert_event(
        _known_state(external_id="gfz2026oyxe", source="geofon", mag=4.48,
                     lat=35.406, lon=44.659, origin_time_ms=GEOFON_TIME_MS)
    )
    events = fw.parse_emsc_geojson(_payload(_emsc_feature(
        unid="20260801_0000123", mag=4.4, lat=35.4, lon=44.7,
        time_iso="2026-08-01T20:27:45.0Z",
    )))
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "skip"
    assert "geofon:gfz2026oyxe" in decisions[0].reason


def test_distinct_geofon_event_near_a_tracked_usgs_event_still_triggers():
    ws = WorkerState()
    ws.upsert_event(
        _known_state(external_id="us7000abcd", source="usgs", mag=4.1,
                     lat=34.9, lon=45.9, origin_time_ms=BORDER_TIME_MS - 3 * 3600 * 1000)
    )
    events = fw.parse_geofon_text(_geofon_text(_geofon_row(event_id="gfz2026new")))
    decisions = fw.evaluate_feed_events(events, ws)
    assert decisions[0].kind == "new"


def test_geofon_only_qualifying_event_triggers_the_pipeline():
    # The verified gfz2026oyxe intermediate-depth event: mb 4.48 >= the 3.5
    # floor, inside the bbox, absent from USGS/EMSC/state -> "new".
    events = fw.parse_geofon_text(_geofon_text(GEOFON_VERIFIED_ROW))
    decisions = fw.evaluate_feed_events(events, WorkerState())
    assert len(decisions) == 1
    assert decisions[0].kind == "new"
    assert decisions[0].event.external_id == "gfz2026oyxe"
    assert decisions[0].event.source == "geofon"


def test_geofon_event_below_magnitude_floor_is_skipped():
    events = fw.parse_geofon_text(_geofon_text(_geofon_row(event_id="gfzsmall", mag="3.4")))
    decisions = fw.evaluate_feed_events(events, WorkerState())
    assert decisions[0].kind == "skip"
    assert "magnitude" in decisions[0].reason
