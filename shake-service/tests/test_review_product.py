"""review_product.py: CLI round-trip — info.json flip, optional WorkerState
audit-trail update, idempotent replay, argparse wiring."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import review_product  # noqa: E402

from shake_service.worker.state import EventState, WorkerState  # noqa: E402


def _write_info(products_root: Path, event_id: str, version: int) -> Path:
    path = products_root / event_id / f"v{version}" / "info.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"producer": "bumelerze-shake-service", "review_status": "automatic", "reviewed_by": None, "reviewed_at": None}))
    return path


def _event_state(**overrides) -> EventState:
    base = dict(
        external_id="us2000bmcg", source="usgs", mag=7.3, lat=34.9, lon=45.9, depth_km=19.0,
        last_version=1, params_hash="abc", product_paths={}, last_feed_updated_ms=1,
        first_seen_at="2026-08-07T00:00:00+00:00", last_computed_at="2026-08-07T00:00:00+00:00",
    )
    base.update(overrides)
    return EventState(**base)


def test_review_product_flips_info_json_on_disk(tmp_path):
    _write_info(tmp_path, "us2000bmcg", 1)

    result = review_product.review_product(
        products_root=tmp_path, event_id="us2000bmcg", version=1, reviewed_by="peshawa",
    )

    assert result["review_status"] == "reviewed"
    assert result["reviewed_by"] == "peshawa"
    on_disk = json.loads((tmp_path / "us2000bmcg" / "v1" / "info.json").read_text())
    assert on_disk["review_status"] == "reviewed"


def test_review_product_without_state_path_touches_no_state_file(tmp_path):
    _write_info(tmp_path, "us2000bmcg", 1)
    review_product.review_product(products_root=tmp_path, event_id="us2000bmcg", version=1, reviewed_by="peshawa")
    assert not (tmp_path / "worker_state.json").exists()


def test_review_product_updates_worker_state_reviews_when_state_path_given(tmp_path):
    _write_info(tmp_path, "us2000bmcg", 1)
    state_path = tmp_path / "worker_state.json"
    ws = WorkerState()
    ws.upsert_event(_event_state())
    ws.save(state_path)

    review_product.review_product(
        products_root=tmp_path, event_id="us2000bmcg", version=1, reviewed_by="peshawa", state_path=state_path,
    )

    reloaded = WorkerState.load(state_path)
    known = reloaded.get_event("us2000bmcg")
    assert known.reviews["1"]["review_status"] == "reviewed"
    assert known.reviews["1"]["reviewed_by"] == "peshawa"


def test_review_product_with_state_path_but_unknown_event_does_not_crash(tmp_path):
    _write_info(tmp_path, "us_unknown", 1)
    state_path = tmp_path / "worker_state.json"
    WorkerState().save(state_path)  # empty state, event not tracked

    result = review_product.review_product(
        products_root=tmp_path, event_id="us_unknown", version=1, reviewed_by="peshawa", state_path=state_path,
    )
    assert result["review_status"] == "reviewed"  # info.json still updated even though state has no record


def test_review_product_replay_is_idempotent_no_overwrite(tmp_path):
    _write_info(tmp_path, "us2000bmcg", 1)

    first = review_product.review_product(products_root=tmp_path, event_id="us2000bmcg", version=1, reviewed_by="first")
    second = review_product.review_product(products_root=tmp_path, event_id="us2000bmcg", version=1, reviewed_by="second")

    assert second["reviewed_by"] == first["reviewed_by"] == "first"


def test_review_product_allow_re_review_overrides(tmp_path):
    _write_info(tmp_path, "us2000bmcg", 1)

    review_product.review_product(products_root=tmp_path, event_id="us2000bmcg", version=1, reviewed_by="first")
    second = review_product.review_product(
        products_root=tmp_path, event_id="us2000bmcg", version=1, reviewed_by="second", allow_re_review=True,
    )

    assert second["reviewed_by"] == "second"


def test_main_parses_args_and_prints_json(tmp_path, monkeypatch, capsys):
    _write_info(tmp_path, "us2000bmcg", 1)
    monkeypatch.setattr(
        review_product.sys, "argv",
        [
            "review_product.py",
            "--products-root", str(tmp_path),
            "--event-id", "us2000bmcg",
            "--version", "1",
            "--reviewed-by", "peshawa",
        ],
    )

    review_product.main()

    out = json.loads(capsys.readouterr().out)
    assert out["review_status"] == "reviewed"
    assert out["reviewed_by"] == "peshawa"
