"""pipeline — per-trigger orchestration: `forward.build_forward_map` ->
`export.write_products` -> `state.WorkerState` update -> `uploader.upload_products`.
One `run_pipeline` call per `feed_watcher.TriggerDecision` of kind `"new"`
or `"update"` (callers should not call this for `"skip"` decisions —
`scripts/run_worker.py` filters those out before this module ever sees
them).

**Conditioning is explicitly SKIPPED this wave — a documented integration
point, not an oversight.** D9's graded-conditioning chain (catalog -> faults
-> stations -> felt reports) needs a felt-report source, and none exists
until the Supabase project + `felt_reports`/derived `felt_cells` table land
(PROJECT.md "Blocked on Peshawa"). `conditioned_forward.py` + `mvn.py` +
`config.MIN_CONDITIONING_OBSERVATIONS` are already built and D20-validated
(`docs/decisions.md` D20 checkpoint) — only the observations input is
missing. See the `# CONDITIONING INTEGRATION POINT` comment below for
exactly where this wires in later; nothing about this module's shape needs
to change when it does (the bare `ForwardMap` this module builds is a
strict subset of the conditioned one's shape, per `conditioned_forward.py`'s
own contract).

**Idempotency (the property this module exists to guarantee, alongside
`state.py`):** `run_pipeline` hashes the incoming event's params
(lat/lon/depth/mag) and compares against the LAST COMPUTED version's own
hash (`EventState.params_hash`). An identical hash short-circuits — no new
version, no re-export, no re-upload — even if a caller passes in a
duplicate/replayed `TriggerDecision` for the same params (the primary guard
against this is `feed_watcher`'s own feed-updated-timestamp dedup; this is
defense in depth at the compute layer, not a replacement for it).
"""

from __future__ import annotations

import datetime as _dt
import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from shake_service import export, forward
from shake_service.worker.feed_watcher import TriggerDecision
from shake_service.worker.state import EventState, WorkerState
from shake_service.worker.uploader import ProductUploader, ShakeMapProductRow


def params_hash(*, lat: float, lon: float, depth_km: float, mag: float) -> str:
    """A short, stable hash of the event params that drove one compute —
    rounded to a precision well past feed noise (4 decimal degrees ~= 11 m,
    2 decimal km, 2 decimal magnitude) so two feed reads of the SAME
    underlying revision never hash differently over float formatting
    alone."""
    canonical = f"{lat:.4f}|{lon:.4f}|{depth_km:.2f}|{mag:.2f}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class PipelineResult:
    event_id: str
    decision_kind: str
    version: int
    recomputed: bool  # False when short-circuited by an unchanged params hash
    product_paths: dict[str, Path]
    forward_map: forward.ForwardMap | None  # None when short-circuited (nothing was (re)computed)
    upload_records: tuple[ShakeMapProductRow, ...]


def run_pipeline(
    decision: TriggerDecision,
    ws: WorkerState,
    *,
    products_root: str | Path,
    uploader: ProductUploader,
    now: _dt.datetime | None = None,
) -> PipelineResult:
    """Run (or idempotently skip) the forward-map -> export -> state ->
    upload chain for one trigger. Mutates `ws` in place (upserts the
    event's new state on an actual recompute) but never calls `ws.save` —
    the caller controls persistence timing (e.g. one save per poll cycle,
    not one per event)."""
    event = decision.event
    products_root = Path(products_root)
    now_iso = (now or _dt.datetime.now(_dt.timezone.utc)).isoformat()

    known = ws.get_event(event.external_id)
    new_hash = params_hash(lat=event.lat, lon=event.lon, depth_km=event.depth_km, mag=event.mag)

    if known is not None and known.params_hash == new_hash:
        existing_paths = {name: Path(p) for name, p in known.product_paths.items()}
        return PipelineResult(
            event_id=event.external_id,
            decision_kind=decision.kind,
            version=known.last_version,
            recomputed=False,
            product_paths=existing_paths,
            forward_map=None,
            upload_records=(),
        )

    fm = forward.build_forward_map(event.lat, event.lon, event.depth_km, mag_mw=event.mag)

    # --- CONDITIONING INTEGRATION POINT (see module docstring) ---
    # observations_pga, observations_pgv = <fetch felt_cells for event.external_id, once Supabase exists>
    # if observations_pga or observations_pgv:
    #     from shake_service import conditioned_forward
    #     result = conditioned_forward.condition_forward_map_on_dyfi(
    #         fm, event_lat=event.lat, event_lon=event.lon, event_depth_km=event.depth_km,
    #         mag_mw=event.mag, observations_pga=observations_pga, observations_pgv=observations_pgv,
    #     )
    #     fm = result.forward_map
    # --- end integration point ---

    version = (known.last_version + 1) if known is not None else 1
    out_dir = products_root / event.external_id / f"v{version}"
    written = export.write_products(fm, out_dir)

    first_seen_at = known.first_seen_at if known is not None else now_iso
    new_state = EventState(
        external_id=event.external_id,
        source=event.source,
        mag=event.mag,
        lat=event.lat,
        lon=event.lon,
        depth_km=event.depth_km,
        last_version=version,
        params_hash=new_hash,
        product_paths={name: str(path) for name, path in written.items()},
        last_feed_updated_ms=event.updated_ms,
        first_seen_at=first_seen_at,
        last_computed_at=now_iso,
    )
    ws.upsert_event(new_state)

    upload_records = uploader.upload_products(
        event_id=event.external_id,
        version=version,
        product_paths=written,
        data_used=fm.data_used,
    )

    return PipelineResult(
        event_id=event.external_id,
        decision_kind=decision.kind,
        version=version,
        recomputed=True,
        product_paths=written,
        forward_map=fm,
        upload_records=tuple(upload_records),
    )
