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
