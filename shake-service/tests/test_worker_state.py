"""state.py: round-trip + idempotency of the JSON-file-backed worker state."""

from __future__ import annotations

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
