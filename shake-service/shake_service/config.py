"""Static configuration for bumelerze-shake-service — the D20 logic tree,
magnitude/grid-extent bands, region geometry, and dependency pin.

Nothing here does I/O; it is data + a couple of pure lookup helpers, so it
can be imported cheaply by every other module (and by tests) without
touching openquake at all.

Authoritative sources:
- `docs/decisions.md` D9, D19, D20
- `docs/research/gmpe-set-proposal-v2.md` §4 (set/weights/defaults),
  §4.3 (out-of-range policy), §5 (inputs audit)
- `docs/research/event-pipeline-design.md` §4 (region bbox)
"""

from __future__ import annotations

from dataclasses import dataclass


# ---------------------------------------------------------------------------
# 1. The D20 GMPE set (4 branches)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GsimBranch:
    """One branch of the logic tree: a hazardlib GSIM class + where it lives."""

    key: str
    class_name: str
    module: str
    citation: str


# Order matters only for readability/log stability — gmm.py always looks
# branches up by `key`.
GSIM_BRANCHES: tuple[GsimBranch, ...] = (
    GsimBranch(
        key="CY14",
        class_name="ChiouYoungs2014",
        module="openquake.hazardlib.gsim.chiou_youngs_2014",
        citation="Chiou & Youngs (2014) — global anchor / EMME-MIE 0.35 / EMME24 backbone",
    ),
    GsimBranch(
        key="ASB14",
        class_name="AkkarEtAlRjb2014",
        module="openquake.hazardlib.gsim.akkar_2014",
        citation="Akkar et al. (2014), Rjb — Europe-Middle East regional, EMME-MIE 0.35",
    ),
    GsimBranch(
        key="BSSA14",
        class_name="BooreEtAl2014",
        module="openquake.hazardlib.gsim.boore_2014",
        citation="Boore et al. (2014) — small-magnitude anchor (valid to M3.0), USGS ShakeMap ACR",
    ),
    GsimBranch(
        key="KALE15",
        class_name="KaleEtAl2015Iran",
        module="openquake.hazardlib.gsim.kale_2015",
        citation="Kale, Akkar, Ansari & Hamzehloo (2015), Iran branch — regional attenuation voice",
    ),
)

GSIM_KEYS: tuple[str, ...] = tuple(b.key for b in GSIM_BRANCHES)


# ---------------------------------------------------------------------------
# 2. Magnitude bands, per-band weights, and grid extent
# ---------------------------------------------------------------------------

# Band edges: small = Mw < 5.0, moderate = 5.0 <= Mw < 6.5, major = Mw >= 6.5.
# Same edges drive both the logic-tree weights (§4.2) and the magnitude-scaled
# grid extent (§4.3 / G8) — proposal-v2 keeps them aligned deliberately.
MAGNITUDE_BAND_EDGES: tuple[float, float] = (5.0, 6.5)

MagnitudeBand = str  # "small" | "moderate" | "major"

# §4.2 — all weights [REVIEW R2] per gmpe-set-proposal-v2.md; confirmed D20.
BAND_WEIGHTS: dict[MagnitudeBand, dict[str, float]] = {
    "small": {"CY14": 0.25, "ASB14": 0.15, "BSSA14": 0.35, "KALE15": 0.25},
    "moderate": {"CY14": 0.30, "ASB14": 0.25, "BSSA14": 0.20, "KALE15": 0.25},
    "major": {"CY14": 0.35, "ASB14": 0.25, "BSSA14": 0.25, "KALE15": 0.15},
}

# §4.3 / G8 — magnitude-scaled grid extent (radius, km) around the epicentre.
GRID_EXTENT_KM: dict[MagnitudeBand, float] = {
    "small": 100.0,
    "moderate": 200.0,
    "major": 300.0,
}


def magnitude_band(mw: float) -> MagnitudeBand:
    """Classify a moment magnitude into small/moderate/major per §4.2 edges.

    Events below the smallest published edge (Mw < 3.5, several branches'
    validity floor) still fall into "small" — the mixture weights are the
    finest-grained band we have; magnitude-extrapolation tagging (§4.3) is a
    separate, per-branch concern handled in gmm.py, not here.
    """
    small_edge, moderate_edge = MAGNITUDE_BAND_EDGES
    if mw < small_edge:
        return "small"
    if mw < moderate_edge:
        return "moderate"
    return "major"


def band_weights(band: MagnitudeBand) -> dict[str, float]:
    """Return a copy of the per-branch weight dict for a magnitude band."""
    return dict(BAND_WEIGHTS[band])


def grid_extent_km(band: MagnitudeBand) -> float:
    """Return the magnitude-scaled grid half-extent (km) for a band."""
    return GRID_EXTENT_KM[band]


# ---------------------------------------------------------------------------
# 2b. Per-branch validity ranges — extrapolation tagging only (§4.3, R9)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BranchValidity:
    """Published magnitude/distance validity range for one GSIM branch.

    Used only to *tag* out-of-range grids/events in product metadata
    (gmpe-set-proposal-v2.md §4.3: "compute, tag ... never clamp") — a
    branch is never excluded from the mixture for being out of range.
    """

    mag_min: float
    mag_max_ss: float  # ceiling for non-reverse (or mechanism-agnostic) events
    mag_max_rv: float | None  # CY14-specific reverse-mechanism ceiling, else None
    max_distance_km: float


# [REVIEW R9] — every number here is transcribed from
# gmpe-set-proposal-v2.md §8 R9 ("Validity ranges ... from recall ... to be
# verified via Zotero"), itself not yet verified against the primary papers.
# Treat these as extrapolation-tagging thresholds, not certified science.
BRANCH_VALIDITY: dict[str, BranchValidity] = {
    "CY14": BranchValidity(mag_min=3.5, mag_max_ss=8.5, mag_max_rv=8.0, max_distance_km=300.0),
    "ASB14": BranchValidity(mag_min=4.0, mag_max_ss=7.6, mag_max_rv=None, max_distance_km=200.0),
    "BSSA14": BranchValidity(mag_min=3.0, mag_max_ss=8.5, mag_max_rv=None, max_distance_km=400.0),
    "KALE15": BranchValidity(mag_min=4.0, mag_max_ss=8.0, mag_max_rv=None, max_distance_km=200.0),
}


# ---------------------------------------------------------------------------
# 3. Depth extrapolation tag threshold (G7, confirmed)
# ---------------------------------------------------------------------------

DEPTH_EXTRAPOLATION_THRESHOLD_KM: float = 40.0


# ---------------------------------------------------------------------------
# 4. Region bbox (event-pipeline-design.md §4 — tunable, stored in config
#    not code, kept here so the shake-service and the ingestion worker agree
#    on the same numbers even though they live in different runtimes)
# ---------------------------------------------------------------------------

REGION_BBOX: dict[str, float] = {
    "min_lat": 33.0,
    "max_lat": 38.5,
    "min_lon": 41.0,
    "max_lon": 48.5,
}


# ---------------------------------------------------------------------------
# 5. Zagros-belt mechanism polygon (G9 confirmed: inside -> reverse rake
#    default; outside -> neutral strike-slip rake default, §4.3/§5)
# ---------------------------------------------------------------------------

# [REVIEW] Coarse hand-drawn polygon, NOT a literature geometry. Built from
# the tectonic description in gmpe-set-proposal.md §1 ("Zagros fold-and-
# thrust belt ... Bitlis-Zagros suture ... Mountain Front fault system") as
# a corridor roughly 150-200 km wide following the belt's NW-SE strike from
# the Turkish border (near Zakho/Dohuk) through Erbil, Sulaymaniyah/Halabja,
# across the Iran border past Kermanshah, to Dezful. This is a policy
# geometry for a *default* (moment-tensor solutions override it whenever
# available, §4.3) — Peshawa should refine the vertices against a real
# structural map (e.g. AFEAD/GEM fault traces, G14) before this polygon is
# trusted for anything beyond "assign a plausible default rake".
#
# Ring is (lon, lat) pairs, NOT closed (last point does not repeat the
# first) — `rupture_params.py` closes it for the point-in-polygon test.
ZAGROS_POLYGON_LONLAT: tuple[tuple[float, float], ...] = (
    (41.3, 36.8),  # SW tip, foreland-facing corner, near Mosul/Turkish border
    (42.0, 37.6),  # NW tip, foreland-facing corner, near Zakho
    (43.6, 38.0),  # NW tip, mountain-facing corner, north of Erbil
    (45.5, 36.3),  # mountain-facing, north of Sulaymaniyah/Halabja
    (47.4, 35.0),  # mountain-facing, north of Kermanshah
    (49.2, 33.0),  # SE tip, mountain-facing corner, past Dezful
    (48.6, 32.2),  # SE tip, foreland-facing corner, south of Dezful
    (46.9, 33.6),  # foreland-facing, south of Kermanshah
    (44.9, 34.7),  # foreland-facing, south of Sulaymaniyah/Halabja
    (43.0, 36.2),  # foreland-facing, south of Erbil, near Mosul
)


# ---------------------------------------------------------------------------
# 6. Dependency pin (§6.3 — exact-version pin, revalidate-on-upgrade policy)
# ---------------------------------------------------------------------------

# Bump only via: install candidate version in a scratch venv -> re-run the
# full test suite + the Halabja smoke/validation grid (wave C) -> commit the
# new pin here (and in pyproject.toml/requirements.txt) only if residuals
# are unchanged within the §7 validation tolerance. Never bump silently.
OPENQUAKE_PIN: str = "openquake.engine==3.26.2"
