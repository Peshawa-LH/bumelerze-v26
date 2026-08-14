"""pipeline — per-trigger orchestration: (D22) fetch USGS product content
FIRST -> `forward.build_forward_map` (finite-fault-aware, D22) -> (D21)
condition on USGS station/DYFI data -> `export.write_products` -> (D21)
auto-compare against a USGS ShakeMap grid, if one exists -> `state.WorkerState`
update -> `uploader.upload_products`. One `run_pipeline` call per
`feed_watcher.TriggerDecision` of kind `"new"` or `"update"` (callers should
not call this for `"skip"` decisions — `scripts/run_worker.py` filters those
out before this module ever sees them).

**D21 "dual backend" / D22 "use ALL available USGS data" wiring
(`docs/decisions.md` — this module is the "AUTOMATICALLY runs the
comparison" + "USGS station data ... joins DYFI as mvn conditioning
observations when available" + "the engine USES [rupture model, station
data] when available" integration point).**

1. `usgs_products_fetcher(event.external_id)` fetches (or, by default,
   deliberately does NOT fetch — see `usgs_products_fetcher`'s docstring)
   whatever USGS ShakeMap/DYFI product content the event has, INCLUDING
   (D22) `rupture.json` — fetched first, before the forward map is even
   built, because (unlike station/DYFI conditioning, applied to an already-
   built prior) a rupture model changes the prior itself: the distance
   context (`gmm.compute_mixture`'s `rupture=` argument) that the D20 GSIM
   set is evaluated against in the first place.
2. If a `rupture.json` was fetched and parses to >=1 quad
   (`rupture_model.parse_rupture_json`, tolerant — a malformed payload
   yields `n_quads == 0` treated identically to "no rupture model"),
   `forward.build_forward_map` uses it: finite-fault Rjb/Rrup replace
   ps2ff, geometry-derived dip/ztor (+ metadata rake when a real mechanism
   exists) replace the point-source polygon defaults
   (`rupture_model.override_rupture_params`). `data_used["distance_method"]`
   records `"finite-fault"` vs `"ps2ff"` on every product, unconditionally.
3. If it has a `stationlist.json` and/or `dyfi_geo_10km.geojson`, real
   instrumental stations (`station_observations.py`, DYFI-as-station rows
   dropped) and filtered DYFI boxes (`dyfi_observations.py`) are merged into
   ONE combined observation list per IMT
   (`station_observations.combined_station_observations`, stations
   first-class) and used to condition the forward-map prior
   (`conditioned_forward.condition_forward_map_on_dyfi` — `mvn.py`'s own
   `config.MIN_CONDITIONING_OBSERVATIONS` floor still applies, unchanged,
   to whatever this module hands it, source-agnostic; D22's
   `distance_method`/`rupture_quads_used` keys SURVIVE this step —
   `conditioned_forward.py`'s own data_used construction merges rather than
   replaces, see that module's note).
4. Our (possibly finite-fault, possibly conditioned) product is exported as
   before (`export.write_products`, `review_status="automatic"` — D21's
   scientist-review status, flipped later only by
   `scripts/review_product.py`).
5. If the event ALSO has a USGS ShakeMap grid (`grid.xml`), it is parsed
   (`comparison.py`) and compared against OUR exported product, and the
   result — stats + D20 pass/fail verdict + engine/product versions — is
   written to `compatibility.json` alongside the product version dir (a
   growing, versioned compatibility record, D21: "systematic corrections
   decided by Peshawa from that evidence, never tuned ad hoc" — this module
   only records the evidence, never acts on it). `EventState.has_comparison`/
   `.comparison_path` track whether the LAST COMPUTED version has one.

A malformed/unparseable USGS product (stationlist, DYFI, rupture, or
grid.xml) is tolerated — logged into the returned `PipelineResult`'s nothing
(no logging framework here, `scripts/run_worker.py` owns structured
logging) but never raises: a single bad USGS payload must not abort an
otherwise-valid recompute of our own product, exactly the same
tolerant-parsing policy `feed_watcher.parse_usgs_geojson` already applies to
the trigger feed itself.

**Idempotency (the property this module exists to guarantee, alongside
`state.py`):** `run_pipeline` hashes the incoming event's params
(lat/lon/depth/mag) and compares against the LAST COMPUTED version's own
hash (`EventState.params_hash`). An identical hash short-circuits — no new
version, no re-export, no re-upload, and (D21) no USGS re-fetch/re-compare
either — even if a caller passes in a duplicate/replayed `TriggerDecision`
for the same params (the primary guard against this is `feed_watcher`'s own
feed-updated-timestamp dedup; this is defense in depth at the compute
layer, not a replacement for it). Re-running `run_pipeline` against
DIFFERENT (mocked/replayed) USGS product content for an unchanged event is
this wave's own idempotency check (`tests/test_worker_pipeline.py`): the
short circuit fires before the USGS fetch ever happens, so a re-run never
double-writes `compatibility.json` or double-conditions the map.

**`force=True` (D22, new this wave):** deliberately BYPASSES the params-hash
short circuit — every call recomputes a NEW version, even when params are
byte-identical to the last one. This exists for the one case idempotency-
by-params-hash cannot itself distinguish: the ENGINE changed (a new distance
method, a corrected constant, ...) but the event's own lat/lon/depth/mag
didn't. `scripts/seed_atlas.py --force` is the intended caller — reseeding
an Atlas event to pick up an engine change always produces a new version,
old ones retained (D9 "old v1 retained" versioning policy, unchanged).
Default `False` everywhere else (`scripts/run_worker.py`'s live auto-trigger
path never passes it) — the short circuit stays the default behavior for
every existing caller/test.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable

from shake_service import (
    comparison,
    conditioned_forward,
    dyfi_observations,
    export,
    forward,
    rupture_model,
    station_observations,
    vs30,
)
from shake_service.worker.feed_watcher import TriggerDecision
from shake_service.worker.state import EventState, WorkerState
from shake_service.worker.uploader import ProductUploader, ShakeMapProductRow
from shake_service.worker.usgs_products import UsgsEventProducts, no_usgs_products

UsgsProductsFetcher = Callable[[str], UsgsEventProducts]

COMPATIBILITY_FILE_NAME = "compatibility.json"


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
    # D21 additions — also None/False when short-circuited.
    has_comparison: bool = False
    comparison_path: Path | None = None
    conditioning_sources: tuple[str, ...] = ()  # e.g. ("stations",) / ("dyfi",) / ("stations", "dyfi") / ()


def _parse_station_records(text: str | None) -> list[station_observations.StationRecord]:
    """Tolerant: a malformed `stationlist.json` yields an empty list, never
    an exception that would abort the whole recompute (module docstring)."""
    if not text:
        return []
    try:
        return station_observations.parse_stationlist_json(text)
    except ValueError:
        return []


def _parse_dyfi_boxes(text: str | None) -> list[dyfi_observations.DyfiBox]:
    if not text:
        return []
    try:
        return dyfi_observations.parse_dyfi_geo_geojson(text)
    except ValueError:
        return []


def _parse_rupture_model(text: str | None) -> rupture_model.RuptureModel | None:
    """Tolerant, module docstring: a malformed `rupture.json` (or none
    fetched at all) returns `None`, treated identically to "no rupture
    model" by `forward.build_forward_map`/`gmm.compute_mixture` (a model
    that parses but yields zero quads is ALSO effectively "none" — that
    check lives in `gmm.py`, not duplicated here)."""
    if not text:
        return None
    try:
        return rupture_model.parse_rupture_json(text)
    except ValueError:
        return None


def _condition_if_possible(
    fm: forward.ForwardMap,
    *,
    event_lat: float, event_lon: float, event_depth_km: float, mag_mw: float,
    station_records: list[station_observations.StationRecord],
    dyfi_boxes: list[dyfi_observations.DyfiBox],
    vs30_sampler: vs30.Vs30Sampler,
) -> tuple[forward.ForwardMap, tuple[str, ...]]:
    """Condition `fm` on whatever combined station+DYFI observations exist
    (module docstring point 2) — returns the (possibly unchanged) map plus
    which source(s) actually contributed at least one raw record/box (NOT
    the same thing as "cleared the conditioning floor" — that per-IMT
    detail already lives in `fm.data_used["conditioning_applied"]` after
    this call; this tuple is coarse provenance for reports like
    `scripts/seed_atlas.py`'s summary table).

    `vs30_sampler`: the SAME resolved sampler `run_pipeline` used to build
    `fm`'s prior (below) — `conditioned_forward.condition_forward_map_on_dyfi`
    re-evaluates the D20 GMPE mixture at each station/DYFI point to get its
    own residual (`mvn.condition_forward_map`'s station-point Vs30 lookup);
    passing a DIFFERENT (or the default, silently-rock-760) sampler there
    than the one that built the grid would inject a spurious Vs30 offset
    into every conditioning residual — real terrain Vs30 at the grid, rock
    at the stations (or vice-versa) — corrupting the conditioning rather
    than refining it. Never left to its own per-call default here."""
    if not station_records and not dyfi_boxes:
        return fm, ()

    half_extent_km = fm.grid_meta["half_extent_km"]
    obs_pga = station_observations.combined_station_observations(
        station_records=station_records, dyfi_boxes=dyfi_boxes, imt="PGA", half_extent_km=half_extent_km,
    )
    obs_pgv = station_observations.combined_station_observations(
        station_records=station_records, dyfi_boxes=dyfi_boxes, imt="PGV", half_extent_km=half_extent_km,
    )
    if not obs_pga and not obs_pgv:
        return fm, ()

    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=event_lat, event_lon=event_lon, event_depth_km=event_depth_km, mag_mw=mag_mw,
        observations_pga=obs_pga, observations_pgv=obs_pgv, vs30_sampler=vs30_sampler,
    )
    sources = tuple(
        s for s, present in (("stations", bool(station_records)), ("dyfi", bool(dyfi_boxes))) if present
    )
    return result.forward_map, sources


def _write_compatibility_product(
    fm: forward.ForwardMap,
    *,
    event: Any,
    version: int,
    usgs: UsgsEventProducts,
    out_dir: Path,
    generated_at_iso: str,
) -> Path | None:
    """If `usgs.grid_xml_text` is present, compare `fm` against it
    (module docstring point 4) and write `compatibility.json` into
    `out_dir`. Returns the written path, or `None` if there was no USGS
    grid to compare against, or it failed to parse (tolerant, module
    docstring)."""
    if not usgs.shakemap_available or not usgs.grid_xml_text:
        return None
    try:
        grid_xml = comparison.parse_shakemap_grid_xml(usgs.grid_xml_text)
    except ValueError:
        return None

    cmp_result = comparison.compare_forward_map_to_grid(
        fm, grid_xml, event_lon=event.lon, event_lat=event.lat,
    )
    verdict = comparison.judge_comparison(cmp_result)

    payload = {
        "generated_at": generated_at_iso,
        "event_id": event.external_id,
        "our_version": version,
        "usgs_shakemap_product_id": usgs.shakemap_product_id,
        "engine_version": dict(fm.version),
        "comparison": cmp_result.to_dict(),
        "verdict": verdict,
    }
    path = out_dir / COMPATIBILITY_FILE_NAME
    path.write_text(json.dumps(payload))
    return path


def run_pipeline(
    decision: TriggerDecision,
    ws: WorkerState,
    *,
    products_root: str | Path,
    uploader: ProductUploader,
    usgs_products_fetcher: UsgsProductsFetcher = no_usgs_products,
    now: _dt.datetime | None = None,
    force: bool = False,
    vs30_sampler: vs30.Vs30Sampler | None = None,
) -> PipelineResult:
    """Run (or idempotently skip) the USGS-fetch -> forward-map (D22
    finite-fault-aware) -> USGS-condition -> export -> auto-compare -> state
    -> upload chain for one trigger. Mutates `ws` in place (upserts the
    event's new state on an actual recompute) but never calls `ws.save` —
    the caller controls persistence timing (e.g. one save per poll cycle,
    not one per event).

    `usgs_products_fetcher` defaults to `usgs_products.no_usgs_products` —
    ZERO network I/O — so calling this function without explicitly opting
    in never makes a real HTTP request (every existing test, plus any
    future caller that hasn't wired one). Real wiring:
    `scripts/run_worker.py`/`scripts/seed_atlas.py` pass
    `usgs_products.fetch_usgs_event_products` explicitly.

    `force`: see module docstring's own "`force=True`" section — bypasses
    the params-hash short circuit below, default `False`.

    `vs30_sampler`: resolved ONCE per call (`None` -> `vs30.default_sampler()`,
    the real Vs30 raster when available, else rock-760 — `vs30.py`'s own
    default-on/LOUD-fallback docstring) and reused for BOTH the forward-map
    prior (`forward.build_forward_map`) and the USGS-conditioning step
    (`_condition_if_possible`) below, so a single event's map and its own
    conditioning residuals are never computed against two different Vs30
    fields (see `_condition_if_possible`'s own docstring for why that would
    corrupt conditioning). Pass an explicit sampler (e.g.
    `vs30.UniformRockVs30()`) to pin a test/run to rock-760 regardless of
    environment.
    """
    event = decision.event
    products_root = Path(products_root)
    now_iso = (now or _dt.datetime.now(_dt.timezone.utc)).isoformat()
    resolved_vs30_sampler = vs30_sampler if vs30_sampler is not None else vs30.default_sampler()

    known = ws.get_event(event.external_id)
    new_hash = params_hash(lat=event.lat, lon=event.lon, depth_km=event.depth_km, mag=event.mag)

    if not force and known is not None and known.params_hash == new_hash:
        existing_paths = {name: Path(p) for name, p in known.product_paths.items()}
        return PipelineResult(
            event_id=event.external_id,
            decision_kind=decision.kind,
            version=known.last_version,
            recomputed=False,
            product_paths=existing_paths,
            forward_map=None,
            upload_records=(),
            has_comparison=known.has_comparison,
            comparison_path=Path(known.comparison_path) if known.comparison_path else None,
            conditioning_sources=(),
        )

    # --- D22: fetch USGS product content FIRST — a rupture model, if any,
    # changes the forward-map PRIOR itself (module docstring points 1-2).
    # EMSC-sourced triggers (the completeness sweep, feed_watcher.py) skip
    # the fetch entirely: `event.external_id` is an EMSC unid, which USGS's
    # event-detail API does not know — the real fetcher would 404 (and
    # raise) on an id that by definition (EMSC-only = absent from USGS)
    # has no USGS products to offer. `no_usgs_products` keeps every
    # `usgs_*_available: False` provenance flag honest for these events. ---
    usgs = (
        usgs_products_fetcher(event.external_id)
        if event.source == "usgs"
        else no_usgs_products(event.external_id)
    )
    rupture = _parse_rupture_model(usgs.rupture_json_text)
    fm = forward.build_forward_map(
        event.lat, event.lon, event.depth_km, mag_mw=event.mag, rupture_model=rupture,
        vs30_sampler=resolved_vs30_sampler,
    )

    # --- D21: condition on whatever USGS station/DYFI data exists ---
    station_records = _parse_station_records(usgs.stationlist_text)
    dyfi_boxes = _parse_dyfi_boxes(usgs.dyfi_geo_10km_text)
    fm, conditioning_sources = _condition_if_possible(
        fm, event_lat=event.lat, event_lon=event.lon, event_depth_km=event.depth_km, mag_mw=event.mag,
        station_records=station_records, dyfi_boxes=dyfi_boxes, vs30_sampler=resolved_vs30_sampler,
    )
    # Honest provenance on every product, conditioned or not — "no USGS data
    # was available" and "USGS data existed but conditioning wasn't run" are
    # both distinguishable from the data_used dict alone (never silently
    # indistinguishable, same policy as conditioned_forward.py's own
    # small-N conditioning-floor notes). `distance_method`/`rupture_quads_used`
    # (D22) are already IN `fm.data_used` from `build_forward_map` and
    # survive `_condition_if_possible` (conditioned_forward.py merges, see
    # its own note) — only the USGS-fetch-level flags are added here.
    fm = replace(
        fm,
        data_used={
            **fm.data_used,
            # Which provider's feed record triggered this compute ("usgs" /
            # "emsc") — trigger provenance for EMSC-only events surfaced by
            # the completeness sweep (feed_watcher.py).
            "trigger_source": event.source,
            "usgs_shakemap_grid_available": usgs.shakemap_available,
            "usgs_stationlist_available": usgs.stationlist_text is not None,
            "usgs_dyfi_available": usgs.dyfi_available,
            "usgs_rupture_available": usgs.rupture_available,
            "instrument_stations_parsed": len(station_records),
            "dyfi_boxes_parsed": len(dyfi_boxes),
        },
    )
    # --- end D21/D22 conditioning wiring ---

    version = (known.last_version + 1) if known is not None else 1
    out_dir = products_root / event.external_id / f"v{version}"
    written = export.write_products(fm, out_dir, product_version=version, generated_at=now)

    # --- D21: automatic comparison against a USGS grid, if one exists ---
    comparison_path = _write_compatibility_product(
        fm, event=event, version=version, usgs=usgs, out_dir=out_dir, generated_at_iso=now_iso,
    )
    has_comparison = comparison_path is not None
    # --- end D21 comparison wiring ---

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
        origin_time_ms=event.time_ms,
        first_seen_at=first_seen_at,
        last_computed_at=now_iso,
        has_comparison=has_comparison,
        comparison_path=str(comparison_path) if comparison_path else None,
        reviews=known.reviews if known is not None else {},
    )
    ws.upsert_event(new_state)

    upload_records = uploader.upload_products(
        event_id=event.external_id,
        version=version,
        product_paths=written,
        data_used=fm.data_used,
        review_status=export.DEFAULT_REVIEW_STATUS,
    )

    return PipelineResult(
        event_id=event.external_id,
        decision_kind=decision.kind,
        version=version,
        recomputed=True,
        product_paths=written,
        forward_map=fm,
        upload_records=tuple(upload_records),
        has_comparison=has_comparison,
        comparison_path=comparison_path,
        conditioning_sources=conditioning_sources,
    )
