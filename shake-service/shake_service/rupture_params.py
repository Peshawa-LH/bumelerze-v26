"""Point-source rupture parameter derivation (gmpe-set-proposal-v2.md §4.3/§5).

Everything here derives the parameters hazardlib GSIMs need but a bare
catalog event (lat, lon, depth, Mw) does not supply: mechanism/rake, dip,
ztor, the CY14-specific rx and z1pt0 sentinel, and vs30measured.

Policy source: gmpe-set-proposal-v2.md §4.3 ("Mechanism") and §5 ("Inputs
audit"), confirmed under D20. Point-in-polygon test uses the coarse Zagros
polygon in `config.py` — see that module's [REVIEW] note on the geometry
itself.
"""

from __future__ import annotations

from dataclasses import dataclass

from shake_service.config import ZAGROS_POLYGON_LONLAT

# CY14's sentinel for "no measured z1pt0 — use my own Vs30 relation"
# (openquake.hazardlib.gsim.chiou_youngs_2014: ctx.z1pt0 == -999 triggers
# `global_mean_z1pt0(vs30)` internally). Confirmed by reading the source in
# the installed openquake.engine==3.26.2 package this session — this *is*
# "CY14's own Vs30->z1pt0 California relation" the proposal's §5 table
# specifies as the default.
CY14_Z1PT0_SENTINEL: float = -999.0

# Rake defaults (§4.3): Zagros polygon -> reverse; elsewhere -> neutral
# strike-slip class (moment-tensor solutions override both, when available
# — not implemented in wave A, no station/MT feed exists yet).
ZAGROS_REVERSE_RAKE_DEG: float = 90.0
NEUTRAL_STRIKE_SLIP_RAKE_DEG: float = 0.0

# Dip defaults (§5 inputs-audit table).
ZAGROS_DIP_DEG: float = 45.0
ELSEWHERE_DIP_DEG: float = 90.0

# [REVIEW] Assumed down-dip half-width (km) used to back out ztor from
# hypocentral depth for in-polygon (reverse, dipping) events: ztor =
# max(depth - half_width, 0). Not given a specific number by the proposal
# ("half-width assumption behind ztor documented" — this constant is that
# documentation). 5 km is a coarse placeholder consistent with the
# shallow (~5-20 km) seismogenic layer thickness for Zagros blind-thrust
# events described in gmpe-set-proposal.md §1 — a fixed fraction of that
# layer, not a magnitude-scaled rupture-width relation. UPDATE (hazard-
# science audit wave, 2026-08-08): the Wells & Coppersmith refinement now
# EXISTS as an opt-in (`derive_rupture_params(half_width_model="wc94")`,
# backed by the toolkit-ported `scaling.py`) — this fixed value REMAINS the
# default because the D20 validation gate passed with it; flipping the
# default is Peshawa's call at a science touchpoint ([REVIEW]).
ASSUMED_HALF_WIDTH_KM: float = 5.0

# rx (CY14 hanging-wall term): no point-source estimate exists; neutral-off.
CY14_RX_KM: float = 0.0

# vs30measured: always False for a synthetic/inferred site grid.
VS30_MEASURED_DEFAULT: bool = False


@dataclass(frozen=True)
class RuptureParams:
    """Everything the D20 GSIM set needs beyond lat/lon/depth/Mw, for a
    single point-source event."""

    rake_deg: float
    dip_deg: float
    ztor_km: float
    rx_km: float
    z1pt0: float
    vs30measured: bool
    in_zagros_polygon: bool
    review_flags: tuple[str, ...] = ()


def point_in_polygon(lon: float, lat: float, ring_lonlat: tuple[tuple[float, float], ...]) -> bool:
    """Ray-casting point-in-polygon test on a (lon, lat) ring.

    Standard even-odd rule; `ring_lonlat` need not be closed (this function
    always wraps last->first itself). Good enough for a coarse policy
    polygon at this scale — no need for a geo library dependency.
    """
    n = len(ring_lonlat)
    inside = False
    x, y = lon, lat
    x1, y1 = ring_lonlat[-1]
    for x2, y2 in ring_lonlat:
        if (y1 > y) != (y2 > y):
            x_intersect = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < x_intersect:
                inside = not inside
        x1, y1 = x2, y2
    return inside


def in_zagros_belt(lat: float, lon: float) -> bool:
    """True if (lat, lon) falls inside the coarse Zagros mechanism polygon."""
    return point_in_polygon(lon, lat, ZAGROS_POLYGON_LONLAT)


def derive_rupture_params(
    lat: float,
    lon: float,
    depth_km: float,
    assumed_half_width_km: float = ASSUMED_HALF_WIDTH_KM,
    *,
    mag: float | None = None,
    half_width_model: str = "fixed",
) -> RuptureParams:
    """Derive the point-source rupture parameters the D20 GSIM set needs.

    Mechanism: Zagros-polygon reverse default (rake=90, dip=45, ztor backed
    out from depth via the half-width assumption) vs. elsewhere neutral
    strike-slip default (rake=0, dip=90, ztor=depth — a vertical fault has
    its top at the hypocentre in the point-source approximation).

    Half-width model (hazard-science audit wave, 2026-08-08 — the WC94
    refinement `ASSUMED_HALF_WIDTH_KM`'s own [REVIEW] note anticipated):
      - `"fixed"` (DEFAULT, unchanged behavior): the 5 km placeholder
        (`assumed_half_width_km`). The D20 validation gate passed with this
        value, so it stays the default until Peshawa flips it at a science
        touchpoint ([REVIEW] — `scaling.py` module docstring).
      - `"wc94"` (opt-in, requires `mag`): magnitude-scaled vertical
        half-extent `scaling.vertical_half_width_km(mag, dip, mech)` —
        Wells & Coppersmith (1994) downdip width projected through the
        assumed dip. Only affects the in-Zagros (dipping reverse) branch;
        the elsewhere branch's vertical-fault ztor=depth is half-width-free
        either way.
    """
    from shake_service import scaling  # local import: keeps module import graph flat

    if half_width_model not in ("fixed", "wc94"):
        raise ValueError(
            f"derive_rupture_params: unknown half_width_model {half_width_model!r} "
            "(use 'fixed' or 'wc94')"
        )
    if half_width_model == "wc94" and mag is None:
        raise ValueError("derive_rupture_params: half_width_model='wc94' requires mag")

    inside = in_zagros_belt(lat, lon)

    if inside:
        rake = ZAGROS_REVERSE_RAKE_DEG
        dip = ZAGROS_DIP_DEG
        if half_width_model == "wc94":
            half_width = scaling.vertical_half_width_km(float(mag), dip, rake=rake)
            flags = ("wc94_half_width_ztor",)
        else:
            half_width = assumed_half_width_km
            flags = ()
        ztor = max(depth_km - half_width, 0.0)
    else:
        rake = NEUTRAL_STRIKE_SLIP_RAKE_DEG
        dip = ELSEWHERE_DIP_DEG
        ztor = depth_km
        flags = ("outside_zagros_polygon_neutral_mechanism",)

    return RuptureParams(
        rake_deg=rake,
        dip_deg=dip,
        ztor_km=ztor,
        rx_km=CY14_RX_KM,
        z1pt0=CY14_Z1PT0_SENTINEL,
        vs30measured=VS30_MEASURED_DEFAULT,
        in_zagros_polygon=inside,
        review_flags=flags,
    )
