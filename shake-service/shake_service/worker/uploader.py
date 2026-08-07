"""uploader — `ProductUploader`: turn one pipeline run's exported product
files into `shakemap_products` row-shaped records
(`supabase/migrations/0006_shakemap_products.sql`) and hand them off
somewhere. Two implementations this wave:

- `LocalOnlyUploader` (default): products stay on disk exactly where
  `export.write_products` put them; this class only LOGS what it WOULD
  upload, mapped to the exact row shape the migration defines. This is
  what `scripts/run_worker.py` uses until Supabase exists.
- `SupabaseUploader`: a stub that raises `NotImplementedError` with a doc
  comment describing the two things it will need to do once the Supabase
  project exists (storage upload + row insert) — never called for real in
  this task (no real Supabase calls, per the task boundary).

**`event_id` mapping — the one deliberately-unresolved seam.** The
migration's `shakemap_products.event_id` is a UUID foreign key into the
INTERNAL `public.events` table, which is populated by a *different* worker
(the ingestion/dedup pipeline, `docs/research/event-pipeline-design.md`)
that does not exist yet. This worker only ever knows the catalog's own
external id (e.g. `"us2000bmcg"`, `FeedEvent.external_id`). Every
`ShakeMapProductRow` below therefore carries that EXTERNAL id in its
`event_id` field, clearly documented as such — `SupabaseUploader` is the
integration point that will need to resolve external id -> internal
`events.event_id` UUID (most likely via `event_source_records`, per
event-pipeline-design.md §1) before a real row can be inserted. Recording
this explicitly here is the point: silently shipping the external id into
a column typed as an internal UUID FK would be a real data-integrity bug
if this stub were ever connected as-is.
"""

from __future__ import annotations

import abc
import datetime as _dt
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# `export.write_products` returns exactly these three keys
# (`shake_service/export.py`'s `write_products` orchestrator) mapped to the
# `shakemap_products.product_type` check constraint's three allowed values.
PRODUCT_TYPE_BY_FILE: dict[str, str] = {
    "cont_mi": "contours",
    "info": "metadata",
    "grid": "raster",
}

PRODUCER = "bumelerze"  # matches export.py's PRODUCER and the migration's producer check constraint


@dataclass(frozen=True)
class ShakeMapProductRow:
    """Mirrors `shakemap_products` columns 1:1, EXCEPT `event_id` — see
    module docstring's "event_id mapping" note. `product_id` and
    `created_at`'s DB-side `default now()` are intentionally not
    reproduced here (this is a row to be INSERTED, not a full row as
    stored); `created_at` is still recorded so `LocalOnlyUploader`'s log
    line and any future `SupabaseUploader` insert can use the SAME
    timestamp rather than each computing "now" independently."""

    event_id: str  # EXTERNAL catalog id for now — see module docstring
    producer: str
    version: int
    product_type: str  # "contours" | "raster" | "metadata"
    storage_path: str
    data_used: dict[str, Any]
    created_at: str  # ISO 8601
    # D21 "scientist-review status" — mirrors export.py's info.json field of
    # the same name (`supabase/migrations/0007_shakemap_review_status.sql`).
    # Defaulted so every pre-D21 caller of `upload_products` keeps working
    # unchanged.
    review_status: str = "automatic"


class ProductUploader(abc.ABC):
    """Interface `pipeline.py` calls after `export.write_products` for one
    (event, version). Implementations decide what "upload" means."""

    @abc.abstractmethod
    def upload_products(
        self,
        *,
        event_id: str,
        version: int,
        product_paths: dict[str, Path],
        data_used: dict[str, Any],
        review_status: str = "automatic",
    ) -> list[ShakeMapProductRow]:
        """`product_paths` is exactly `export.write_products`'s return
        value (keys `"cont_mi"`/`"info"`/`"grid"`, values local `Path`s).
        Returns one `ShakeMapProductRow` per recognized product file, in
        `PRODUCT_TYPE_BY_FILE` order is not guaranteed — callers should not
        depend on row order. `review_status` (D21) should mirror whatever
        `export.write_products` was called with for this same version."""
        raise NotImplementedError


class LocalOnlyUploader(ProductUploader):
    """Default uploader: never leaves the local machine. Logs the row it
    WOULD have upserted (Supabase Storage path + `shakemap_products` row
    shape) and returns the same records for the caller's own logging/tests
    — nothing is written anywhere except the structured log line."""

    def __init__(self, *, log_fn: Any = print, storage_prefix: str = "shakemap") -> None:
        self._log = log_fn
        self._storage_prefix = storage_prefix

    def upload_products(
        self,
        *,
        event_id: str,
        version: int,
        product_paths: dict[str, Path],
        data_used: dict[str, Any],
        review_status: str = "automatic",
    ) -> list[ShakeMapProductRow]:
        created_at = _dt.datetime.now(_dt.timezone.utc).isoformat()
        records: list[ShakeMapProductRow] = []
        for file_key, local_path in product_paths.items():
            product_type = PRODUCT_TYPE_BY_FILE.get(file_key)
            if product_type is None:
                # Defensive: export.py's contract is exactly these 3 keys;
                # an unrecognized key is a signal export.py changed shape
                # under us, not something to upload blindly.
                self._log(
                    f"[LocalOnlyUploader] skipping unrecognized product file key "
                    f"{file_key!r} for {event_id} v{version} (local file: {local_path})"
                )
                continue
            storage_path = f"{self._storage_prefix}/{event_id}/v{version}/{Path(local_path).name}"
            record = ShakeMapProductRow(
                event_id=event_id,
                producer=PRODUCER,
                version=version,
                product_type=product_type,
                storage_path=storage_path,
                data_used=data_used,
                created_at=created_at,
                review_status=review_status,
            )
            self._log(
                f"[LocalOnlyUploader] WOULD upload {record.product_type} product for "
                f"event={event_id} v{version} -> storage_path={storage_path} "
                f"(local file: {local_path})"
            )
            records.append(record)
        return records


class SupabaseUploader(ProductUploader):
    """Wired once the Supabase project exists (PROJECT.md "Blocked on
    Peshawa"). Two things this will need to do, neither implemented here:

    1. Upload each local product file to Supabase Storage at
       `storage_path`, using the service_role key (bypasses RLS — same as
       `shakemap_products`'s own write-policy comment in the migration:
       "Writes come only from the shake-service via the service_role key").
    2. Resolve `event_id` (external catalog id, this class's constructor
       argument) to the internal `events.event_id` UUID (see module
       docstring), then `upsert` into `shakemap_products` on its own
       `(event_id, producer, version, product_type)` unique constraint —
       so a re-run is idempotent at the DB layer too, not just in this
       worker's local JSON state.

    Raises `NotImplementedError` immediately on construction so a caller
    can never silently no-op through this class — it must be an explicit,
    deliberate wiring step, not a config flag flipped by accident.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError(
            "SupabaseUploader is a stub — wire Supabase Storage upload + a "
            "shakemap_products upsert once the Supabase project exists. "
            "See this class's docstring for the two required integration steps "
            "(storage upload, event_id resolution + idempotent upsert)."
        )

    def upload_products(
        self,
        *,
        event_id: str,
        version: int,
        product_paths: dict[str, Path],
        data_used: dict[str, Any],
        review_status: str = "automatic",
    ) -> list[ShakeMapProductRow]:
        raise NotImplementedError("SupabaseUploader.upload_products is not wired yet — see class docstring.")
