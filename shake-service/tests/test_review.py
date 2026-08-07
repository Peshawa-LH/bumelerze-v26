"""review.py: the v1 scientist-review channel — pure info.json read/write,
idempotent re-review guard, atomic write."""

from __future__ import annotations

import json

import pytest

from shake_service import review


def _write_info(tmp_path, *, review_status="automatic", reviewed_by=None, reviewed_at=None):
    path = tmp_path / "us2000bmcg" / "v1" / "info.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "producer": "bumelerze-shake-service",
        "product_version": 1,
        "review_status": review_status,
        "reviewed_by": reviewed_by,
        "reviewed_at": reviewed_at,
    }
    path.write_text(json.dumps(payload))
    return path


def test_info_json_path_matches_pipeline_layout(tmp_path):
    path = review.info_json_path(tmp_path, "us2000bmcg", 1)
    assert path == tmp_path / "us2000bmcg" / "v1" / "info.json"


def test_read_info_json_raises_review_error_when_missing(tmp_path):
    with pytest.raises(review.ReviewError, match="no info.json"):
        review.read_info_json(tmp_path / "does_not_exist" / "info.json")


def test_mark_reviewed_flips_status_and_records_reviewer(tmp_path):
    path = _write_info(tmp_path)
    updated = review.mark_reviewed(path, reviewed_by="peshawa")

    assert updated["review_status"] == "reviewed"
    assert updated["reviewed_by"] == "peshawa"
    assert updated["reviewed_at"]

    on_disk = json.loads(path.read_text())
    assert on_disk == updated


def test_mark_reviewed_uses_explicit_reviewed_at(tmp_path):
    import datetime as dt

    path = _write_info(tmp_path)
    ts = dt.datetime(2026, 8, 7, 12, 0, 0, tzinfo=dt.timezone.utc)
    updated = review.mark_reviewed(path, reviewed_by="peshawa", reviewed_at=ts)
    assert updated["reviewed_at"] == ts.isoformat()


def test_mark_reviewed_is_idempotent_by_default_no_overwrite(tmp_path):
    path = _write_info(tmp_path, review_status="reviewed", reviewed_by="first-reviewer", reviewed_at="2026-08-01T00:00:00+00:00")

    updated = review.mark_reviewed(path, reviewed_by="someone-else")

    assert updated["reviewed_by"] == "first-reviewer"  # unchanged -- no silent overwrite
    assert updated["reviewed_at"] == "2026-08-01T00:00:00+00:00"


def test_mark_reviewed_allow_re_review_explicitly_overwrites(tmp_path):
    path = _write_info(tmp_path, review_status="reviewed", reviewed_by="first-reviewer", reviewed_at="2026-08-01T00:00:00+00:00")

    updated = review.mark_reviewed(path, reviewed_by="corrected-reviewer", allow_re_review=True)

    assert updated["reviewed_by"] == "corrected-reviewer"
    assert updated["reviewed_at"] != "2026-08-01T00:00:00+00:00"


def test_mark_reviewed_preserves_every_other_info_json_field(tmp_path):
    path = tmp_path / "us2000bmcg" / "v1" / "info.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"producer": "bumelerze-shake-service", "event": {"mag_mw": 7.3}, "review_status": "automatic", "reviewed_by": None, "reviewed_at": None}
    path.write_text(json.dumps(payload))

    updated = review.mark_reviewed(path, reviewed_by="peshawa")

    assert updated["producer"] == "bumelerze-shake-service"
    assert updated["event"] == {"mag_mw": 7.3}


def test_mark_reviewed_leaves_no_tmp_file_behind(tmp_path):
    path = _write_info(tmp_path)
    review.mark_reviewed(path, reviewed_by="peshawa")
    assert not path.with_name(path.name + ".tmp").exists()
