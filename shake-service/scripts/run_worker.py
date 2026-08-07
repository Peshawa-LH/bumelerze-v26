#!/usr/bin/env python3
"""run_worker — CLI for the bumelerze-shake-service auto-trigger worker
(D9: "auto for regional M>=3.5 ... versioned re-conditioning").

Two modes:

  --once     One poll cycle: an `all_hour` feed poll AND a region-bbox
             `updatedafter` sweep, unconditionally (regardless of the
             daemon cadences below) — for tests/cron. Loads state, polls
             both feeds, processes every `"new"`/`"update"` decision
             through `pipeline.run_pipeline`, saves state once, exits 0.

  --daemon   Loops forever at the design cadences (60 s `all_hour` poll,
             10 min region-bbox sweep — `docs/research/
             event-pipeline-design.md` §2) until SIGINT. Each cadence's
             poll is independently try/excepted so a feed outage on one
             never blocks the other (tolerant of feed downtime); state is
             saved after every processed cycle AND on clean shutdown.

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

from shake_service import config  # noqa: E402
from shake_service.worker import feed_watcher, pipeline  # noqa: E402
from shake_service.worker.state import WorkerState  # noqa: E402
from shake_service.worker.uploader import LocalOnlyUploader, ProductUploader  # noqa: E402

ALL_HOUR_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
FDSNWS_EVENT_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"

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

REQUEST_TIMEOUT_S = 30
DAEMON_TICK_S = 1.0

DEFAULT_STATE_PATH = Path(__file__).resolve().parent.parent / "worker_state.json"
DEFAULT_PRODUCTS_ROOT = Path(__file__).resolve().parent.parent / "products"

FetchFn = Callable[..., dict[str, Any]]


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


def _region_sweep_params(updated_after: str) -> dict[str, Any]:
    bbox = config.REGION_BBOX
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


def process_decisions(
    decisions: list[feed_watcher.TriggerDecision],
    ws: WorkerState,
    *,
    products_root: Path,
    uploader: ProductUploader,
) -> None:
    for decision in decisions:
        if decision.kind == "skip":
            continue
        result = pipeline.run_pipeline(decision, ws, products_root=products_root, uploader=uploader)
        _log(
            "trigger_processed",
            event_id=result.event_id,
            decision_kind=decision.kind,
            reason=decision.reason,
            version=result.version,
            recomputed=result.recomputed,
        )


def _default_sweep_updated_after(lookback_s: int = SWEEP_LOOKBACK_S) -> str:
    return (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(seconds=lookback_s)).strftime("%Y-%m-%dT%H:%M:%S")


def run_once(
    *,
    state_path: Path,
    products_root: Path,
    uploader: ProductUploader,
    fetch_fn: FetchFn = fetch_json,
    sweep_updated_after: str | None = None,
) -> WorkerState:
    ws = WorkerState.load(state_path)
    _log("cycle_start", mode="once")

    all_hour_decisions = poll_all_hour(ws, fetch_fn=fetch_fn)
    process_decisions(all_hour_decisions, ws, products_root=products_root, uploader=uploader)

    updated_after = sweep_updated_after or _default_sweep_updated_after()
    sweep_decisions = poll_region_sweep(ws, updated_after=updated_after, fetch_fn=fetch_fn)
    process_decisions(sweep_decisions, ws, products_root=products_root, uploader=uploader)

    ws.save(state_path)
    _log("cycle_end", mode="once", state_path=str(state_path))
    return ws


def run_daemon(
    *,
    state_path: Path,
    products_root: Path,
    uploader: ProductUploader,
    fetch_fn: FetchFn = fetch_json,
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
                    process_decisions(decisions, ws, products_root=products_root, uploader=uploader)
                    ws.save(state_path)
                except requests.RequestException as exc:
                    # Tolerant of feed downtime: log and keep looping, never
                    # crash the daemon on a transient network/feed failure.
                    _log("all_hour_poll_failed", error=str(exc))
                last_all_hour_poll = now

            if now - last_sweep_poll >= SWEEP_INTERVAL_S:
                try:
                    updated_after = _default_sweep_updated_after()
                    decisions = poll_region_sweep(ws, updated_after=updated_after, fetch_fn=fetch_fn)
                    process_decisions(decisions, ws, products_root=products_root, uploader=uploader)
                    ws.save(state_path)
                except requests.RequestException as exc:
                    _log("region_sweep_failed", error=str(exc))
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
    args = parser.parse_args()

    state_path = Path(args.state_path)
    products_root = Path(args.products_root)
    uploader = LocalOnlyUploader(log_fn=lambda msg: _log("uploader", message=msg))

    if args.once:
        run_once(state_path=state_path, products_root=products_root, uploader=uploader)
    else:
        run_daemon(state_path=state_path, products_root=products_root, uploader=uploader)


if __name__ == "__main__":
    main()
