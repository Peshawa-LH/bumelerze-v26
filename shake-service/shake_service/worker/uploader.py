"""uploader — `ProductUploader`: turn one pipeline run's exported product
files into `shakemap_products` INDEX rows (`supabase/migrations/
0006_shakemap_products.sql` + `0019_shakemap_products_index_fields.sql`)
and publish the actual artifact files somewhere a client/site can read
them. Three-way split (owner architecture decision — see the module-level
"why not everything in Supabase" note below), each with its own
implementation this wave:

- `LocalOnlyUploader` (default when no Supabase credentials are configured):
  products stay on disk exactly where `export.write_products` put them;
  this class only LOGS what it WOULD publish/index — nothing leaves the
  local machine.
- `SupabaseUploader` (real, wired this wave): composes two independent,
  independently-swappable pieces —
    - a `SupabaseIndexWriter` (real impl `_HttpSupabaseIndexWriter`) that
      resolves the internal `events.event_id` and upserts a SMALL,
      queryable INDEX row per product file (event reference, version,
      product type, engine provenance, review status, a coarse bounding
      box, and the artifact's PUBLIC URL) — never the artifact bytes
      themselves.
    - an `ArtifactPublisher` (real impl `AtlasRepoPublisher`) that writes
      the actual product files into a clean, deterministic, versioned
      directory tree plus a machine-readable index — the local staging
      copy of the **Bumelerze Atlas**, a separate public data repository
      (D21's own naming) the orchestrator creates/publishes elsewhere.
      This class never creates or pushes to that repository itself.
- `build_uploader` — the factory every real entrypoint (`scripts/
  run_worker.py`) should call instead of constructing any of the above
  directly: reads env vars (below) and returns a working `SupabaseUploader`
  when Supabase credentials are set, or a `LocalOnlyUploader` (with a
  logged reason) when they aren't — so an unconfigured worker degrades to
  its old local-only behavior instead of crashing.

**Why not "everything into Supabase" (owner architecture decision).**
Storing every artifact's bytes in Postgres/Supabase Storage would make
`shakemap_products` (and its object storage) grow by one full copy of every
recompute forever, inside the app's own operational database — the wrong
place for what is, in practice, versioned open scientific data. The split
instead keeps Supabase as the fast, queryable INDEX (what the app's own
`felt_cells`/`events` tables already are) and pushes bulk artifacts to a
plain static file tree a CDN/GitHub Pages can serve cheaply and that is
independently citable. `shakemap_products.storage_path` already anticipated
exactly this shape before today (0006's own comment: "Supabase Storage path
(**or external URL for pass-through USGS products**)") — this wave just
makes bumelerze-produced rows use the same "external URL" shape USGS
pass-through rows always could.

**Vector-first (owner architecture decision).** The contour GeoJSON
(`product_type = "contours"`) and metadata (`"metadata"`) are what the app
renders as live, restylable map layers and what a dashboard queries — they
are ALWAYS published. The raster grid (`"raster"`, `grid.json`) is
secondary: `SupabaseUploader.publish_raster` (env: `BUMELERZE_PUBLISH_RASTER`)
defaults to `False`, and when it is, no raster file is published, no raster
INDEX ROW is written at all — not merely hidden, genuinely absent, matching
"excluded from anything the client fetches by default." Real measured sizes
from this repo's own committed Atlas output (`bumelerze-atlas/`, task
brief's own ask): `cont_mi.json` (contours) is ~101-142 KB for a first-pass
compute and ~437-527 KB for a conditioned recompute (more contour detail);
`info.json` (metadata) is ~1.9-2.6 KB. `grid.json` (raster) is NOT even
committed to this repo (`.gitignore`'s own comment: "~7 MB PER EVENT") —
15-70x the size of the vector artifacts, which is exactly why it stays
opt-in.

**`event_id` mapping — how the identity seam is closed.** The migration's
`shakemap_products.event_id` is a UUID foreign key into the INTERNAL
`public.events` table. This worker only ever knows the catalog's own
external id (e.g. `"us2000bmcg"`, `FeedEvent.external_id`).
`SupabaseUploader` resolves external id -> internal `events.event_id` UUID
by calling the SAME `upsert_event_from_client` RPC (`supabase/migrations/
0011_event_registry_and_assignment.sql`) the app itself calls to attach a
felt report to an event, reusing the one identity-resolution path this
project already has rather than reimplementing cross-provider dedup a
second time in Python. That RPC needs more than the external id (origin
time, lat/lon/depth/magnitude/place), so callers pass an `EventMeta`
alongside the product files.

**Artifact directory key: `bml` id over provider id, absorbed here.**
`worker/pipeline.py`'s `data_used["bumelerze_id"]` (when known — `None` for
Atlas seeds/pre-allocation events, `event_id.py`'s own single-authority
note) is the PREFERRED key for the published directory tree — the
canonical, stable, human-shareable identity, not an arbitrary provider id.
`SupabaseUploader` is exactly the translation point for this (it already
has to resolve the internal UUID here too), matching the architecture
review's own "no filesystem rename needed, absorb the mismatch in the
uploader" proposal — falls back to the external provider id only when no
`bml` id exists yet.
"""

from __future__ import annotations

import abc
import datetime as _dt
import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import requests

# `export.write_products` returns exactly these three keys
# (`shake_service/export.py`'s `write_products` orchestrator) mapped to the
# `shakemap_products.product_type` check constraint's three allowed values.
PRODUCT_TYPE_BY_FILE: dict[str, str] = {
    "cont_mi": "contours",
    "info": "metadata",
    "grid": "raster",
}

PRODUCER = "bumelerze"  # matches export.py's PRODUCER and the migration's producer check constraint
DEFAULT_STORAGE_PREFIX = "shakemap"  # LocalOnlyUploader's own local-preview path shape only
DEFAULT_TIMEOUT_S = 30.0
# The local staging copy of the Bumelerze Atlas data repository — a plain
# directory tree, never committed to THIS repo (see this package's own
# .gitignore), synced/published elsewhere by the orchestrator. Distinct
# from `bumelerze-atlas/` (the curated-11 archive that IS committed here,
# `scripts/seed_atlas.py`'s default output) — different concept, different
# lifecycle, deliberately different name.
DEFAULT_ATLAS_PUBLISH_ROOT = Path(__file__).resolve().parent.parent.parent / "atlas-publish"
_KM_PER_DEG_LAT = 111.0  # coarse spherical-Earth approximation, indexing-only — see _bbox_from_info


@dataclass(frozen=True)
class EventMeta:
    """Everything `SupabaseUploader` needs to resolve (or, for a genuinely
    new physical event, register) the internal `events.event_id` UUID via
    `upsert_event_from_client` before it can write a real `shakemap_products`
    row. Optional on the `ProductUploader` interface (`None` default) so
    `LocalOnlyUploader` and every existing caller/test keep working
    unchanged — `worker/pipeline.py` is the one real caller and always
    supplies it, built straight from the `FeedEvent` that drove the compute.

    `mag_type` is `None` for every caller today — `FeedEvent`/`EventState`
    don't track it (worker/feed_watcher.py, worker/state.py) — and that is
    fine: `events.mag_type` is nullable (`supabase/migrations/
    0002_events.sql`) and the RPC does not require it.
    """

    provider: str  # event_source_records.provider check constraint (usgs/emsc/geofon/afad/irsc/iscgem/manual/other)
    origin_time_ms: int
    lat: float
    lon: float
    depth_km: float
    magnitude: float
    mag_type: str | None
    place: str | None

    @property
    def origin_time_iso(self) -> str:
        return _dt.datetime.fromtimestamp(self.origin_time_ms / 1000, tz=_dt.timezone.utc).isoformat()


@dataclass(frozen=True)
class ShakeMapProductRow:
    """Mirrors `shakemap_products` columns 1:1, EXCEPT `event_id` (module
    docstring's "event_id mapping" note) and `internal_event_id`.
    `product_id` and `created_at`'s DB-side `default now()` are
    intentionally not reproduced here (this is a row to be INSERTED, not a
    full row as stored); `created_at` is still recorded so
    `LocalOnlyUploader`'s log line and `SupabaseUploader`'s insert can use
    the SAME timestamp rather than each computing "now" independently.
    `storage_path` is a PUBLIC URL (or a repo-relative path, when no base
    URL is configured yet) to the artifact in the Bumelerze Atlas data
    repository — never Supabase Storage, never inline bytes (module
    docstring's "why not everything in Supabase")."""

    event_id: str  # EXTERNAL catalog id — see module docstring
    producer: str
    version: int
    product_type: str  # "contours" | "raster" | "metadata"
    storage_path: str  # public URL / repo-relative path to the published artifact
    data_used: dict[str, Any]
    created_at: str  # ISO 8601
    # D21 "scientist-review status" — mirrors export.py's info.json field of
    # the same name (`supabase/migrations/0007_shakemap_review_status.sql`).
    # Defaulted so every pre-D21 caller of `upload_products` keeps working
    # unchanged.
    review_status: str = "automatic"
    # The resolved internal `events.event_id` UUID actually written to the
    # DB column named `event_id` — `None` for `LocalOnlyUploader`, which
    # never resolves anything, and for any row logged before resolution
    # completes.
    internal_event_id: str | None = None
    # Coarse indexing bounding box (migration 0019) — `None` when it could
    # not be derived (missing/malformed info.json), never a fabricated
    # value. See `_bbox_from_info`'s own docstring for the approximation.
    bbox_min_lat: float | None = None
    bbox_max_lat: float | None = None
    bbox_min_lon: float | None = None
    bbox_max_lon: float | None = None


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
        event_meta: EventMeta | None = None,
    ) -> list[ShakeMapProductRow]:
        """`product_paths` is exactly `export.write_products`'s return
        value (keys `"cont_mi"`/`"info"`/`"grid"`, values local `Path`s).
        Returns one `ShakeMapProductRow` per recognized, published product
        file (a real implementation may publish fewer than 3 — see
        "vector-first" in the module docstring); row order is not
        guaranteed — callers should not depend on it. `review_status` (D21)
        should mirror whatever `export.write_products` was called with for
        this same version. `event_meta` is required by any implementation
        that actually needs to resolve an internal event id
        (`SupabaseUploader`); implementations that never leave the local
        machine (`LocalOnlyUploader`) ignore it."""
        raise NotImplementedError


class LocalOnlyUploader(ProductUploader):
    """Default uploader: never leaves the local machine. Logs the row it
    WOULD have published/indexed (own local-preview path shape, unrelated
    to the real Atlas repo layout `AtlasRepoPublisher` writes) and returns
    the same records for the caller's own logging/tests — nothing is
    written anywhere except the structured log line."""

    def __init__(self, *, log_fn: Any = print, storage_prefix: str = DEFAULT_STORAGE_PREFIX) -> None:
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
        event_meta: EventMeta | None = None,  # unused — LocalOnlyUploader never resolves an internal id
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


class SupabaseUploadError(RuntimeError):
    """Raised when a real Supabase index call (RPC resolve or row upsert)
    fails — always carries enough context (event id, which step) to be
    actionable from a structured log line. Never raised for "credentials
    are absent" (that is `build_uploader`'s fallback path, not an error) —
    only for a call that was actually attempted and failed."""


class SupabaseIndexWriter(Protocol):
    """The narrow surface `SupabaseUploader` needs to maintain the
    `shakemap_products` INDEX — resolving/registering the internal event id
    and upserting small row dicts. Never touches artifact bytes (that is
    `ArtifactPublisher`'s job). A `Protocol`, not an ABC, so tests can hand
    it a plain fake object with no import-time coupling to
    `_HttpSupabaseIndexWriter`/`requests` — the whole point of "no network
    required in tests" (task brief)."""

    def resolve_event_id(
        self,
        *,
        provider: str,
        provider_event_id: str,
        origin_time_iso: str,
        lat: float,
        lon: float,
        depth_km: float,
        magnitude: float,
        mag_type: str | None,
        place: str | None,
    ) -> str:
        """Calls `upsert_event_from_client` (migration 0011) and returns the
        resolved internal `events.event_id` UUID as a string."""
        ...

    def upsert_shakemap_products(self, rows: list[dict[str, Any]]) -> None:
        """Upserts N `shakemap_products` INDEX rows keyed on the table's own
        `(event_id, producer, version, product_type)` unique constraint —
        a re-run with identical rows must never create duplicates."""
        ...


class ArtifactPublisher(Protocol):
    """The narrow surface `SupabaseUploader` needs to publish artifact
    FILES somewhere a client/site can read them — never touches the
    Supabase index (that is `SupabaseIndexWriter`'s job). Pluggable on
    purpose: this wave ships one real implementation
    (`AtlasRepoPublisher`, a local deterministic directory tree); a future
    implementation could publish somewhere else entirely (object storage,
    a real git push) without `SupabaseUploader`'s own logic changing."""

    def publish(
        self,
        *,
        event_key: str,
        version: int,
        product_files: dict[str, Path],
        engine_version: dict[str, Any] | None,
        review_status: str,
    ) -> dict[str, str]:
        """`product_files` is keyed by PRODUCT_TYPE ("contours"/"metadata"/
        "raster" — already filtered/vector-first-gated by the caller, see
        `SupabaseUploader.upload_products`), not by `export.py`'s raw file
        key. Returns `{product_type: public_url}` for every file actually
        published — implementations may publish fewer than were given
        (none are expected to today; `SupabaseUploader` does its own
        filtering upstream) but must never publish MORE than were given."""
        ...


class _HttpSupabaseIndexWriter:
    """Real `SupabaseIndexWriter`: plain HTTPS calls against a Supabase
    project's PostgREST (`/rest/v1/...`) surface, authenticated with the
    service_role key (bypasses RLS — same convention every other
    service-role writer in this repo uses, see `supabase/README.md`'s
    "service_role bypass is implicit" note). Never constructed directly by
    a test — `build_uploader`/`supabase_index_writer_from_env` are the only
    real callers; tests inject a fake `SupabaseIndexWriter` instead."""

    def __init__(self, *, base_url: str, service_role_key: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._session = requests.Session()
        self._session.headers.update(
            {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
            }
        )

    def resolve_event_id(
        self,
        *,
        provider: str,
        provider_event_id: str,
        origin_time_iso: str,
        lat: float,
        lon: float,
        depth_km: float,
        magnitude: float,
        mag_type: str | None,
        place: str | None,
    ) -> str:
        try:
            resp = self._session.post(
                f"{self._base_url}/rest/v1/rpc/upsert_event_from_client",
                json={
                    "p_provider": provider,
                    "p_provider_event_id": provider_event_id,
                    "p_origin_time": origin_time_iso,
                    "p_lat": lat,
                    "p_lon": lon,
                    "p_depth_km": depth_km,
                    "p_magnitude": magnitude,
                    "p_mag_type": mag_type,
                    "p_place_name": place,
                },
                timeout=self._timeout_s,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise SupabaseUploadError(
                f"resolve_event_id({provider}, {provider_event_id}): upsert_event_from_client RPC failed: {exc}"
            ) from exc
        event_id = resp.json()
        if not isinstance(event_id, str) or not event_id:
            raise SupabaseUploadError(
                f"resolve_event_id({provider}, {provider_event_id}): unexpected RPC response {event_id!r}"
            )
        return event_id

    def upsert_shakemap_products(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        try:
            resp = self._session.post(
                f"{self._base_url}/rest/v1/shakemap_products",
                params={"on_conflict": "event_id,producer,version,product_type"},
                data=json.dumps(rows),
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                timeout=self._timeout_s,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise SupabaseUploadError(f"upsert_shakemap_products({len(rows)} rows): {exc}") from exc


def _atomic_write_json(path: Path, payload: Any) -> None:
    """Same atomic-replace idiom as `worker/state.py` (this module's own
    "single writer, crash-safety via os.replace" rationale applies
    identically here): a crash mid-write leaves the previous, still-valid
    manifest in place rather than a half-written JSON document."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    os.replace(tmp_path, path)


class AtlasRepoPublisher:
    """Writes a clean, deterministic, versioned directory tree — the local
    staging copy of the Bumelerze Atlas DATA REPOSITORY (a separate public
    repo/site the orchestrator creates and publishes; this class never
    creates or pushes to that repo itself, only produces the tree it will
    contain). Layout:

        <publish_root>/events/<event_key>/v<version>/<filename>
        <publish_root>/events/<event_key>/index.json   (per-event manifest)
        <publish_root>/index.json                       (site-wide manifest)

    `event_key` — see module docstring's own "artifact directory key" note;
    resolved by `SupabaseUploader`, this class just uses whatever string it
    is given.

    Idempotent: republishing the same (event_key, version) with the same
    files overwrites the same paths with the same bytes. Both manifests are
    fully REGENERATED from what is actually on disk on every `publish()`
    call (read-aggregate-write, never hand-appended), so a re-run, an
    out-of-order re-run, or two different versions published in either
    order all converge on the same correct manifest content — no manifest
    entry can ever be duplicated or left stale."""

    def __init__(self, *, publish_root: Path | str, base_url: str = "") -> None:
        self._root = Path(publish_root)
        self._base_url = base_url.rstrip("/")

    def _public_url(self, relative_path: str) -> str:
        return f"{self._base_url}/{relative_path}" if self._base_url else relative_path

    def publish(
        self,
        *,
        event_key: str,
        version: int,
        product_files: dict[str, Path],
        engine_version: dict[str, Any] | None,
        review_status: str,
    ) -> dict[str, str]:
        version_dir = self._root / "events" / event_key / f"v{version}"
        version_dir.mkdir(parents=True, exist_ok=True)

        urls: dict[str, str] = {}
        for product_type, local_path in product_files.items():
            dest = version_dir / Path(local_path).name
            dest.write_bytes(Path(local_path).read_bytes())
            relative = dest.relative_to(self._root).as_posix()
            urls[product_type] = self._public_url(relative)

        self._update_event_index(
            event_key=event_key, version=version, urls=urls,
            engine_version=engine_version, review_status=review_status,
        )
        self._regenerate_global_index()
        return urls

    def _event_index_path(self, event_key: str) -> Path:
        return self._root / "events" / event_key / "index.json"

    def _update_event_index(
        self, *, event_key: str, version: int, urls: dict[str, str],
        engine_version: dict[str, Any] | None, review_status: str,
    ) -> None:
        path = self._event_index_path(event_key)
        existing_versions: list[dict[str, Any]] = []
        if path.exists():
            try:
                existing_versions = json.loads(path.read_text()).get("versions", [])
            except (OSError, ValueError):
                existing_versions = []  # tolerant: a corrupt manifest is rebuilt, never blocks a publish
        versions = [v for v in existing_versions if v.get("version") != version]
        versions.append(
            {
                "version": version,
                "published_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
                "review_status": review_status,
                "engine_version": engine_version,
                "products": urls,
            }
        )
        versions.sort(key=lambda v: v["version"])
        _atomic_write_json(path, {"event_key": event_key, "versions": versions})

    def _regenerate_global_index(self) -> None:
        events_dir = self._root / "events"
        entries: list[dict[str, Any]] = []
        if events_dir.exists():
            for event_dir in sorted(p for p in events_dir.iterdir() if p.is_dir()):
                index_path = event_dir / "index.json"
                if not index_path.exists():
                    continue
                try:
                    data = json.loads(index_path.read_text())
                except (OSError, ValueError):
                    continue
                versions = data.get("versions") or []
                if not versions:
                    continue
                latest = max(versions, key=lambda v: v["version"])
                entries.append(
                    {
                        "event_key": data.get("event_key", event_dir.name),
                        "latest_version": latest["version"],
                        "index_path": f"events/{event_dir.name}/index.json",
                    }
                )
        _atomic_write_json(
            self._root / "index.json",
            {"generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(), "events": entries},
        )


def _load_info_json(info_path: Path | None, *, log_fn: Any) -> dict[str, Any] | None:
    """Tolerant, matching this package's existing policy for any external/
    generated file it reads (`pipeline.py`'s own station/DYFI/rupture
    parsing docstring): a missing `info_path`, an unreadable file, or an
    invalid-JSON file returns `None` and logs once — never raises, since a
    provenance/bbox-enrichment failure must not block publishing the
    products themselves."""
    if info_path is None:
        return None
    try:
        return json.loads(Path(info_path).read_text())
    except (OSError, ValueError) as exc:
        log_fn(f"[SupabaseUploader] could not read {info_path}: {exc}")
        return None


def _vs30_from_info(info: dict[str, Any] | None) -> dict[str, Any] | None:
    """Carries `info.json`'s top-level `"vs30"` block (`export.py`'s
    `build_info_product`, sourced from `ForwardMap.vs30_meta`) into the
    INDEX row's `data_used` jsonb, same rationale as
    `_engine_version_from_info` just above. Without this, a degraded
    compute (the real Vs30 raster unavailable — e.g. a CI runner that
    doesn't have the ~610 MB backbone raster hydrated,
    `shake_service/vs30.py`'s own DEFAULT-ON/LOUD-fallback docstring) is
    honestly tagged `vs30.vs30_source: "rock-default"` inside the
    published `info.json` artifact, but a caller/dashboard querying
    `shakemap_products` directly (the fast, queryable index this repo's
    own docs describe — never opening every artifact file) could not tell
    a degraded product from a full one without fetching and parsing that
    artifact. This function closes that gap — a degraded product must
    never be indistinguishable from a full one at ANY layer a consumer
    might reasonably query, not just inside the artifact bytes."""
    if info is None:
        return None
    vs30 = info.get("vs30")
    return vs30 if isinstance(vs30, dict) else None


def _engine_version_from_info(info: dict[str, Any] | None) -> dict[str, Any] | None:
    """Carries the engine-version block through instead of dropping it: the
    computed `info.json` already has a `"version"` block (service version,
    openquake pin, GSIM branches, GMICE models, conditioning method —
    `export.py`'s `build_info_product`), but `ForwardMap.data_used` (what
    `worker/pipeline.py` hands this module) only ever carried DATA
    provenance, never the ENGINE's own version. This is landed in the INDEX
    row's `data_used` jsonb (already producer-defined, no schema change
    needed — 0006's own comment) so a query for "which products came from
    which engine build" never has to open an artifact file."""
    if info is None:
        return None
    version = info.get("version")
    return version if isinstance(version, dict) else None


def _bbox_from_info(
    info: dict[str, Any] | None, *, event_meta: EventMeta
) -> tuple[float, float, float, float] | None:
    """Coarse INDEXING-ONLY bounding box (min_lat, max_lat, min_lon,
    max_lon) — a spherical-Earth approximation from the grid's own
    `half_extent_km` (`export.py`'s `build_info_product`'s `"grid"` block)
    centered on the event epicenter, good enough for a map viewport/layer-
    registry query, NOT a scientific product output (the real grid geometry
    is in `grid.json`/`cont_mi.json` themselves). Prefers `info.json`'s own
    recorded `event.lat`/`event.lon` (what the engine actually computed
    against) over `event_meta`'s, falling back to `event_meta` only when
    `info` is unavailable/malformed. `None` when neither the grid extent
    nor coordinates can be determined — never a fabricated bbox."""
    lat, lon = event_meta.lat, event_meta.lon
    half_extent_km: float | None = None
    if info is not None:
        event_block = info.get("event")
        if isinstance(event_block, dict):
            lat = event_block.get("lat", lat)
            lon = event_block.get("lon", lon)
        grid_block = info.get("grid")
        if isinstance(grid_block, dict) and isinstance(grid_block.get("half_extent_km"), (int, float)):
            half_extent_km = float(grid_block["half_extent_km"])
    if half_extent_km is None:
        return None

    lat_delta_deg = half_extent_km / _KM_PER_DEG_LAT
    lon_scale = math.cos(math.radians(lat))
    lon_delta_deg = half_extent_km / (_KM_PER_DEG_LAT * lon_scale) if lon_scale > 1e-6 else lat_delta_deg
    return (
        max(lat - lat_delta_deg, -90.0),
        min(lat + lat_delta_deg, 90.0),
        max(lon - lon_delta_deg, -180.0),
        min(lon + lon_delta_deg, 180.0),
    )


def supabase_index_writer_from_env() -> _HttpSupabaseIndexWriter | None:
    """`None` when either required env var is unset — `build_uploader`'s
    signal to fall back to `LocalOnlyUploader`. Deliberately does NOT fall
    back to the anon key: every write this uploader makes needs RLS bypass,
    which only the service_role key grants."""
    url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_role_key:
        return None
    return _HttpSupabaseIndexWriter(base_url=url, service_role_key=service_role_key)


def atlas_publish_root_from_env() -> Path:
    """`BUMELERZE_ATLAS_PUBLISH_ROOT` — where `AtlasRepoPublisher` stages
    the local copy of the Atlas data repository tree. Defaults to a
    directory next to this package (`DEFAULT_ATLAS_PUBLISH_ROOT`) rather
    than requiring this to be set: the worker can start producing a correct
    tree today even before the orchestrator wires it up to a real published
    repo/CDN — publishing THAT tree somewhere is an operational step, not a
    code dependency."""
    raw = os.environ.get("BUMELERZE_ATLAS_PUBLISH_ROOT")
    return Path(raw) if raw else DEFAULT_ATLAS_PUBLISH_ROOT


def atlas_base_url_from_env() -> str:
    """`BUMELERZE_ATLAS_BASE_URL` — the public base URL once the Atlas data
    repository is actually published (e.g. a GitHub Pages URL). Empty by
    default: `AtlasRepoPublisher` then stores repo-relative paths in
    `shakemap_products.storage_path`, honestly reflecting "not published
    externally yet" rather than fabricating a URL that doesn't resolve."""
    return os.environ.get("BUMELERZE_ATLAS_BASE_URL", "")


def publish_raster_from_env() -> bool:
    """`BUMELERZE_PUBLISH_RASTER` — opt-in override for the vector-first
    default (module docstring). Any of `1`/`true`/`yes`/`on` (case-
    insensitive) enables raster publishing; anything else (including
    unset) keeps the default `False`."""
    raw = os.environ.get("BUMELERZE_PUBLISH_RASTER", "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class SupabaseUploader(ProductUploader):
    """Real uploader: for one (event, version), resolves the internal event
    id, publishes every recognized, vector-first-gated product file via its
    `ArtifactPublisher`, and upserts one `shakemap_products` INDEX row per
    published file via its `SupabaseIndexWriter` — idempotent end to end
    (RPC resolution is itself idempotent per migration 0011's own doc
    comment; `AtlasRepoPublisher.publish` overwrites the same path on
    retry; the index write is a merge-duplicates upsert on the table's own
    unique constraint), so replaying the same product directory through
    this uploader twice never creates a duplicate row or a second physical
    event.

    `index_writer`/`artifact_publisher` are both required (no defaults, no
    env-reading inside this constructor) — `build_uploader`/the two
    `*_from_env` helpers own the "are credentials/config present at all"
    decision; this class's only job is "given working collaborators, do the
    two real-write steps correctly, in the right order, gated by the
    vector-first policy." Tests construct this directly with fakes.
    """

    def __init__(
        self,
        *,
        index_writer: SupabaseIndexWriter,
        artifact_publisher: ArtifactPublisher,
        publish_raster: bool = False,
        log_fn: Any = print,
    ) -> None:
        self._index_writer = index_writer
        self._artifact_publisher = artifact_publisher
        self._publish_raster = publish_raster
        self._log = log_fn

    def upload_products(
        self,
        *,
        event_id: str,
        version: int,
        product_paths: dict[str, Path],
        data_used: dict[str, Any],
        review_status: str = "automatic",
        event_meta: EventMeta | None = None,
    ) -> list[ShakeMapProductRow]:
        if event_meta is None:
            raise ValueError(
                "SupabaseUploader.upload_products requires event_meta to resolve the internal "
                "events.event_id (see EventMeta / worker/pipeline.py's caller) — got None."
            )

        internal_event_id = self._index_writer.resolve_event_id(
            provider=event_meta.provider,
            provider_event_id=event_id,
            origin_time_iso=event_meta.origin_time_iso,
            lat=event_meta.lat,
            lon=event_meta.lon,
            depth_km=event_meta.depth_km,
            magnitude=event_meta.magnitude,
            mag_type=event_meta.mag_type,
            place=event_meta.place,
        )

        # Vector-first gate (module docstring): filter/translate export.py's
        # raw file keys to product types HERE, before the publisher ever
        # sees them, so an ArtifactPublisher implementation never has to
        # know export.py's file-naming contract or this policy.
        recognized: dict[str, Path] = {}
        for file_key, local_path in product_paths.items():
            product_type = PRODUCT_TYPE_BY_FILE.get(file_key)
            if product_type is None:
                self._log(
                    f"[SupabaseUploader] skipping unrecognized product file key "
                    f"{file_key!r} for {event_id} v{version} (local file: {local_path})"
                )
                continue
            if product_type == "raster" and not self._publish_raster:
                self._log(
                    f"[SupabaseUploader] raster product for {event_id} v{version} not published "
                    f"(publish_raster=False, vector-first default — set BUMELERZE_PUBLISH_RASTER "
                    f"to opt in)"
                )
                continue
            recognized[product_type] = local_path

        info = _load_info_json(product_paths.get("info"), log_fn=self._log)
        engine_version = _engine_version_from_info(info)
        vs30_info = _vs30_from_info(info)
        bbox = _bbox_from_info(info, event_meta=event_meta)
        enriched_data_used = dict(data_used)
        if engine_version:
            enriched_data_used["engine_version"] = engine_version
        if vs30_info:
            # Never silently missing — see _vs30_from_info's own docstring.
            enriched_data_used["vs30"] = vs30_info

        # bml id over provider id (module docstring's "artifact directory
        # key" note) — data_used["bumelerze_id"] is set unconditionally by
        # worker/pipeline.py (possibly None; event_id.py's own
        # single-authority note on when that happens).
        event_key = data_used.get("bumelerze_id") or event_id

        urls = self._artifact_publisher.publish(
            event_key=event_key, version=version, product_files=recognized,
            engine_version=engine_version, review_status=review_status,
        )

        created_at = _dt.datetime.now(_dt.timezone.utc).isoformat()
        bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon = bbox if bbox else (None, None, None, None)
        rows: list[dict[str, Any]] = []
        records: list[ShakeMapProductRow] = []
        for product_type, url in urls.items():
            rows.append(
                {
                    "event_id": internal_event_id,
                    "producer": PRODUCER,
                    "version": version,
                    "product_type": product_type,
                    "storage_path": url,
                    "data_used": enriched_data_used,
                    "review_status": review_status,
                    "bbox_min_lat": bbox_min_lat,
                    "bbox_max_lat": bbox_max_lat,
                    "bbox_min_lon": bbox_min_lon,
                    "bbox_max_lon": bbox_max_lon,
                }
            )
            records.append(
                ShakeMapProductRow(
                    event_id=event_id,
                    producer=PRODUCER,
                    version=version,
                    product_type=product_type,
                    storage_path=url,
                    data_used=enriched_data_used,
                    created_at=created_at,
                    review_status=review_status,
                    internal_event_id=internal_event_id,
                    bbox_min_lat=bbox_min_lat,
                    bbox_max_lat=bbox_max_lat,
                    bbox_min_lon=bbox_min_lon,
                    bbox_max_lon=bbox_max_lon,
                )
            )
            self._log(
                f"[SupabaseUploader] published {product_type} for event={event_id} "
                f"(internal={internal_event_id}, key={event_key}) v{version} -> {url}"
            )

        self._index_writer.upsert_shakemap_products(rows)
        return records


def build_uploader(*, log_fn: Any = print) -> ProductUploader:
    """The one function real entrypoints (`scripts/run_worker.py`) should
    call to get an uploader — never construct `SupabaseUploader`/
    `LocalOnlyUploader` directly in a CLI's `main()`. Reads
    `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (index credentials) plus the
    three `*_from_env` config helpers above (artifact publish root/base
    URL/raster policy) from the environment; returns a real
    `SupabaseUploader` when Supabase credentials are set, or falls back to
    `LocalOnlyUploader` (with a logged reason, not a silent no-op) when
    they aren't — so an unconfigured or not-yet-deployed worker keeps
    working exactly as it always has, instead of crashing at startup. The
    artifact-publish env vars have safe defaults (`atlas_publish_root_from_env`/
    `atlas_base_url_from_env`/`publish_raster_from_env`'s own docstrings) so
    they are never required for the fallback to trigger — only the
    Supabase credentials gate that."""
    index_writer = supabase_index_writer_from_env()
    if index_writer is None:
        log_fn(
            "[uploader] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set in the environment — "
            "falling back to LocalOnlyUploader (products stay on disk only, nothing reaches "
            "shakemap_products)."
        )
        return LocalOnlyUploader(log_fn=log_fn)
    artifact_publisher = AtlasRepoPublisher(
        publish_root=atlas_publish_root_from_env(), base_url=atlas_base_url_from_env()
    )
    return SupabaseUploader(
        index_writer=index_writer,
        artifact_publisher=artifact_publisher,
        publish_raster=publish_raster_from_env(),
        log_fn=log_fn,
    )
