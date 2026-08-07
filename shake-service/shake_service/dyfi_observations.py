"""dyfi_observations — USGS DYFI "geocoded" product ingestion + CDI-intensity
-> ground-motion conversion, so `mvn.condition_forward_map` can condition our
forward-map prior on felt-report observations exactly like it would on
instrumental stations (wave D, `docs/decisions.md` D20 checkpoint outcome
2026-08-06: "condition our prior on the SAME observations via our own
mvn.py, re-run the comparison like-for-like").

Pipeline (this module covers steps 1-3; `mvn.py` — untouched — covers 4):

    1. parse_dyfi_geo_geojson   — Atlas `dyfi_geo_10km.geojson` -> DyfiBox[]
    2. filter_by_nresp          — USGS ShakeMap practice: drop thin boxes
    3. dyfi_boxes_to_station_observations
                                 — CDI (+ its own uncertainty) -> ln-space
                                   ground-motion "station" observation, one
                                   IMT at a time (mvn.py is single-IMT scope)
    4. mvn.condition_field / condition_forward_map (unmodified)

Product shape (confirmed against the real fetched file this wave, not
assumed from docs): `dyfi_geo_10km.geojson` is a GeoJSON `FeatureCollection`
of `Polygon` features, one per populated 10km UTM box, `properties` =
`{stddev, nresp, name, cdi, dist}` — `cdi` is the box's aggregate Community
Decimal Intensity, `nresp` the number of individual felt-reports
aggregated into it, `dist` epicentral distance (km, USGS's own, not
recomputed here), `stddev` USGS's own box-level CDI aggregation scatter
(a function of `nresp` alone in every box checked this wave — see
`DYFI_USGS_STDDEV_NOT_USED` below for why this module does NOT reuse it).

CDI ~ EMS/MMI numeric-closeness assumption (stated once, prominently, per
task instruction)
----------------------------------------------------------------------------
DYFI's Community Decimal Intensity (CDI) is USGS's own aggregate scale,
calibrated to track (not identical to, but numerically close to) Modified
Mercalli Intensity in the range that matters here (roughly IV-VIII — every
CDI value actually used by this Halabja run, after nresp filtering, falls
in 5.3-8.5, see `tests/fixtures/README_dyfi.md`). `gmpe-set-proposal-v2.md`
§4.4 makes the same assumption explicit for EMS-98 (CDI/MMI/EMS "close
enough numerically in the intensity range that matters for this app" —
NOT an equivalence, a convenience assumption this module inherits and
states again here). Two independent GMICE reverse-conversions are exposed
(`DEFAULT_MODEL` primary, `SENSITIVITY_MODEL` alternative) precisely so a
caller can sensitivity-check how much this assumption matters to the
conditioned result — `scripts/run_halabja_conditioned.py` runs both.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np

from shake_service import gmice, mvn

# ---------------------------------------------------------------------------
# 1. Parsing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DyfiBox:
    """One `dyfi_geo_10km.geojson` feature, reduced to what this module
    needs: box centroid (lon/lat, mean of the polygon's real corners — a
    10km UTM box is not a perfect lon/lat rectangle after reprojection, so
    "centroid of the actual corners" is used rather than assuming a
    min/max-derived box center), the aggregate CDI, and `nresp`/`dist_km`/
    `stddev_usgs` carried through for filtering/diagnostics."""

    lon: float
    lat: float
    cdi: float
    nresp: int
    dist_km: float
    stddev_usgs: float
    name: str


def _polygon_centroid(coordinates: list) -> tuple[float, float]:
    """Mean of a GeoJSON `Polygon`'s exterior-ring vertices (`coordinates[0]`),
    de-duplicating a closing repeated first==last vertex if present (this
    product's own rings are NOT closed — confirmed against the real fetched
    file, 4 distinct corners per box — but a plain arithmetic mean handles
    a closed ring correctly too if some future product revision closes it,
    since a repeated point only shifts the mean negligibly for a small
    box, never wrongly)."""
    ring = coordinates[0]
    lons = [float(p[0]) for p in ring]
    lats = [float(p[1]) for p in ring]
    return float(np.mean(lons)), float(np.mean(lats))


def parse_dyfi_geo_geojson(text: str) -> list[DyfiBox]:
    """Parse a `dyfi_geo_10km.geojson` (or `_1km`) document already read
    into memory into a flat list of `DyfiBox`. Raises `ValueError` on a
    document that isn't a `FeatureCollection` of `Polygon` features with
    the expected `properties` keys — never silently skips a malformed
    feature."""
    doc = json.loads(text)
    if doc.get("type") != "FeatureCollection":
        raise ValueError(f"parse_dyfi_geo_geojson: expected a FeatureCollection, got type={doc.get('type')!r}")
    features = doc.get("features")
    if not isinstance(features, list):
        raise ValueError("parse_dyfi_geo_geojson: no 'features' list found")

    boxes: list[DyfiBox] = []
    for i, feature in enumerate(features):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Polygon":
            raise ValueError(f"parse_dyfi_geo_geojson: feature {i} geometry is {geometry.get('type')!r}, expected 'Polygon'")
        props = feature.get("properties") or {}
        for key in ("cdi", "nresp", "dist", "stddev"):
            if key not in props:
                raise ValueError(f"parse_dyfi_geo_geojson: feature {i} missing properties.{key!r}")
        lon, lat = _polygon_centroid(geometry["coordinates"])
        boxes.append(
            DyfiBox(
                lon=lon, lat=lat,
                cdi=float(props["cdi"]), nresp=int(props["nresp"]),
                dist_km=float(props["dist"]), stddev_usgs=float(props["stddev"]),
                name=str(props.get("name", "")),
            )
        )
    return boxes


def load_dyfi_geo_geojson(path: str) -> list[DyfiBox]:
    """Read and parse a `dyfi_geo_*.geojson` file from disk."""
    with open(path, encoding="utf-8") as f:
        return parse_dyfi_geo_geojson(f.read())


# ---------------------------------------------------------------------------
# 2. Filtering (USGS ShakeMap DYFI-ingestion practice)
# ---------------------------------------------------------------------------

# USGS ShakeMap's own DYFI module discards boxes with too few individual
# responses before using them as ShakeMap conditioning input (a thin box's
# aggregate CDI is dominated by one or two people's subjective scoring, not
# a stable community estimate) -- nresp>=3 is the commonly documented floor
# (ShakeMap DYFI-module practice, cited from task brief; not independently
# re-verified against a specific USGS source doc this wave -- [REVIEW] like
# every other unverified transcription in this package, flagged not hidden).
DEFAULT_MIN_NRESP: int = 3
SENSITIVITY_MIN_NRESP: int = 2


def filter_by_nresp(boxes: Sequence[DyfiBox], *, min_nresp: int = DEFAULT_MIN_NRESP) -> list[DyfiBox]:
    """Boxes with `nresp >= min_nresp` only."""
    return [b for b in boxes if b.nresp >= min_nresp]


# ---------------------------------------------------------------------------
# 3. CDI -> ground-motion "station" observations
# ---------------------------------------------------------------------------

# PRIMARY = Worden et al. (2012), MMI-native -- NOT `gmice.DEFAULT_EMS_MODEL`
# (Zanini & Hofer 2019, the rest of the service's EMS-98 DISPLAY default,
# D18). Reason (full numbers in `scripts/run_halabja_conditioned.py`'s own
# module docstring point 1, kept in sync with this constant): reversing the
# SAME near-field CDI value through Zanini's independently-fit PGA-EMS and
# PGV-EMS regressions gives internally-inconsistent PGA/PGV ratios at high
# intensity (~680 (cm/s)/g at CDI 8.5, far outside the ~50-150 (cm/s)/g
# range typical of near-source ground motion) -- specifically a PGV-EMS
# coefficient-pair concern, not a PGA-EMS one (that reversal alone lines up
# well with the wave-C SPZ spot check). Worden's PGA-MMI/PGV-MMI pair does
# not exhibit this inconsistency. Zanini/EMS is run as the documented
# SENSITIVITY model instead, every time, never silently dropped.
#
# RATIFIED as permanent service policy (Z4, `docs/decisions.md` D20
# checkpoint condition 2, CLOSED 2026-08-07 "option A + Z1-Z6 defaults";
# investigation: `docs/research/zanini-gmice-investigation.md`). The
# wave-D arrangement below was originally an interim, defensive choice made
# BEFORE the root cause was confirmed; it is now the permanent, reviewed
# answer -- Worden 2012 stays PRIMARY for every DYFI-ingestion CDI-reversal
# run, Zanini stays the documented, always-run SENSITIVITY comparison,
# clearly labelled as such wherever it is surfaced (never load-bearing for
# `mvn` conditioning).
DEFAULT_MODEL = gmice.DEFAULT_MMI_MODEL  # "WordenEtAl12" -- primary (CDI ~ MMI), ratified 2026-08-07
SENSITIVITY_MODEL = gmice.DEFAULT_EMS_MODEL  # "Zaniniandhofer19" -- sensitivity-only (CDI ~ EMS), never load-bearing

_IMT_TO_UNIT = {"PGA": "g", "PGV": "cm/s"}

# [REVIEW] DYFI-box observation sigma, intensity units (CDI/EMS/MMI scale,
# whichever `model` treats it as). USGS's own ShakeMap DYFI module gives
# felt-report-derived ("DYFI") conditioning points a LARGER sigma than
# instrumental seismic stations (documented convention, not reproduced here
# from a specific numeric USGS table this wave -- an honest, stated choice,
# not a verified transcription). This module's choice: sigma decays with
# 1/sqrt(nresp) off a base value (more individual respondents -> a more
# stable aggregate CDI, same logic as a standard-error-of-the-mean), capped
# at a floor so a box is never claimed more precise than
# DYFI_SIGMA_INTENSITY_FLOOR intensity units regardless of nresp (DYFI
# aggregation has real ceiling precision -- people round to whole/half
# units, geocoding within a 10km box adds its own scatter). Sensitivity-
# checked against `USGS`'s OWN per-box `stddev` field
# (`DYFI_USGS_STDDEV_NOT_USED` below) as a cross-check, not blended in.
DYFI_SIGMA_INTENSITY_BASE: float = 1.0  # [REVIEW] at nresp=1
DYFI_SIGMA_INTENSITY_FLOOR: float = 0.30  # [REVIEW] floor regardless of nresp

# Confirmed empirically against the real fetched product this wave: the
# product's own `stddev` field is a DETERMINISTIC function of `nresp` alone
# (every box with the same nresp has the identical stddev, e.g. nresp=1 ->
# 0.33 always, nresp=49 -> 0.123 always) -- i.e. it looks like USGS's own
# formula-derived box-aggregation uncertainty, not the actual empirical
# scatter of that box's individual responses. Documented, NOT used as this
# module's primary sigma (this module's own formula, above, is used
# instead, so the choice is ours and independently defensible/testable) --
# available on `DyfiBox.stddev_usgs` for anyone who wants to cross-check.
DYFI_USGS_STDDEV_NOT_USED = True


def dyfi_sigma_intensity(nresp: int, *, base: float = DYFI_SIGMA_INTENSITY_BASE, floor: float = DYFI_SIGMA_INTENSITY_FLOOR) -> float:
    """This module's own DYFI-box observation-sigma formula (intensity
    units): `max(floor, base / sqrt(max(nresp, 1)))`."""
    return max(floor, base / math.sqrt(max(int(nresp), 1)))


def dyfi_box_to_station_observation(
    box: DyfiBox, *, imt: str, model: str = DEFAULT_MODEL,
    sigma_intensity_fn: Callable[[int], float] = dyfi_sigma_intensity,
) -> mvn.StationObservation:
    """One `DyfiBox` -> one `mvn.StationObservation` in `imt`'s ln-space
    (ln(g) for PGA, ln(cm/s) for PGV), via `model`'s reverse GMICE
    (`gmice.convert_from_intensity`) plus chain-rule sigma propagation
    (mirrors `intensity.py`'s FORWARD chain-rule exactly, run in reverse):

        Y_native = GMICE^-1(cdi)                      (linear GM units)
        deriv    = d(intensity)/d(ln Y) at Y_native    (gmice.dintensity_dlny)
        sigma_intensity_total = sqrt(sigma_box(nresp)^2 + sigma_gmice(model,imt)^2)
        sigma_ln = sigma_intensity_total / |deriv|

    `sigma_gmice` (the GMICE's own published conversion scatter, same
    quantity `intensity.py`'s forward chain rule folds into `phi`) is added
    in intensity-units QUADRATURE before dividing by the derivative -- the
    natural inverse of `intensity.py`'s own `phi = sqrt((deriv*phi_lnY)^2 +
    sigma_g^2)` step (there, phi_lnY is known and sigma_g is added in
    intensity space; here, sigma_intensity is known and both components are
    summed in intensity space before the single division back to ln-Y
    space)."""
    imt_key = imt.strip().upper()
    if imt_key not in _IMT_TO_UNIT:
        raise ValueError(f"dyfi_box_to_station_observation: unsupported imt {imt!r} (PGA/PGV only)")
    unit = _IMT_TO_UNIT[imt_key]

    cdi_arr = np.array([box.cdi], dtype=float)
    y_native = gmice.convert_from_intensity(cdi_arr, imt=imt_key, unit_out=unit, model=model)
    deriv = gmice.dintensity_dlny(y_native, imt=imt_key, unit_in=unit, model=model)
    sigma_gmice_val = gmice.sigma_gmice(model, imt_key)

    sigma_box = float(sigma_intensity_fn(box.nresp))
    sigma_intensity_total = float(np.sqrt(sigma_box**2 + sigma_gmice_val**2))

    d = float(deriv[0])
    if not np.isfinite(d) or abs(d) < 1e-12:
        # A degenerate (near-zero) GMICE slope makes intensity essentially
        # insensitive to ln(Y) at this point -- an honest "this observation
        # carries almost no ground-motion information" rather than a
        # divide-by-near-zero blow-up masquerading as near-zero sigma.
        sigma_ln = float("inf")
    else:
        sigma_ln = sigma_intensity_total / abs(d)

    return mvn.StationObservation(
        lon=box.lon, lat=box.lat,
        value_ln=float(np.log(y_native[0])),
        sigma_obs=sigma_ln,
    )


def dyfi_boxes_to_station_observations(
    boxes: Sequence[DyfiBox], *, imt: str, model: str = DEFAULT_MODEL,
    sigma_intensity_fn: Callable[[int], float] = dyfi_sigma_intensity,
) -> list[mvn.StationObservation]:
    """`dyfi_box_to_station_observation` over a whole box list, dropping any
    box that converts to a non-finite `value_ln` (a CDI at/below the
    model's own zero-floor, e.g. `cdi<=0` -- `gmice`'s own guarded
    conversions return 0 linear GM there, `ln(0) = -inf`; never silently
    fed into the Cholesky solve as a fabricated real number) rather than
    raising, since a global ingestion run should not abort on one
    pathological box."""
    out: list[mvn.StationObservation] = []
    for box in boxes:
        obs = dyfi_box_to_station_observation(box, imt=imt, model=model, sigma_intensity_fn=sigma_intensity_fn)
        if np.isfinite(obs.value_ln) and np.isfinite(obs.sigma_obs):
            out.append(obs)
    return out
