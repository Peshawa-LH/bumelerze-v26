"""feed_watcher — USGS + EMSC feed polling + trigger decisions (D9: "auto
for regional M>=3.5").

Three feeds feed this module:

1. The USGS `all_hour` summary feed (polled every 60 s by
   `scripts/run_worker.py`) — cheap, low-latency, but only ever shows the
   last hour.
2. A USGS `fdsnws/event` region-bbox `updatedafter` sweep (polled every
   10 min) — the consistency net: catches magnitude/location revisions and
   events the hourly feed's window already slid past (mirrors the ingestion
   worker's own "60s poll + 10min updatedafter sweep" cadence,
   `docs/research/event-pipeline-design.md` §2, deliberately, so the two
   USGS-facing workers in this repo behave the same way to operators).
3. An EMSC seismicportal.eu `fdsnws/event` region-bbox sweep (same 10-min
   cadence), parsed by `parse_emsc_geojson` — the COMPLETENESS net. Why it
   exists — a real missed earthquake: 2026-08-13 22:28 UTC, M4.0 mb,
   Iran–Iraq border region, present in EMSC's catalog, absent from USGS
   entirely (below NEIC's ~M4.5 regional completeness) — above the M>=3.5
   trigger floor, yet the USGS-only watcher never saw it and no Bumelerze
   SHAKEmap was produced. EMSC-only qualifying events now trigger the
   pipeline exactly like USGS ones (event id = the EMSC `unid`).

Cross-provider dedup: state is keyed by provider event id (USGS id / EMSC
unid — `EventState.source` records which), so the SAME physical earthquake
seen via both providers has two different keys. Before declaring an
unknown-id event `"new"`, `evaluate_feed_events` therefore checks the
tracked events of the OTHER provider for a spatial-temporal match
(`same_earthquake`, event-pipeline-design.md §2 step 3: |Δ origin time| <=
16 s AND distance <= 100 km AND |ΔM| <= 1.5 — the same thresholds the app's
client-side merge uses, `src/features/events/merge.ts`; keep in sync when
tuning). A match -> `"skip"`: an event already tracked from USGS must never
re-trigger from its EMSC record, and vice versa. USGS is the canonical id
when both are seen (§2 authority order) simply because `scripts/
run_worker.py` polls USGS first each cycle — whichever provider's record is
processed first owns the state entry, and in practice that is USGS for any
event USGS has at all.

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

import datetime as _dt
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

# ---------------------------------------------------------------------------
# Cross-provider dedup thresholds — event-pipeline-design.md §2 step 3
# (tunable; mirrored client-side in src/features/events/config.ts — keep in
# sync when tuning)
# ---------------------------------------------------------------------------

DEDUP_MAX_TIME_DELTA_MS: int = 16_000
DEDUP_MAX_DISTANCE_KM: float = 100.0
DEDUP_MAX_MAG_DELTA: float = 1.5

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
    source: str  # "usgs" (both USGS feeds) or "emsc" (the EMSC sweep)
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


def _parse_emsc_iso_ms(value: Any) -> int | None:
    """EMSC timestamps are ISO 8601 strings (e.g. "2026-08-13T22:28:04.0Z"),
    unlike USGS's epoch-ms numbers. Returns UTC epoch ms, or `None` for a
    missing/unparseable value (tolerant — the caller decides whether the
    field is load-bearing)."""
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_dt.timezone.utc)
    return int(parsed.timestamp() * 1000)


def parse_emsc_geojson(payload: dict[str, Any]) -> list[FeedEvent]:
    """Parse an EMSC seismicportal.eu fdsnws GeoJSON `FeatureCollection`
    (`format=json`) into `FeedEvent`s with `source="emsc"`. EMSC rides the
    same FDSN WS-EVENT spec as USGS but its `properties` shape differs
    (mirrors the app's own emsc-schema.ts findings):

    - the provider event id is `unid` (-> `external_id`, and the pipeline's
      event id for an EMSC-only trigger);
    - `lat`/`lon`/`depth` are repeated directly in `properties` (read from
      there — `geometry` is not required at all);
    - `time`/`lastupdate` are ISO 8601 strings, not epoch ms (parsed by
      `_parse_emsc_iso_ms`; an unusable `time` drops the feature since
      origin time is load-bearing for cross-provider dedup, an unusable
      `lastupdate` falls back to the origin time).

    Same tolerant contract as `parse_usgs_geojson`: malformed/incomplete
    features (missing unid/coords/magnitude/time) are skipped, never raised."""
    events: list[FeedEvent] = []
    for feature in payload.get("features", []) or []:
        props = feature.get("properties") or {}
        unid = props.get("unid")
        mag = props.get("mag")
        lat, lon, depth = props.get("lat"), props.get("lon"), props.get("depth")
        if not unid or mag is None or lat is None or lon is None or depth is None:
            continue
        time_ms = _parse_emsc_iso_ms(props.get("time"))
        if time_ms is None:
            continue
        updated_ms = _parse_emsc_iso_ms(props.get("lastupdate"))
        try:
            lat_f, lon_f, depth_f, mag_f = float(lat), float(lon), float(depth), float(mag)
        except (TypeError, ValueError):
            continue
        events.append(
            FeedEvent(
                external_id=str(unid),
                source="emsc",
                mag=mag_f,
                lat=lat_f,
                lon=lon_f,
                depth_km=depth_f,
                place=str(props.get("flynn_region") or ""),
                time_ms=time_ms,
                updated_ms=updated_ms if updated_ms is not None else time_ms,
            )
        )
    return events


def in_region(event: FeedEvent, bbox: dict[str, float]) -> bool:
    return (
        bbox["min_lat"] <= event.lat <= bbox["max_lat"]
        and bbox["min_lon"] <= event.lon <= bbox["max_lon"]
    )


# ---------------------------------------------------------------------------
# Cross-provider dedup (event-pipeline-design.md §2 step 3)
# ---------------------------------------------------------------------------


def same_earthquake(
    *,
    time_ms_a: int, lat_a: float, lon_a: float, mag_a: float,
    time_ms_b: int, lat_b: float, lon_b: float, mag_b: float,
) -> bool:
    """§2 step-3 spatial-temporal match: two provider records describe the
    same physical earthquake when |Δ origin time| <= 16 s AND epicentral
    distance <= 100 km AND |ΔM| <= 1.5 (all inclusive; the |ΔM| guard
    protects against associating a foreshock's record with a mainshock).
    Both magnitudes always exist in this worker's `FeedEvent`/`EventState`
    shapes (magnitude-less features are dropped at parse time), so the §2
    "when both present" qualifier never bites here. The shared helper for
    the watcher's cross-provider dedup — same rules, same thresholds, as
    the app's client-side merge (src/features/events/merge.ts)."""
    if abs(time_ms_a - time_ms_b) > DEDUP_MAX_TIME_DELTA_MS:
        return False
    if abs(mag_a - mag_b) > DEDUP_MAX_MAG_DELTA:
        return False
    return _haversine_km(lat_a, lon_a, lat_b, lon_b) <= DEDUP_MAX_DISTANCE_KM


def find_cross_provider_match(event: FeedEvent, ws: WorkerState) -> EventState | None:
    """The already-tracked `EventState` from the OTHER provider that is the
    same physical earthquake as `event` (per `same_earthquake`), or `None`.
    Called only for events whose own (provider, id) key is unknown to state
    — the guard that stops an event tracked from USGS re-triggering from its
    EMSC record and vice versa (module docstring). Ties (multiple
    candidates) resolve to the closest in (|Δt|, distance) lexicographic
    order, §2 step 3. Tracked entries with `origin_time_ms == 0` (unknown —
    pre-upgrade state files) never match: with no origin time there is no
    defensible time criterion, and those legacy entries are by definition
    old events the recent-origin EMSC sweep can never return anyway."""
    candidates: list[tuple[float, float, EventState]] = []
    for known in ws.events.values():
        if known.source == event.source or known.origin_time_ms == 0:
            continue
        if same_earthquake(
            time_ms_a=event.time_ms, lat_a=event.lat, lon_a=event.lon, mag_a=event.mag,
            time_ms_b=known.origin_time_ms, lat_b=known.lat, lon_b=known.lon, mag_b=known.mag,
        ):
            delta_t = abs(event.time_ms - known.origin_time_ms)
            distance = _haversine_km(event.lat, event.lon, known.lat, known.lon)
            candidates.append((delta_t, distance, known))
    if not candidates:
        return None
    return min(candidates, key=lambda c: (c[0], c[1]))[2]


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
            # Unknown (provider, id) key — but possibly the SAME physical
            # earthquake already tracked under the other provider's id
            # (module docstring "Cross-provider dedup"). A tracked-from-USGS
            # event must never re-trigger from its EMSC record, nor vice
            # versa.
            cross = find_cross_provider_match(event, ws)
            if cross is not None:
                decisions.append(
                    TriggerDecision(
                        kind="skip", event=event,
                        reason=(
                            f"cross-provider duplicate of tracked event "
                            f"{cross.source}:{cross.external_id} (dedup §2)"
                        ),
                    )
                )
                continue
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
