"""feed_watcher — USGS + EMSC + GEOFON feed polling + trigger decisions
(owner directive 2026-08-14: any event in Iraq or with effect on
Kurdistan, no magnitude floor — see "Trigger policy" below; supersedes
D9's M>=3.5 regional floor for the auto path).

Four feeds feed this module:

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
4. A GEOFON (geofon.gfz.de) `fdsnws/event` region-bbox sweep (same 10-min
   cadence), parsed by `parse_geofon_text` — the SECOND completeness net
   (D4 named GEOFON the third catalog from the start). GEOFON serves NO
   `format=json` (verified live: 400) — its sweep speaks `format=text`,
   the pipe-delimited FDSN WS-EVENT text format every SeisComP-based
   fdsnws emits; the parser is deliberately reusable for a future SeisComP
   source (`docs/research/provider-architecture.md`). GEOFON-only
   qualifying events trigger the pipeline exactly like the others (event
   id = the gfz id).

Cross-provider dedup: state is keyed by provider event id (USGS id / EMSC
unid / GEOFON gfz id — `EventState.source` records which), so the SAME
physical earthquake seen via multiple providers has different keys. Before
declaring an unknown-id event `"new"`, `evaluate_feed_events` therefore
checks the tracked events of ALL OTHER providers for a spatial-temporal
match (`same_earthquake`, event-pipeline-design.md §2 step 3: |Δ origin
time| <= 16 s AND distance <= 100 km AND |ΔM| <= 1.5 — the same thresholds
the app's client-side merge uses, `src/features/events/merge.ts`; keep in
sync when tuning). A match -> `"skip"`: an event already tracked from any
provider must never re-trigger from another provider's record. The
canonical id follows the §2 authority order (USGS > EMSC > GEOFON) simply
because `scripts/run_worker.py` polls the providers in exactly that order
each cycle — whichever provider's record is processed first owns the state
entry, and the poll ordering makes that the highest-authority provider
that has the event at all.

This module does no I/O itself — `fetch_fn`/the raw GeoJSON payload is
always passed in, so `evaluate_feed_events` (the actual decision logic) is
testable with hand-built payloads and no network, and `scripts/run_worker.py`
owns the actual `requests.get` calls + retry/downtime handling.

Trigger policy (owner directive 2026-08-14, superseding D9's M>=3.5
regional floor: "ANY event in Iraq or with effect on Kurdistan, no
magnitude floor" — `triggers_shakemap` is the single implementation):

- An event triggers a SHAKEmap when its epicenter is inside
  `config.IRAQ_BBOX` (any magnitude — Iraq is the audience, "in Iraq" IS
  the effect), OR when its epicenter lies within
  `config.grid_extent_km(config.magnitude_band(mag))` of the Kurdistan
  `config.REGION_BBOX` — i.e. its own magnitude-scaled shaking footprint
  (the engine's grid half-extent, §4.3/G8) could reach Kurdistan. There
  is NO magnitude floor on either branch (compute-volume implication
  documented at `config.IRAQ_BBOX`).
- Events inside `config.MONITORED_BBOX` that do NOT satisfy the trigger
  policy are still DETECTED: decision kind `"catalog"` — the caller
  (`scripts/run_worker.py`) assigns them a bml id (`event_id.py`) and
  appends them to the live catalog, but no map is computed.
- Events outside `MONITORED_BBOX` entirely -> `"skip"` (not our region;
  the all_hour feed is global, so this gate does real work there).

Decision semantics per event:
- Never seen before, triggers -> `"new"`; never seen, monitored-but-not-
  triggering -> `"catalog"`; either way cross-provider dedup runs first
  (a duplicate of a tracked event -> `"skip"`, whatever its own params).
- A known event whose feed `updated` timestamp has not advanced since the
  record we last processed -> `"skip"` (dedup against state — the feeds
  overlap in time; cheap defense against re-processing one snapshot twice).
- A known event whose `updated` HAS advanced but which does not (or no
  longer does) satisfy the trigger policy -> `"skip"` (catalog-only
  revision; the live catalog is append-only first-detection records, so
  nothing is rewritten).
- A known, triggering event never yet computed (`last_version == 0` — a
  `"catalog"`-tracked event whose revised params now cross the policy,
  e.g. an upgraded magnitude widening its footprint) -> `"new"` (first
  compute), regardless of revision-delta size.
- A known, computed, triggering event whose revised params cross at least
  one threshold below -> `"update"`; below all thresholds -> `"skip"`.

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
    source: str  # "usgs" (both USGS feeds), "emsc", or "geofon" (their sweeps)
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


def _parse_iso_utc_ms(value: Any) -> int | None:
    """ISO 8601 string -> UTC epoch ms, or `None` for a missing/unparseable
    value (tolerant — the caller decides whether the field is load-bearing).
    Handles both provider flavors: EMSC's Z-suffixed strings (e.g.
    "2026-08-13T22:28:04.0Z") AND the FDSN text format's ZONE-LESS strings
    (e.g. GEOFON's "2026-08-01T20:27:43.07") — zone-less is UTC by the FDSN
    spec, hence the tzinfo-None -> UTC branch (never local time). USGS needs
    neither: its feeds carry epoch-ms numbers directly."""
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
      `_parse_iso_utc_ms`; an unusable `time` drops the feature since
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
        time_ms = _parse_iso_utc_ms(props.get("time"))
        if time_ms is None:
            continue
        updated_ms = _parse_iso_utc_ms(props.get("lastupdate"))
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


# The 13 core FDSN WS-EVENT text columns; GEOFON appends `EventType` as a
# 14th. Rows with fewer than the core 13 are malformed and skipped; extra
# trailing columns from other SeisComP deployments are tolerated (read by
# index, surplus ignored).
_FDSN_TEXT_MIN_FIELDS = 13


def parse_geofon_text(text: str) -> list[FeedEvent]:
    """Parse a GEOFON fdsnws `format=text` payload into `FeedEvent`s with
    `source="geofon"`. GEOFON serves NO `format=json` (verified live: 400),
    so this speaks the pipe-delimited FDSN WS-EVENT text format instead —
    the same format any SeisComP-based fdsnws emits, which makes this
    parser deliberately reusable for a future SeisComP source (e.g. the
    Kurdistan/Iraq data center, `docs/research/provider-architecture.md`).
    Deliberately a dumb line-by-line pipe-split — no regex over row content.
    Column order per the service's own header line:

        #EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|
         Contributor|ContributorID|MagType|Magnitude|MagAuthor|
         EventLocationName|EventType

    Format notes (mirror the app's own geofon.ts findings):
    - `#`-prefixed lines are header/comment lines, blank lines (and an
      entirely empty body — the FDSN `nodata=204` no-events response) are
      not data and not errors;
    - times are ISO 8601 WITHOUT a zone designator — UTC per the FDSN
      spec, parsed by `_parse_iso_utc_ms` (never local time);
    - the Magnitude column is EMPTY for not-yet-reviewed events (the text
      analogue of USGS/EMSC's `mag: null`) — such rows are skipped;
    - there is no provider-update timestamp column at all -> `updated_ms`
      falls back to the origin time (a GEOFON-side revision therefore
      re-triggers only via the cross-provider paths, acceptable: matched
      events are USGS/EMSC-tracked anyway).

    Same tolerant contract as the other parsers: malformed/incomplete rows
    (wrong column count, empty id, unusable time/coords/magnitude) are
    skipped, never raised."""
    events: list[FeedEvent] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split("|")
        if len(fields) < _FDSN_TEXT_MIN_FIELDS:
            continue
        external_id = fields[0].strip()
        time_ms = _parse_iso_utc_ms(fields[1].strip())
        mag_raw = fields[10].strip()
        if not external_id or time_ms is None or not mag_raw:
            continue
        try:
            lat = float(fields[2])
            lon = float(fields[3])
            depth_km = float(fields[4])
            mag = float(mag_raw)
        except ValueError:
            continue
        events.append(
            FeedEvent(
                external_id=external_id,
                source="geofon",
                mag=mag,
                lat=lat,
                lon=lon,
                depth_km=depth_km,
                place=fields[12].strip(),
                time_ms=time_ms,
                updated_ms=time_ms,
            )
        )
    return events


def in_region(event: FeedEvent, bbox: dict[str, float]) -> bool:
    return (
        bbox["min_lat"] <= event.lat <= bbox["max_lat"]
        and bbox["min_lon"] <= event.lon <= bbox["max_lon"]
    )


def distance_km_to_bbox(lat: float, lon: float, bbox: dict[str, float]) -> float:
    """Great-circle distance (km) from a point to the NEAREST point of a
    lat/lon bbox — 0.0 for a point inside it. The nearest bbox point is the
    coordinate-wise clamp of the point onto the box (exact for the lat
    axis; for the lon axis a slight approximation at these mid-latitudes,
    fine for a trigger criterion whose extents are themselves 100 km-round
    policy numbers). No date-line handling — every bbox this worker owns
    (`config.REGION_BBOX`/`IRAQ_BBOX`/`MONITORED_BBOX`) is far from ±180."""
    nearest_lat = min(max(lat, bbox["min_lat"]), bbox["max_lat"])
    nearest_lon = min(max(lon, bbox["min_lon"]), bbox["max_lon"])
    return _haversine_km(lat, lon, nearest_lat, nearest_lon)


# ---------------------------------------------------------------------------
# Trigger policy (module docstring "Trigger policy" — owner directive
# 2026-08-14: ANY event in Iraq or with effect on Kurdistan, no magnitude
# floor)
# ---------------------------------------------------------------------------


def triggers_shakemap(
    event: FeedEvent,
    *,
    iraq_bbox: dict[str, float] = config.IRAQ_BBOX,
    region_bbox: dict[str, float] = config.REGION_BBOX,
) -> tuple[bool, str]:
    """Does this event get a Bumelerze SHAKEmap? Returns `(decision,
    reason)` — the reason string is human-facing (logged into
    `TriggerDecision.reason`), stating WHICH criterion decided.

    Criterion 1 — Iraq: epicenter inside `iraq_bbox`, any magnitude.
    Criterion 2 — effect on Kurdistan: epicenter within
    `grid_extent_km(band(mag))` of `region_bbox` — the event's own
    magnitude-scaled shaking-footprint radius (the same §4.3/G8 grid
    half-extent the engine would map it with: 100/200/300 km for
    small/moderate/major), measured as distance-to-bbox. An M7.5 in
    eastern Turkey 250 km out reaches (300 km extent); an M5 in central
    Iran 400 km out does not (200 km extent). Note criterion 2 subsumes
    "inside the region bbox" (distance 0), so Kurdistan epicenters pass
    it at any magnitude too — criterion 1 exists for the REST of Iraq,
    where no distance argument is needed at all."""
    if in_region(event, iraq_bbox):
        return True, "epicenter in Iraq"
    extent_km = config.grid_extent_km(config.magnitude_band(event.mag))
    distance_km = distance_km_to_bbox(event.lat, event.lon, region_bbox)
    if distance_km <= extent_km:
        return True, (
            f"shaking footprint reaches Kurdistan ({distance_km:.0f} km from region, "
            f"extent {extent_km:.0f} km at M{event.mag:.1f})"
        )
    return False, (
        f"no effect on Kurdistan ({distance_km:.0f} km from region exceeds "
        f"{extent_km:.0f} km extent at M{event.mag:.1f}) and not in Iraq"
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
    """The already-tracked `EventState` from ANY OTHER provider that is the
    same physical earthquake as `event` (per `same_earthquake`), or `None`.
    Provider-agnostic by construction — the only per-provider knowledge is
    `known.source != event.source`, so a third (or fourth) provider joins
    this check with zero changes here. Called only for events whose own
    (provider, id) key is unknown to state — the guard that stops an event
    tracked from one provider re-triggering from another provider's record
    (module docstring). Ties (multiple
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

# `"catalog"`: a newly detected canonical event (inside MONITORED_BBOX,
# post-cross-provider-dedup) that the trigger policy did NOT select for a
# SHAKEmap — the caller records it (bml id + live-catalog append) but runs
# no pipeline. `"new"`/`"update"`/`"skip"` keep their existing meanings.
DecisionKind = Literal["new", "update", "skip", "catalog"]


@dataclass(frozen=True)
class TriggerDecision:
    kind: DecisionKind
    event: FeedEvent
    reason: str
    delta_mag: float | None = None
    delta_location_km: float | None = None
    delta_depth_km: float | None = None
    # For cross-provider-duplicate `"skip"`s: the tracked EventState this
    # record matched, so the caller can record the new provider's id into
    # that entry's `provider_aliases` (a mutation this pure function
    # deliberately does not perform itself).
    cross_match: EventState | None = None


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
    monitored_bbox: dict[str, float] = config.MONITORED_BBOX,
    iraq_bbox: dict[str, float] = config.IRAQ_BBOX,
    region_bbox: dict[str, float] = config.REGION_BBOX,
) -> list[TriggerDecision]:
    """Pure decision function: `FeedEvent`s + current worker state ->
    `TriggerDecision`s. No I/O, no state mutation (the caller — `pipeline`/
    `scripts/run_worker.py` — decides what to do with `"new"`/`"update"`/
    `"catalog"` decisions, records aliases from `"skip"`s' `cross_match`,
    and controls when state is persisted). Full decision semantics: module
    docstring "Trigger policy"."""
    decisions: list[TriggerDecision] = []
    for event in events:
        # Detection-domain gate first: outside MONITORED_BBOX the event is
        # neither mapped nor cataloged (the global all_hour feed carries
        # the whole planet; the fdsnws sweeps already query this box).
        if not in_region(event, monitored_bbox):
            decisions.append(
                TriggerDecision(kind="skip", event=event, reason="outside monitored bbox")
            )
            continue

        triggers, trigger_reason = triggers_shakemap(
            event, iraq_bbox=iraq_bbox, region_bbox=region_bbox
        )

        known = ws.get_event(event.external_id)
        if known is None:
            # Unknown (provider, id) key — but possibly the SAME physical
            # earthquake already tracked under another provider's id
            # (module docstring "Cross-provider dedup"). An event tracked
            # from any provider must never re-trigger — or re-catalog —
            # from another provider's record.
            cross = find_cross_provider_match(event, ws)
            if cross is not None:
                decisions.append(
                    TriggerDecision(
                        kind="skip", event=event,
                        reason=(
                            f"cross-provider duplicate of tracked event "
                            f"{cross.source}:{cross.external_id} (dedup §2)"
                        ),
                        cross_match=cross,
                    )
                )
                continue
            if triggers:
                decisions.append(
                    TriggerDecision(kind="new", event=event, reason=f"new event: {trigger_reason}")
                )
            else:
                # Detected canonical event, no map: catalog-only (the
                # caller assigns its bml id + live-catalog line).
                decisions.append(
                    TriggerDecision(
                        kind="catalog", event=event,
                        reason=f"detected, catalog-only: {trigger_reason}",
                    )
                )
            continue

        if event.updated_ms <= known.last_feed_updated_ms:
            decisions.append(
                TriggerDecision(
                    kind="skip", event=event,
                    reason="feed updated timestamp not newer than last-processed (dedup against state)",
                )
            )
            continue

        if not triggers:
            # A revision of a tracked event that does not (or no longer
            # does) satisfy the policy: nothing to compute, nothing to
            # rewrite (the live catalog is append-only first detections).
            decisions.append(
                TriggerDecision(
                    kind="skip", event=event, reason=f"revision, catalog-only: {trigger_reason}",
                )
            )
            continue

        if known.last_version == 0:
            # Tracked as catalog-only at first detection, but this revision
            # crosses the trigger policy (e.g. an upgraded magnitude whose
            # footprint now reaches Kurdistan): FIRST compute — revision-
            # delta thresholds are recompute economics and don't apply to
            # an event that has never been computed at all.
            decisions.append(
                TriggerDecision(
                    kind="new", event=event,
                    reason=f"tracked catalog-only event now triggers: {trigger_reason}",
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
