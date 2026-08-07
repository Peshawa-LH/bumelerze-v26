"""seed_atlas.py: parse_notable_events against the REAL notable-events.ts
(sync-check — this script must never silently drift from the app's own
curated list), fetch_feed_event wiring (mocked), and the full seed_event/
main() orchestration (mocked network, tiny grid for speed)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from shake_service import config

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import seed_atlas  # noqa: E402

from shake_service.worker import usgs_products  # noqa: E402
from shake_service.worker.state import WorkerState  # noqa: E402
from shake_service.worker.uploader import LocalOnlyUploader  # noqa: E402


@pytest.fixture(autouse=True)
def tiny_grid(monkeypatch):
    monkeypatch.setattr(config, "grid_extent_km", lambda band: 10.0)
    monkeypatch.setattr(config, "forward_grid_spacing_km", lambda band: 50.0)


# ---------------------------------------------------------------------------
# parse_notable_events — sync-check against the real TS file
# ---------------------------------------------------------------------------


def test_parse_notable_events_reads_the_real_ts_file():
    assert seed_atlas.NOTABLE_EVENTS_TS.exists(), "notable-events.ts not found at the expected repo path"
    events = seed_atlas.parse_notable_events()
    assert len(events) == 11
    ids = [e["id"] for e in events]
    # Every id from src/features/historical/notable-events.ts, transcribed
    # ONLY for this assertion's own readability -- parse_notable_events
    # itself never hand-transcribes (module docstring).
    assert ids == [
        "iscgem899464", "iscgem898547", "iscgem884317", "iscgem839648",
        "usp0001bb6", "usp0004uk3", "us2000bmcg", "us1000ghda", "us1000hwdw",
        "us6000jllz", "us6000jlqa",
    ]


def test_parse_notable_events_fields_are_well_formed():
    events = seed_atlas.parse_notable_events()
    for e in events:
        assert isinstance(e["id"], str) and e["id"]
        assert 1900 <= e["year"] <= 2100
        assert 4.0 <= e["magnitude"] <= 9.0
        assert -90.0 <= e["lat"] <= 90.0
        assert -180.0 <= e["lon"] <= 180.0
        assert e["noteKey"]


def test_parse_notable_events_halabja_2017_fields_match_known_values():
    events = seed_atlas.parse_notable_events()
    halabja = next(e for e in events if e["id"] == "us2000bmcg")
    assert halabja["year"] == 2017
    assert halabja["magnitude"] == pytest.approx(7.3)
    assert halabja["lat"] == pytest.approx(34.9109)
    assert halabja["lon"] == pytest.approx(45.9592)


def test_parse_notable_events_raises_on_missing_file(tmp_path):
    with pytest.raises(ValueError, match="NOTABLE_HISTORICAL_EVENTS"):
        seed_atlas.parse_notable_events(tmp_path / "does_not_exist.ts")


def test_parse_notable_events_raises_on_malformed_array(tmp_path):
    bad = tmp_path / "notable-events.ts"
    bad.write_text("export const NOTABLE_HISTORICAL_EVENTS = 42;")
    with pytest.raises(ValueError, match="NOTABLE_HISTORICAL_EVENTS"):
        seed_atlas.parse_notable_events(bad)


def test_parse_notable_events_raises_on_event_missing_a_required_field(tmp_path):
    bad = tmp_path / "notable-events.ts"
    bad.write_text(
        'export const NOTABLE_HISTORICAL_EVENTS = [\n'
        '  { id: "test1", year: 2000, lat: 35.0, lon: 45.0 },\n'  # missing magnitude
        '] as const;\n'
    )
    with pytest.raises(ValueError, match="missing an expected field"):
        seed_atlas.parse_notable_events(bad)


# ---------------------------------------------------------------------------
# fetch_feed_event — mocked USGS event detail
# ---------------------------------------------------------------------------


def _detail_text(*, event_id="us_test", mag=6.0, lon=45.0, lat=35.0, depth=10.0, place="test place", time=1000, updated=2000):
    return json.dumps({
        "id": event_id,
        "properties": {"mag": mag, "place": place, "time": time, "updated": updated},
        "geometry": {"type": "Point", "coordinates": [lon, lat, depth]},
    })


def test_fetch_feed_event_parses_bare_feature_detail():
    def fake_fetch(url, params=None):
        assert url == usgs_products.DETAIL_URL
        assert params == {"eventid": "us_test", "format": "geojson"}
        return _detail_text()

    fe = seed_atlas.fetch_feed_event("us_test", fetch_text=fake_fetch)
    assert fe.external_id == "us_test"
    assert fe.mag == pytest.approx(6.0)
    assert fe.lat == pytest.approx(35.0)
    assert fe.lon == pytest.approx(45.0)
    assert fe.depth_km == pytest.approx(10.0)
    assert fe.place == "test place"


# ---------------------------------------------------------------------------
# seed_event / main — mocked network, fully offline
# ---------------------------------------------------------------------------


def _curated(**overrides):
    base = dict(id="us_seed_1", year=2020, magnitude=6.0, lat=35.5, lon=45.0, placeName="Test", noteKey="test")
    base.update(overrides)
    return base


def _routes(event_id="us_seed_1", lat=35.5, lon=45.0, mag=6.0):
    return {
        usgs_products.DETAIL_URL: _detail_text(event_id=event_id, mag=mag, lon=lon, lat=lat),
    }


def _route_fetch(routes):
    calls = []

    def fetch(url, params=None):
        calls.append((url, params))
        if url not in routes:
            raise AssertionError(f"unexpected fetch: {url}")
        return routes[url]

    return fetch, calls


def test_seed_event_writes_v1_products_and_returns_summary_row(tmp_path):
    ws = WorkerState()
    uploader = LocalOnlyUploader(log_fn=lambda *_: None)
    fetch, calls = _route_fetch(_routes())

    row = seed_atlas.seed_event(_curated(), ws, atlas_root=tmp_path, uploader=uploader, fetch_text=fetch)

    assert row["id"] == "us_seed_1"
    assert row["version"] == 1
    assert row["recomputed"] is True
    assert (tmp_path / "us_seed_1" / "v1" / "info.json").exists()
    # Detail is fetched twice -- once by fetch_feed_event (params/depth),
    # once by usgs_products.fetch_usgs_event_products (product resolution)
    # -- both against the same URL/params; no shakemap/dyfi content existed
    # in this event's payload, so nothing else was fetched.
    detail_call = (usgs_products.DETAIL_URL, {"eventid": "us_seed_1", "format": "geojson"})
    assert calls == [detail_call, detail_call]


def test_seed_event_replay_is_idempotent(tmp_path):
    ws = WorkerState()
    uploader = LocalOnlyUploader(log_fn=lambda *_: None)
    fetch, calls = _route_fetch(_routes())

    first = seed_atlas.seed_event(_curated(), ws, atlas_root=tmp_path, uploader=uploader, fetch_text=fetch)
    second = seed_atlas.seed_event(_curated(), ws, atlas_root=tmp_path, uploader=uploader, fetch_text=fetch)

    assert first["recomputed"] is True
    assert second["recomputed"] is False
    assert second["version"] == 1
    assert not (tmp_path / "us_seed_1" / "v2").exists()


def test_main_seeds_only_the_requested_event(tmp_path, monkeypatch, capsys):
    def fake_parse_notable_events():
        return [_curated(id="us_a"), _curated(id="us_b")]

    monkeypatch.setattr(seed_atlas, "parse_notable_events", fake_parse_notable_events)

    routes = {usgs_products.DETAIL_URL: _detail_text(event_id="us_a")}
    fake_fetch, _ = _route_fetch(routes)
    monkeypatch.setattr(usgs_products, "default_fetch_text", fake_fetch)

    monkeypatch.setattr(
        sys, "argv",
        [
            "seed_atlas.py",
            "--atlas-root", str(tmp_path / "atlas"),
            "--state-path", str(tmp_path / "state.json"),
            "--summary-path", str(tmp_path / "summary.json"),
            "--event", "us_a",
        ],
    )

    seed_atlas.main()

    summary = json.loads((tmp_path / "summary.json").read_text())
    assert [row["id"] for row in summary] == ["us_a"]
    assert (tmp_path / "atlas" / "us_a" / "v1" / "info.json").exists()
    assert not (tmp_path / "atlas" / "us_b").exists()


def test_main_rejects_unknown_event_id(tmp_path, monkeypatch):
    def fake_parse_notable_events():
        return [_curated(id="us_a")]

    monkeypatch.setattr(seed_atlas, "parse_notable_events", fake_parse_notable_events)
    monkeypatch.setattr(
        sys, "argv",
        [
            "seed_atlas.py",
            "--atlas-root", str(tmp_path / "atlas"),
            "--state-path", str(tmp_path / "state.json"),
            "--summary-path", str(tmp_path / "summary.json"),
            "--event", "does_not_exist",
        ],
    )
    with pytest.raises(SystemExit):
        seed_atlas.main()
