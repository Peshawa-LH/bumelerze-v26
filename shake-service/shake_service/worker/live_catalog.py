"""live_catalog — the from-launch internal Bumelerze catalog, grown live.

`shake-service/regional-catalog/live-catalog.jsonl` is the append-only
continuation of the compiled archival catalog
(`regional-catalog/bumelerze-catalog.sqlite`, built once by
`scripts/build_regional_catalog.py` from five historical sources): from
the moment the worker runs, EVERY newly detected canonical event — any
magnitude, post-cross-provider-dedup, whether or not the trigger policy
computed a map for it — is appended here as one JSON line, carrying the
bml id assigned at first detection (`shake_service/event_id.py`).

Contract (kept deliberately boring):

- **Append-only.** One line per canonical event, written exactly once, at
  first detection. Later parameter revisions, recomputes, alias additions
  and review flips do NOT rewrite the line — each line is the
  first-detection record, and the worker state file remains the richer,
  current view of a tracked event. Merging revised params properly is the
  job of the next full catalog rebuild / backend sync (below), not of
  in-place edits to a log file.
- **JSONL, one object per line** — trivially greppable/`jq`-able for a
  solo operator, safe to append to atomically enough for a single-writer
  worker (one small `write` + flush per event), and mergeable into the
  sqlite build by a future `build_regional_catalog.py` run as just
  another (highest-recency) source: the line shape mirrors the build
  script's normalized record (time/lat/lon/depth/mag + provenance), plus
  the already-assigned `bumelerze_id`, which a rebuild MUST carry through
  verbatim (ids are immutable — event_id.py).
- **Future backend sync:** when Supabase goes live, these lines are the
  worker-side truth to reconcile `public.events.bumelerze_id` against
  (migration 0008); the file keeps being written regardless, as the
  worker-local audit trail.
"""

from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path
from typing import Any

LIVE_CATALOG_FILE_NAME = "live-catalog.jsonl"


def _iso_utc_ms(time_ms: int) -> str:
    dt = _dt.datetime.fromtimestamp(time_ms / 1000.0, tz=_dt.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def append_to_live_catalog(
    path: str | Path,
    event: Any,
    *,
    bumelerze_id: str,
    triggered: bool,
    detected_at_iso: str,
) -> dict[str, Any]:
    """Append one first-detection line for `event` (a
    `feed_watcher.FeedEvent`, duck-typed) and return the dict written.
    `triggered` records whether the trigger policy selected the event for
    a SHAKEmap at detection time (provenance only — a later revision can
    still promote a catalog-only event; the line is not rewritten when it
    does, per the module contract). Creates the parent directory on first
    use. The caller is responsible for calling this exactly once per
    canonical event (run_worker's `"new"`/`"catalog"` decision handling)."""
    record = {
        "bumelerze_id": bumelerze_id,
        "provider": event.source,
        "provider_id": event.external_id,
        "time": _iso_utc_ms(event.time_ms),
        "lat": event.lat,
        "lon": event.lon,
        "depth_km": event.depth_km,
        "mag": event.mag,
        "place": event.place,
        "detected_at": detected_at_iso,
        "triggered": triggered,
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record
