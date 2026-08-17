#!/usr/bin/env python3
"""run_worker — CLI for the bumelerze-shake-service auto-trigger worker
(owner directive 2026-08-14: any event in Iraq or with effect on
Kurdistan, no magnitude floor — `feed_watcher.triggers_shakemap`;
supersedes D9's M>=3.5 regional floor. D9's versioned re-conditioning
policy is unchanged).

Besides computing maps for triggering events, the worker is the bml-id
allocation point and the live catalog's writer: every newly detected
canonical event (post-dedup, any magnitude, `"new"` AND `"catalog"`
decisions) is assigned a `bml<year><base36>` id
(`shake_service/event_id.py` — the worker state file is the single
allocation authority today) and appended as one JSONL line to
`regional-catalog/live-catalog.jsonl` (`worker/live_catalog.py`), whether
or not a ShakeMap was computed for it.

Two modes:

  --once     One poll cycle: a USGS `all_hour` feed poll, a USGS region-bbox
             `updatedafter` sweep, an EMSC region-bbox sweep, AND a GEOFON
             region-bbox sweep, unconditionally (regardless of the daemon
             cadences below) — for tests/cron. Loads state, polls all four
             feeds, processes every `"new"`/`"update"` decision through
             `pipeline.run_pipeline`, saves state once, exits 0.

  --daemon   Loops forever at the design cadences (60 s `all_hour` poll,
             10 min region-bbox sweeps — USGS, EMSC, and GEOFON, `docs/
             research/event-pipeline-design.md` §2) until SIGINT. Each poll
             is independently try/excepted so a feed outage on one never
             blocks the others (tolerant of feed downtime); state is saved
             after every processed cycle AND on clean shutdown.

**EMSC completeness sweep (why a second provider):** a real missed
earthquake — 2026-08-13 22:28 UTC, M4.0 mb, Iran–Iraq border region — was
in EMSC's catalog but absent from USGS entirely (below NEIC's ~M4.5
regional completeness), so the USGS-only watcher produced no Bumelerze
SHAKEmap despite qualifying to trigger. The EMSC sweep polls
seismicportal.eu's fdsnws region query at the USGS sweep's cadence;
EMSC-vs-USGS duplicates are deduped inside `feed_watcher` (event-pipeline-
design.md §2: 16 s / 100 km / |ΔM| 1.5; an event tracked from one provider
never re-triggers from the other's record), and EMSC-only qualifying
events trigger the pipeline exactly like USGS ones (event id = the EMSC
`unid`, `trigger_source: "emsc"` recorded in each product's data_used and
in worker state). Unlike the USGS sweep's `updatedafter` window, EMSC is
queried by ORIGIN time (`start=` lookback, `EMSC_SWEEP_LOOKBACK_S`) —
generous enough to cover publication latency and near-term revisions; an
EMSC-side revision arriving later than that is rare and matters little
(matched events are USGS-tracked anyway, and D9 versioning re-runs on the
next qualifying revision either provider surfaces inside the window).

**GEOFON completeness sweep (the third provider, D4's named order USGS >
EMSC > GEOFON):** same cadence and origin-time lookback rationale as the
EMSC sweep, against geofon.gfz.de's fdsnws. GEOFON serves NO `format=json`
(verified live: 400), so this sweep requests `format=text` — the
pipe-delimited FDSN WS-EVENT text format (parsed by
`feed_watcher.parse_geofon_text`; deliberately reusable for any future
SeisComP-based source, `docs/research/provider-architecture.md`) — and
therefore fetches through `fetch_text` rather than `fetch_json`. Sweep
ORDER is the dedup's canonical-id mechanism: USGS polls run first, EMSC
second, GEOFON third, so an event carried by several providers is created
under the highest-authority id available and every later record
cross-provider-dedups against it (feed_watcher §2 matching across ALL
other providers' tracked events). GEOFON-only qualifying events trigger
the pipeline exactly like EMSC-only ones (event id = the gfz id,
`trigger_source: "geofon"`; no USGS products fetch for non-USGS ids).

**Deployment note:** this worker is designed to run server-side, next to
Supabase — a small always-on process (or cron-equivalent) — NOT on
Peshawa's Mac. No systemd unit / launchd plist is shipped this wave: there
is nowhere to deploy this permanently yet (PROJECT.md "Blocked on Peshawa" —
the Supabase project does not exist). `--daemon` proves the loop shape now;
the actual process supervisor is a later wave's concern.

Usage:
    ./.venv/bin/python scripts/run_worker.py --once
    ./.venv/bin/python scripts/run_worker.py --daemon
    ./.venv/bin/python scripts/run_worker.py --once \\
        --state-path worker_state.json --products-root products
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import signal
import sys
import time
from pathlib import Path
from typing import Any, Callable

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # allow running as a plain script

from shake_service import config, event_id  # noqa: E402
from shake_service.worker import feed_watcher, pipeline, usgs_products  # noqa: E402
from shake_service.worker.live_catalog import append_to_live_catalog  # noqa: E402
from shake_service.worker.state import WorkerState  # noqa: E402
from shake_service.worker.uploader import LocalOnlyUploader, ProductUploader, build_uploader  # noqa: E402

ALL_HOUR_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
FDSNWS_EVENT_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
EMSC_FDSNWS_EVENT_URL = "https://www.seismicportal.eu/fdsnws/event/1/query"
GEOFON_FDSNWS_EVENT_URL = "https://geofon.gfz.de/fdsnws/event/1/query"

# Cadences per `docs/research/event-pipeline-design.md` §2 (the
# ingestion worker's own "60s poll + 10min updatedafter sweep" rhythm —
# deliberately matched so both USGS-facing workers in this repo behave the
# same way operationally).
POLL_INTERVAL_S = 60
SWEEP_INTERVAL_S = 600
# The sweep looks back further than its own interval so a transient outage
# (daemon restart, one failed poll) does not create a gap no later sweep
# would ever re-cover.
SWEEP_LOOKBACK_S = SWEEP_INTERVAL_S * 2
# EMSC has no `updatedafter`-shaped consistency net wired here — its sweep
# filters on ORIGIN time (`start=`), so the lookback is deliberately much
# longer (1 h) than the USGS sweep's: it must cover EMSC's own publication
# latency for a brand-new event AND keep recent events in view long enough
# to catch near-term revisions (module docstring). Cheap: a 1-hour
# region-bbox query returns at most a handful of events.
EMSC_SWEEP_LOOKBACK_S = 3600
# GEOFON's sweep shares the EMSC sweep's origin-time semantics and
# therefore its lookback rationale verbatim (no `updatedafter` equivalent;
# must cover publication latency + near-term revisions; cheap query).
GEOFON_SWEEP_LOOKBACK_S = 3600

REQUEST_TIMEOUT_S = 30
DAEMON_TICK_S = 1.0

DEFAULT_STATE_PATH = Path(__file__).resolve().parent.parent / "worker_state.json"
DEFAULT_PRODUCTS_ROOT = Path(__file__).resolve().parent.parent / "products"
# The from-launch internal catalog (worker/live_catalog.py): every newly
# detected canonical event gets one appended JSONL line, bml id included.
DEFAULT_LIVE_CATALOG_PATH = (
    Path(__file__).resolve().parent.parent / "regional-catalog" / "live-catalog.jsonl"
)

FetchFn = Callable[..., dict[str, Any]]
FetchTextFn = Callable[..., str]


def _log(event: str, **fields: Any) -> None:
    """One structured JSON line per event, to stdout — no logging
    framework/monitoring stack (PROJECT.md "structured logging in functions
    — no extra monitoring stack"; solo-dev ops)."""
    payload = {"ts": _dt.datetime.now(_dt.timezone.utc).isoformat(), "event": event, **fields}
    print(json.dumps(payload, default=str))


def fetch_json(url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    return response.json()


def fetch_text(url: str, params: dict[str, Any] | None = None) -> str:
    """GEOFON's fdsnws serves no JSON at all (module docstring) — its sweep
    fetches the FDSN text format as a plain string. A 204 (the FDSN
    default no-events status) yields an empty string, which
    `parse_geofon_text` treats as zero events, not an error."""
    response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    return response.text


def _region_sweep_params(updated_after: str) -> dict[str, Any]:
    # MONITORED_BBOX, not REGION_BBOX: the sweeps must cover the whole
    # detection domain of the trigger policy (all of Iraq + the Kurdistan
    # bbox widened by the largest possible shaking footprint — see the
    # config constant's own doc) or southern-Iraq / cross-border effect
    # events would never even reach `evaluate_feed_events`.
    bbox = config.MONITORED_BBOX
    return {
        "format": "geojson",
        "updatedafter": updated_after,
        "minlatitude": bbox["min_lat"],
        "maxlatitude": bbox["max_lat"],
        "minlongitude": bbox["min_lon"],
        "maxlongitude": bbox["max_lon"],
    }


def poll_all_hour(ws: WorkerState, *, fetch_fn: FetchFn = fetch_json) -> list[feed_watcher.TriggerDecision]:
    payload = fetch_fn(ALL_HOUR_FEED_URL)
    events = feed_watcher.parse_usgs_geojson(payload)
    return feed_watcher.evaluate_feed_events(events, ws)


def poll_region_sweep(
    ws: WorkerState, *, updated_after: str, fetch_fn: FetchFn = fetch_json
) -> list[feed_watcher.TriggerDecision]:
    payload = fetch_fn(FDSNWS_EVENT_URL, _region_sweep_params(updated_after))
    events = feed_watcher.parse_usgs_geojson(payload)
    return feed_watcher.evaluate_feed_events(events, ws)


def _emsc_sweep_params(start_time: str) -> dict[str, Any]:
    """EMSC's fdsnws documents the short param-name aliases (`start`,
    `minlat`/`maxlat`/`minlon`/`maxlon`) rather than USGS's long names —
    same FDSN WS-EVENT spec, different documented alias (verified against
    the primary source by the app's own EMSC integration,
    src/features/events/emsc.ts — kept literal to that here). Queries
    MONITORED_BBOX — see `_region_sweep_params`'s note."""
    bbox = config.MONITORED_BBOX
    return {
        "format": "json",
        "start": start_time,
        "minlat": bbox["min_lat"],
        "maxlat": bbox["max_lat"],
        "minlon": bbox["min_lon"],
        "maxlon": bbox["max_lon"],
        "orderby": "time",
    }


def poll_emsc_sweep(
    ws: WorkerState, *, start_time: str, fetch_fn: FetchFn = fetch_json
) -> list[feed_watcher.TriggerDecision]:
    """The EMSC completeness sweep (module docstring): same decision logic
    as the USGS polls — `feed_watcher.evaluate_feed_events` applies the
    region/magnitude gates, state dedup, AND the cross-provider §2 dedup
    that stops an already-USGS-tracked event re-triggering from its EMSC
    record."""
    payload = fetch_fn(EMSC_FDSNWS_EVENT_URL, _emsc_sweep_params(start_time))
    events = feed_watcher.parse_emsc_geojson(payload)
    return feed_watcher.evaluate_feed_events(events, ws)


def _geofon_sweep_params(start_time: str) -> dict[str, Any]:
    """GEOFON takes the same short bbox aliases as EMSC
    (minlat/maxlat/minlon/maxlon) with the long-form `starttime`, and
    `format=text` because it serves no JSON — all verified live against
    geofon.gfz.de (matching the app's own geofon.ts findings), not assumed
    from the FDSN spec. Queries MONITORED_BBOX — see
    `_region_sweep_params`'s note."""
    bbox = config.MONITORED_BBOX
    return {
        "format": "text",
        "starttime": start_time,
        "minlat": bbox["min_lat"],
        "maxlat": bbox["max_lat"],
        "minlon": bbox["min_lon"],
        "maxlon": bbox["max_lon"],
        "orderby": "time",
    }


def poll_geofon_sweep(
    ws: WorkerState, *, start_time: str, fetch_text_fn: FetchTextFn = fetch_text
) -> list[feed_watcher.TriggerDecision]:
    """The GEOFON completeness sweep (module docstring): identical decision
    logic to the other polls — `feed_watcher.evaluate_feed_events` applies
    the region/magnitude gates, state dedup, AND the cross-provider §2
    dedup across ALL other providers' tracked events, so an event already
    tracked from USGS *or* EMSC never re-triggers from its GEOFON record.
    Fetches TEXT, not JSON (module docstring), hence the separate
    `fetch_text_fn` seam."""
    text = fetch_text_fn(GEOFON_FDSNWS_EVENT_URL, _geofon_sweep_params(start_time))
    events = feed_watcher.parse_geofon_text(text)
    return feed_watcher.evaluate_feed_events(events, ws)


def process_decisions(
    decisions: list[feed_watcher.TriggerDecision],
    ws: WorkerState,
    *,
    products_root: Path,
    uploader: ProductUploader,
    usgs_products_fetcher: pipeline.UsgsProductsFetcher = usgs_products.no_usgs_products,
    live_catalog_path: Path | None = None,
) -> None:
    """Act on one poll's decisions. Besides running the pipeline for
    `"new"`/`"update"`, this is where first-detection bookkeeping lives:

    - `"new"` and `"catalog"` decisions (both are newly detected canonical
      events, post-dedup) get a bml id assigned via
      `event_id.ensure_bumelerze_id` — allocation happens for ALL detected
      events, whether or not a map is computed — and one appended
      live-catalog line (`worker/live_catalog.py`).
    - cross-provider-duplicate `"skip"`s record the duplicate provider's
      id into the tracked entry's `provider_aliases`.

    `live_catalog_path=None` (the default) skips the append — the same
    "zero side effects unless explicitly wired" convention as
    `usgs_products_fetcher`; `main()` wires `DEFAULT_LIVE_CATALOG_PATH`."""
    for decision in decisions:
        if decision.kind == "skip":
            if decision.cross_match is not None:
                # Another provider's record of an already-tracked event:
                # remember its id as an alias (never re-triggers, never a
                # new bml id — the canonical entry already has one).
                decision.cross_match.provider_aliases.setdefault(
                    decision.event.source, decision.event.external_id
                )
            continue

        if decision.kind in ("new", "catalog"):
            detected_at_iso = _dt.datetime.now(_dt.timezone.utc).isoformat()
            bml_id = event_id.ensure_bumelerze_id(ws, decision.event, now_iso=detected_at_iso)
            if live_catalog_path is not None:
                append_to_live_catalog(
                    live_catalog_path, decision.event, bumelerze_id=bml_id,
                    triggered=decision.kind == "new", detected_at_iso=detected_at_iso,
                )
            if decision.kind == "catalog":
                _log(
                    "catalog_tracked",
                    event_id=decision.event.external_id,
                    bumelerze_id=bml_id,
                    reason=decision.reason,
                    mag=decision.event.mag,
                )
                continue

        result = pipeline.run_pipeline(
            decision, ws, products_root=products_root, uploader=uploader,
            usgs_products_fetcher=usgs_products_fetcher,
        )
        tracked = ws.get_event(result.event_id)
        _log(
            "trigger_processed",
            event_id=result.event_id,
            bumelerze_id=tracked.bumelerze_id if tracked is not None else None,
            decision_kind=decision.kind,
            reason=decision.reason,
            version=result.version,
            recomputed=result.recomputed,
            has_comparison=result.has_comparison,
            conditioning_sources=list(result.conditioning_sources),
        )


def _default_sweep_updated_after(lookback_s: int = SWEEP_LOOKBACK_S) -> str:
    return (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(seconds=lookback_s)).strftime("%Y-%m-%dT%H:%M:%S")


def _default_emsc_sweep_start(lookback_s: int = EMSC_SWEEP_LOOKBACK_S) -> str:
    return _default_sweep_updated_after(lookback_s)


def _default_geofon_sweep_start(lookback_s: int = GEOFON_SWEEP_LOOKBACK_S) -> str:
    return _default_sweep_updated_after(lookback_s)


def run_once(
    *,
    state_path: Path,
    products_root: Path,
    uploader: ProductUploader,
    fetch_fn: FetchFn = fetch_json,
    fetch_text_fn: FetchTextFn = fetch_text,
    usgs_products_fetcher: pipeline.UsgsProductsFetcher = usgs_products.no_usgs_products,
    live_catalog_path: Path | None = None,
    sweep_updated_after: str | None = None,
    emsc_sweep_start: str | None = None,
    geofon_sweep_start: str | None = None,
) -> WorkerState:
    ws = WorkerState.load(state_path)
    _log("cycle_start", mode="once")

    # Order IS the canonical-id mechanism (module docstring): USGS polls
    # run FIRST, EMSC second, GEOFON third — an event carried by several
    # providers is created under the highest-authority id available and
    # every later record cross-provider-dedups against it (feed_watcher
    # module docstring: §2 authority order USGS > EMSC > GEOFON).
    all_hour_decisions = poll_all_hour(ws, fetch_fn=fetch_fn)
    process_decisions(
        all_hour_decisions, ws, products_root=products_root, uploader=uploader,
        usgs_products_fetcher=usgs_products_fetcher,
        live_catalog_path=live_catalog_path,
    )

    updated_after = sweep_updated_after or _default_sweep_updated_after()
    sweep_decisions = poll_region_sweep(ws, updated_after=updated_after, fetch_fn=fetch_fn)
    process_decisions(
        sweep_decisions, ws, products_root=products_root, uploader=uploader,
        usgs_products_fetcher=usgs_products_fetcher,
        live_catalog_path=live_catalog_path,
    )

    emsc_start = emsc_sweep_start or _default_emsc_sweep_start()
    emsc_decisions = poll_emsc_sweep(ws, start_time=emsc_start, fetch_fn=fetch_fn)
    process_decisions(
        emsc_decisions, ws, products_root=products_root, uploader=uploader,
        usgs_products_fetcher=usgs_products_fetcher,
        live_catalog_path=live_catalog_path,
    )

    geofon_start = geofon_sweep_start or _default_geofon_sweep_start()
    geofon_decisions = poll_geofon_sweep(ws, start_time=geofon_start, fetch_text_fn=fetch_text_fn)
    process_decisions(
        geofon_decisions, ws, products_root=products_root, uploader=uploader,
        usgs_products_fetcher=usgs_products_fetcher,
        live_catalog_path=live_catalog_path,
    )

    ws.save(state_path)
    _log("cycle_end", mode="once", state_path=str(state_path))
    return ws


def run_daemon(
    *,
    state_path: Path,
    products_root: Path,
    uploader: ProductUploader,
    fetch_fn: FetchFn = fetch_json,
    fetch_text_fn: FetchTextFn = fetch_text,
    usgs_products_fetcher: pipeline.UsgsProductsFetcher = usgs_products.no_usgs_products,
    live_catalog_path: Path | None = None,
    tick_s: float = DAEMON_TICK_S,
) -> None:
    ws = WorkerState.load(state_path)
    shutdown_requested = False

    def _handle_sigint(signum: int, frame: Any) -> None:
        nonlocal shutdown_requested
        shutdown_requested = True
        _log("shutdown_requested", signal=signum)

    signal.signal(signal.SIGINT, _handle_sigint)

    last_all_hour_poll = 0.0
    last_sweep_poll = 0.0
    _log("daemon_start", poll_interval_s=POLL_INTERVAL_S, sweep_interval_s=SWEEP_INTERVAL_S)

    try:
        while not shutdown_requested:
            now = time.monotonic()

            if now - last_all_hour_poll >= POLL_INTERVAL_S:
                try:
                    decisions = poll_all_hour(ws, fetch_fn=fetch_fn)
                    process_decisions(
                        decisions, ws, products_root=products_root, uploader=uploader,
                        usgs_products_fetcher=usgs_products_fetcher,
                        live_catalog_path=live_catalog_path,
                    )
                    ws.save(state_path)
                except requests.RequestException as exc:
                    # Tolerant of feed downtime: log and keep looping, never
                    # crash the daemon on a transient network/feed failure.
                    _log("all_hour_poll_failed", error=str(exc))
                last_all_hour_poll = now

            if now - last_sweep_poll >= SWEEP_INTERVAL_S:
                # USGS sweep first, EMSC second, GEOFON third (same 10-min
                # cadence): sweep order IS the canonical-id mechanism —
                # the highest-authority provider that carries an event owns
                # its state entry (see run_once's ordering note). Each
                # sweep has its own try/except so an outage on one provider
                # never blocks the others' sweeps in the same cycle.
                try:
                    updated_after = _default_sweep_updated_after()
                    decisions = poll_region_sweep(ws, updated_after=updated_after, fetch_fn=fetch_fn)
                    process_decisions(
                        decisions, ws, products_root=products_root, uploader=uploader,
                        usgs_products_fetcher=usgs_products_fetcher,
                        live_catalog_path=live_catalog_path,
                    )
                    ws.save(state_path)
                except requests.RequestException as exc:
                    _log("region_sweep_failed", error=str(exc))
                try:
                    emsc_start = _default_emsc_sweep_start()
                    decisions = poll_emsc_sweep(ws, start_time=emsc_start, fetch_fn=fetch_fn)
                    process_decisions(
                        decisions, ws, products_root=products_root, uploader=uploader,
                        usgs_products_fetcher=usgs_products_fetcher,
                        live_catalog_path=live_catalog_path,
                    )
                    ws.save(state_path)
                except requests.RequestException as exc:
                    _log("emsc_sweep_failed", error=str(exc))
                try:
                    geofon_start = _default_geofon_sweep_start()
                    decisions = poll_geofon_sweep(ws, start_time=geofon_start, fetch_text_fn=fetch_text_fn)
                    process_decisions(
                        decisions, ws, products_root=products_root, uploader=uploader,
                        usgs_products_fetcher=usgs_products_fetcher,
                        live_catalog_path=live_catalog_path,
                    )
                    ws.save(state_path)
                except requests.RequestException as exc:
                    _log("geofon_sweep_failed", error=str(exc))
                last_sweep_poll = now

            if shutdown_requested:
                break
            time.sleep(tick_s)
    finally:
        ws.save(state_path)
        _log("daemon_stop", state_path=str(state_path))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="run a single poll cycle and exit")
    mode.add_argument("--daemon", action="store_true", help="loop forever at the design cadences until SIGINT")
    parser.add_argument("--state-path", default=str(DEFAULT_STATE_PATH))
    parser.add_argument("--products-root", default=str(DEFAULT_PRODUCTS_ROOT))
    parser.add_argument(
        "--live-catalog-path", default=str(DEFAULT_LIVE_CATALOG_PATH),
        help="append-only JSONL of every newly detected canonical event (worker/live_catalog.py)",
    )
    args = parser.parse_args()

    state_path = Path(args.state_path)
    products_root = Path(args.products_root)
    live_catalog_path = Path(args.live_catalog_path)
    # Real wiring (SupabaseUploader integration wave): `build_uploader` reads
    # SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY from the environment and returns
    # a real, network-enabled SupabaseUploader when both are set, or falls
    # back to the old LocalOnlyUploader (with a logged reason) when they
    # aren't — so a worker started without those two env vars behaves
    # exactly as it always has, degrading safely rather than crashing.
    uploader = build_uploader(log_fn=lambda msg: _log("uploader", message=msg))
    # Real wiring (D21): the actual CLI entrypoint opts INTO network-enabled
    # USGS product fetching — every testable function above this
    # (`process_decisions`/`run_once`/`run_daemon`) defaults to the
    # zero-network `usgs_products.no_usgs_products` instead, so no existing
    # or new unit test ever makes a real HTTP request unless it explicitly
    # asks for one.
    usgs_products_fetcher = usgs_products.fetch_usgs_event_products

    if args.once:
        run_once(
            state_path=state_path, products_root=products_root, uploader=uploader,
            usgs_products_fetcher=usgs_products_fetcher, live_catalog_path=live_catalog_path,
        )
    else:
        run_daemon(
            state_path=state_path, products_root=products_root, uploader=uploader,
            usgs_products_fetcher=usgs_products_fetcher, live_catalog_path=live_catalog_path,
        )


if __name__ == "__main__":
    main()
