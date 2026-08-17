"""uploader.py: `shakemap_products` INDEX row-shape mapping
(`LocalOnlyUploader`), the real `SupabaseUploader` (event resolution,
vector-first gating, idempotent index upsert, engine-provenance and bbox
carry-through, all against injected fakes — no network anywhere in this
file), `AtlasRepoPublisher`'s real filesystem behavior (deterministic
directory tree + manifests, still no network), and `build_uploader`'s
credentials-present/absent fallback. `_HttpSupabaseIndexWriter`'s own
request-shaping is covered separately against a monkeypatched
`requests.Session`, still zero real network calls.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import requests

from shake_service.worker.uploader import (
    DEFAULT_STORAGE_PREFIX,
    AtlasRepoPublisher,
    EventMeta,
    LocalOnlyUploader,
    ShakeMapProductRow,
    SupabaseUploadError,
    SupabaseUploader,
    _HttpSupabaseIndexWriter,
    build_uploader,
    supabase_index_writer_from_env,
)


def _product_paths(tmp_path: Path) -> dict[str, Path]:
    return {
        "cont_mi": tmp_path / "cont_mi.json",
        "info": tmp_path / "info.json",
        "grid": tmp_path / "grid.json",
    }


def _write_product_files(
    tmp_path: Path,
    *,
    version_block: dict[str, Any] | None = None,
    event_block: dict[str, Any] | None = None,
    grid_block: dict[str, Any] | None = None,
) -> dict[str, Path]:
    paths = _product_paths(tmp_path)
    paths["cont_mi"].write_text(json.dumps({"type": "FeatureCollection", "features": []}))
    paths["grid"].write_text(json.dumps({"pga_g": []}))
    info_payload: dict[str, Any] = {"product_schema_version": 1, "producer": "bumelerze-shake-service"}
    if version_block is not None:
        info_payload["version"] = version_block
    if event_block is not None:
        info_payload["event"] = event_block
    if grid_block is not None:
        info_payload["grid"] = grid_block
    paths["info"].write_text(json.dumps(info_payload))
    return paths


def _event_meta(**overrides: Any) -> EventMeta:
    fields: dict[str, Any] = dict(
        provider="usgs",
        origin_time_ms=1_723_000_000_000,
        lat=35.5,
        lon=45.0,
        depth_km=10.0,
        magnitude=4.2,
        mag_type=None,
        place="test place",
    )
    fields.update(overrides)
    return EventMeta(**fields)


# ---------------------------------------------------------------------------
# LocalOnlyUploader — unchanged behavior, plus the new event_meta param is
# accepted (and ignored), matching worker/pipeline.py's real call shape.
# ---------------------------------------------------------------------------


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
        assert record.internal_event_id is None  # LocalOnlyUploader never resolves anything
        assert record.bbox_min_lat is None  # LocalOnlyUploader never derives a bbox either


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


def test_local_only_uploader_ignores_event_meta(tmp_path):
    """`worker/pipeline.py` always passes `event_meta` now — LocalOnlyUploader
    must accept it without changing its (local-only, event_meta-blind)
    behavior."""
    uploader = LocalOnlyUploader(log_fn=lambda *_: None)
    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=_product_paths(tmp_path), data_used={}, event_meta=_event_meta(),
    )
    assert len(records) == 3
    assert all(r.internal_event_id is None for r in records)


# ---------------------------------------------------------------------------
# EventMeta
# ---------------------------------------------------------------------------


def test_event_meta_origin_time_iso_converts_ms_to_utc_iso8601():
    meta = _event_meta(origin_time_ms=1_723_000_000_000)
    assert meta.origin_time_iso == "2024-08-07T03:06:40+00:00"


# ---------------------------------------------------------------------------
# SupabaseUploader — against fake SupabaseIndexWriter/ArtifactPublisher. No
# network anywhere in this section.
# ---------------------------------------------------------------------------


class FakeIndexWriter:
    """Simulates just enough of `SupabaseIndexWriter`'s contract: idempotent
    event resolution and idempotent (merge-duplicates) row upserts keyed on
    (event_id, producer, version, product_type)."""

    def __init__(self) -> None:
        self.resolve_calls: list[dict[str, Any]] = []
        self.upsert_calls: list[list[dict[str, Any]]] = []
        self._resolved: dict[tuple[str, str], str] = {}
        self._next_uuid = 0
        self.rows_by_key: dict[tuple[Any, ...], dict[str, Any]] = {}

    def resolve_event_id(
        self, *, provider, provider_event_id, origin_time_iso, lat, lon, depth_km, magnitude, mag_type, place
    ) -> str:
        self.resolve_calls.append(
            dict(
                provider=provider, provider_event_id=provider_event_id, origin_time_iso=origin_time_iso,
                lat=lat, lon=lon, depth_km=depth_km, magnitude=magnitude, mag_type=mag_type, place=place,
            )
        )
        key = (provider, provider_event_id)
        if key not in self._resolved:
            self._next_uuid += 1
            self._resolved[key] = f"00000000-0000-0000-0000-{self._next_uuid:012d}"
        return self._resolved[key]

    def upsert_shakemap_products(self, rows: list[dict[str, Any]]) -> None:
        self.upsert_calls.append(rows)
        for row in rows:
            key = (row["event_id"], row["producer"], row["version"], row["product_type"])
            self.rows_by_key[key] = row  # last-write-wins, exactly like a real merge-duplicates upsert


class FakeArtifactPublisher:
    """Simulates `ArtifactPublisher`: records what it was asked to publish
    and hands back deterministic fake URLs, one per product_type given."""

    def __init__(self) -> None:
        self.publish_calls: list[dict[str, Any]] = []

    def publish(self, *, event_key, version, product_files, engine_version, review_status) -> dict[str, str]:
        self.publish_calls.append(
            dict(
                event_key=event_key, version=version, product_files=dict(product_files),
                engine_version=engine_version, review_status=review_status,
            )
        )
        return {pt: f"fake://atlas/{event_key}/v{version}/{pt}" for pt in product_files}


def test_supabase_uploader_resolves_event_and_publishes_vector_products_by_default(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    paths = _write_product_files(tmp_path)

    records = uploader.upload_products(
        event_id="us2000bmcg", version=1, product_paths=paths, data_used={"source": "catalog"},
        event_meta=_event_meta(provider="usgs"),
    )

    assert len(index_writer.resolve_calls) == 1
    assert index_writer.resolve_calls[0]["provider"] == "usgs"
    assert index_writer.resolve_calls[0]["provider_event_id"] == "us2000bmcg"

    # Vector-first default: raster is NOT published, no row for it at all.
    assert len(publisher.publish_calls) == 1
    assert set(publisher.publish_calls[0]["product_files"]) == {"contours", "metadata"}
    assert len(records) == 2
    assert {r.product_type for r in records} == {"contours", "metadata"}

    internal_ids = {r.internal_event_id for r in records}
    assert len(internal_ids) == 1  # every row of this version resolves to the SAME internal event
    assert all(r.event_id == "us2000bmcg" for r in records)  # external id preserved on the row object
    assert len(index_writer.rows_by_key) == 2
    assert all(row["event_id"] in internal_ids for row in index_writer.rows_by_key.values())


def test_supabase_uploader_publishes_raster_when_opted_in(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(
        index_writer=index_writer, artifact_publisher=publisher, publish_raster=True, log_fn=lambda *_: None,
    )
    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=_write_product_files(tmp_path), data_used={},
        event_meta=_event_meta(),
    )
    assert {r.product_type for r in records} == {"contours", "metadata", "raster"}
    assert set(publisher.publish_calls[0]["product_files"]) == {"contours", "metadata", "raster"}


def test_supabase_uploader_event_key_prefers_bumelerze_id(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    uploader.upload_products(
        event_id="us2000bmcg", version=1, product_paths=_write_product_files(tmp_path),
        data_used={"bumelerze_id": "bml2026a3kx"}, event_meta=_event_meta(),
    )
    assert publisher.publish_calls[0]["event_key"] == "bml2026a3kx"


def test_supabase_uploader_event_key_falls_back_to_provider_id_when_no_bml_id(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    uploader.upload_products(
        event_id="us2000bmcg", version=1, product_paths=_write_product_files(tmp_path),
        data_used={"bumelerze_id": None}, event_meta=_event_meta(),
    )
    assert publisher.publish_calls[0]["event_key"] == "us2000bmcg"


def test_supabase_uploader_requires_event_meta(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    with pytest.raises(ValueError, match="event_meta"):
        uploader.upload_products(
            event_id="ev", version=1, product_paths=_write_product_files(tmp_path), data_used={},
        )
    assert index_writer.resolve_calls == []  # never even tried to resolve
    assert publisher.publish_calls == []  # never even tried to publish


def test_supabase_uploader_is_idempotent_on_replay(tmp_path):
    """Replaying the exact same product upload (the pipeline's own
    idempotency guarantee failing open, or a manual re-run) must never grow
    the row count or mint a second physical event."""
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    paths = _write_product_files(tmp_path)
    kwargs = dict(
        event_id="us2000bmcg", version=2, product_paths=paths, data_used={"source": "catalog"},
        event_meta=_event_meta(provider="usgs"),
    )

    first = uploader.upload_products(**kwargs)
    second = uploader.upload_products(**kwargs)

    assert len(index_writer.resolve_calls) == 2  # resolution IS called twice ...
    assert len({c["provider_event_id"] for c in index_writer.resolve_calls}) == 1
    first_ids = {r.internal_event_id for r in first}
    second_ids = {r.internal_event_id for r in second}
    assert first_ids == second_ids  # ... but always resolves to the same internal id
    assert len(index_writer.rows_by_key) == 2  # never 4 — merge-duplicates upsert, not append
    assert len(index_writer.upsert_calls) == 2  # two upsert calls were made, both idempotent


def test_supabase_uploader_skips_unrecognized_file_keys(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    logged: list[str] = []
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=logged.append)
    paths = {**_write_product_files(tmp_path), "mystery": tmp_path / "mystery.json"}
    paths["mystery"].write_text("{}")

    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=paths, data_used={}, event_meta=_event_meta(),
    )

    assert {r.product_type for r in records} == {"contours", "metadata"}
    assert any("unrecognized" in line for line in logged)


def test_supabase_uploader_carries_engine_version_block_from_info_json(tmp_path):
    version_block = {
        "service_version": "0.1.0",
        "openquake_pin": "openquake.engine==3.26.2",
        "gsim_branches": "CY14,ASB14,BSSA14,KALE15",
        "ems_model": "Zaniniandhofer19",
        "mmi_model": "WordenEtAl12",
        "conditioning": "mvn (Engler et al. 2022)",
    }
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    paths = _write_product_files(tmp_path, version_block=version_block)

    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=paths, data_used={"source": "catalog+dyfi"},
        event_meta=_event_meta(),
    )

    # Every published row of this version carries the engine stamp, not just
    # the metadata-type row — so a staleness query never has to special-case
    # product_type.
    for record in records:
        assert record.data_used["engine_version"] == version_block
        assert record.data_used["source"] == "catalog+dyfi"  # original data_used content preserved
    for row in index_writer.rows_by_key.values():
        assert row["data_used"]["engine_version"] == version_block
    assert publisher.publish_calls[0]["engine_version"] == version_block


def test_supabase_uploader_tolerates_missing_info_file(tmp_path):
    """No `"info"` key in product_paths at all (a hypothetical partial
    export) — enrichment is skipped, contours still published."""
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    paths = _write_product_files(tmp_path)
    del paths["info"]

    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=paths, data_used={"source": "catalog"}, event_meta=_event_meta(),
    )

    assert len(records) == 1  # only contours left
    assert all("engine_version" not in r.data_used for r in records)
    assert all(r.bbox_min_lat is None for r in records)


def test_supabase_uploader_tolerates_malformed_info_json(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    logged: list[str] = []
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=logged.append)
    paths = _write_product_files(tmp_path)
    paths["info"].write_text("not valid json{{{")

    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=paths, data_used={"source": "catalog"}, event_meta=_event_meta(),
    )

    assert {r.product_type for r in records} == {"contours", "metadata"}  # upload still succeeds
    assert all("engine_version" not in r.data_used for r in records)
    assert any("could not read" in line for line in logged)


def test_supabase_uploader_passes_through_review_status(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=_write_product_files(tmp_path), data_used={},
        review_status="reviewed", event_meta=_event_meta(),
    )
    assert all(r.review_status == "reviewed" for r in records)
    assert all(row["review_status"] == "reviewed" for row in index_writer.rows_by_key.values())


def test_supabase_uploader_requires_writer_and_publisher_arguments():
    with pytest.raises(TypeError):
        SupabaseUploader()  # type: ignore[call-arg]  # both are required, no silent no-op construction


# ---------------------------------------------------------------------------
# _bbox_from_info — coarse indexing bbox derivation
# ---------------------------------------------------------------------------


def test_supabase_uploader_derives_bbox_from_info_json_grid_extent(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    paths = _write_product_files(
        tmp_path, event_block={"lat": 35.0, "lon": 45.0, "depth_km": 10.0, "mag_mw": 5.0},
        grid_block={"half_extent_km": 111.0, "spacing_km": 3.0, "shape": [10, 10], "n_sites": 100},
    )

    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=paths, data_used={}, event_meta=_event_meta(lat=1.0, lon=1.0),
    )

    for r in records:
        assert r.bbox_min_lat == pytest.approx(34.0, abs=0.01)
        assert r.bbox_max_lat == pytest.approx(36.0, abs=0.01)
        # 111 km east-west at lat 35 covers more than 1 degree of longitude
        assert r.bbox_min_lon < 45.0 < r.bbox_max_lon
    # info.json's own event.lat/lon (35.0) was preferred over event_meta's (1.0)
    for row in index_writer.rows_by_key.values():
        assert row["bbox_min_lat"] == pytest.approx(34.0, abs=0.01)


def test_supabase_uploader_bbox_is_none_without_grid_extent(tmp_path):
    index_writer = FakeIndexWriter()
    publisher = FakeArtifactPublisher()
    uploader = SupabaseUploader(index_writer=index_writer, artifact_publisher=publisher, log_fn=lambda *_: None)
    paths = _write_product_files(tmp_path)  # no grid block at all

    records = uploader.upload_products(
        event_id="ev", version=1, product_paths=paths, data_used={}, event_meta=_event_meta(),
    )
    assert all(r.bbox_min_lat is None and r.bbox_max_lon is None for r in records)


# ---------------------------------------------------------------------------
# AtlasRepoPublisher — real filesystem writes, deterministic tree +
# manifests. No network.
# ---------------------------------------------------------------------------


def test_atlas_repo_publisher_writes_files_under_events_event_key_version(tmp_path):
    publisher = AtlasRepoPublisher(publish_root=tmp_path)
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    (src_dir / "cont_mi.json").write_text('{"a": 1}')
    (src_dir / "info.json").write_text('{"b": 2}')

    urls = publisher.publish(
        event_key="bml2026a3kx", version=1,
        product_files={"contours": src_dir / "cont_mi.json", "metadata": src_dir / "info.json"},
        engine_version=None, review_status="automatic",
    )

    assert (tmp_path / "events" / "bml2026a3kx" / "v1" / "cont_mi.json").read_text() == '{"a": 1}'
    assert (tmp_path / "events" / "bml2026a3kx" / "v1" / "info.json").read_text() == '{"b": 2}'
    assert urls == {
        "contours": "events/bml2026a3kx/v1/cont_mi.json",
        "metadata": "events/bml2026a3kx/v1/info.json",
    }


def test_atlas_repo_publisher_prefixes_base_url_when_configured(tmp_path):
    publisher = AtlasRepoPublisher(publish_root=tmp_path, base_url="https://atlas.example.com/")
    src = tmp_path / "cont_mi.json"
    src.write_text("{}")
    urls = publisher.publish(
        event_key="ev", version=1, product_files={"contours": src}, engine_version=None, review_status="automatic",
    )
    assert urls["contours"] == "https://atlas.example.com/events/ev/v1/cont_mi.json"


def test_atlas_repo_publisher_republish_overwrites_same_path(tmp_path):
    publisher = AtlasRepoPublisher(publish_root=tmp_path)
    src = tmp_path / "cont_mi.json"
    src.write_text('{"first": true}')
    publisher.publish(event_key="ev", version=1, product_files={"contours": src}, engine_version=None, review_status="automatic")
    src.write_text('{"first": false}')
    publisher.publish(event_key="ev", version=1, product_files={"contours": src}, engine_version=None, review_status="automatic")

    dest = tmp_path / "events" / "ev" / "v1" / "cont_mi.json"
    assert dest.read_text() == '{"first": false}'


def test_atlas_repo_publisher_writes_per_event_manifest_with_all_versions(tmp_path):
    publisher = AtlasRepoPublisher(publish_root=tmp_path)
    src = tmp_path / "cont_mi.json"
    src.write_text("{}")

    publisher.publish(
        event_key="ev", version=1, product_files={"contours": src},
        engine_version={"service_version": "0.1.0"}, review_status="automatic",
    )
    publisher.publish(
        event_key="ev", version=2, product_files={"contours": src},
        engine_version={"service_version": "0.2.0"}, review_status="reviewed",
    )

    manifest = json.loads((tmp_path / "events" / "ev" / "index.json").read_text())
    assert manifest["event_key"] == "ev"
    versions = {v["version"]: v for v in manifest["versions"]}
    assert set(versions) == {1, 2}
    assert versions[1]["engine_version"] == {"service_version": "0.1.0"}
    assert versions[2]["review_status"] == "reviewed"
    assert versions[1]["products"]["contours"] == "events/ev/v1/cont_mi.json"


def test_atlas_repo_publisher_republishing_same_version_does_not_duplicate_manifest_entry(tmp_path):
    publisher = AtlasRepoPublisher(publish_root=tmp_path)
    src = tmp_path / "cont_mi.json"
    src.write_text("{}")
    publisher.publish(event_key="ev", version=1, product_files={"contours": src}, engine_version=None, review_status="automatic")
    publisher.publish(event_key="ev", version=1, product_files={"contours": src}, engine_version=None, review_status="reviewed")

    manifest = json.loads((tmp_path / "events" / "ev" / "index.json").read_text())
    assert len(manifest["versions"]) == 1
    assert manifest["versions"][0]["review_status"] == "reviewed"  # latest publish wins


def test_atlas_repo_publisher_writes_global_index_across_events(tmp_path):
    publisher = AtlasRepoPublisher(publish_root=tmp_path)
    src = tmp_path / "cont_mi.json"
    src.write_text("{}")
    publisher.publish(event_key="ev_a", version=1, product_files={"contours": src}, engine_version=None, review_status="automatic")
    publisher.publish(event_key="ev_a", version=2, product_files={"contours": src}, engine_version=None, review_status="automatic")
    publisher.publish(event_key="ev_b", version=1, product_files={"contours": src}, engine_version=None, review_status="automatic")

    global_index = json.loads((tmp_path / "index.json").read_text())
    by_key = {e["event_key"]: e for e in global_index["events"]}
    assert by_key["ev_a"]["latest_version"] == 2
    assert by_key["ev_a"]["index_path"] == "events/ev_a/index.json"
    assert by_key["ev_b"]["latest_version"] == 1


def test_atlas_repo_publisher_tolerates_corrupt_manifest(tmp_path):
    event_dir = tmp_path / "events" / "ev"
    event_dir.mkdir(parents=True)
    (event_dir / "index.json").write_text("not valid json{{{")

    publisher = AtlasRepoPublisher(publish_root=tmp_path)
    src = tmp_path / "cont_mi.json"
    src.write_text("{}")
    publisher.publish(event_key="ev", version=1, product_files={"contours": src}, engine_version=None, review_status="automatic")

    manifest = json.loads((event_dir / "index.json").read_text())
    assert [v["version"] for v in manifest["versions"]] == [1]


# ---------------------------------------------------------------------------
# build_uploader / supabase_index_writer_from_env — the credentials-present/
# absent fallback (task requirement: degrade safely, never crash the worker).
# ---------------------------------------------------------------------------


def test_build_uploader_falls_back_to_local_only_without_credentials(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    logged: list[str] = []

    uploader = build_uploader(log_fn=logged.append)

    assert isinstance(uploader, LocalOnlyUploader)
    assert any("falling back to LocalOnlyUploader" in line for line in logged)


def test_build_uploader_falls_back_when_only_url_is_set(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    assert isinstance(build_uploader(log_fn=lambda *_: None), LocalOnlyUploader)


def test_build_uploader_falls_back_when_only_key_is_set(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "secret")
    assert isinstance(build_uploader(log_fn=lambda *_: None), LocalOnlyUploader)


def test_build_uploader_returns_supabase_uploader_when_both_set(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "secret")

    uploader = build_uploader(log_fn=lambda *_: None)

    assert isinstance(uploader, SupabaseUploader)


def test_build_uploader_respects_publish_raster_env(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "secret")
    monkeypatch.setenv("BUMELERZE_ATLAS_PUBLISH_ROOT", str(tmp_path))
    monkeypatch.setenv("BUMELERZE_PUBLISH_RASTER", "true")

    uploader = build_uploader(log_fn=lambda *_: None)

    assert isinstance(uploader, SupabaseUploader)
    assert uploader._publish_raster is True


def test_supabase_index_writer_from_env_never_uses_the_anon_key_name(monkeypatch):
    """Guard against the one dangerous mixup this module's docstring warns
    about: an anon-key-only env (as the app itself uses) must never satisfy
    this function — only the two SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
    names count."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setenv("EXPO_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "anon-not-service-role")
    assert supabase_index_writer_from_env() is None


# ---------------------------------------------------------------------------
# _HttpSupabaseIndexWriter — request shaping against a monkeypatched
# requests.Session (still zero real network I/O).
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, *, status_code: int = 200, payload: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"status {self.status_code}")

    def json(self) -> Any:
        return self._payload


def _client(monkeypatch, *, responder) -> tuple[_HttpSupabaseIndexWriter, list[dict[str, Any]]]:
    client = _HttpSupabaseIndexWriter(base_url="https://example.supabase.co", service_role_key="secret")
    calls: list[dict[str, Any]] = []

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        return responder(url, **kwargs)

    monkeypatch.setattr(client._session, "post", fake_post)
    return client, calls


def test_http_index_writer_resolve_event_id_posts_rpc_and_returns_uuid(monkeypatch):
    resolved = "11111111-1111-1111-1111-111111111111"
    client, calls = _client(monkeypatch, responder=lambda url, **kw: _FakeResponse(payload=resolved))

    result = client.resolve_event_id(
        provider="usgs", provider_event_id="us2000bmcg", origin_time_iso="2026-08-07T00:00:00+00:00",
        lat=35.0, lon=45.0, depth_km=10.0, magnitude=4.2, mag_type=None, place="somewhere",
    )

    assert result == resolved
    assert len(calls) == 1
    assert calls[0]["url"] == "https://example.supabase.co/rest/v1/rpc/upsert_event_from_client"
    assert calls[0]["json"]["p_provider"] == "usgs"
    assert calls[0]["json"]["p_provider_event_id"] == "us2000bmcg"


def test_http_index_writer_resolve_event_id_wraps_request_failure(monkeypatch):
    def raise_it(url, **kw):
        raise requests.ConnectionError("boom")

    client = _HttpSupabaseIndexWriter(base_url="https://example.supabase.co", service_role_key="secret")
    monkeypatch.setattr(client._session, "post", raise_it)

    with pytest.raises(SupabaseUploadError, match="upsert_event_from_client"):
        client.resolve_event_id(
            provider="usgs", provider_event_id="us2000bmcg", origin_time_iso="2026-08-07T00:00:00+00:00",
            lat=35.0, lon=45.0, depth_km=10.0, magnitude=4.2, mag_type=None, place=None,
        )


def test_http_index_writer_resolve_event_id_rejects_non_uuid_payload(monkeypatch):
    client, _ = _client(monkeypatch, responder=lambda url, **kw: _FakeResponse(payload={"unexpected": "shape"}))
    with pytest.raises(SupabaseUploadError, match="unexpected RPC response"):
        client.resolve_event_id(
            provider="usgs", provider_event_id="us2000bmcg", origin_time_iso="2026-08-07T00:00:00+00:00",
            lat=35.0, lon=45.0, depth_km=10.0, magnitude=4.2, mag_type=None, place=None,
        )


def test_http_index_writer_upsert_shakemap_products_sets_merge_duplicates_header(monkeypatch):
    client, calls = _client(monkeypatch, responder=lambda url, **kw: _FakeResponse())
    rows = [{"event_id": "e1", "producer": "bumelerze", "version": 1, "product_type": "metadata"}]

    client.upsert_shakemap_products(rows)

    assert len(calls) == 1
    assert calls[0]["params"]["on_conflict"] == "event_id,producer,version,product_type"
    assert calls[0]["headers"]["Prefer"] == "resolution=merge-duplicates,return=minimal"
    assert json.loads(calls[0]["data"]) == rows


def test_http_index_writer_upsert_shakemap_products_is_a_noop_for_empty_rows(monkeypatch):
    client, calls = _client(monkeypatch, responder=lambda url, **kw: _FakeResponse())
    client.upsert_shakemap_products([])
    assert calls == []


def test_http_index_writer_upsert_shakemap_products_wraps_request_failure(monkeypatch):
    def raise_it(url, **kw):
        raise requests.Timeout("slow")

    client = _HttpSupabaseIndexWriter(base_url="https://example.supabase.co", service_role_key="secret")
    monkeypatch.setattr(client._session, "post", raise_it)
    with pytest.raises(SupabaseUploadError, match="upsert_shakemap_products"):
        client.upsert_shakemap_products([{"event_id": "e1", "producer": "bumelerze", "version": 1, "product_type": "metadata"}])
