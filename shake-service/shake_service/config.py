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


# R9 verification status (science-verification pass, web-verified
# 2026-08-09; impact is TAGGING-ONLY — these thresholds drive extrapolation
# flags in product metadata, never any computed ground-motion number):
#   - CY14: VERIFIED vs PEER Report 2013/07 (Chiou & Youngs), p. 71 —
#     M 3.5-8.5 strike-slip, M 3.5-8.0 reverse AND normal, Rrup 0-300 km
#     (also ztor <= 20 km, Vs30 180-1500 m/s, not modelled here).
#     https://peer.berkeley.edu/sites/default/files/webpeer-2013-07-brian_s.j._chiou_and_robert_r.youngs.pdf
#     Note our mag_max_rv is applied via the Zagros-polygon reverse default;
#     CY14's 8.0 ceiling covers normal too (no normal-mechanism default here).
#   - ASB14: VERIFIED vs the author-hosted primary PDF (Akkar, Sandikkaya &
#     Bommer 2014, Bull Earthquake Eng 12:359-387, Table 2 "This study":
#     Mmin 4.0, Mmax 7.6, max distance 200 km; distance metrics RJB for the
#     finite-fault model, Repi/Rhyp for point-source).
#     https://web.bogazici.edu.tr/sinan.akkar/download/publications/34_Akkar_etal_HorizontalGMPE.pdf
#   - BSSA14: VERIFIED vs the author-hosted Earthquake Spectra copy —
#     M 3.0-8.5 for strike-slip AND reverse (reverse shares the 8.5 ceiling),
#     normal-slip capped at M 7.0 (NOT modelled here: our schema has no
#     normal-mechanism ceiling and the Zagros default is reverse/strike-slip;
#     recorded as a known simplification), RJB 0-400 km.
#     https://www.daveboore.com/pubs_online/ngaw2_paper_bssa14_eqs_2014.pdf
#   - [REVIEW R9-KALE15] KALE15: STILL FROM RECALL — the only permitted web
#     attempt this pass (GeoScienceWorld abstract for BSSA 105(2A):963-980)
#     returned HTTP 403; Mw 4.0-8.0 / RJB <= 200 km remains unverified
#     against the primary paper.
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
# 6. Forward-map site-grid spacing policy (wave B, `forward.py`)
# ---------------------------------------------------------------------------

# Target resolution: ~0.0167 deg (~1.8 km at the equator, using vs30.py's own
# 111.32 km/deg flat-earth convention) -- task-specified default, fine enough
# that a ShakeMap-scale product doesn't look blocky at the neighbourhood
# level. Used as-is for the small/moderate bands.
SITE_SPACING_DEG_TARGET: float = 0.0167
_KM_PER_DEG: float = 111.32
SITE_SPACING_KM_TARGET: float = SITE_SPACING_DEG_TARGET * _KM_PER_DEG  # ~1.859 km

# Site-count cap: `forward.py` must not build more than this many steps per
# axis, so the largest grid (major band, 300 km half-extent per
# `GRID_EXTENT_KM` -- a 600 km-span site mesh) stays tractable for
# hazardlib's per-site context evaluation on a server-side worker meant to
# run per-event, near-real-time (a full 600 km span at the 1.859 km target
# would be ~334x334 ~= 112k sites). Spacing is COARSENED -- never finer than
# the target -- just enough to keep each axis at or under this cap;
# small/moderate-band grids keep the full target resolution untouched.
MAX_GRID_STEPS_PER_AXIS: int = 200


def forward_grid_spacing_km(band: MagnitudeBand) -> float:
    """The site-grid spacing (km) `forward.py` uses for a magnitude band:
    `SITE_SPACING_KM_TARGET`, coarsened only as much as needed to keep
    `vs30.build_grid_km_spacing`'s step count (`round(span/spacing) + 1`) at
    or under `MAX_GRID_STEPS_PER_AXIS` for this band's half-extent
    (`grid_extent_km`). Monotonically non-decreasing with band severity."""
    half_extent = grid_extent_km(band)
    span_km = 2.0 * half_extent
    min_spacing_for_cap = span_km / (MAX_GRID_STEPS_PER_AXIS - 1)
    return max(SITE_SPACING_KM_TARGET, min_spacing_for_cap)


# ---------------------------------------------------------------------------
# 6b. Auto-trigger magnitude floor (D9: "auto for regional M>=3.5,
#     on-demand below when felt reports arrive"; `shake_service/worker/`,
#     wave E). Kept alongside `REGION_BBOX` for the same reason: the worker
#     (a separate runtime/entry point) and the ingestion/significance-score
#     design (`event-pipeline-design.md` §3, region-significance threshold
#     "sig >= 350 (~M3.5+) ... deliberate alignment with D9") must agree on
#     one number. On-demand sub-3.5 triggering (felt reports) is a later
#     wave — this constant only gates the AUTO path.
# ---------------------------------------------------------------------------

TRIGGER_MIN_MAGNITUDE: float = 3.5


# ---------------------------------------------------------------------------
# 7. Dependency pin (§6.3 — exact-version pin, revalidate-on-upgrade policy)
# ---------------------------------------------------------------------------

# Bump only via: install candidate version in a scratch venv -> re-run the
# full test suite + the Halabja smoke/validation grid (wave C) -> commit the
# new pin here (and in pyproject.toml/requirements.txt) only if residuals
# are unchanged within the §7 validation tolerance. Never bump silently.
OPENQUAKE_PIN: str = "openquake.engine==3.26.2"


# ---------------------------------------------------------------------------
# 8. Small-N conditioning floor (D20 checkpoint condition 3,
#    `docs/decisions.md` 2026-08-07 "small-N conditioning instability"
#    finding; used by `conditioned_forward.condition_forward_map_on_dyfi`)
# ---------------------------------------------------------------------------

# [REVIEW — Peshawa to confirm/tune] Below this many ACTUAL in-domain
# conditioning observations for one IMT (post any mvn-internal colocated-
# observation merge -- `mvn.ConditionedField.n_conditioning`),
# `conditioned_forward.condition_forward_map_on_dyfi` skips conditioning for
# that IMT and publishes the bare (unconditioned) prior instead, recording
# a metadata note that observations existed but were below the floor.
# CONFIRMED by Peshawa (2026-08-08 science touchpoint, replacing the earlier
# proposed hard n>=10 floor): the soft-transition variant. Below
# MIN_CONDITIONING_OBSERVATIONS the bare prior is published (unchanged
# behavior); in the band [MIN_CONDITIONING_OBSERVATIONS,
# SMALL_N_SIGMA_INFLATION_THRESHOLD) conditioning ENGAGES but with every
# observation's sigma_obs multiplied by SMALL_N_SIGMA_INFLATION_FACTOR, so a
# handful of observations pull the field gently instead of flipping it --
# the `us1000hwdw` N=5 instability (validation/SUMMARY.md; decisions.md D20
# checkpoint condition 3 note, 2026-08-07). These constants post-date every
# currently-committed validation run -- see validation/SUMMARY.md's
# floor-postdate note before comparing any NEW run's
# `data_used["conditioning_applied"]` against the committed reports.
MIN_CONDITIONING_OBSERVATIONS: int = 5
SMALL_N_SIGMA_INFLATION_THRESHOLD: int = 10
SMALL_N_SIGMA_INFLATION_FACTOR: float = 2.0


# ---------------------------------------------------------------------------
# 9. Vs30 backbone raster — default-on path (Peshawa 2026-08-08 ruling:
#    "make the calculation identical to the SHAKEmaps toolkit's approach ...
#    let site amplification refine the map"; `vs30.py`'s wave-B `RasterVs30`
#    was built but shipped OFF by default behind `BUMELERZE_VS30_RASTER_PATH`
#    — this constant flips that default ON while keeping the env var as a
#    portable override, per `vs30.py`'s own module docstring.)
# ---------------------------------------------------------------------------

# The toolkit's global Vs30 backbone raster (`SHAKEmaps-Toolkit-v26/
# SHAKEdata/vs30/global_vs30.grd`, read-only, ~610 MB, OneDrive-hosted) —
# the SAME data source `vs30.py`'s wave-B docstring already documents.
# Hardcoding an absolute path on Peshawa's machine here is a deliberate
# exception to this module's own "no dependency on Peshawa's local machine"
# spirit (see `vs30.py`'s `[REVIEW]` note): it is safe ONLY because
# `vs30.default_sampler()` treats this purely as a *candidate* — a missing
# or unreadable file (any other machine, CI, a not-yet-hydrated OneDrive
# placeholder) falls back to `UniformRockVs30` loudly and automatically,
# never blocks a run. `BUMELERZE_VS30_RASTER_PATH` still overrides this
# default for any machine/CI that needs a different (or no) raster.
DEFAULT_VS30_RASTER_PATH: str = (
    "/Users/pesha/Library/CloudStorage/OneDrive-Personal/2_WorkDrive/5_MyPhD/"
    "SHAKEmaps/SHAKEmaps-Toolkit-v26/SHAKEdata/vs30/global_vs30.grd"
)
