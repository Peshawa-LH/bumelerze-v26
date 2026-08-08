"""build_regional_catalog.py: pure-logic unit tests for the merge/dedup
algorithm, the haversine/bbox helpers, and the mixed-format USGS time
parser — deliberately NOT exercising the `read_*` source readers (those
depend on the read-only OneDrive vault, which isn't available in CI/other
machines and shouldn't be a test dependency). See that module's docstring
for the full algorithm description this file is testing against."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_regional_catalog as brc  # noqa: E402


def _dt(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def _record(
    source_catalog="USGS",
    source_id=None,
    isc_event_id=None,
    time=_dt(2020, 1, 1, 0, 0, 0),
    lat=35.5,
    lon=45.0,
    depth_km=10.0,
    mag=4.5,
    mag_type="mb",
):
    return brc.RawRecord(
        source_catalog=source_catalog,
        source_id=source_id,
        isc_event_id=isc_event_id,
        time=time,
        lat=lat,
        lon=lon,
        depth_km=depth_km,
        mag=mag,
        mag_type=mag_type,
    )


class TestHaversine:
    def test_zero_distance(self):
        assert brc.haversine_km(35.5, 45.0, 35.5, 45.0) == 0.0

    def test_one_degree_latitude_is_about_111km(self):
        # A well-known approximation, independent of longitude/cos(lat).
        d = brc.haversine_km(35.0, 45.0, 36.0, 45.0)
        assert 110.0 < d < 112.0

    def test_symmetric(self):
        a = brc.haversine_km(35.5, 45.0, 36.6, 44.0)
        b = brc.haversine_km(36.6, 44.0, 35.5, 45.0)
        assert a == b


class TestInBbox:
    def test_inside(self):
        assert brc.in_bbox(35.5, 45.0) is True

    def test_outside_lat(self):
        assert brc.in_bbox(50.0, 45.0) is False

    def test_outside_lon(self):
        assert brc.in_bbox(35.5, 10.0) is False

    def test_boundary_inclusive(self):
        assert brc.in_bbox(brc.BBOX_LAT_MIN, brc.BBOX_LON_MIN) is True
        assert brc.in_bbox(brc.BBOX_LAT_MAX, brc.BBOX_LON_MAX) is True


class TestParseUsgsTime:
    def test_full_iso_with_millis(self):
        dt, date_only = brc._parse_usgs_time("2023-10-09T07:07:08.226Z")
        assert dt == datetime(2023, 10, 9, 7, 7, 8, 226000)
        assert date_only is False

    def test_full_iso_no_millis(self):
        dt, date_only = brc._parse_usgs_time("2023-10-09T07:07:08Z")
        assert dt == datetime(2023, 10, 9, 7, 7, 8)
        assert date_only is False

    def test_date_only_ddmmyyyy(self):
        dt, date_only = brc._parse_usgs_time("20/06/1990")
        assert dt == datetime(1990, 6, 20)
        assert date_only is True

    def test_truncated_iso_date(self):
        dt, date_only = brc._parse_usgs_time("1983-07-22T")
        assert dt == datetime(1983, 7, 22)
        assert date_only is True

    def test_unparseable_returns_none(self):
        dt, date_only = brc._parse_usgs_time("not-a-date")
        assert dt is None
        assert date_only is False


class TestMergerExactIdMatch:
    def test_same_source_same_id_attaches(self):
        merger = brc.Merger()
        r1 = _record(source_catalog="USGS", source_id="us2000bmcg", mag=7.3)
        r2 = _record(
            source_catalog="USGS",
            source_id="us2000bmcg",
            time=_dt(2020, 6, 1),  # far outside the 16s window
            lat=10.0,  # far outside the 100km window too
            lon=10.0,
            mag=1.0,  # far outside |ΔM|<=1.5 too
        )
        merger.ingest(r1)
        merger.ingest(r2)
        assert len(merger.events) == 1
        ev = merger.events[0]
        # Canonical fields come from the CREATING record (r1), never r2 —
        # exact-id match is a pure attach, not a field override.
        assert ev.mag == 7.3
        assert ev.merged_count == 2

    def test_different_source_same_id_does_not_match(self):
        merger = brc.Merger()
        r1 = _record(source_catalog="USGS", source_id="123")
        r2 = _record(source_catalog="KISC", source_id="123", time=_dt(2020, 6, 1))
        merger.ingest(r1)
        merger.ingest(r2)
        assert len(merger.events) == 2


class TestMergerIscEventIdMatch:
    def test_cross_reference_match_attaches_despite_drift(self):
        merger = brc.Merger()
        r1 = _record(source_catalog="ISCGEM", isc_event_id=12345, mag=6.0)
        r2 = _record(
            source_catalog="ONUR2017",
            isc_event_id=12345,
            time=_dt(2020, 1, 5),  # far outside the 16s window
            lat=20.0,
            lon=20.0,
            mag=1.0,
        )
        merger.ingest(r1)
        merger.ingest(r2)
        assert len(merger.events) == 1
        assert merger.events[0].mag == 6.0
        assert merger.events[0].contributing_sources == {"ISCGEM", "ONUR2017"}


class TestMergerSpatiotemporalMatch:
    def test_close_in_time_distance_and_mag_merges(self):
        merger = brc.Merger()
        r1 = _record(source_catalog="ONUR2017", mag=5.0, time=_dt(2020, 1, 1, 12, 0, 0))
        r2 = _record(
            source_catalog="USGS",
            mag=5.2,
            time=_dt(2020, 1, 1, 12, 0, 10),  # 10s later — inside the 16s window
            lat=35.6,  # ~11km away — inside the 100km window
            lon=45.0,
        )
        merger.ingest(r1)
        merger.ingest(r2)
        assert len(merger.events) == 1
        # Canonical fields are ONUR2017's (higher priority, ingested first).
        assert merger.events[0].mag == 5.0
        assert merger.events[0].source_catalog == "ONUR2017"

    def test_outside_time_window_does_not_merge(self):
        merger = brc.Merger()
        r1 = _record(time=_dt(2020, 1, 1, 12, 0, 0))
        r2 = _record(time=_dt(2020, 1, 1, 12, 0, 30))  # 30s later
        merger.ingest(r1)
        merger.ingest(r2)
        assert len(merger.events) == 2

    def test_outside_distance_window_does_not_merge(self):
        merger = brc.Merger()
        r1 = _record(lat=35.5, lon=45.0)
        r2 = _record(lat=35.5, lon=47.0)  # ~180km away
        merger.ingest(r1)
        merger.ingest(r2)
        assert len(merger.events) == 2

    def test_outside_magnitude_window_does_not_merge(self):
        merger = brc.Merger()
        r1 = _record(mag=6.5)
        r2 = _record(mag=3.0)  # |ΔM| = 3.5 > 1.5
        merger.ingest(r1)
        merger.ingest(r2)
        assert len(merger.events) == 2

    def test_multiple_candidates_picks_closest(self):
        merger = brc.Merger()
        t0 = _dt(2020, 1, 1, 12, 0, 0)
        # `near` and `far` are both within each other's 100km radius and
        # 16s window, but a >1.5 magnitude gap keeps them from merging with
        # EACH OTHER — giving two separate existing events that can both
        # still be valid candidates for a later incoming record.
        near = _record(source_catalog="ONUR2017", time=t0, lat=35.50, lon=45.00, mag=5.0)
        far = _record(
            source_catalog="ONUR2017",
            time=_dt(2020, 1, 1, 12, 0, 2),
            lat=36.00,
            lon=45.50,
            mag=6.6,  # |ΔM| vs `near` = 1.6 > 1.5 -> stays a separate event
        )
        merger.ingest(near)
        merger.ingest(far)
        assert len(merger.events) == 2  # sanity: near/far didn't merge

        # `incoming` is a valid spatiotemporal candidate for BOTH (equal
        # |Δt| = 1s to each), but much closer in distance to `near`
        # (~1.4km) than to `far` (~65km) — lexicographic (|Δt|, distance)
        # ordering must break the time tie by distance and pick `near`.
        incoming = _record(
            source_catalog="USGS",
            time=_dt(2020, 1, 1, 12, 0, 1),
            lat=35.51,
            lon=45.01,
            mag=5.6,
        )
        merger.ingest(incoming)

        assert len(merger.events) == 2
        near_event = next(e for e in merger.events if e.lat == 35.50)
        far_event = next(e for e in merger.events if e.lat == 36.00)
        assert near_event.merged_count == 2  # incoming attached to `near`...
        assert far_event.merged_count == 1  # ...not `far`


class TestMergerDepthBackfill:
    def test_null_canonical_depth_is_backfilled(self):
        merger = brc.Merger()
        r1 = _record(source_catalog="ONUR2017", source_id="a", depth_km=None)
        r2 = _record(
            source_catalog="USGS",
            source_id="a",
            depth_km=12.5,
        )
        merger.ingest(r1)
        merger.ingest(r2)
        assert merger.events[0].depth_km == 12.5

    def test_present_canonical_depth_is_not_overridden(self):
        merger = brc.Merger()
        r1 = _record(source_catalog="ONUR2017", source_id="a", depth_km=8.0)
        r2 = _record(source_catalog="USGS", source_id="a", depth_km=99.0)
        merger.ingest(r1)
        merger.ingest(r2)
        assert merger.events[0].depth_km == 8.0


class TestMergerPriorityOrder:
    def test_first_ingested_record_is_always_canonical(self):
        # SOURCE_PRIORITY order means callers ingest ISCGEM before ONUR2017
        # before EMME before USGS before KISC — verify the merger itself
        # doesn't reorder or re-resolve canonical fields after the fact,
        # it simply trusts ingestion order (module docstring).
        merger = brc.Merger()
        high = _record(source_catalog="ISCGEM", mag=6.1, mag_type="Mw")
        low = _record(source_catalog="KISC", mag=6.3, mag_type="mb", time=_dt(2020, 1, 1, 0, 0, 5))
        merger.ingest(high)
        merger.ingest(low)
        assert len(merger.events) == 1
        assert merger.events[0].mag_type == "Mw"
        assert merger.events[0].mag == 6.1
