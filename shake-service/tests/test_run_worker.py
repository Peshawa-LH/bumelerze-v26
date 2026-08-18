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


def _no_text(url, params=None):
    """Hermetic GEOFON leg for tests not about GEOFON: an empty FDSN text
    body (= the live service's no-events response) so `run_once`/`run_daemon`
    never touch the network for the text sweep."""
    return ""


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
    # The sweeps query the MONITORED bbox (all Iraq + effect margin), not
    # the narrower Kurdistan region bbox — see _region_sweep_params's note.
    assert params["minlatitude"] == config.MONITORED_BBOX["min_lat"]
    assert params["maxlongitude"] == config.MONITORED_BBOX["max_lon"]


# ---------------------------------------------------------------------------
# process_decisions — skips vs. processed triggers
# ---------------------------------------------------------------------------


def test_process_decisions_skips_skip_kind_and_processes_new(tmp_path, capsys):
    ws = WorkerState()

    def fake_fetch(url, params=None):
        return _feature_collection(
            _feature(event_id="qualifies", mag=4.0),
            # Far outside the monitored bbox: skip — not tracked at all.
            _feature(event_id="far_away", mag=6.0, lat=10.0, lon=10.0),
        )

    decisions = run_worker.poll_all_hour(ws, fetch_fn=fake_fetch)
    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.process_decisions(decisions, ws, products_root=tmp_path, uploader=uploader)

    assert ws.get_event("qualifies") is not None
    assert ws.get_event("far_away") is None
    assert (tmp_path / "qualifies" / "v1" / "info.json").exists()
    assert not (tmp_path / "far_away").exists()

    out = capsys.readouterr().out
    logged = [json.loads(line) for line in out.strip().splitlines()]
    processed_events = [entry for entry in logged if entry["event"] == "trigger_processed"]
    assert len(processed_events) == 1
    assert processed_events[0]["event_id"] == "qualifies"


def test_process_decisions_catalog_kind_gets_id_and_live_line_but_no_products(tmp_path, capsys):
    # A detected non-triggering event (Iran margin, small): tracked with a
    # bml id + one live-catalog line, but NO pipeline run/products dir.
    ws = WorkerState()
    live_path = tmp_path / "live-catalog.jsonl"
    products_root = tmp_path / "products"

    def fake_fetch(url, params=None):
        return _feature_collection(
            _feature(event_id="iran_margin", mag=3.0, lat=34.0, lon=50.6, updated_ms=1_754_000_000_000),
        )

    decisions = run_worker.poll_all_hour(ws, fetch_fn=fake_fetch)
    assert [d.kind for d in decisions] == ["catalog"]
    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.process_decisions(
        decisions, ws, products_root=products_root, uploader=uploader, live_catalog_path=live_path,
    )

    tracked = ws.get_event("iran_margin")
    assert tracked is not None
    assert tracked.bumelerze_id is not None
    assert tracked.last_version == 0  # nothing computed
    assert not (products_root / "iran_margin").exists()

    lines = [json.loads(line) for line in live_path.read_text().splitlines()]
    assert len(lines) == 1
    assert lines[0]["provider_id"] == "iran_margin"
    assert lines[0]["bumelerze_id"] == tracked.bumelerze_id
    assert lines[0]["triggered"] is False

    out = capsys.readouterr().out
    logged = [json.loads(line) for line in out.strip().splitlines()]
    assert any(entry["event"] == "catalog_tracked" for entry in logged)


def test_process_decisions_new_kind_appends_live_line_and_products_carry_bml_id(tmp_path):
    ws = WorkerState()
    live_path = tmp_path / "live-catalog.jsonl"
    products_root = tmp_path / "products"
    origin_ms = 1_786_660_084_000  # 2026-08-13T22:28:04Z

    def fake_fetch(url, params=None):
        return _feature_collection(_feature(event_id="us_bml_1", mag=4.0, updated_ms=origin_ms))

    decisions = run_worker.poll_all_hour(ws, fetch_fn=fake_fetch)
    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.process_decisions(
        decisions, ws, products_root=products_root, uploader=uploader, live_catalog_path=live_path,
    )

    tracked = ws.get_event("us_bml_1")
    assert tracked.bumelerze_id == "bml20260001"  # first 2026 detection of this state file
    assert tracked.provider_aliases == {"usgs": "us_bml_1"}

    lines = [json.loads(line) for line in live_path.read_text().splitlines()]
    assert [line["bumelerze_id"] for line in lines] == ["bml20260001"]
    assert lines[0]["triggered"] is True

    # The product's info.json carries the id + alias map in data_used.
    info = json.loads((products_root / "us_bml_1" / "v1" / "info.json").read_text())
    assert info["data_used"]["bumelerze_id"] == "bml20260001"
    assert info["data_used"]["provider_aliases"] == {"usgs": "us_bml_1"}


def test_process_decisions_records_cross_provider_alias_on_skip(tmp_path):
    # First cycle: USGS record creates the tracked entry. Second cycle: the
    # EMSC record of the SAME quake is skipped (dedup) but its unid is
    # recorded as an alias on the tracked entry.
    ws = WorkerState()
    live_path = tmp_path / "live-catalog.jsonl"
    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    origin_ms = 1_786_660_084_000

    def usgs_fetch(url, params=None):
        return _feature_collection(_feature(event_id="us_alias_1", mag=4.1, lat=34.93, lon=45.9, updated_ms=origin_ms))

    decisions = run_worker.poll_all_hour(ws, fetch_fn=usgs_fetch)
    run_worker.process_decisions(
        decisions, ws, products_root=tmp_path / "products", uploader=uploader, live_catalog_path=live_path,
    )
    # Patch origin time to the real value (the _feature helper reuses
    # updated_ms as time too, which is what we want here).
    emsc_payload = _feature_collection()
    emsc_payload["features"] = [{
        "type": "Feature",
        "id": "20260813_0000321",
        "properties": {
            "unid": "20260813_0000321", "time": "2026-08-13T22:28:06.0Z",
            "lastupdate": "2026-08-13T22:41:00.0Z", "lat": 34.9, "lon": 45.9,
            "depth": 10.0, "mag": 4.0, "magtype": "mb", "flynn_region": "IRAN-IRAQ BORDER REGION",
        },
    }]
    emsc_decisions = run_worker.poll_emsc_sweep(
        ws, start_time="2026-08-13T21:30:00", fetch_fn=lambda url, params=None: emsc_payload,
    )
    assert [d.kind for d in emsc_decisions] == ["skip"]
    run_worker.process_decisions(
        emsc_decisions, ws, products_root=tmp_path / "products", uploader=uploader, live_catalog_path=live_path,
    )

    tracked = ws.get_event("us_alias_1")
    assert tracked.provider_aliases == {"usgs": "us_alias_1", "emsc": "20260813_0000321"}
    # No second live-catalog line for the duplicate.
    assert len(live_path.read_text().splitlines()) == 1


# ---------------------------------------------------------------------------
# --once end-to-end integration (mocked fetch, real forward map + export)
# ---------------------------------------------------------------------------


def test_run_once_end_to_end_new_event_writes_products_and_saves_state(tmp_path, capsys):
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    all_hour_payload = _feature_collection(_feature(event_id="us_e2e_1", mag=4.2, lat=35.6, lon=44.9, depth_km=12.0))
    sweep_payload = _feature_collection()  # nothing new from either sweep this cycle

    def fake_fetch(url, params=None):
        if url == run_worker.ALL_HOUR_FEED_URL:
            return all_hour_payload
        assert url in (run_worker.FDSNWS_EVENT_URL, run_worker.EMSC_FDSNWS_EVENT_URL)
        return sweep_payload

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    ws = run_worker.run_once(
        state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch,
        fetch_text_fn=_no_text,
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
    run_worker.run_once(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch, fetch_text_fn=_no_text)
    run_worker.run_once(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch, fetch_text_fn=_no_text)

    final = WorkerState.load(state_path)
    assert final.get_event("us_e2e_2").last_version == 1
    assert not (products_root / "us_e2e_2" / "v2").exists()


def test_run_once_no_qualifying_events_saves_empty_state_cleanly(tmp_path):
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    def fake_fetch(url, params=None):
        return _feature_collection()

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.run_once(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch, fetch_text_fn=_no_text)

    assert state_path.exists()
    ws = WorkerState.load(state_path)
    assert ws.events == {}


def test_run_once_tolerates_a_feed_failure_and_still_saves_state(tmp_path, capsys):
    """Regression coverage for the scheduled-CI robustness fix: `run_once`
    used to let a single feed's `requests.RequestException` abort the WHOLE
    cycle before the final `ws.save` call, silently discarding whatever
    earlier legs in the same cycle had already processed. Real internet
    flakiness (the GitHub Actions scheduled lane's normal operating
    condition, unlike a human re-running this by hand) makes that a real
    state-loss risk, not just a theoretical one — this test pins the fixed
    behavior: one feed failing must not block the others, and state from
    whatever succeeded must still be saved."""
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    def flaky_fetch(url, params=None):
        if url == run_worker.ALL_HOUR_FEED_URL:
            raise run_worker.requests.RequestException("all_hour feed is down")
        if url == run_worker.FDSNWS_EVENT_URL:
            return _feature_collection(_feature(event_id="us_flaky_1", mag=4.1, lat=35.4, lon=45.1))
        return _feature_collection()

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    ws = run_worker.run_once(
        state_path=state_path, products_root=products_root, uploader=uploader,
        fetch_fn=flaky_fetch, fetch_text_fn=_no_text,
    )

    # The USGS region-sweep's event, processed AFTER the failing all_hour
    # poll in the same cycle, was not lost.
    assert ws.get_event("us_flaky_1") is not None
    reloaded = WorkerState.load(state_path)
    assert reloaded.get_event("us_flaky_1") is not None

    out = capsys.readouterr().out
    logged_events = [json.loads(line)["event"] for line in out.strip().splitlines()]
    assert "all_hour_poll_failed" in logged_events
    assert "cycle_end" in logged_events  # reached despite the failed leg


def test_run_once_a_non_network_exception_still_propagates_after_saving_state(tmp_path):
    """A real bug (not feed downtime) must still fail the run loudly — the
    tolerant try/except is scoped to `requests.RequestException` only."""
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    def broken_fetch(url, params=None):
        raise ValueError("not a network error -- a real bug")

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    with pytest.raises(ValueError, match="not a network error"):
        run_worker.run_once(
            state_path=state_path, products_root=products_root, uploader=uploader,
            fetch_fn=broken_fetch, fetch_text_fn=_no_text,
        )
    # ws.save still ran (the `finally` block) even though the exception
    # propagated afterwards.
    assert state_path.exists()


# ---------------------------------------------------------------------------
# --require-supabase: fail loudly instead of a silent LocalOnlyUploader
# fallback — the scheduled CI lane's own preflight check.
# ---------------------------------------------------------------------------


def test_require_supabase_env_passes_when_both_vars_set():
    run_worker.require_supabase_env(
        env={"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "secret"}
    )  # must not raise


def test_require_supabase_env_raises_when_both_missing():
    with pytest.raises(run_worker.MissingSupabaseCredentialsError) as exc_info:
        run_worker.require_supabase_env(env={})
    message = str(exc_info.value)
    assert "SUPABASE_URL" in message
    assert "SUPABASE_SERVICE_ROLE_KEY" in message


def test_require_supabase_env_raises_when_only_one_is_set():
    with pytest.raises(run_worker.MissingSupabaseCredentialsError):
        run_worker.require_supabase_env(env={"SUPABASE_URL": "https://x.supabase.co"})
    with pytest.raises(run_worker.MissingSupabaseCredentialsError):
        run_worker.require_supabase_env(env={"SUPABASE_SERVICE_ROLE_KEY": "secret"})


def test_require_supabase_env_error_is_a_system_exit_with_exit_code_2():
    with pytest.raises(SystemExit) as exc_info:
        run_worker.require_supabase_env(env={})
    assert exc_info.value.code != 0  # a non-zero exit -- a real CI failure, not a silent pass


def test_main_exits_before_any_network_call_when_require_supabase_and_creds_missing(monkeypatch, tmp_path):
    """`--require-supabase` must fail BEFORE `run_once`/`run_daemon` (and
    therefore before any feed poll or `build_uploader()` call) ever runs --
    not merely before the upload step."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    def fail_if_called(**kwargs):
        raise AssertionError("run_once must not be reached when --require-supabase fails preflight")

    monkeypatch.setattr(run_worker, "run_once", fail_if_called)
    monkeypatch.setattr(
        sys, "argv",
        ["run_worker.py", "--once", "--require-supabase", "--state-path", str(tmp_path / "s.json")],
    )
    with pytest.raises(SystemExit):
        run_worker.main()


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
    run_worker.run_daemon(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch, fetch_text_fn=_no_text)

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
    run_worker.run_daemon(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=failing_fetch, fetch_text_fn=_no_text)

    out = capsys.readouterr().out
    logged_events = [json.loads(line)["event"] for line in out.strip().splitlines()]
    assert "all_hour_poll_failed" in logged_events
    assert "region_sweep_failed" in logged_events
    assert "daemon_stop" in logged_events
    assert state_path.exists()  # state still saved cleanly despite the failures


# ---------------------------------------------------------------------------
# D21: usgs_products_fetcher wiring — safe default, explicit opt-in
# ---------------------------------------------------------------------------


def test_process_decisions_defaults_to_zero_network_usgs_fetcher(tmp_path):
    ws = WorkerState()

    def fake_fetch(url, params=None):
        return _feature_collection(_feature(event_id="us_no_usgs", mag=4.0))

    decisions = run_worker.poll_all_hour(ws, fetch_fn=fake_fetch)
    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.process_decisions(decisions, ws, products_root=tmp_path, uploader=uploader)

    known = ws.get_event("us_no_usgs")
    assert known.has_comparison is False


def test_process_decisions_forwards_a_custom_usgs_products_fetcher(tmp_path):
    ws = WorkerState()
    calls = []

    def fake_fetch(url, params=None):
        return _feature_collection(_feature(event_id="us_with_usgs", mag=4.0))

    def fake_usgs_fetcher(event_id):
        calls.append(event_id)
        return run_worker.usgs_products.UsgsEventProducts(event_id=event_id)

    decisions = run_worker.poll_all_hour(ws, fetch_fn=fake_fetch)
    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.process_decisions(
        decisions, ws, products_root=tmp_path, uploader=uploader, usgs_products_fetcher=fake_usgs_fetcher,
    )

    assert calls == ["us_with_usgs"]


def test_main_wires_the_real_network_enabled_usgs_fetcher(monkeypatch, tmp_path):
    # main() is the one place that should opt INTO the real fetcher --
    # confirm the wiring without making a real request (run_once itself is
    # monkeypatched out, so this only checks what main() PASSES it).
    captured = {}

    def fake_run_once(*, state_path, products_root, uploader, usgs_products_fetcher, **kwargs):
        captured["usgs_products_fetcher"] = usgs_products_fetcher

    monkeypatch.setattr(run_worker, "run_once", fake_run_once)
    monkeypatch.setattr(
        run_worker.sys, "argv",
        ["run_worker.py", "--once", "--state-path", str(tmp_path / "s.json"), "--products-root", str(tmp_path / "p")],
    )

    run_worker.main()

    assert captured["usgs_products_fetcher"] is run_worker.usgs_products.fetch_usgs_event_products


# ---------------------------------------------------------------------------
# EMSC completeness sweep wiring
# ---------------------------------------------------------------------------

BORDER_TIME_MS = 1_786_660_084_000  # 2026-08-13T22:28:04Z


def _emsc_feature(
    *, unid="20260813_0000321", mag=4.0, lat=34.9, lon=45.9, depth=10.0,
    time_iso="2026-08-13T22:28:04.0Z", lastupdate_iso="2026-08-13T22:41:00.0Z",
):
    return {
        "type": "Feature",
        "id": unid,
        "properties": {
            "unid": unid, "time": time_iso, "lastupdate": lastupdate_iso,
            "lat": lat, "lon": lon, "depth": depth, "mag": mag, "magtype": "mb",
            "flynn_region": "IRAN-IRAQ BORDER REGION",
        },
    }


def test_poll_emsc_sweep_calls_fetch_fn_with_emsc_url_and_short_alias_params():
    calls = []

    def fake_fetch(url, params=None):
        calls.append((url, params))
        return _feature_collection()

    run_worker.poll_emsc_sweep(WorkerState(), start_time="2026-08-13T21:30:00", fetch_fn=fake_fetch)
    assert len(calls) == 1
    url, params = calls[0]
    assert url == run_worker.EMSC_FDSNWS_EVENT_URL
    # EMSC documents the SHORT param aliases (start/minlat/...), not USGS's
    # long names -- regression guard against "fixing" them to match USGS.
    assert params["format"] == "json"
    assert params["start"] == "2026-08-13T21:30:00"
    assert params["minlat"] == config.MONITORED_BBOX["min_lat"]
    assert params["maxlat"] == config.MONITORED_BBOX["max_lat"]
    assert params["minlon"] == config.MONITORED_BBOX["min_lon"]
    assert params["maxlon"] == config.MONITORED_BBOX["max_lon"]


def test_run_once_emsc_only_border_event_triggers_a_bumelerze_shakemap(tmp_path):
    # REGRESSION -- the real missed earthquake: 2026-08-13 22:28 UTC, M4.0
    # mb, Iran-Iraq border region. USGS feeds return NOTHING for it (below
    # NEIC regional completeness); EMSC's sweep carries it. The worker must
    # produce a versioned Bumelerze product for it, keyed by the EMSC unid.
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    def fake_fetch(url, params=None):
        if url == run_worker.EMSC_FDSNWS_EVENT_URL:
            return _feature_collection(_emsc_feature())
        return _feature_collection()  # USGS: healthy but incomplete -- empty

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    ws = run_worker.run_once(
        state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch,
        fetch_text_fn=_no_text,
    )

    known = ws.get_event("20260813_0000321")
    assert known is not None
    assert known.source == "emsc"
    assert known.last_version == 1
    assert known.origin_time_ms == BORDER_TIME_MS

    v1_dir = products_root / "20260813_0000321" / "v1"
    info = json.loads((v1_dir / "info.json").read_text())
    assert info["event"]["mag_mw"] == pytest.approx(4.0)
    assert info["data_used"]["trigger_source"] == "emsc"


def test_run_once_same_event_via_both_providers_triggers_exactly_once(tmp_path):
    # The same physical quake in USGS's all_hour feed AND EMSC's sweep
    # (EMSC: 4 s later origin, ~3 km offset, dM 0.1 -- inside the s2 dedup
    # thresholds). USGS polls first, owns the state entry; the EMSC record
    # must cross-provider-dedup, never creating a second product tree.
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    usgs_time_ms = BORDER_TIME_MS - 4_000

    def fake_fetch(url, params=None):
        if url == run_worker.ALL_HOUR_FEED_URL:
            return _feature_collection({
                "type": "Feature",
                "id": "us7000zzzz",
                "properties": {"mag": 4.1, "place": "border", "time": usgs_time_ms, "updated": usgs_time_ms},
                "geometry": {"type": "Point", "coordinates": [45.9, 34.93, 10.0]},
            })
        if url == run_worker.EMSC_FDSNWS_EVENT_URL:
            return _feature_collection(_emsc_feature())
        return _feature_collection()

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    ws = run_worker.run_once(
        state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fake_fetch,
        fetch_text_fn=_no_text,
    )

    # One event entry, under the canonical USGS id; no EMSC-keyed twin.
    assert ws.get_event("us7000zzzz") is not None
    assert ws.get_event("20260813_0000321") is None
    assert (products_root / "us7000zzzz" / "v1" / "info.json").exists()
    assert not (products_root / "20260813_0000321").exists()


def test_daemon_logs_emsc_sweep_failure_independently(tmp_path, monkeypatch, capsys):
    # An EMSC outage must be logged under its own event name and must not
    # block the USGS sweep (each has its own try/except).
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    def fetch(url, params=None):
        if url == run_worker.EMSC_FDSNWS_EVENT_URL:
            raise run_worker.requests.RequestException("emsc is down")
        return _feature_collection()

    captured_handler = {}

    def fake_signal(signum, handler):
        captured_handler["handler"] = handler
        return None

    def fake_sleep(seconds):
        captured_handler["handler"](2, None)

    monkeypatch.setattr(run_worker.signal, "signal", fake_signal)
    monkeypatch.setattr(run_worker.time, "sleep", fake_sleep)

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.run_daemon(state_path=state_path, products_root=products_root, uploader=uploader, fetch_fn=fetch, fetch_text_fn=_no_text)

    out = capsys.readouterr().out
    logged_events = [json.loads(line)["event"] for line in out.strip().splitlines()]
    assert "emsc_sweep_failed" in logged_events
    # The USGS sweep in the same cycle still ran and did NOT fail.
    assert "region_sweep_failed" not in logged_events
    assert "daemon_stop" in logged_events


# ---------------------------------------------------------------------------
# GEOFON completeness sweep wiring
# ---------------------------------------------------------------------------

# The VERIFIED live GEOFON row this wave was built against (geofon.gfz.de,
# format=text, fetched 2026-08-14): mb 4.48 at 55 km under Iraq.
GEOFON_HEADER = (
    "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor"
    "|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType"
)
GEOFON_VERIFIED_ROW = (
    "gfz2026oyxe|2026-08-01T20:27:43.07|35.406|44.659|55.0|||GFZ"
    "|gfz2026oyxe|mb|4.48||Iraq|earthquake"
)


def test_poll_geofon_sweep_calls_fetch_text_fn_with_geofon_url_and_text_params():
    calls = []

    def fake_fetch_text(url, params=None):
        calls.append((url, params))
        return ""

    run_worker.poll_geofon_sweep(
        WorkerState(), start_time="2026-08-13T21:30:00", fetch_text_fn=fake_fetch_text
    )
    assert len(calls) == 1
    url, params = calls[0]
    assert url == run_worker.GEOFON_FDSNWS_EVENT_URL
    # GEOFON serves NO format=json (verified live: 400) -- regression guard
    # against "fixing" this to json; bbox uses the short aliases with the
    # long-form starttime (also verified live).
    assert params["format"] == "text"
    assert params["starttime"] == "2026-08-13T21:30:00"
    assert params["minlat"] == config.MONITORED_BBOX["min_lat"]
    assert params["maxlat"] == config.MONITORED_BBOX["max_lat"]
    assert params["minlon"] == config.MONITORED_BBOX["min_lon"]
    assert params["maxlon"] == config.MONITORED_BBOX["max_lon"]


def test_run_once_geofon_only_event_triggers_a_bumelerze_shakemap(tmp_path):
    # A GEOFON-only qualifying event (the verified gfz2026oyxe row; USGS and
    # EMSC both return nothing for it) must produce a versioned Bumelerze
    # product keyed by the gfz id, with trigger_source "geofon" -- exactly
    # the EMSC-only path, one provider further down the authority order.
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    def fake_fetch(url, params=None):
        return _feature_collection()  # USGS + EMSC: healthy but incomplete

    def fake_fetch_text(url, params=None):
        assert url == run_worker.GEOFON_FDSNWS_EVENT_URL
        return f"{GEOFON_HEADER}\n{GEOFON_VERIFIED_ROW}\n"

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    ws = run_worker.run_once(
        state_path=state_path, products_root=products_root, uploader=uploader,
        fetch_fn=fake_fetch, fetch_text_fn=fake_fetch_text,
    )

    known = ws.get_event("gfz2026oyxe")
    assert known is not None
    assert known.source == "geofon"
    assert known.last_version == 1

    v1_dir = products_root / "gfz2026oyxe" / "v1"
    info = json.loads((v1_dir / "info.json").read_text())
    assert info["event"]["mag_mw"] == pytest.approx(4.48)
    assert info["data_used"]["trigger_source"] == "geofon"
    # Non-USGS trigger: no USGS products were fetched (honest provenance).
    assert info["data_used"]["usgs_stationlist_available"] is False


def test_run_once_same_event_via_all_three_providers_triggers_exactly_once(tmp_path):
    # The same physical quake in USGS's all_hour feed, EMSC's sweep, AND
    # GEOFON's sweep (all inside the s2 dedup thresholds of each other).
    # USGS polls first -> owns the canonical state entry; both later
    # records must cross-provider-dedup. One product tree, no twins.
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    usgs_time_ms = BORDER_TIME_MS - 4_000

    def fake_fetch(url, params=None):
        if url == run_worker.ALL_HOUR_FEED_URL:
            return _feature_collection({
                "type": "Feature",
                "id": "us7000zzzz",
                "properties": {"mag": 4.1, "place": "border", "time": usgs_time_ms, "updated": usgs_time_ms},
                "geometry": {"type": "Point", "coordinates": [45.9, 34.93, 10.0]},
            })
        if url == run_worker.EMSC_FDSNWS_EVENT_URL:
            return _feature_collection(_emsc_feature())
        return _feature_collection()

    def fake_fetch_text(url, params=None):
        # GEOFON's record of the same quake: 2 s after EMSC's origin, ~4 km
        # offset, dM 0.2 -- inside the thresholds vs the tracked USGS entry.
        return (
            f"{GEOFON_HEADER}\n"
            "gfz2026dupe|2026-08-13T22:28:06.0|34.94|45.94|11.0|||GFZ"
            "|gfz2026dupe|mb|4.2||Iran-Iraq border region|earthquake\n"
        )

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    ws = run_worker.run_once(
        state_path=state_path, products_root=products_root, uploader=uploader,
        fetch_fn=fake_fetch, fetch_text_fn=fake_fetch_text,
    )

    # One event entry, under the canonical USGS id; no EMSC/GEOFON twins.
    assert ws.get_event("us7000zzzz") is not None
    assert ws.get_event("20260813_0000321") is None
    assert ws.get_event("gfz2026dupe") is None
    assert (products_root / "us7000zzzz" / "v1" / "info.json").exists()
    assert not (products_root / "20260813_0000321").exists()
    assert not (products_root / "gfz2026dupe").exists()


def test_daemon_logs_geofon_sweep_failure_independently(tmp_path, monkeypatch, capsys):
    # A GEOFON outage must be logged under its own event name and must not
    # block the USGS/EMSC sweeps (each has its own try/except).
    state_path = tmp_path / "worker_state.json"
    products_root = tmp_path / "products"

    def fetch(url, params=None):
        return _feature_collection()

    def failing_fetch_text(url, params=None):
        raise run_worker.requests.RequestException("geofon is down")

    captured_handler = {}

    def fake_signal(signum, handler):
        captured_handler["handler"] = handler
        return None

    def fake_sleep(seconds):
        captured_handler["handler"](2, None)

    monkeypatch.setattr(run_worker.signal, "signal", fake_signal)
    monkeypatch.setattr(run_worker.time, "sleep", fake_sleep)

    uploader = run_worker.LocalOnlyUploader(log_fn=lambda *_: None)
    run_worker.run_daemon(
        state_path=state_path, products_root=products_root, uploader=uploader,
        fetch_fn=fetch, fetch_text_fn=failing_fetch_text,
    )

    out = capsys.readouterr().out
    logged_events = [json.loads(line)["event"] for line in out.strip().splitlines()]
    assert "geofon_sweep_failed" in logged_events
    # The other sweeps in the same cycle ran fine.
    assert "region_sweep_failed" not in logged_events
    assert "emsc_sweep_failed" not in logged_events
    assert "daemon_stop" in logged_events
