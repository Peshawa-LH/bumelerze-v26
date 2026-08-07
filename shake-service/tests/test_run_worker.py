"""run_worker.py: CLI orchestration unit tests (`poll_all_hour`/
`poll_region_sweep`/`process_decisions`, fully mocked fetch) plus one
`--once` end-to-end integration test — everything mocked except the real
`export.write_products` write (feed fetch is a canned/mocked payload;
the forward-map compute is the REAL engine over a monkeypatched tiny grid,
same speed trick as `test_worker_pipeline.py`)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import run_worker  # noqa: E402

from shake_service import config  # noqa: E402
from shake_service.worker.state import WorkerState  # noqa: E402


@pytest.fixture(autouse=True)
def tiny_grid(monkeypatch):
    monkeypatch.setattr(config, "grid_extent_km", lambda band: 10.0)
    monkeypatch.setattr(config, "forward_grid_spacing_km", lambda band: 50.0)


def _feature(*, event_id="us_run_1", mag=4.0, lat=35.5, lon=45.0, depth_km=10.0, updated_ms=1_000):
    return {
        "type": "Feature",
        "id": event_id,
        "properties": {"mag": mag, "place": "test", "time": updated_ms, "updated": updated_ms},
        "geometry": {"type": "Point", "coordinates": [lon, lat, depth_km]},
    }


def _feature_collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


# ---------------------------------------------------------------------------
# poll_all_hour / poll_region_sweep — fetch_fn wiring
# ---------------------------------------------------------------------------


def test_poll_all_hour_calls_fetch_fn_with_all_hour_url_and_returns_decisions():
    calls = []

    def fake_fetch(url, params=None):
        calls.append((url, params))
        return _feature_collection(_feature(mag=4.0))

    ws = WorkerState()
    decisions = run_worker.poll_all_hour(ws, fetch_fn=fake_fetch)
    assert calls == [(run_worker.ALL_HOUR_FEED_URL, None)]
    assert len(decisions) == 1
    assert decisions[0].kind == "new"


def test_poll_region_sweep_calls_fetch_fn_with_fdsnws_url_and_bbox_params():
    calls = []

    def fake_fetch(url, params=None):
        calls.append((url, params))
        return _feature_collection()

    ws = WorkerState()
    run_worker.poll_region_sweep(ws, updated_after="2026-08-01T00:00:00", fetch_fn=fake_fetch)
    assert len(calls) == 1
    url, params = calls[0]
    assert url == run_worker.FDSNWS_EVENT_URL
    assert params["updatedafter"] == "2026-08-01T00:00:00"
    assert params["minlatitude"] == config.REGION_BBOX["min_lat"]
    assert params["maxlongitude"] == config.REGION_BBOX["max_lon"]


# ---------------------------------------------------------------------------
# process_decisions — skips vs. processed triggers
# ---------------------------------------------------------------------------


def test_process_decisions_skips_skip_kind_and_processes_new(tmp_path, capsys):
    ws = WorkerState()

    def fake_fetch(url, params=None):
        return _feature_collection(
            _feature(event_id="qualifies", mag=4.0),
            _feature(event_id="too_small", mag=3.0),
        )

    decisions = run_worker.poll_all_hour(ws, fetch_fn=fake_fetch)
    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.process_decisions(decisions, ws, products_root=tmp_path, uploader=uploader)

    assert ws.get_event("qualifies") is not None
    assert ws.get_event("too_small") is None
    assert (tmp_path / "qualifies" / "v1" / "info.json").exists()
    assert not (tmp_path / "too_small").exists()

    out = capsys.readouterr().out
    logged = [json.loads(line) for line in out.strip().splitlines()]
    processed_events = [entry for entry in logged if entry["event"] == "trigger_processed"]
    assert len(processed_events) == 1
    assert processed_events[0]["event_id"] == "qualifies"


# ---------------------------------------------------------------------------
# --once end-to-end integration (mocked fetch, real forward map + export)
# ---------------------------------------------------------------------------


def test_run_once_end_to_end_new_event_writes_products_and_saves_state(tmp_path, capsys):
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    all_hour_payload = _feature_collection(_feature(event_id="us_e2e_1", mag=4.2, lat=35.6, lon=44.9, depth_km=12.0))
    sweep_payload = _feature_collection()  # nothing new from the sweep this cycle

    def fake_fetch(url, params=None):
        if url == run_worker.ALL_HOUR_FEED_URL:
            return all_hour_payload
        assert url == run_worker.FDSNWS_EVENT_URL
        return sweep_payload

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    ws = run_worker.run_once(
        state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch,
    )

    # In-memory state reflects the processed event...
    known = ws.get_event("us_e2e_1")
    assert known is not None
    assert known.last_version == 1

    # ...and it was persisted to disk (idempotent-restart contract).
    reloaded = WorkerState.load(state_path)
    assert reloaded.get_event("us_e2e_1").last_version == 1

    # Real export.write_products output, on disk, valid JSON.
    v1_dir = products_root / "us_e2e_1" / "v1"
    info = json.loads((v1_dir / "info.json").read_text())
    assert info["event"]["mag_mw"] == pytest.approx(4.2)
    assert (v1_dir / "cont_mi.json").exists()
    assert (v1_dir / "grid.json").exists()

    out = capsys.readouterr().out
    logged_events = [json.loads(line)["event"] for line in out.strip().splitlines()]
    assert "cycle_start" in logged_events
    assert "trigger_processed" in logged_events
    assert "cycle_end" in logged_events


def test_run_once_replayed_is_idempotent_across_two_full_cycles(tmp_path):
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    payload = _feature_collection(_feature(event_id="us_e2e_2", mag=4.0, lat=35.5, lon=45.0, depth_km=10.0, updated_ms=1_000))

    def fake_fetch(url, params=None):
        return payload

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.run_once(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch)
    run_worker.run_once(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch)

    final = WorkerState.load(state_path)
    assert final.get_event("us_e2e_2").last_version == 1
    assert not (products_root / "us_e2e_2" / "v2").exists()


def test_run_once_no_qualifying_events_saves_empty_state_cleanly(tmp_path):
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    def fake_fetch(url, params=None):
        return _feature_collection()

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.run_once(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch)

    assert state_path.exists()
    ws = WorkerState.load(state_path)
    assert ws.events == {}


# ---------------------------------------------------------------------------
# --daemon: immediate first-cycle polling + clean SIGINT shutdown
# ---------------------------------------------------------------------------


def test_daemon_polls_both_feeds_immediately_then_shuts_down_cleanly_on_sigint(tmp_path, monkeypatch, capsys):
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    fetch_calls = []

    def fake_fetch(url, params=None):
        fetch_calls.append(url)
        if url == run_worker.ALL_HOUR_FEED_URL:
            return _feature_collection(_feature(event_id="us_daemon_1", mag=4.0))
        return _feature_collection()

    captured_handler = {}

    def fake_signal(signum, handler):
        # Never install a real OS handler in-test -- just capture the
        # callback `run_daemon` registered so `fake_sleep` can invoke it
        # directly, simulating the OS delivering SIGINT.
        captured_handler["handler"] = handler
        return None

    sleep_calls = {"n": 0}

    def fake_sleep(seconds):
        sleep_calls["n"] += 1
        # Simulate the OS delivering SIGINT to our handler during the sleep,
        # exactly once, after the first full poll cycle has already run.
        captured_handler["handler"](2, None)

    monkeypatch.setattr(run_worker.signal, "signal", fake_signal)
    monkeypatch.setattr(run_worker.time, "sleep", fake_sleep)

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.run_daemon(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch)

    # Both feeds were polled on the immediate first iteration.
    assert run_worker.ALL_HOUR_FEED_URL in fetch_calls
    assert run_worker.FDSNWS_EVENT_URL in fetch_calls
    # The loop stopped after exactly one simulated sleep (one SIGINT), not an
    # infinite loop.
    assert sleep_calls["n"] == 1

    ws = WorkerState.load(state_path)
    assert ws.get_event("us_daemon_1") is not None

    out = capsys.readouterr().out
    logged_events = [json.loads(line)["event"] for line in out.strip().splitlines()]
    assert "daemon_start" in logged_events
    assert "shutdown_requested" in logged_events
    assert "daemon_stop" in logged_events


def test_daemon_tolerates_a_feed_failure_and_keeps_looping(tmp_path, monkeypatch, capsys):
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    def failing_fetch(url, params=None):
        raise run_worker.requests.RequestException("feed is down")

    captured_handler = {}

    def fake_signal(signum, handler):
        captured_handler["handler"] = handler
        return None

    def fake_sleep(seconds):
        captured_handler["handler"](2, None)

    monkeypatch.setattr(run_worker.signal, "signal", fake_signal)
    monkeypatch.setattr(run_worker.time, "sleep", fake_sleep)

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    # Must not raise -- a feed outage is tolerated, not fatal.
    run_worker.run_daemon(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=failing_fetch)

    out = capsys.readouterr().out
    logged_events = [json.loads(line)["event"] for line in out.strip().splitlines()]
    assert "all_hour_poll_failed" in logged_events
    assert "region_sweep_failed" in logged_events
    assert "daemon_stop" in logged_events
    assert state_path.exists()  # state still saved cleanly despite the failures
