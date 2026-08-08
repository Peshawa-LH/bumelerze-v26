"""Ground Motion to Intensity Conversion Equations (GMICE) — Zanini & Hofer
(2019) EMS-98 display channel + Worden et al. (2012) MMI validation channel
(gmpe-set-proposal.md §4.4, D9/D19/D20), plus Bilal & Askan (2014) as a
mean-only Turkey regional SENSITIVITY channel (hazard-science audit wave,
2026-08-08 — see its own section notice below; never a display/conditioning
channel).

Provenance (D9 "extract, don't entangle" — wave B, 2026-08-07)
----------------------------------------------------------------------------
Ported from, read-only, never modified:
  - SHAKEmaps-Toolkit-v26/modules/hazard/gmice/SHAKEgmice.py
    (`GMICE.Zaniniandhofer19`, `GMICE.WordenEtAl12`) — the coefficient
    tables, transcribed VERBATIM, no re-derivation.
  - SHAKEmaps-Toolkit-v26/modules/hazard/gmice/gmice_adapter.py — the unit
    discipline (native GMICE units: cm/s^2 for PGA/SA, cm/s for PGV), the
    numerical-derivative technique for dIntensity/d(lnY) (central difference
    through the model's own conversion function, not a hand-transcribed
    analytic slope — same rationale: SHAKEgmice's models are a mix of power
    laws and one quadratic-inverse form, and duplicating each one's slope by
    hand repeats exactly the transcription risk this policy exists to avoid),
    and the published sigma_MMI/sigma_EMS tables.

Sigma honesty policy (updated 2026-08-09, science-verification pass):
  - `WORDEN_SIGMA_VERIFIED = True` — CLOSED this pass. The toolkit's
    recollected SA sigmas were wrong (0.79/0.73/0.72) and are corrected to
    the USGS operational values (0.82/0.75/0.89); PGA/PGV (0.66/0.63)
    confirmed. Verification basis: USGS shakelib wgrw12.py (see the
    WORDEN_SIGMA_TABLE comment below for the honest scope of that basis).
  - `ZANINI_SIGMA_IS_PLACEHOLDER = False` — CLOSED this wave (Z3,
    `docs/decisions.md` D20 checkpoint condition 2, accepted
    2026-08-07). The Zanini & Hofer (2019) paper's own published sigma_tot
    (0.27 PGA / 0.34 PGV, Table 3) was located and verified against the
    primary PDF, but is BINNED-MEAN regression scatter, not per-observation
    scatter, and would overstate conversion precision ~2x if used directly
    for per-observation weighting. The pre-existing 0.70 (both IMTs,
    Peshawa-authorized in the toolkit, 2026-07-06) is RATIFIED as the
    adopted per-observation value instead; the published 0.27/0.34 (plus
    sigma_a/sigma_b/R^2) are recorded as provenance-only constants next to
    it (`ZANINI_PUBLISHED_SIGMA_TOTAL_*` etc., below) — see
    `docs/research/zanini-gmice-investigation.md` §3.3.

GMICE PGA/PGV-EMS forward-use notice (D20 checkpoint condition 2, CLOSED
2026-08-07 "option A"): the EMS-98 display channel is now PGA-DRIVEN ONLY
— Zanini & Hofer's independently-fit PGV-EMS coefficient pair is a
published, verified model defect (not a transcription error) and is
retired from forward/display use. Full rationale next to
`_ZANINI_PGV_TO_EMS` below; investigation:
`docs/research/zanini-gmice-investigation.md`.

Unit discipline (adapted from gmice_adapter.py to the wave-A contract)
----------------------------------------------------------------------------
`shake_service.gmm`'s ln-space contract is **g** for PGA/SA, **cm/s** for
PGV (`gmm.py` module docstring). SHAKEgmice's own coefficients are
calibrated in **cm/s^2** for PGA/SA and **cm/s** for PGV (confirmed by
`docs/data_contracts.md` "GMICE PGA input: always convert before
calling GMICE"). This module converts explicitly at its own boundary
(`_G_TO_CM_S2`, standard gravity 9.80665 m/s^2, matching the toolkit's own
`modules/utils/units.py:G0_M_PER_S2`) — PGV needs no conversion (cm/s in
both contracts).

Discovered-and-fixed transcription bug (flagged loudly, per task instruction)
----------------------------------------------------------------------------
`SHAKEgmice.WordenEtAl12`'s "PGM to MMI" branch selects each SA period's
coefficients by checking `self.output_type == 'sa_03'` / `'sa_1'` / `'sa_3'`
(SHAKEgmice.py lines ~308-313) — but in that branch `self.output_type` is
ALREADY constrained to `'MMI'` by the enclosing `elif` (line ~303), so those
three checks can never be true. Calling the toolkit's `WordenEtAl12` with
`input_type='sa_03'|'sa_1'|'sa_3', output_type='MMI'` therefore always falls
through to `raise ValueError("Invalid input and output type combination.")`
— SA(0.3)/SA(1.0)/SA(3.0) -> MMI is DEAD CODE in the toolkit today (the
PGA/PGV branches, which check `self.input_type`, are unaffected and correct).
This port fixes the obvious transcription slip (branch on the row's own
`input_type`, matching every other branch in the same `if`/`elif` chain and
the mirror-image MMI->PGM direction) so SA(0.3)/SA(1.0) actually work here —
`shake_service.gmm.IMT_KEYS` includes both. The coefficient VALUES are
unchanged from the toolkit; only which `elif` fires was corrected. Nothing
else about SHAKEgmice.py is touched (it stays read-only in its own repo).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Tuple

import numpy as np

# Standard gravity (m/s^2) -- matches modules/utils/units.py:G0_M_PER_S2 in
# the toolkit exactly (9.80665), so the g<->cm/s^2 boundary conversion here
# reproduces the toolkit's own `convert_accel_units('g', 'cm/s^2')` factor.
_G0_M_PER_S2: float = 9.80665
_G_TO_CM_S2: float = _G0_M_PER_S2 * 100.0  # 980.665


# ---------------------------------------------------------------------------
# IMT vocabulary (mirrors gmm.IMT_KEYS: "PGA" | "PGV" | "SA(0.3)" | "SA(1.0)")
# ---------------------------------------------------------------------------


def _parse_imt(imt: str) -> Tuple[str, float | None]:
    k = imt.strip().upper()
    if k == "PGA":
        return "PGA", None
    if k == "PGV":
        return "PGV", None
    if k.startswith("SA(") and k.endswith(")"):
        return "SA", float(k[3:-1])
    raise ValueError(f"gmice: cannot parse IMT '{imt}' (PGA/PGV/SA(period) only)")


_SA_PERIOD_TO_WORDEN_KEY = {0.3: "sa_03", 1.0: "sa_1", 3.0: "sa_3"}


def _worden_key(imt: str) -> str:
    """The engine's IMT string -> SHAKEgmice's own coefficient-table key
    ('PGA' | 'PGV' | 'sa_03' | 'sa_1' | 'sa_3')."""
    kind, period = _parse_imt(imt)
    if kind in ("PGA", "PGV"):
        return kind
    key = _SA_PERIOD_TO_WORDEN_KEY.get(round(float(period), 4))
    if key is None:
        raise ValueError(
            f"gmice: Worden 2012 has no tabulated SA period {period}s "
            f"(only 0.3/1.0/3.0 s)"
        )
    return key


def _to_gmice_native(y_native: np.ndarray, imt: str, unit_in: str) -> np.ndarray:
    """Caller's linear unit -> SHAKEgmice's own native discipline
    (cm/s^2 for PGA/SA, cm/s for PGV)."""
    kind, _period = _parse_imt(imt)
    y = np.asarray(y_native, dtype=float)
    if kind in ("PGA", "SA"):
        u = unit_in.strip().lower()
        if u == "g":
            return y * _G_TO_CM_S2
        if u == "cm/s^2":
            return y
        raise ValueError(f"gmice: unsupported PGA/SA unit_in={unit_in!r} (use 'g' or 'cm/s^2')")
    if kind == "PGV":
        u = unit_in.strip().lower()
        if u != "cm/s":
            raise ValueError(f"gmice: unsupported PGV unit_in={unit_in!r} (use 'cm/s')")
        return y
    raise AssertionError("unreachable")  # pragma: no cover -- _parse_imt already gates this


def _from_gmice_native(y_native: np.ndarray, imt: str, unit_out: str) -> np.ndarray:
    kind, _period = _parse_imt(imt)
    y = np.asarray(y_native, dtype=float)
    if kind in ("PGA", "SA"):
        u = unit_out.strip().lower()
        if u == "g":
            return y / _G_TO_CM_S2
        if u == "cm/s^2":
            return y
        raise ValueError(f"gmice: unsupported PGA/SA unit_out={unit_out!r} (use 'g' or 'cm/s^2')")
    if kind == "PGV":
        u = unit_out.strip().lower()
        if u != "cm/s":
            raise ValueError(f"gmice: unsupported PGV unit_out={unit_out!r} (use 'cm/s')")
        return y
    raise AssertionError("unreachable")  # pragma: no cover


# ---------------------------------------------------------------------------
# Zanini & Hofer (2019) — reversible PGA/PGV <-> EMS-98
# Coefficients transcribed VERBATIM from SHAKEgmice.py `Zaniniandhofer19`.
#
# RETIRED-FROM-FORWARD-USE NOTICE (D20 checkpoint condition 2, CLOSED
# 2026-08-07 "option A + Z1-Z6 defaults"; full finding:
# `docs/research/zanini-gmice-investigation.md`)
# ----------------------------------------------------------------------------
# `_ZANINI_PGV_TO_EMS` is a FAITHFUL transcription of the published paper
# (Zanini, Hofer & Faleschini 2019, *Engineering Structures* 180:310-320,
# Eq. 7, Table 3 — verified digit-for-digit against the primary PDF, Zotero
# item VK9M2IHB; NOT a transcription error) but the PUBLISHED PAIR is
# internally inconsistent with `_ZANINI_PGA_TO_EMS`: because the two
# relations were fit independently (orthogonal distance regression on
# binned Italian data) with very different log-PGM slopes (2.28 vs. 1.62),
# the implied PGV/PGA ratio grows unboundedly with intensity — physically
# typical (~60-150 (cm/s)/g) only up to about EMS 5, reaching an
# implausible ~680 (cm/s)/g by EMS 8.5 and ~1260 (cm/s)/g at EMS 10 (an
# effective dominant period of several seconds — not physical for
# near-source crustal shaking). The paper's own literature comparison
# corroborates that the PGV-EMS relation, not the PGA-EMS one, is the
# defective half (it "always underestimates intensities ... by about 1
# intensity point" versus Faenza & Michelini 2010 / Faccioli & Cauzzi,
# while the PGA-EMS relation tracks those same models closely — matching
# this port's own wave-C SPZ spot check).
#
# Decision (Option A, accepted): the EMS-98 DISPLAY channel
# (`intensity.py`'s `compute_intensity` for `model="Zaniniandhofer19"`) is
# now PGA-driven ONLY — `_zanini_pgv_to_ems`/`_zanini_ems_to_pgv` are no
# longer called from that forward/display path. They are kept, unchanged,
# for two non-display uses that remain load-bearing:
#   1. `dyfi_observations.py`'s documented SENSITIVITY reversal model (CDI
#      -> GM via the PGV-EMS pair), run every time alongside the PRIMARY
#      Worden reversal, never silently dropped — exactly so this known
#      defect stays visible and auditable rather than erased.
#   2. Provenance/regression tests (`tests/test_gmice.py`) that prove the
#      port stays a faithful, invertible transcription of the published
#      model, defect and all.
# Coefficient correction ("fix the numbers") was explicitly RULED OUT — the
# transcription is faithful; there is nothing to correct, only a published
# model limitation to route around. Oliveti, Faenza & Michelini (2022, GJI
# 231(2):1117-1137) is queued as the v1.x display-GMICE swap candidate
# (reversible, EMS-98-capable, PGA/PGV-consistent by construction).
# ---------------------------------------------------------------------------

_ZANINI_PGA_TO_EMS = (2.03, 2.28)  # ems = c0 + c1*log10(pga_cm_s2)
_ZANINI_PGV_TO_EMS = (4.16, 1.62)  # ems = c0 + c1*log10(pgv_cm_s) -- RETIRED from forward/display use, see notice above (provenance/sensitivity-model use only)

# Paper-stated applicability, Table 3 / §3.4 of the paper (both PGA and PGV
# relations): 2.0 <= I_EMS-98 <= 9.5, "valid within the Italian peninsula",
# fit on Mw 3.2-6.1 events. `intensity.py` clamps the EMS display channel to
# this envelope at its writer boundary (Z2, accepted 2026-08-07) rather than
# quoting an extrapolating line outside it.
ZANINI_EMS_VALIDITY_MIN: float = 2.0
ZANINI_EMS_VALIDITY_MAX: float = 9.5


def _zanini_pga_to_ems(pga_cm_s2: np.ndarray) -> np.ndarray:
    c0, c1 = _ZANINI_PGA_TO_EMS
    pga_cm_s2 = np.asarray(pga_cm_s2, dtype=float)
    return np.where(pga_cm_s2 <= 0, 0.0, c0 + c1 * np.log10(np.where(pga_cm_s2 > 0, pga_cm_s2, 1.0)))


def _zanini_pgv_to_ems(pgv_cm_s: np.ndarray) -> np.ndarray:
    c0, c1 = _ZANINI_PGV_TO_EMS
    pgv_cm_s = np.asarray(pgv_cm_s, dtype=float)
    return np.where(pgv_cm_s < 0, 0.0, c0 + c1 * np.log10(np.where(pgv_cm_s > 0, pgv_cm_s, 1.0)))


def _zanini_ems_to_pga(ems: np.ndarray) -> np.ndarray:
    c0, c1 = _ZANINI_PGA_TO_EMS
    ems = np.asarray(ems, dtype=float)
    return np.where(ems < 0, 0.0, 10.0 ** ((ems - c0) / c1))


def _zanini_ems_to_pgv(ems: np.ndarray) -> np.ndarray:
    c0, c1 = _ZANINI_PGV_TO_EMS
    ems = np.asarray(ems, dtype=float)
    return np.where(ems < 0, 0.0, 10.0 ** ((ems - c0) / c1))


def zanini_hofer_2019_to_ems(y_native: np.ndarray, *, imt: str, unit_in: str) -> np.ndarray:
    """PGA/PGV (linear, `unit_in`) -> EMS-98 (linear ordinal, continuous
    internally -- clamped to [1,12] only at a product's writer boundary,
    same convention as the toolkit's `grid.xml` export)."""
    kind, _period = _parse_imt(imt)
    if kind not in ("PGA", "PGV"):
        raise ValueError(f"zanini_hofer_2019: only PGA/PGV supported (toolkit has no SA branch), got {imt!r}")
    y_gmice = _to_gmice_native(y_native, imt, unit_in)
    if kind == "PGA":
        return _zanini_pga_to_ems(y_gmice)
    return _zanini_pgv_to_ems(y_gmice)


def zanini_hofer_2019_from_ems(ems: np.ndarray, *, imt: str, unit_out: str) -> np.ndarray:
    """EMS-98 (linear) -> PGA/PGV (linear, `unit_out`)."""
    kind, _period = _parse_imt(imt)
    if kind not in ("PGA", "PGV"):
        raise ValueError(f"zanini_hofer_2019: only PGA/PGV supported, got {imt!r}")
    y_gmice = _zanini_ems_to_pga(ems) if kind == "PGA" else _zanini_ems_to_pgv(ems)
    return _from_gmice_native(y_gmice, imt, unit_out)


# ---------------------------------------------------------------------------
# Worden et al. (2012) — PGA/PGV/SA(0.3)/SA(1.0)/SA(3.0) <-> MMI
# Coefficients (c1, c2, c3, c4, t1, t2) transcribed VERBATIM from
# SHAKEgmice.py `WordenEtAl12`; SA branch-selection bug fixed (module
# docstring "Discovered-and-fixed transcription bug").
# ---------------------------------------------------------------------------

# key -> (c1, c2, c3, c4, t1, t2)
_WORDEN_COEFFS: Dict[str, Tuple[float, float, float, float, float, float]] = {
    "PGA": (1.78, 1.55, -1.60, 3.70, 1.57, 4.22),
    "PGV": (3.78, 1.47, 2.89, 3.16, 0.53, 4.56),
    "sa_03": (1.26, 1.69, -4.15, 4.14, 2.21, 4.99),
    "sa_1": (2.50, 1.51, 0.20, 2.90, 1.65, 4.98),
    "sa_3": (3.81, 1.17, 1.99, 3.01, 0.99, 4.96),
}


def _worden_pgm_to_mmi(y_gmice: np.ndarray, key: str) -> np.ndarray:
    c1, c2, c3, c4, t1, _t2 = _WORDEN_COEFFS[key]
    y_gmice = np.asarray(y_gmice, dtype=float)
    log_y = np.log10(np.where(y_gmice > 0, y_gmice, np.nan))
    return np.where(log_y <= t1, c1 + c2 * log_y, c3 + c4 * log_y)


def _worden_mmi_to_pgm(mmi: np.ndarray, key: str) -> np.ndarray:
    c1, c2, c3, c4, _t1, t2 = _WORDEN_COEFFS[key]
    mmi = np.asarray(mmi, dtype=float)
    return np.where(mmi <= t2, 10.0 ** ((mmi - c1) / c2), 10.0 ** ((mmi - c3) / c4))


def worden_2012_to_mmi(y_native: np.ndarray, *, imt: str, unit_in: str) -> np.ndarray:
    """PGA/PGV/SA (linear, `unit_in`) -> MMI (linear)."""
    key = _worden_key(imt)
    y_gmice = _to_gmice_native(y_native, imt, unit_in)
    return _worden_pgm_to_mmi(y_gmice, key)


def worden_2012_from_mmi(mmi: np.ndarray, *, imt: str, unit_out: str) -> np.ndarray:
    """MMI (linear) -> PGA/PGV/SA (linear, `unit_out`)."""
    key = _worden_key(imt)
    y_gmice = _worden_mmi_to_pgm(mmi, key)
    return _from_gmice_native(y_gmice, imt, unit_out)


# ---------------------------------------------------------------------------
# Bilal & Askan (2014) — Turkey PGA/PGV <-> MMI sensitivity channel
# Coefficients transcribed VERBATIM from SHAKEgmice.py `Bilalandaskan14`
# (hazard-science audit wave, 2026-08-08 — the closest REGIONAL (Turkey)
# GMICE in the toolkit's 9-model catalogue; ported as a sensitivity/
# validation channel alongside the Zanini EMS display + Worden MMI
# validation channels, exactly because the Zanini PGV-EMS defect
# (RETIRED-FROM-FORWARD-USE notice above) showed the value of an
# independent regional cross-check. NOT wired into any display/export/
# conditioning path — selectable by name for comparison runs only.)
#
# Citation: Bilal, M., & Askan, A. (2014), "Relationships between Felt
# Intensity and Recorded Ground-Motion Parameters for Turkey", BSSA
# 104(1):484-496. Model form (toolkit transcription):
#     MMI = 0.132 + 3.884 * log10(PGA[cm/s^2])
#     MMI = 2.673 + 4.340 * log10(PGV[cm/s])
#
# [REVIEW] Verification status (same honesty policy as WORDEN_SIGMA_VERIFIED):
#   - BILAL_COEFFS_VERIFIED = False — the coefficients are a VERBATIM copy of
#     the toolkit's own transcription, NOT independently re-verified against
#     the BSSA 104(1) primary PDF this session (the paper is not in Peshawa's
#     Zotero library as of 2026-08-08 — checked, not assumed). Joins the same
#     G12-style pre-use verification pass Worden's table already awaits.
#   - NO sigma is catalogued for this model (the toolkit transcribes none,
#     and the paper's published scatter was not readable this session) —
#     `sigma_gmice("Bilalandaskan14", ...)` raises `NotImplementedError`
#     honestly, so this model CANNOT feed the chain-rule sigma path
#     (`intensity.compute_intensity`) or reverse-GMICE observation weighting
#     until a published sigma is transcribed and verified. Mean-only
#     sensitivity comparisons (`convert_to_intensity`/`convert_from_intensity`)
#     are the supported use.
# ---------------------------------------------------------------------------

_BILAL_PGA_TO_MMI = (0.132, 3.884)  # mmi = c0 + c1*log10(pga_cm_s2)
_BILAL_PGV_TO_MMI = (2.673, 4.340)  # mmi = c0 + c1*log10(pgv_cm_s)

BILAL_COEFFS_VERIFIED = False  # verbatim toolkit transcription, not yet checked vs BSSA 104(1) -- see [REVIEW] note above.
BILAL_CITATION = "Bilal & Askan (2014), BSSA 104(1):484-496 (Turkey)"


def _bilal_pgm_to_mmi(y_gmice: np.ndarray, coeffs: Tuple[float, float]) -> np.ndarray:
    # Guard pattern mirrors `_zanini_pga_to_ems` (a numerical log10(<=0)
    # guard, not model content -- the toolkit's own `np.where(x < 0, 0, ...)`
    # still evaluates log10(0) noisily; <=0 is the safe equivalent).
    c0, c1 = coeffs
    y = np.asarray(y_gmice, dtype=float)
    return np.where(y <= 0, 0.0, c0 + c1 * np.log10(np.where(y > 0, y, 1.0)))


def _bilal_mmi_to_pgm(mmi: np.ndarray, coeffs: Tuple[float, float]) -> np.ndarray:
    c0, c1 = coeffs
    mmi = np.asarray(mmi, dtype=float)
    return np.where(mmi < 0, 0.0, 10.0 ** ((mmi - c0) / c1))


def bilal_askan_2014_to_mmi(y_native: np.ndarray, *, imt: str, unit_in: str) -> np.ndarray:
    """PGA/PGV (linear, `unit_in`) -> MMI (linear). Turkey regional model;
    sensitivity channel only (module section notice above)."""
    kind, _period = _parse_imt(imt)
    if kind not in ("PGA", "PGV"):
        raise ValueError(
            f"bilal_askan_2014: only PGA/PGV supported (toolkit has no SA branch), got {imt!r}"
        )
    y_gmice = _to_gmice_native(y_native, imt, unit_in)
    coeffs = _BILAL_PGA_TO_MMI if kind == "PGA" else _BILAL_PGV_TO_MMI
    return _bilal_pgm_to_mmi(y_gmice, coeffs)


def bilal_askan_2014_from_mmi(mmi: np.ndarray, *, imt: str, unit_out: str) -> np.ndarray:
    """MMI (linear) -> PGA/PGV (linear, `unit_out`)."""
    kind, _period = _parse_imt(imt)
    if kind not in ("PGA", "PGV"):
        raise ValueError(f"bilal_askan_2014: only PGA/PGV supported, got {imt!r}")
    coeffs = _BILAL_PGA_TO_MMI if kind == "PGA" else _BILAL_PGV_TO_MMI
    return _from_gmice_native(_bilal_mmi_to_pgm(mmi, coeffs), imt, unit_out)


# ---------------------------------------------------------------------------
# Model registry -- generic convert_to_intensity/convert_from_intensity, so
# `intensity.py` can pick a model by name without an if/elif ladder.
# ---------------------------------------------------------------------------

_ToFn = Callable[..., np.ndarray]
_FromFn = Callable[..., np.ndarray]

MODEL_SCALE: Dict[str, str] = {
    "Zaniniandhofer19": "EMS",
    "WordenEtAl12": "MMI",
    "Bilalandaskan14": "MMI",  # Turkey regional sensitivity channel -- mean-only (no sigma catalogued), see its section notice.
}
_MODEL_TO_FN: Dict[str, _ToFn] = {
    "Zaniniandhofer19": zanini_hofer_2019_to_ems,
    "WordenEtAl12": worden_2012_to_mmi,
    "Bilalandaskan14": bilal_askan_2014_to_mmi,
}
_MODEL_FROM_FN: Dict[str, _FromFn] = {
    "Zaniniandhofer19": zanini_hofer_2019_from_ems,
    "WordenEtAl12": worden_2012_from_mmi,
    "Bilalandaskan14": bilal_askan_2014_from_mmi,
}

DEFAULT_EMS_MODEL = "Zaniniandhofer19"
DEFAULT_MMI_MODEL = "WordenEtAl12"  # masterplan/toolkit default, "Worden 2012 for parity"


def scale_for_model(model: str) -> str:
    if model not in MODEL_SCALE:
        raise KeyError(f"gmice: unknown model {model!r} (available: {sorted(MODEL_SCALE)})")
    return MODEL_SCALE[model]


def convert_to_intensity(y_native: np.ndarray, *, imt: str, unit_in: str, model: str) -> np.ndarray:
    """PGA/PGV/SA (linear, `unit_in`) -> the model's own intensity scale
    (EMS for Zanini & Hofer, MMI for Worden), linear."""
    return _MODEL_TO_FN[model](y_native, imt=imt, unit_in=unit_in)


def convert_from_intensity(value: np.ndarray, *, imt: str, unit_out: str, model: str) -> np.ndarray:
    """Intensity (linear, the model's own scale) -> PGA/PGV/SA (linear,
    `unit_out`)."""
    return _MODEL_FROM_FN[model](value, imt=imt, unit_out=unit_out)


def dintensity_dlny(
    y_native: np.ndarray, *, imt: str, unit_in: str, model: str, eps: float = 1e-3
) -> np.ndarray:
    """Numerical central-difference derivative d(intensity)/d(ln Y) --
    computed by calling `convert_to_intensity` twice at `Y*exp(+-eps)`,
    through the model's own (untouched) coefficient tables, exactly the
    `gmice_adapter.dmmi_dlny` technique (module docstring: a hand-transcribed
    analytic slope repeats the transcription risk this avoids). Scale-
    invariant to a multiplicative unit change in `unit_in` (a unit change is
    only an additive shift in ln-space), so callers may pass any of this
    module's supported linear units."""
    y = np.asarray(y_native, dtype=float)
    y_hi = y * np.exp(eps)
    y_lo = y * np.exp(-eps)
    hi = convert_to_intensity(y_hi, imt=imt, unit_in=unit_in, model=model)
    lo = convert_to_intensity(y_lo, imt=imt, unit_in=unit_in, model=model)
    return (hi - lo) / (2.0 * eps)


# ---------------------------------------------------------------------------
# Published sigma (the GMICE's own conversion scatter) -- transcribed
# VERBATIM from gmice_adapter.py's `_SIGMA_MMI_TABLE`, INCLUDING its
# placeholder/unverified flags (module docstring "Sigma honesty policy").
# G12 (gmpe-set-proposal.md §4.4) transcription-verification is separate,
# later, pre-launch work -- these flags stay prominent until it lands.
# ---------------------------------------------------------------------------

WORDEN_SIGMA_TABLE: Dict[str, float] = {
    # Worden et al. (2012), BSSA 102(1) -- sigma_MMI (MMI given PGM),
    # natural MMI units (not log). CORRECTED + VERIFIED (science-verification
    # pass, web-verified 2026-08-09) against the USGS ShakeMap operational
    # implementation of this exact model -- shakelib/gmice/wgrw12.py
    # (maintained in the model first author's own codebase;
    # https://usgs.github.io/shakelib/_modules/shakelib/gmice/wgrw12.html),
    # which carries SMMI = {PGA: 0.66, PGV: 0.63, SA0.3: 0.82, SA1.0: 0.75,
    # SA3.0: 0.89}. The toolkit's recollected SA entries (0.79/0.73/0.72)
    # were WRONG and are corrected here; PGA/PGV were confirmed unchanged.
    # (The same wgrw12.py source also confirms every c1..c4/t1/t2
    # coefficient in `_WORDEN_COEFFS` above, digit-for-digit.)
    "PGA": 0.66,
    "PGV": 0.63,
    "SA(0.3)": 0.82,
    "SA(1.0)": 0.75,
    "SA(3.0)": 0.89,
}
# Verification basis is the USGS operational implementation (above), not the
# paywalled BSSA primary PDF itself -- stated plainly. As the model's
# authoritative production transcription (first-author-maintained), this
# closes the G12 pre-launch blocker for Worden; anyone re-opening it should
# diff against BSSA 102(1) Tables 4/5 directly.
WORDEN_SIGMA_VERIFIED = True
WORDEN_SIGMA_CITATION = (
    "Worden et al. (2012), BSSA 102(1), sigma_MMI -- verified against USGS "
    "shakelib wgrw12.py operational implementation, 2026-08-09"
)

ZANINI_SIGMA_TABLE: Dict[str, float] = {
    # Zanini & Hofer (2019): 0.70 for both PGA/PGV -- ADOPTED value (G12
    # CLOSED for Zanini, D20 checkpoint condition 2, 2026-08-07, "Z3
    # accepted": research/zanini-gmice-investigation.md §3.3/§5). The
    # paper's OWN published sigma_tot (0.27 PGA / 0.34 PGV, Table 3 --
    # provenance constants below) is regression scatter on 0.5-intensity
    # BINNED MEANS, not per-observation scatter, and is therefore not
    # comparable to Worden's per-observation sigma_MMI (0.66/0.63); using
    # 0.27/0.34 directly here would overstate conversion precision by
    # roughly 2x. The 0.70 placeholder (Peshawa-authorized in the toolkit,
    # 2026-07-06) is coincidentally the more defensible per-observation
    # magnitude, so it is KEPT and relabelled "adopted" rather than
    # "upgraded" to the published-but-incomparable figures.
    "PGA": 0.70,
    "PGV": 0.70,
}
ZANINI_SIGMA_IS_PLACEHOLDER = False  # ADOPTED value (Z3, closed 2026-08-07) -- see table comment; no longer an unverified placeholder.
ZANINI_SIGMA_CITATION = (
    "0.70 (both IMTs) -- adopted per-observation sigma, Peshawa-authorized "
    "2026-07-06, ratified as the adopted value 2026-08-07 (G12/Z3, "
    "research/zanini-gmice-investigation.md); published sigma_tot 0.27 "
    "(PGA) / 0.34 (PGV) is BINNED-MEAN regression scatter, not "
    "per-observation, and is recorded only as provenance "
    "(ZANINI_PUBLISHED_SIGMA_TOTAL_* below), not used directly"
)

# Provenance only (NOT used by `sigma_gmice`/forward math) -- Zanini, Hofer
# & Faleschini (2019), Table 3 ("Main parameters of the proposed
# regressions", form I = a + b*logPGM), transcribed verbatim: sigma_tot is
# the ODR fit's scatter of BINNED (0.5-intensity-bin mean) log-PGM values
# about the regression line, per the paper's own §4.1 methodology -- kept
# here purely so the binned-vs-per-observation caveat above is checkable
# against real numbers, never fed into `sigma_gmice`.
ZANINI_PUBLISHED_SIGMA_TOTAL_PGA: float = 0.27  # Table 3, PGA row, sigma_tot (binned-mean scatter)
ZANINI_PUBLISHED_SIGMA_TOTAL_PGV: float = 0.34  # Table 3, PGV row, sigma_tot (binned-mean scatter)
ZANINI_PUBLISHED_SIGMA_A_PGA: float = 0.30  # Table 3, PGA row, sigma_a (intercept coefficient sigma)
ZANINI_PUBLISHED_SIGMA_B_PGA: float = 0.19  # Table 3, PGA row, sigma_b (slope coefficient sigma)
ZANINI_PUBLISHED_SIGMA_A_PGV: float = 0.15  # Table 3, PGV row, sigma_a
ZANINI_PUBLISHED_SIGMA_B_PGV: float = 0.12  # Table 3, PGV row, sigma_b
ZANINI_PUBLISHED_R2_PGA: float = 0.9476  # Table 3, PGA row, R^2
ZANINI_PUBLISHED_R2_PGV: float = 0.9354  # Table 3, PGV row, R^2

_SIGMA_TABLES: Dict[str, Dict[str, float]] = {
    "WordenEtAl12": WORDEN_SIGMA_TABLE,
    "Zaniniandhofer19": ZANINI_SIGMA_TABLE,
}
_SIGMA_VERIFIED: Dict[str, bool] = {
    "WordenEtAl12": WORDEN_SIGMA_VERIFIED,
    "Zaniniandhofer19": not ZANINI_SIGMA_IS_PLACEHOLDER,
}
_SIGMA_CITATION: Dict[str, str] = {
    "WordenEtAl12": WORDEN_SIGMA_CITATION,
    "Zaniniandhofer19": ZANINI_SIGMA_CITATION,
}


def sigma_gmice(model: str, imt: str) -> float:
    """Published sigma_intensity (the GMICE's own conversion scatter) for
    one model/IMT. Raises `NotImplementedError` for any model/IMT not
    catalogued -- an honest gap, never a guessed number (same policy as the
    toolkit's `sigma_gmice`)."""
    table = _SIGMA_TABLES.get(model)
    if table is None or imt not in table:
        raise NotImplementedError(
            f"gmice.sigma_gmice: no published sigma catalogued for "
            f"model={model!r}, imt={imt!r} (catalogued: "
            f"{ {m: sorted(t) for m, t in _SIGMA_TABLES.items()} })"
        )
    return float(table[imt])


def sigma_gmice_verified(model: str) -> bool:
    return bool(_SIGMA_VERIFIED[model])


def sigma_gmice_citation(model: str) -> str:
    return _SIGMA_CITATION[model]


@dataclass(frozen=True)
class GmiceModel:
    """A small, introspectable handle on one registered GMICE model --
    convenience for `intensity.py`'s per-model dispatch."""

    name: str
    scale: str
    to_intensity: _ToFn
    from_intensity: _FromFn
