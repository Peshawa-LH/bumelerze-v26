#!/usr/bin/env python3
"""seed_atlas — CLI: run the full pipeline (forward prior -> USGS
station/DYFI conditioning -> export -> auto-compare) for every Bumelerze
Atlas seed event — the Historical View's curated 11
(`src/features/historical/notable-events.ts`) — writing output into
`bumelerze-atlas/<event-id>/v1/` (a permanent, versioned, COMMITTED
archive — D21 "Bumelerze Atlas": "the permanent versioned archive of our
computed maps — seeded with the curated important past events (historical
view's 11), grown automatically by the worker for every picked-up event").

Event ids/coordinates/magnitudes are read directly from the TS source at
RUNTIME (never hand-transcribed), so this script can never silently drift
from the app's own curated list — `parse_notable_events` is a small,
dependency-free regex extraction (no TS/JS toolchain needed from Python),
tested against the real file in `tests/test_seed_atlas.py`. Depth is not in
the TS source (the app never needed it) — fetched fresh per event from the
USGS event-detail endpoint, same as every other field the pipeline needs.

Unlike the auto-trigger worker (`scripts/run_worker.py`, D9's M>=3.5
regional floor + region bbox), Atlas seeding is UNCONDITIONAL for these 11
events — several pre-date instrumental coverage or sit outside the region
bbox tuning (e.g. the two Kahramanmaraş events), and all 11 are
deliberately picked for their significance, not their live-feed trigger
eligibility.

Idempotent, like every other pipeline entrypoint: re-running this script
against an event whose params haven't changed since the last seed is a
no-op (no re-fetch of USGS products, no re-export, no re-comparison) — see
`worker/pipeline.py`'s own params-hash short circuit.

Network access required (USGS event detail + whatever shakemap/dyfi
product content each event has) — this is an occasional, manually-run
seeding script, not a scheduled job.

Usage:
    ./.venv/bin/python scripts/seed_atlas.py
    ./.venv/bin/python scripts/seed_atlas.py --atlas-root bumelerze-atlas \\
        --state-path bumelerze-atlas/worker_state.json
    ./.venv/bin/python scripts/seed_atlas.py --event us2000bmcg  # one event only
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # allow running as a plain script

from shake_service.worker import pipeline, usgs_products  # noqa: E402
from shake_service.worker.feed_watcher import FeedEvent, TriggerDecision  # noqa: E402
from shake_service.worker.state import WorkerState  # noqa: E402
from shake_service.worker.uploader import LocalOnlyUploader  # noqa: E402

SHAKE_SERVICE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = SHAKE_SERVICE_ROOT.parent
NOTABLE_EVENTS_TS = REPO_ROOT / "src" / "features" / "historical" / "notable-events.ts"

DEFAULT_ATLAS_ROOT = SHAKE_SERVICE_ROOT / "bumelerze-atlas"
DEFAULT_STATE_PATH = DEFAULT_ATLAS_ROOT / "worker_state.json"
DEFAULT_SUMMARY_PATH = DEFAULT_ATLAS_ROOT / "SEED_SUMMARY.json"

# ---------------------------------------------------------------------------
# Reading the curated event list straight from the TS source
# ---------------------------------------------------------------------------

_ARRAY_RE = re.compile(r"NOTABLE_HISTORICAL_EVENTS[^\[]*\[(.*)\]\s*as const", re.DOTALL)
_EVENT_OBJECT_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)
_ID_RE = re.compile(r'id:\s*"([^"]+)"')
_YEAR_RE = re.compile(r"year:\s*(\d+)")
_MAG_RE = re.compile(r"magnitude:\s*([0-9.]+)")
_LAT_RE = re.compile(r"lat:\s*(-?[0-9.]+)")
_LON_RE = re.compile(r"lon:\s*(-?[0-9.]+)")
_PLACE_NAME_RE = re.compile(r'placeName:\s*"([^"]*)"')
_NOTE_KEY_RE = re.compile(r'noteKey:\s*"([^"]*)"')


def parse_notable_events(ts_path: Path = NOTABLE_EVENTS_TS) -> list[dict[str, Any]]:
    """Extracts `{id, year, magnitude, lat, lon, placeName, noteKey}` for
    every event object literal inside `NOTABLE_HISTORICAL_EVENTS` — a
    small, dependency-free regex parse (module docstring), NOT a full TS
    parser: relies on the source file's own consistent one-object-per-entry
    shape. Raises `ValueError` (rather than silently returning a partial
    list) if the array or an expected field can't be found — a shape
    change in `notable-events.ts` must be a loud failure here, not a
    silently stale Atlas."""
    if not ts_path.exists():
        raise ValueError(f"parse_notable_events: could not find NOTABLE_HISTORICAL_EVENTS array in {ts_path} (file does not exist)")
    text = ts_path.read_text()
    array_match = _ARRAY_RE.search(text)
    if not array_match:
        raise ValueError(f"parse_notable_events: could not find NOTABLE_HISTORICAL_EVENTS array in {ts_path}")
    body = array_match.group(1)

    events: list[dict[str, Any]] = []
    for obj_text in _EVENT_OBJECT_RE.findall(body):
        id_match = _ID_RE.search(obj_text)
        mag_match = _MAG_RE.search(obj_text)
        lat_match = _LAT_RE.search(obj_text)
        lon_match = _LON_RE.search(obj_text)
        if not (id_match and mag_match and lat_match and lon_match):
            raise ValueError(f"parse_notable_events: event object missing an expected field: {obj_text!r}")
        year_match = _YEAR_RE.search(obj_text)
        place_match = _PLACE_NAME_RE.search(obj_text)
        note_match = _NOTE_KEY_RE.search(obj_text)
        events.append({
            "id": id_match.group(1),
            "year": int(year_match.group(1)) if year_match else None,
            "magnitude": float(mag_match.group(1)),
            "lat": float(lat_match.group(1)),
            "lon": float(lon_match.group(1)),
            "placeName": place_match.group(1) if place_match else "",
            "noteKey": note_match.group(1) if note_match else "",
        })
    if not events:
        raise ValueError(f"parse_notable_events: found zero events in {ts_path}")
    return events


# ---------------------------------------------------------------------------
# USGS event detail -> FeedEvent (depth isn't in the TS source — fetched)
# ---------------------------------------------------------------------------


def fetch_feed_event(
    event_id: str, *, fetch_text: usgs_products.FetchTextFn | None = None,
) -> FeedEvent:
    """USGS event-detail geojson (a bare `Feature`, not a `FeatureCollection`
    — same shape `scripts/run_validation.py`'s own `fetch_event_detail`
    reads) -> a `FeedEvent` `worker/pipeline.py` can run. `fetch_text`
    defaults to `usgs_products.default_fetch_text`, resolved at CALL time
    (not bound as a literal default value) so tests can monkeypatch
    `usgs_products.default_fetch_text` and have it take effect even when a
    caller (like `main()`) never passes `fetch_text` explicitly."""
    fetch_text = fetch_text or usgs_products.default_fetch_text
    text = fetch_text(usgs_products.DETAIL_URL, {"eventid": event_id, "format": "geojson"})
    detail = json.loads(text)
    props = detail["properties"]
    lon, lat, depth_km = detail["geometry"]["coordinates"][:3]
    return FeedEvent(
        external_id=str(detail.get("id") or event_id),
        source="usgs",
        mag=float(props["mag"]),
        lat=float(lat), lon=float(lon), depth_km=float(depth_km),
        place=str(props.get("place") or ""),
        time_ms=int(props.get("time") or 0),
        updated_ms=int(props.get("updated") or 0),
    )


# ---------------------------------------------------------------------------
# Seeding one event
# ---------------------------------------------------------------------------


def seed_event(
    curated: dict[str, Any],
    ws: WorkerState,
    *,
    atlas_root: Path,
    uploader: LocalOnlyUploader,
    fetch_text: usgs_products.FetchTextFn | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Seed (or idempotently re-confirm) one curated event. Returns a
    flat, JSON-serializable summary row — never raises on a per-event USGS
    product-availability gap (that is the expected, common case for
    pre-instrumental events; `pipeline.run_pipeline` itself is already
    tolerant of a missing/malformed USGS product). `fetch_text` resolves at
    CALL time — see `fetch_feed_event`'s docstring. `force` (D22): passed
    straight through to `pipeline.run_pipeline` — bypasses the params-hash
    short circuit, always producing a new version even for an event whose
    catalog params haven't changed (the "engine changed, not the event"
    reseed case — `pipeline.py`'s own `force=` docstring)."""
    fetch_text = fetch_text or usgs_products.default_fetch_text
    event_id = curated["id"]
    feed_event = fetch_feed_event(event_id, fetch_text=fetch_text)
    kind = "update" if ws.get_event(event_id) is not None else "new"
    decision = TriggerDecision(kind=kind, event=feed_event, reason="bumelerze-atlas seeding")

    def _usgs_fetcher(eid: str) -> usgs_products.UsgsEventProducts:
        return usgs_products.fetch_usgs_event_products(eid, fetch_text=fetch_text)

    result = pipeline.run_pipeline(
        decision, ws, products_root=atlas_root, uploader=uploader, usgs_products_fetcher=_usgs_fetcher, force=force,
    )

    return {
        "id": event_id,
        "year": curated.get("year"),
        "place": curated.get("placeName"),
        "magnitude": curated.get("magnitude"),
        "version": result.version,
        "recomputed": result.recomputed,
        "conditioning_sources": list(result.conditioning_sources),
        "has_comparison": result.has_comparison,
        "comparison_path": str(result.comparison_path) if result.comparison_path else None,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--atlas-root", default=str(DEFAULT_ATLAS_ROOT))
    parser.add_argument("--state-path", default=str(DEFAULT_STATE_PATH))
    parser.add_argument("--summary-path", default=str(DEFAULT_SUMMARY_PATH))
    parser.add_argument(
        "--event", action="append", default=None,
        help="seed only this event id (repeatable) — default: every curated event",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="D22: force a new version even for events whose catalog params are unchanged "
        "(use after an ENGINE change — e.g. a new rupture model wired in — old versions retained)",
    )
    args = parser.parse_args()

    atlas_root = Path(args.atlas_root)
    state_path = Path(args.state_path)
    summary_path = Path(args.summary_path)

    curated_events = parse_notable_events()
    if args.event:
        wanted = set(args.event)
        curated_events = [e for e in curated_events if e["id"] in wanted]
        missing = wanted - {e["id"] for e in curated_events}
        if missing:
            raise SystemExit(f"seed_atlas: unknown --event id(s), not in notable-events.ts: {sorted(missing)}")

    ws = WorkerState.load(state_path)
    uploader = LocalOnlyUploader(log_fn=lambda msg: print(f"[uploader] {msg}"))

    summary: list[dict[str, Any]] = []
    for curated in curated_events:
        print(f"seeding {curated['id']} ({curated.get('year')}, Mw {curated.get('magnitude')}) ...")
        row = seed_event(curated, ws, atlas_root=atlas_root, uploader=uploader, force=args.force)
        summary.append(row)
        print(f"  -> v{row['version']} recomputed={row['recomputed']} "
              f"conditioning={row['conditioning_sources']} has_comparison={row['has_comparison']}")

    ws.save(state_path)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2))
    print(f"wrote {summary_path}")


if __name__ == "__main__":
    main()
