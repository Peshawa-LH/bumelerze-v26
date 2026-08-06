"""Distance metrics: exact geodetic Repi/Rhyp, and ps2ff-based expected
Rjb/Rrup (+variances) from point-source (epicentral) distance.

Rationale (gmpe-set-proposal-v2.md §5, §6.2): every D20 branch needs Rjb;
CY14 additionally needs Rrup (+ Rx, handled in rupture_params.py). We have
no finite-fault geometry at baseline (point-source events), so ps2ff
(Thompson & Worden 2017 — the same package USGS ShakeMap itself uses)
supplies the expected value + variance of the ratio between point distance
and finite-rupture distance, keyed by magnitude and mechanism.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from ps2ff.constants import DistType, Mechanism
from ps2ff.constants import MagScaling as Ps2ffMagScaling
from ps2ff.interpolate import PS2FF

_EARTH_RADIUS_KM = 6371.0088  # IUGG mean radius

# [REVIEW] ps2ff table-selection parameters. The proposal (§5) says
# "ps2ff IS the default" for Rjb/Rrup but does not pin an exact
# magnitude-scaling relation / aspect-ratio / seismogenic-depth-range
# combination. S14 (Somerville et al. 2014) at AR=1.0, seis 0-15 km is
# chosen here because it is the only bundled table set covering BOTH the
# reverse (R) and strike-slip (SS) mechanisms our rake policy actually
# produces (rupture_params.py), with a 0-15 km seismogenic range that is a
# closer match to the shallow (~5-20 km) Zagros seismogenic layer
# (gmpe-set-proposal.md §1) than the alternative bundled sets (HB08/WC94,
# AR=1.7, seis 0-20 km, and HB08 has no "A"/all-mechanism table). Revisit
# if Peshawa wants a different published magnitude-scaling relation.
_PS2FF_MAG_SCALING = Ps2ffMagScaling.S14
_PS2FF_AR = 1.0
_PS2FF_MIN_SEIS_DEPTH = 0
_PS2FF_MAX_SEIS_DEPTH = 15

# Minimum epicentral distance fed to ps2ff (log-distance table lookup — 0
# is undefined). A site essentially at the epicentre still needs a number.
_MIN_REPI_KM = 1e-3

_TABLE_CACHE: dict[tuple[DistType, Mechanism], PS2FF] = {}


def _table(dist_type: DistType, mechanism: Mechanism) -> PS2FF:
    key = (dist_type, mechanism)
    cached = _TABLE_CACHE.get(key)
    if cached is not None:
        return cached
    table = PS2FF.fromParams(
        dist_type=dist_type,
        mag_scaling=_PS2FF_MAG_SCALING,
        mechanism=mechanism,
        AR=_PS2FF_AR,
        min_seis_depth=_PS2FF_MIN_SEIS_DEPTH,
        max_seis_depth=_PS2FF_MAX_SEIS_DEPTH,
    )
    _TABLE_CACHE[key] = table
    return table


def mechanism_for_ps2ff(in_zagros_polygon: bool) -> Mechanism:
    """Map the service's binary rake policy onto a ps2ff Mechanism. Our rake
    policy (rupture_params.py) only ever produces reverse (in-belt) or
    neutral strike-slip (elsewhere) — a direct 1:1 mapping, no "unknown/all"
    case needed."""
    return Mechanism.R if in_zagros_polygon else Mechanism.SS


# ---------------------------------------------------------------------------
# Exact geodetic distances (haversine — no heavy geo dependency)
# ---------------------------------------------------------------------------


def repi_km(
    event_lat: float, event_lon: float, site_lats: np.ndarray, site_lons: np.ndarray
) -> np.ndarray:
    """Great-circle epicentral distance (km) from the event to every site,
    via the haversine formula."""
    lat1 = np.radians(event_lat)
    lon1 = np.radians(event_lon)
    lat2 = np.radians(np.asarray(site_lats, dtype=float))
    lon2 = np.radians(np.asarray(site_lons, dtype=float))

    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0) ** 2
    c = 2.0 * np.arcsin(np.clip(np.sqrt(a), -1.0, 1.0))
    return _EARTH_RADIUS_KM * c


def rhyp_km(repi_km_arr: np.ndarray, depth_km: float) -> np.ndarray:
    """Hypocentral distance from epicentral distance + depth (flat-earth
    combination at this scale is standard ShakeMap practice — depth is
    always << Earth's radius)."""
    repi = np.asarray(repi_km_arr, dtype=float)
    return np.sqrt(repi**2 + depth_km**2)


# ---------------------------------------------------------------------------
# ps2ff expected Rjb / Rrup + variance
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DistanceEstimate:
    """Expected finite-rupture distances (+ variance from the point-source
    uncertainty) for a grid of sites, all same shape."""

    rjb_km: np.ndarray
    rjb_var: np.ndarray
    rrup_km: np.ndarray
    rrup_var: np.ndarray


def expected_rjb_rrup(
    repi_km_arr: np.ndarray, mag: float, in_zagros_polygon: bool
) -> DistanceEstimate:
    """Convert point-source epicentral distances to expected Rjb/Rrup
    (+ variance) via ps2ff, given magnitude and the polygon-derived
    mechanism."""
    repi = np.clip(np.asarray(repi_km_arr, dtype=float), _MIN_REPI_KM, None)
    mag_arr = np.full_like(repi, mag, dtype=float)
    mech = mechanism_for_ps2ff(in_zagros_polygon)

    rjb_table = _table(DistType.Rjb, mech)
    rrup_table = _table(DistType.Rrup, mech)

    return DistanceEstimate(
        rjb_km=rjb_table.r2r(repi, mag_arr),
        rjb_var=rjb_table.var(repi, mag_arr),
        rrup_km=rrup_table.r2r(repi, mag_arr),
        rrup_var=rrup_table.var(repi, mag_arr),
    )
