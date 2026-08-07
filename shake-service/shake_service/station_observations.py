"""station_observations — USGS `stationlist.json` ingestion: REAL
instrumental (seismic) stations only, as `mvn.StationObservation`s for
conditioning (D21 "dual backend" wave, `docs/decisions.md`: "USGS station
data (stationlist.json) joins DYFI as mvn conditioning observations when
available").

`stationlist.json` (a shakemap product content — same USGS event-detail
`contents` machinery `dyfi_observations.py`'s sibling product uses, via
`worker/usgs_products.py`/`scripts/run_validation.py`'s own fetch code) is a
GeoJSON `FeatureCollection` mixing TWO kinds of "station" (confirmed against
real fetched fixtures this wave, `.cache/validation/*/stationlist.json`):
real instrumental seismic-network readings (`properties.source` a real
network code, e.g. `"TU"`; `properties.station_type == "seismic"`) and
USGS's own DYFI-as-station rows (`properties.source == "DYFI"`,
`properties.station_type == "macroseismic"` — one point per aggregated 10km
box, the SAME underlying felt-report population `dyfi_observations.py`
already ingests from the dedicated `dyfi_geo_10km.geojson` product, just
re-packaged into the stationlist shape, `pga`/`pgv` reported as the literal
STRING `"null"`, never a real reading).

Dedup rule (documented, not incidental)
----------------------------------------------------------------------------
This module DROPS every DYFI-as-station feature outright — a row is
considered DYFI-derived (and skipped) if EITHER `properties.source` is
`"DYFI"` (case-insensitive) OR `properties.station_type` is `"macroseismic"`
(both fields independently mark the same real-world distinction in every
fixture checked this wave; OR'd together so a future USGS payload carrying
only one of the two still gets caught, never silently admitted as if it
were instrumental). Re-admitting the same felt-report population a second
time via `stationlist.json`'s DYFI rows — on top of `dyfi_observations.py`'s
own dedicated, purpose-built ingestion of the SAME underlying data
(nresp filtering, this service's own sigma model, GMICE reverse-conversion)
— would double-count every felt report that fed both products. Only
`source != "DYFI"` AND `station_type != "macroseismic"` rows reach this
module's output: real instrumental readings, never felt reports.

Instrumental sigma (`INSTRUMENT_SIGMA_LN_PGA`/`_PGV`) [REVIEW]
----------------------------------------------------------------------------
USGS ShakeMap's own convention gives instrumental station readings a much
SMALLER conditioning sigma than DYFI-derived (GMICE-reversed) observations —
a real seismometer reading is a direct, high-precision measurement of the
target IMT itself, with no reverse-GMICE step and no felt-report
aggregation scatter anywhere in the chain (contrast `dyfi_observations.py`'s
propagated sigma, which combines a per-box CDI scatter term AND the
GMICE's own ~0.66-0.70 intensity-unit conversion scatter — `gmice.py`'s
`WORDEN_SIGMA_TABLE`/`ZANINI_SIGMA_TABLE` — before dividing by the local
intensity/ground-motion slope, routinely landing well above a few tenths
of a ln unit). This module's choice is NOT derived from that chain-rule
propagation at all — there is no intensity-to-ground-motion conversion step
for an instrumental reading, `stationlist.json` already reports it directly
in the target ground-motion units — it is a small, FIXED ln-space reading
sigma per IMT. [REVIEW]: a engineering-decided default (D14 pattern), NOT
independently re-verified against a specific USGS/ShakeMap source-code
table this wave — an honest, stated choice, not a verified transcription,
same policy as every other [REVIEW]-flagged constant in this package
(`dyfi_observations.DYFI_SIGMA_INTENSITY_BASE`, `gmice.WORDEN_SIGMA_VERIFIED`,
`mvn.JAYARAM_BAKER_2009_VERIFIED`, ...).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np

from shake_service import dyfi_observations, mvn

# [REVIEW] — see module docstring "Instrumental sigma". Deliberately smaller
# than DYFI's propagated sigma (`dyfi_observations.py`'s own module
# docstring: routinely several tenths of a ln unit or more once the GMICE
# conversion scatter is folded in).
INSTRUMENT_SIGMA_LN_PGA: float = 0.20
INSTRUMENT_SIGMA_LN_PGV: float = 0.20

# `stationlist.json`'s own unit convention (matches `scripts/run_validation.py`
# `spot_check_station`'s `_PCT_G_TO_G` local, reproduced here since this
# module owns the parse, not that script).
_PCT_G_TO_G = 1.0 / 100.0


@dataclass(frozen=True)
class StationRecord:
    """One real (non-DYFI) instrumental `stationlist.json` feature, reduced
    to what conditioning needs."""

    network: str
    code: str
    lon: float
    lat: float
    distance_km: float
    pga_g: float | None  # None when the feature carries no finite PGA reading
    pgv_cms: float | None  # None when the feature carries no finite PGV reading


def _is_dyfi_row(props: dict[str, Any]) -> bool:
    """Dedup rule (module docstring): True for a DYFI-as-station row —
    dropped by `parse_stationlist_json`, never reaches `StationRecord`."""
    source = str(props.get("source", "")).strip().upper()
    station_type = str(props.get("station_type", "")).strip().lower()
    return source == "DYFI" or station_type == "macroseismic"


def _finite_reading(value: Any) -> float | None:
    """`stationlist.json` reports a missing reading as the literal STRING
    `"null"` at least as often as an absent key (confirmed against real
    fetched fixtures this wave) — both, plus any non-finite float, normalize
    to `None` here rather than leaking a NaN/string into downstream
    arithmetic."""
    if value is None or isinstance(value, str):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def parse_stationlist_json(text: str) -> list[StationRecord]:
    """Parse a `stationlist.json` document already read into memory into
    real (non-DYFI) instrumental `StationRecord`s only — see module
    docstring's dedup rule. Raises `ValueError` on a document that isn't a
    `FeatureCollection`; an individual malformed feature is skipped, not
    raised (one bad station must never abort a whole ingestion run — same
    tolerant-parsing convention as `dyfi_observations.py`)."""
    doc = json.loads(text)
    if doc.get("type") != "FeatureCollection":
        raise ValueError(f"parse_stationlist_json: expected a FeatureCollection, got type={doc.get('type')!r}")
    features = doc.get("features")
    if not isinstance(features, list):
        raise ValueError("parse_stationlist_json: no 'features' list found")

    records: list[StationRecord] = []
    for feature in features:
        props = feature.get("properties") or {}
        if _is_dyfi_row(props):
            continue
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates")
        if not coords or len(coords) < 2:
            continue
        try:
            lon, lat = float(coords[0]), float(coords[1])
            distance_km = float(props.get("distance"))
        except (TypeError, ValueError):
            continue

        pga_raw = _finite_reading(props.get("pga"))
        pgv_raw = _finite_reading(props.get("pgv"))
        records.append(
            StationRecord(
                network=str(props.get("network", "")),
                code=str(props.get("code", "")),
                lon=lon, lat=lat, distance_km=distance_km,
                pga_g=(pga_raw * _PCT_G_TO_G) if pga_raw is not None else None,
                pgv_cms=pgv_raw,
            )
        )
    return records


def load_stationlist_json(path: str) -> list[StationRecord]:
    """Read and parse a `stationlist.json` file from disk."""
    with open(path, encoding="utf-8") as f:
        return parse_stationlist_json(f.read())


# ---------------------------------------------------------------------------
# StationRecord -> mvn.StationObservation
# ---------------------------------------------------------------------------

_IMT_FIELD: dict[str, tuple[str, float]] = {
    "PGA": ("pga_g", INSTRUMENT_SIGMA_LN_PGA),
    "PGV": ("pgv_cms", INSTRUMENT_SIGMA_LN_PGV),
}


def station_records_to_observations(
    records: Sequence[StationRecord], *, imt: str, sigma_ln: float | None = None,
) -> list[mvn.StationObservation]:
    """Real instrumental `StationRecord`s -> `mvn.StationObservation`s in
    `imt`'s ln-space, dropping any record with no finite (positive) reading
    for this IMT (common — many stations report PGA but not PGV, or vice
    versa)."""
    imt_key = imt.strip().upper()
    if imt_key not in _IMT_FIELD:
        raise ValueError(f"station_records_to_observations: unsupported imt {imt!r} (PGA/PGV only)")
    attr, default_sigma = _IMT_FIELD[imt_key]
    sigma = default_sigma if sigma_ln is None else float(sigma_ln)

    out: list[mvn.StationObservation] = []
    for record in records:
        value = getattr(record, attr)
        if value is None or not math.isfinite(value) or value <= 0:
            continue
        out.append(
            mvn.StationObservation(lon=record.lon, lat=record.lat, value_ln=float(np.log(value)), sigma_obs=sigma)
        )
    return out


# ---------------------------------------------------------------------------
# Combined observations — stations + DYFI cells, ONE in-domain policy
# ---------------------------------------------------------------------------


def combined_station_observations(
    *,
    station_records: Sequence[StationRecord],
    dyfi_boxes: Sequence[dyfi_observations.DyfiBox],
    imt: str,
    half_extent_km: float | None,
    restrict_to_domain: bool = True,
    dyfi_min_nresp: int = dyfi_observations.DEFAULT_MIN_NRESP,
    dyfi_model: str = dyfi_observations.DEFAULT_MODEL,
    station_sigma_ln: float | None = None,
) -> list[mvn.StationObservation]:
    """Real instrumental stations + filtered DYFI boxes -> ONE merged
    `mvn.StationObservation` list for `imt`, both respecting the SAME
    in-domain policy (`distance_km <= half_extent_km` — the exact rule
    `scripts/run_validation.py`'s own `select_observations` already applies
    to DYFI boxes, extended here to stations too, so both sources share one
    domain-restriction and one min-nresp policy rather than two
    independently-tuned ones). `mvn.py`'s own min-conditioning-observations
    floor (`config.MIN_CONDITIONING_OBSERVATIONS`, applied downstream by
    `conditioned_forward.condition_forward_map_on_dyfi`) then counts
    whatever this function returns, source-agnostic — exactly as it already
    counts a DYFI-only list, no separate per-source floor.

    Real stations are listed FIRST in the returned list ("stations
    first-class" — `mvn.py`'s conditioning math is order-independent, so
    this has no numeric effect, only a provenance-ordering one, kept for
    readability of any report/log that prints the raw list).
    """
    if restrict_to_domain:
        if half_extent_km is None:
            raise ValueError("combined_station_observations: restrict_to_domain=True requires half_extent_km")
        station_records = [r for r in station_records if r.distance_km <= half_extent_km]

    filtered_boxes = dyfi_observations.filter_by_nresp(dyfi_boxes, min_nresp=dyfi_min_nresp)
    if restrict_to_domain:
        filtered_boxes = [b for b in filtered_boxes if b.dist_km <= half_extent_km]  # type: ignore[union-attr]

    station_obs = station_records_to_observations(station_records, imt=imt, sigma_ln=station_sigma_ln)
    dyfi_obs = dyfi_observations.dyfi_boxes_to_station_observations(filtered_boxes, imt=imt, model=dyfi_model)
    return list(station_obs) + list(dyfi_obs)
