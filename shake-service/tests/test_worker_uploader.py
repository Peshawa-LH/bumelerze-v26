"""uploader.py: `shakemap_products` row-shape mapping (LocalOnlyUploader)
+ SupabaseUploader stub behavior."""

from __future__ import annotations

from pathlib import Path

import pytest

from shake_service.worker.uploader import LocalOnlyUploader, ShakeMapProductRow, SupabaseUploader


def _product_paths(tmp_path: Path) -> dict[str, Path]:
    return {
        "cont_mi": tmp_path / "cont_mi.json",
        "info": tmp_path / "info.json",
        "grid": tmp_path / "grid.json",
    }


def test_local_only_uploader_maps_all_three_files_to_correct_product_types(tmp_path):
    uploader = LocalOnlyUploader(log_fn=lambda *_: None)
    records = uploader.upload_products(
        event_id="us2000bmcg", version=1, product_paths=_product_paths(tmp_path), data_used={"source": "catalog"},
    )
    by_type = {r.product_type: r for r in records}
    assert set(by_type) == {"contours", "metadata", "raster"}
    assert by_type["contours"].storage_path == "shakemap/us2000bmcg/v1/cont_mi.json"
    assert by_type["metadata"].storage_path == "shakemap/us2000bmcg/v1/info.json"
    assert by_type["raster"].storage_path == "shakemap/us2000bmcg/v1/grid.json"


def test_local_only_uploader_row_fields_match_migration_columns(tmp_path):
    uploader = LocalOnlyUploader(log_fn=lambda *_: None)
    records = uploader.upload_products(
        event_id="us2000bmcg", version=3, product_paths=_product_paths(tmp_path), data_used={"source": "catalog+dyfi"},
    )
    for record in records:
        assert isinstance(record, ShakeMapProductRow)
        assert record.event_id == "us2000bmcg"
        assert record.producer == "bumelerze"
        assert record.version == 3
        assert record.product_type in ("contours", "raster", "metadata")
        assert record.data_used == {"source": "catalog+dyfi"}
        assert record.created_at  # non-empty ISO timestamp


def test_local_only_uploader_never_writes_or_deletes_files(tmp_path):
    paths = _product_paths(tmp_path)
    for p in paths.values():
        p.write_text("{}")
    uploader = LocalOnlyUploader(log_fn=lambda *_: None)
    uploader.upload_products(event_id="ev", version=1, product_paths=paths, data_used={})
    for p in paths.values():
        assert p.exists()
        assert p.read_text() == "{}"


def test_local_only_uploader_logs_one_would_upload_line_per_file(tmp_path):
    logged: list[str] = []
    uploader = LocalOnlyUploader(log_fn=logged.append)
    uploader.upload_products(event_id="ev", version=1, product_paths=_product_paths(tmp_path), data_used={})
    assert len(logged) == 3
    assert all("WOULD upload" in line for line in logged)


def test_local_only_uploader_skips_unrecognized_file_keys(tmp_path):
    logged: list[str] = []
    uploader = LocalOnlyUploader(log_fn=logged.append)
    paths = {**_product_paths(tmp_path), "mystery": tmp_path / "mystery.json"}
    records = uploader.upload_products(event_id="ev", version=1, product_paths=paths, data_used={})
    assert len(records) == 3  # mystery key never became a row
    assert any("unrecognized" in line for line in logged)


def test_supabase_uploader_raises_not_implemented_on_construction():
    with pytest.raises(NotImplementedError):
        SupabaseUploader()


def test_local_only_uploader_defaults_review_status_to_automatic(tmp_path):
    uploader = LocalOnlyUploader(log_fn=lambda *_: None)
    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=_product_paths(tmp_path), data_used={},
    )
    assert all(r.review_status == "automatic" for r in records)


def test_local_only_uploader_passes_through_reviewed_status(tmp_path):
    uploader = LocalOnlyUploader(log_fn=lambda *_: None)
    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=_product_paths(tmp_path), data_used={}, review_status="reviewed",
    )
    assert all(r.review_status == "reviewed" for r in records)
