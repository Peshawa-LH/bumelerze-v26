"""Magnitude-to-moment-magnitude conversion (G10 / D20: "Scordilis 2006
mb/ML->Mw proxy conversion").

Citation: Scordilis, E.M. (2006), *Empirical Global Relations Converting MS
and mb to Moment Magnitude*, Journal of Seismology 10:225-236,
doi:10.1007/s10950-006-9012-4.

VERIFIED + CORRECTED (science-verification pass, web-verified 2026-08-09):
the original from-recall transcription (Mw = 0.67*mb + 2.07, sigma 0.17) had
grafted the paper's **Ms** relation (Eq. 14: Mw = 0.67(+-0.005)Ms +
2.07(+-0.03), 3.0 <= Ms <= 6.1, sigma 0.17) onto the mb validity range. The
paper's actual **mb -> Mw** relation is Eq. (22):
    Mw = 0.85(+-0.04)*mb + 1.03(+-0.23),  3.5 <= mb <= 6.2,
    R^2 = 0.53, sigma = 0.29, n = 39,784
(ISC/NEIC mb vs Harvard/USGS Mw, 1965-2003; the paper notes mb saturates
above ~6.2 and data are sparse below mb 4.5). Read from the paper's full
text (academia.edu copy of J Seismol 10:225-236,
https://www.academia.edu/48541211/), cross-checked against independent
secondary quotations (arXiv:2410.09813 and others quoting
"Mw = 0.85 mb + 1.03 (sigma 0.29)"). The correction CHANGES computed proxy
Mw for mb/ML events (e.g. mb 5.0: 5.28, previously 5.42).

Scope note (VERIFIED same pass): Scordilis (2006) publishes relations for
**mb -> Mw** and **Ms -> Mw**. It does **not** publish an ML -> Mw relation
— the paper's own conclusions state no globally valid ML relation can be
proposed and such relations must be derived per region. D20's phrase
"mb/ML->Mw proxy" is read here as: apply the *same* mb relation to ML
magnitudes as a documented, flagged proxy (regional short-period ML and mb
scales are close enough at the magnitudes this service cares about, M3.5-6.5,
that this is a defensible stopgap — but it is a proxy, not a literature
result, and is tagged as such in every conversion record). If Peshawa wants
a real regional ML relation (the mutual-catalog work may derive one, per
G10's own text), swap `MB_TO_MW` for a dedicated ML relation without
touching callers — they only see the `ConversionRecord` contract.
"""

from __future__ import annotations

from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Magnitude-type classification
# ---------------------------------------------------------------------------

# Moment-magnitude family: passthrough, no conversion needed. Mwp (P-wave
# moment magnitude, a fast early estimate) is included because it is
# reported directly in Mw units by USGS/EMSC and is the standard "first
# number" for large events before a full moment tensor lands.
MW_FAMILY_TYPES: frozenset[str] = frozenset(
    {"mw", "mww", "mwb", "mwc", "mwr", "mwp", "moment"}
)

MB_FAMILY_TYPES: frozenset[str] = frozenset({"mb"})

ML_FAMILY_TYPES: frozenset[str] = frozenset({"ml"})


@dataclass(frozen=True)
class ScordilisRelation:
    """One linear Mw = a*M + b relation with its published validity range."""

    slope: float
    intercept: float
    valid_min: float
    valid_max: float
    sigma: float
    citation: str


# Scordilis (2006) Eq. (22): Mw = 0.85*mb + 1.03, 3.5 <= mb <= 6.2, sigma=0.29.
# CORRECTED + web-verified 2026-08-09 (module docstring: the previous values
# 0.67/2.07/sigma 0.17 were the paper's Ms Eq. 14 mistranscribed onto mb).
MB_TO_MW = ScordilisRelation(
    slope=0.85,
    intercept=1.03,
    valid_min=3.5,
    valid_max=6.2,
    sigma=0.29,
    citation="Scordilis (2006) eq. 22, mb -> Mw",
)


@dataclass(frozen=True)
class ConversionRecord:
    """Auditable output of a magnitude conversion — always attached to the
    canonical event record as conversion metadata (D20/G10: "recorded in
    metadata")."""

    mw: float
    source_magnitude: float
    source_mag_type: str
    method: str
    citation: str
    in_published_range: bool | None  # None when passthrough (no range applies)
    review_flags: tuple[str, ...] = ()


def classify_mag_type(mag_type: str) -> str:
    """Normalize and classify a magnitude-type string into 'mw', 'mb', or
    'ml'. Raises ValueError for anything unrecognized rather than guessing
    — a silent wrong conversion is worse than a loud failure."""
    key = mag_type.strip().lower()
    if key in MW_FAMILY_TYPES:
        return "mw"
    if key in MB_FAMILY_TYPES:
        return "mb"
    if key in ML_FAMILY_TYPES:
        return "ml"
    raise ValueError(
        f"unrecognized magnitude type {mag_type!r}; add it to config/magnitude.py "
        "explicitly rather than guessing which family it belongs to"
    )


def to_moment_magnitude(magnitude: float, mag_type: str) -> ConversionRecord:
    """Convert a catalog magnitude to Mw, per D20/G10 policy.

    - Mw-family types: passthrough.
    - mb: Scordilis (2006) eq. 1, tagged with published-range membership.
    - ml: the SAME Scordilis mb relation applied as a proxy (see module
      docstring [REVIEW] scope note) — always carries the
      "ml_proxy_via_mb_relation" review flag so downstream consumers (and a
      future dedicated regional relation) can find every ML-derived event.
    """
    family = classify_mag_type(mag_type)

    if family == "mw":
        return ConversionRecord(
            mw=magnitude,
            source_magnitude=magnitude,
            source_mag_type=mag_type,
            method="passthrough",
            citation="n/a (already moment magnitude)",
            in_published_range=None,
        )

    if family == "mb":
        rel = MB_TO_MW
        mw = rel.slope * magnitude + rel.intercept
        in_range = rel.valid_min <= magnitude <= rel.valid_max
        flags = () if in_range else ("magnitude_outside_published_range",)
        return ConversionRecord(
            mw=mw,
            source_magnitude=magnitude,
            source_mag_type=mag_type,
            method="scordilis2006_mb",
            citation=rel.citation,
            in_published_range=in_range,
            review_flags=flags,
        )

    # family == "ml"
    rel = MB_TO_MW
    mw = rel.slope * magnitude + rel.intercept
    in_range = rel.valid_min <= magnitude <= rel.valid_max
    flags = ("ml_proxy_via_mb_relation",)
    if not in_range:
        flags = flags + ("magnitude_outside_published_range",)
    return ConversionRecord(
        mw=mw,
        source_magnitude=magnitude,
        source_mag_type=mag_type,
        method="scordilis2006_mb_proxy_for_ml",
        citation=rel.citation + " [REVIEW: applied to ML as proxy, not published for ML]",
        in_published_range=in_range,
        review_flags=flags,
    )
