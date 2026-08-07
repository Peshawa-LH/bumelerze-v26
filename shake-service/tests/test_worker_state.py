"""state.py: round-trip + idempotency of the JSON-file-backed worker state."""

from __future__ import annotations

import json

from shake_service.worker.state import EventState, WorkerState


def _event_state(**overrides) -> EventState:
    base = dict(
        external_id="us2000bmcg",
        source="usgs",
        mag=6.3,
        lat=35.0,
        lon=45.0,
        depth_km=10.0,
        last_version=1,
        params_hash="abc123",
        product_paths={"cont_mi": "products/us2000bmcg/v1/cont_mi.json"},
        last_feed_updated_ms=1_000,
        first_seen_at="2026-08-07T00:00:00+00:00",
        last_computed_at="2026-08-07T00:00:00+00:00",
    )
    base.update(overrides)
    return EventState(**base)


def test_load_missing_file_returns_empty_state(tmp_path):
    ws = WorkerState.load(tmp_path / "does_not_exist.json")
    assert ws.events == {}
    assert ws.meta["schema_version"] == 1


def test_save_then_load_round_trips_event_state(tmp_path):
    state_path = tmp_path / "worker_state.json"
    ws = WorkerState()
    ws.upsert_event(_event_state())
    ws.save(state_path)

    reloaded = WorkerState.load(state_path)
    assert reloaded.known_external_ids() == ["us2000bmcg"]
    round_tripped = reloaded.get_event("us2000bmcg")
    assert round_tripped == _event_state()


def test_save_is_atomic_no_tmp_file_left_behind(tmp_path):
    state_path = tmp_path / "worker_state.json"
    ws = WorkerState()
    ws.upsert_event(_event_state())
    ws.save(state_path)
    assert state_path.exists()
    assert not (tmp_path / "worker_state.json.tmp").exists()


def test_upsert_overwrites_same_external_id(tmp_path):
    ws = WorkerState()
    ws.upsert_event(_event_state(last_version=1))
    ws.upsert_event(_event_state(last_version=2, mag=6.4))
    assert len(ws.events) == 1
    assert ws.get_event("us2000bmcg").last_version == 2
    assert ws.get_event("us2000bmcg").mag == 6.4


def test_repeated_save_load_cycles_are_idempotent(tmp_path):
    state_path = tmp_path / "worker_state.json"
    ws = WorkerState()
    ws.upsert_event(_event_state())
    ws.save(state_path)

    for _ in range(3):
        ws = WorkerState.load(state_path)
        ws.save(state_path)

    final = WorkerState.load(state_path)
    assert final.get_event("us2000bmcg") == _event_state()


def test_get_event_returns_none_for_unknown_id():
    ws = WorkerState()
    assert ws.get_event("nope") is None


# ---------------------------------------------------------------------------
# D21 additions: has_comparison/comparison_path/reviews
# ---------------------------------------------------------------------------


def test_new_event_state_defaults_have_comparison_false_and_no_reviews():
    es = _event_state()
    assert es.has_comparison is False
    assert es.comparison_path is None
    assert es.reviews == {}


def test_comparison_and_review_fields_round_trip(tmp_path):
    state_path = tmp_path / "worker_state.json"
    ws = WorkerState()
    ws.upsert_event(
        _event_state(
            has_comparison=True,
            comparison_path="products/us2000bmcg/v1/compatibility.json",
            reviews={"1": {"review_status": "reviewed", "reviewed_by": "peshawa", "reviewed_at": "2026-08-07T00:00:00+00:00"}},
        )
    )
    ws.save(state_path)

    reloaded = WorkerState.load(state_path)
    es = reloaded.get_event("us2000bmcg")
    assert es.has_comparison is True
    assert es.comparison_path == "products/us2000bmcg/v1/compatibility.json"
    assert es.reviews["1"]["review_status"] == "reviewed"


def test_loading_a_pre_d21_state_file_without_new_fields_still_works(tmp_path):
    # Simulates a state file written before this wave -- no has_comparison/
    # comparison_path/reviews keys at all -- must not crash, defaults apply.
    state_path = tmp_path / "worker_state.json"
    old_shape = {
        "meta": {"schema_version": 1},
        "events": {
            "us_old": {
                "external_id": "us_old", "source": "usgs", "mag": 4.0, "lat": 35.0, "lon": 45.0,
                "depth_km": 10.0, "last_version": 1, "params_hash": "abc",
                "product_paths": {}, "last_feed_updated_ms": 1, "first_seen_at": "x", "last_computed_at": "x",
            }
        },
    }
    state_path.write_text(json.dumps(old_shape))

    ws = WorkerState.load(state_path)
    es = ws.get_event("us_old")
    assert es.has_comparison is False
    assert es.comparison_path is None
    assert es.reviews == {}
