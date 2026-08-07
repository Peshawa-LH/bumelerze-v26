"""feed_watcher — USGS feed polling + trigger decisions (D9: "auto for
regional M>=3.5").

Two feeds feed this module, both USGS, both parsed the same GeoJSON shape
(`parse_usgs_geojson`):

1. The `all_hour` summary feed (polled every 60 s by `scripts/run_worker.py`)
   — cheap, low-latency, but only ever shows the last hour.
2. An `fdsnws/event` region-bbox `updatedafter` sweep (polled every 10 min)
   — the consistency net: catches magnitude/location revisions and events
   the hourly feed's window already slid past (mirrors the ingestion
   worker's own "60s poll + 10min updatedafter sweep" cadence,
   `docs/research/event-pipeline-design.md` §2, deliberately, so the two
   USGS-facing workers in this repo behave the same way to operators).

This module does no I/O itself — `fetch_fn`/the raw GeoJSON payload is
always passed in, so `evaluate_feed_events` (the actual decision logic) is
testable with hand-built payloads and no network, and `scripts/run_worker.py`
owns the actual `requests.get` calls + retry/downtime handling.

Trigger semantics (task-specified, tunable — see module-level constants):
- A qualifying event (in the region bbox AND mag >= `TRIGGER_MIN_MAGNITUDE`)
  never seen before -> `"new"`.
- A known qualifying event whose feed `updated` timestamp has not advanced
  since the version we last computed -> `"skip"` (dedup against state —
  the two feeds overlap in time and this is the intended, cheap defense
  against re-processing the same feed snapshot twice).
- A known qualifying event whose `updated` timestamp HAS advanced, but
  whose revised params (mag/lat/lon/depth) do not cross any of the three
  thresholds below -> `"skip"` (revision too small to matter for a
  ShakeMap recompute).
- A known qualifying event whose revised params cross at least one
  threshold -> `"update"`.
- An event outside the region bbox, or below the magnitude floor -> `"skip"`
  (on-demand sub-floor triggering via felt reports is a later wave, D9).

Revision thresholds (tunable, task-specified defaults):
  |ΔM| >= 0.1  OR  Δepicentral-distance >= 5 km  OR  Δdepth >= 5 km.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal, Sequence

from shake_service import config
from shake_service.worker.state import EventState, WorkerState

# ---------------------------------------------------------------------------
# Revision thresholds — tunable (module docstring; task-specified defaults)
# ---------------------------------------------------------------------------

DELTA_MAGNITUDE_THRESHOLD: float = 0.1
DELTA_LOCATION_KM_THRESHOLD: float = 5.0
DELTA_DEPTH_KM_THRESHOLD: float = 5.0

# Matches `shake_service.comparison.EARTH_RADIUS_KM` /
# `shake_service.distances._EARTH_RADIUS_KM` convention. A local haversine
# (rather than importing `comparison.py`) keeps this module's import graph
# light — it does not need openquake/scipy just to compare two lat/lons,
# and it is polled far more often (every 60 s) than anything else in the
# package.
_EARTH_RADIUS_KM = 6371.0088


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return _EARTH_RADIUS_KM * c


# ---------------------------------------------------------------------------
# Feed parsing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FeedEvent:
    """One USGS GeoJSON feature, normalized to just what the worker needs.
    NOT the app's internal event model (`event-pipeline-design.md`'s
    `events`/`event_source_records`) — that normalization belongs to the
    (separate) ingestion worker; this is a narrower, worker-local shape."""

    external_id: str
    source: str  # "usgs" for both feeds this wave
    mag: float
    lat: float
    lon: float
    depth_km: float
    place: str
    time_ms: int
    updated_ms: int


def parse_usgs_geojson(payload: dict[str, Any], *, source: str = "usgs") -> list[FeedEvent]:
    """Parse a USGS GeoJSON `FeatureCollection` (either feed — both feeds
    share the same feature shape) into `FeedEvent`s. Malformed/incomplete
    features (missing coordinates or magnitude) are skipped, not raised —
    one bad feature must never take down a whole poll cycle."""
    events: list[FeedEvent] = []
    for feature in payload.get("features", []) or []:
        props = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates")
        mag = props.get("mag")
        if not coords or len(coords) < 3 or mag is None:
            continue
        try:
            lon, lat, depth_km = float(coords[0]), float(coords[1]), float(coords[2])
            mag_f = float(mag)
        except (TypeError, ValueError):
            continue
        events.append(
            FeedEvent(
                external_id=str(feature.get("id", "")),
                source=source,
                mag=mag_f,
                lat=lat,
                lon=lon,
                depth_km=depth_km,
                place=str(props.get("place") or ""),
                time_ms=int(props.get("time") or 0),
                updated_ms=int(props.get("updated") or 0),
            )
        )
    return events


def in_region(event: FeedEvent, bbox: dict[str, float]) -> bool:
    return (
        bbox["min_lat"] <= event.lat <= bbox["max_lat"]
        and bbox["min_lon"] <= event.lon <= bbox["max_lon"]
    )


# ---------------------------------------------------------------------------
# Trigger decisions
# ---------------------------------------------------------------------------

DecisionKind = Literal["new", "update", "skip"]


@dataclass(frozen=True)
class TriggerDecision:
    kind: DecisionKind
    event: FeedEvent
    reason: str
    delta_mag: float | None = None
    delta_location_km: float | None = None
    delta_depth_km: float | None = None


def _revision_deltas(event: FeedEvent, known: EventState) -> tuple[float, float, float]:
    # round(..., 6): guards float accumulation (e.g. 4.1 - 4.0 ==
    # 0.09999999999999964 in IEEE754) from ever falsely missing an
    # at-the-threshold revision like exactly |ΔM| = 0.1.
    delta_mag = round(abs(event.mag - known.mag), 6)
    delta_location_km = round(_haversine_km(known.lat, known.lon, event.lat, event.lon), 6)
    delta_depth_km = round(abs(event.depth_km - known.depth_km), 6)
    return delta_mag, delta_location_km, delta_depth_km


def _crosses_revision_threshold(delta_mag: float, delta_location_km: float, delta_depth_km: float) -> bool:
    return (
        delta_mag >= DELTA_MAGNITUDE_THRESHOLD
        or delta_location_km >= DELTA_LOCATION_KM_THRESHOLD
        or delta_depth_km >= DELTA_DEPTH_KM_THRESHOLD
    )


def evaluate_feed_events(
    events: Sequence[FeedEvent],
    ws: WorkerState,
    *,
    min_magnitude: float = config.TRIGGER_MIN_MAGNITUDE,
    bbox: dict[str, float] = config.REGION_BBOX,
) -> list[TriggerDecision]:
    """Pure decision function: `FeedEvent`s + current worker state ->
    `TriggerDecision`s. No I/O, no state mutation (the caller — `pipeline`/
    `scripts/run_worker.py` — decides what to do with `"new"`/`"update"`
    decisions and when to persist state)."""
    decisions: list[TriggerDecision] = []
    for event in events:
        if not in_region(event, bbox):
            decisions.append(TriggerDecision(kind="skip", event=event, reason="outside region bbox"))
            continue
        if event.mag < min_magnitude:
            decisions.append(
                TriggerDecision(
                    kind="skip", event=event,
                    reason=f"magnitude {event.mag:.2f} below auto-trigger floor {min_magnitude:.2f}",
                )
            )
            continue

        known = ws.get_event(event.external_id)
        if known is None:
            decisions.append(TriggerDecision(kind="new", event=event, reason="new qualifying event"))
            continue

        if event.updated_ms <= known.last_feed_updated_ms:
            decisions.append(
                TriggerDecision(
                    kind="skip", event=event,
                    reason="feed updated timestamp not newer than last-processed (dedup against state)",
                )
            )
            continue

        delta_mag, delta_location_km, delta_depth_km = _revision_deltas(event, known)
        if _crosses_revision_threshold(delta_mag, delta_location_km, delta_depth_km):
            decisions.append(
                TriggerDecision(
                    kind="update", event=event, reason="revision crosses recompute threshold",
                    delta_mag=delta_mag, delta_location_km=delta_location_km, delta_depth_km=delta_depth_km,
                )
            )
        else:
            decisions.append(
                TriggerDecision(
                    kind="skip", event=event, reason="revision below recompute threshold",
                    delta_mag=delta_mag, delta_location_km=delta_location_km, delta_depth_km=delta_depth_km,
                )
            )
    return decisions
