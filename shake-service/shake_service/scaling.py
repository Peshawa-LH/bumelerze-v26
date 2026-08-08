"""scaling — magnitude -> rupture-dimension scaling relations (Wells &
Coppersmith 1994), hazard-science audit wave 2026-08-08.

Provenance (D9 "extract, don't entangle")
----------------------------------------------------------------------------
Ported from, read-only, never modified:
  SHAKEmaps-Toolkit-v26/modules/hazard/source/scaling.py
    (`wells_coppersmith_1994`, `rake_to_mechanism`, `_normalize_mechanism`,
    the `_WC94_*` coefficient tables) — transcribed VERBATIM. The toolkit's
    module is itself an independent re-implementation from the paper:
    Wells & Coppersmith (1994), "New Empirical Relationships among
    Magnitude, Rupture Length, Rupture Width, Rupture Area, and Surface
    Displacement", BSSA 84(4):974-1002, Table 2A (regressions on moment
    magnitude; subsurface rupture length RLD / downdip width RW / area RA):

        log10(Y) = a + b * Mw

The toolkit's `leonard_2014` stub (deferred there, NotImplementedError) is
deliberately NOT carried over — porting a stub adds nothing; if Leonard
(2014) is ever wanted here it lands as a real implementation.

Why this module exists in Bumelerze (audit finding, gap (e))
----------------------------------------------------------------------------
`rupture_params.py`'s ztor derivation for in-Zagros (reverse, dipping)
point-source events uses a FIXED 5 km vertical half-width placeholder
(`ASSUMED_HALF_WIDTH_KM`, its own [REVIEW] note: "Wells & Coppersmith style
scaling is a plausible future refinement"). This module supplies that
refinement as an OPT-IN alternative (`vertical_half_width_km`): the WC94
downdip width for the event's magnitude/mechanism, projected vertical
through the assumed dip:

    half_width_vertical = (RW(Mw, mech) / 2) * sin(dip)

[REVIEW] The DEFAULT stays the fixed 5 km placeholder — the D20 Halabja/
Kermanshah validation gate was passed with it, and silently switching the
default would change every validated forward map. Peshawa flips the default
(config/`derive_rupture_params(half_width_model="wc94")`) at a science
touchpoint if he wants magnitude-scaled ztor; until then the WC94 path is
exercised by tests only.
"""

from __future__ import annotations

import math
from typing import Optional

# Wells & Coppersmith (1994), Table 2A -- coefficients (a, b, sigma) for
# log10(RLD) = a + b*M (subsurface rupture length), log10(RW) = a + b*M
# (downdip rupture width), log10(RA) = a + b*M (rupture area). VERBATIM from
# the toolkit's `_WC94_LENGTH`/`_WC94_WIDTH`/`_WC94_AREA`.
_WC94_LENGTH = {
    "ALL": (-2.44, 0.59, 0.16),
    "SS": (-2.57, 0.62, 0.15),
    "R": (-2.42, 0.58, 0.16),
    "N": (-1.88, 0.50, 0.17),
}
_WC94_WIDTH = {
    "ALL": (-1.01, 0.32, 0.15),
    "SS": (-0.76, 0.27, 0.14),
    "R": (-1.61, 0.41, 0.15),
    "N": (-1.14, 0.35, 0.12),
}
_WC94_AREA = {
    "ALL": (-3.49, 0.91, 0.24),
    "SS": (-3.42, 0.90, 0.22),
    "R": (-3.99, 0.98, 0.26),
    "N": (-2.87, 0.82, 0.22),
}


def rake_to_mechanism(rake: Optional[float]) -> str:
    """Classify a rake angle (degrees) into a Wells & Coppersmith mechanism
    ('SS' | 'R' | 'N' | 'ALL'; ALL = unknown/not classifiable). Verbatim
    port of the toolkit's `rake_to_mechanism` (standard ShakeMap-literature
    rake convention: strike-slip near 0/180, reverse near +90, normal near
    -90)."""
    if rake is None:
        return "ALL"
    r = ((float(rake) + 180.0) % 360.0) - 180.0  # wrap to [-180, 180)
    if (-30.0 <= r <= 30.0) or (r >= 150.0) or (r <= -150.0):
        return "SS"
    if 60.0 <= r <= 120.0:
        return "R"
    if -120.0 <= r <= -60.0:
        return "N"
    return "ALL"


def _normalize_mechanism(mechanism: Optional[str], rake: Optional[float]) -> str:
    """Verbatim port of the toolkit's `_normalize_mechanism` alias table."""
    if mechanism:
        m = mechanism.strip().upper()
        aliases = {
            "SS": "SS",
            "STRIKE-SLIP": "SS",
            "STRIKESLIP": "SS",
            "R": "R",
            "RS": "R",
            "REVERSE": "R",
            "THRUST": "R",
            "N": "N",
            "NM": "N",
            "NORMAL": "N",
            "ALL": "ALL",
        }
        if m in aliases:
            return aliases[m]
    return rake_to_mechanism(rake)


def wells_coppersmith_1994(
    mag: float,
    mechanism: Optional[str] = None,
    rake: Optional[float] = None,
) -> dict:
    """WC94 rupture length/width/area (+ log10 sigmas) for a magnitude.
    Verbatim port of the toolkit's `wells_coppersmith_1994` (module
    docstring provenance).

    Args:
        mag: moment magnitude.
        mechanism: 'SS'|'R'|'N'|'ALL' (case-insensitive, aliases accepted);
            if omitted, derived from `rake` via `rake_to_mechanism`.
        rake: rake angle in degrees (used only if `mechanism` is None).

    Returns:
        dict with keys: length_km, width_km, area_km2, sigma_log10_length,
        sigma_log10_width, sigma_log10_area, mechanism (resolved key),
        reference.
    """
    mech = _normalize_mechanism(mechanism, rake)
    mag = float(mag)

    a_l, b_l, s_l = _WC94_LENGTH[mech]
    a_w, b_w, s_w = _WC94_WIDTH[mech]
    a_a, b_a, s_a = _WC94_AREA[mech]

    length_km = 10.0 ** (a_l + b_l * mag)
    width_km = 10.0 ** (a_w + b_w * mag)
    area_km2 = 10.0 ** (a_a + b_a * mag)

    return {
        "length_km": float(length_km),
        "width_km": float(width_km),
        "area_km2": float(area_km2),
        "sigma_log10_length": s_l,
        "sigma_log10_width": s_w,
        "sigma_log10_area": s_a,
        "mechanism": mech,
        "reference": "Wells & Coppersmith (1994), BSSA 84(4):974-1002, Table 2A",
    }


def vertical_half_width_km(
    mag: float,
    dip_deg: float,
    mechanism: Optional[str] = None,
    rake: Optional[float] = None,
) -> float:
    """Magnitude-scaled VERTICAL half-extent (km) of a WC94 rupture plane —
    the opt-in replacement for `rupture_params.ASSUMED_HALF_WIDTH_KM`
    (module docstring "Why this module exists"):

        (WC94 downdip width / 2) * sin(dip)

    i.e. how far above (and below) the hypocentre the rupture plane extends
    vertically when the hypocentre sits mid-width on a plane dipping
    `dip_deg` — the same "ztor = max(depth - half_width_vertical, 0)"
    back-out `rupture_params.derive_rupture_params` already performs with
    its fixed placeholder."""
    wc = wells_coppersmith_1994(mag, mechanism=mechanism, rake=rake)
    return float(wc["width_km"] / 2.0 * math.sin(math.radians(float(dip_deg))))
