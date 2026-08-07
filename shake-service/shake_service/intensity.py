"""VirtualIPE-equivalent: ground-motion field (mu/tau/phi/sigma_model per
IMT, `gmm.GMResult`) -> intensity field (EMS-98 display channel via Zanini &
Hofer 2019, MMI validation channel via Worden et al. 2012), with full
chain-rule sigma propagation (D9's "gmpe_forward prior" step 2 of 2, before
`mvn` conditioning).

Provenance (D9 "extract, don't entangle" — wave B, 2026-08-07)
----------------------------------------------------------------------------
Chain rule reimplemented from the papers, mirroring
SHAKEmaps-Toolkit-v26/modules/hazard/ipe/virtual_ipe.py's own approach
(that module's docstring: "source: USGS ShakeMap 4.0's shakelib/
virtualipe.py, public domain — no code copied, only the physical idea").
Given a ground-motion channel `Y = exp(mean_ln)` (linear) and an intensity
function `f = GMICE(Y)` (`shake_service.gmice`):

    intensity     = f(Y)
    tau_intensity   = |df/dlnY| * tau_lnY
    phi_intensity   = sqrt( (df/dlnY)^2 * phi_lnY^2 + sigma_GMICE^2 )
    sigma_model_int = |df/dlnY| * sigma_model_lnY
    sigma_intensity = sqrt( tau_intensity^2 + phi_intensity^2 + sigma_model_int^2 )

`df/dlnY` is `gmice.dintensity_dlny` (a numerical derivative through the
GMICE's own untouched code). `sigma_GMICE` is the model's own published
conversion scatter (`gmice.sigma_gmice`) — folded into phi (within-event),
never tau or the epistemic channel, because it is a point-level, within-
event phenomenon (virtual_ipe.py's own rationale, reproduced here).

Adaptation from virtual_ipe.py's exact formula (documented, not a behaviour
change)
----------------------------------------------------------------------------
virtual_ipe.py computes `sigma_intensity` by applying the SAME chain-rule
derivative to the toolkit `GMResult`'s own (separately-carried) TOTAL
`sigma` field, then proves algebraically that this equals
`sqrt(tau_intensity^2 + phi_intensity^2 + sigma_model_intensity^2)` exactly,
via the Option-C identity `tau_lnY^2 + phi_lnY^2 + sigma_model_lnY^2 ==
sigma_lnY^2` that already holds upstream. `shake_service.gmm.GMResult` does
not carry a separate total-sigma field at all (it IS an Option-C
decomposition, tau/phi/sigma_model only) — so this module computes
`sigma_intensity` directly as `sqrt(tau_intensity^2 + phi_intensity^2 +
sigma_model_intensity^2)`, which is the SAME algebraic identity virtual_ipe.py
proves, just entered from the already-decomposed side. No numeric behaviour
change versus what virtual_ipe.py would produce for the same inputs.

EMS/MMI driver policy — UPDATED 2026-08-07 (D20 checkpoint condition 2,
Option A; `docs/research/zanini-gmice-investigation.md`)
----------------------------------------------------------------------------
Originally ("PGV-driven with PGA fallback", D9 task scope) BOTH channels
were computed from PGV at every site with a PGA fallback. That is still
true for the **MMI validation channel** (Worden et al. 2012) — PGV
correlates better with felt/damage intensity at the periods that matter for
masonry/soft-story stock, the standard ShakeMap-family rationale, and
Worden's PGA-MMI/PGV-MMI pair stays physically consistent across the whole
range (verified in the investigation above).

The **EMS-98 DISPLAY channel** (Zanini & Hofer 2019) is now **PGA-DRIVEN
ONLY**: Zanini's independently-fit PGV-EMS coefficient pair is a published,
verified model defect (see `gmice.py`'s "RETIRED-FROM-FORWARD-USE NOTICE")
that produces an unbounded, non-physical PGV/PGA ratio at higher
intensities — already material inside the paper's own 2.0-9.5 stated
applicability and inside this app's operating range. `compute_intensity`
therefore branches on `gmice.scale_for_model(model)`: `"EMS"` takes the
PGA-only path (no PGV computation at all, `driver` is always `'PGA'`), and
`"MMI"` keeps the original PGV-driven-with-PGA-fallback path unchanged.
`IntensityChannel.driver` still records which ground-motion channel was
used at each site (`'PGV'` or `'PGA'`), so a product/consumer can audit it
either way.

EMS validity clamp (Z2, accepted 2026-08-07)
----------------------------------------------------------------------------
Zanini & Hofer (2019)'s own stated applicability is `2.0 <= I_EMS-98 <=
9.5` (paper Table 3 / §3.4; fit on Mw 3.2-6.1 Italian events). The EMS
channel's `mean` is clamped to `[gmice.ZANINI_EMS_VALIDITY_MIN,
gmice.ZANINI_EMS_VALIDITY_MAX]` at this module's writer boundary (before
any later product-level [1,12] display clamp) rather than quoting a line
extrapolating outside the model's own validated range. `clamped` is a
per-site boolean array recording where the RAW (pre-clamp) value fell
outside that envelope, so a product/export can disclose the clamp honestly
instead of silently reporting a clipped number as if it were the model's
raw output. The MMI channel is never clamped by this module (Worden has no
equivalent stated envelope in scope here); its `clamped` array is always
all-`False`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from shake_service import gmice
from shake_service.gmm import GMResult

# Below this linear ground-motion value a channel is treated as "not usable"
# for driving the intensity conversion (guards a degenerate near-zero site,
# not a real physical floor) -- falls back to the other channel.
MIN_PGM_LINEAR: float = 1e-9


@dataclass(frozen=True)
class IntensityChannel:
    """One intensity field (EMS or MMI) derived from a `GMResult`, same
    (N,) site-flattened shape as the input channels."""

    scale: str  # "EMS" | "MMI"
    model: str  # gmice model name, e.g. "Zaniniandhofer19" | "WordenEtAl12"
    mean: np.ndarray  # linear intensity (continuous; clamp only at a writer boundary)
    sigma: np.ndarray  # total sigma (tau^2+phi^2+sigma_model^2)**0.5
    tau: np.ndarray
    phi: np.ndarray
    sigma_model: np.ndarray
    driver: np.ndarray  # dtype='<U3' per-site: "PGV" | "PGA"
    sigma_gmice_pgv: float
    sigma_gmice_pga: float
    sigma_gmice_verified: bool
    sigma_gmice_citation: str
    clamped: np.ndarray = None  # type: ignore[assignment]  # bool, per-site: True where the RAW value fell outside the EMS validity envelope (module docstring "EMS validity clamp") and was clamped; always all-False for MMI. `compute_intensity` always supplies a real array -- default `None` exists only so pre-existing manual-construction call sites (synthetic test fixtures) that predate this field keep working unchanged.


def _chain_rule_channel(
    mean_ln: np.ndarray,
    tau_ln: np.ndarray,
    phi_ln: np.ndarray,
    sigma_model_ln: np.ndarray,
    *,
    imt: str,
    unit_in: str,
    model: str,
) -> dict[str, np.ndarray]:
    """The chain-rule math (module docstring) for ONE ground-motion channel
    (e.g. all-PGV, or all-PGA) over a site array. Returns a dict with
    mean/tau/phi/sigma_model/sigma, all same shape as the inputs."""
    y_native = np.exp(np.asarray(mean_ln, dtype=float))
    mean = gmice.convert_to_intensity(y_native, imt=imt, unit_in=unit_in, model=model)
    deriv = gmice.dintensity_dlny(y_native, imt=imt, unit_in=unit_in, model=model)
    sigma_g = gmice.sigma_gmice(model, imt)

    tau_lnY = np.asarray(tau_ln, dtype=float)
    phi_lnY = np.asarray(phi_ln, dtype=float)
    sigma_model_lnY = np.asarray(sigma_model_ln, dtype=float)

    tau = np.abs(deriv) * tau_lnY
    phi = np.sqrt((deriv * phi_lnY) ** 2 + sigma_g**2)
    sigma_model = np.abs(deriv) * sigma_model_lnY
    sigma = np.sqrt(tau**2 + phi**2 + sigma_model**2)

    return {
        "mean": mean,
        "tau": tau,
        "phi": phi,
        "sigma_model": sigma_model,
        "sigma": sigma,
        "deriv": deriv,
    }


def compute_intensity(gm: GMResult, *, model: str, min_pgm: float = MIN_PGM_LINEAR) -> IntensityChannel:
    """Ground-motion `GMResult` -> one `IntensityChannel` (EMS for
    `model='Zaniniandhofer19'`, MMI for `model='WordenEtAl12'`).

    EMS is PGA-driven ONLY; MMI is PGV-driven with a per-site PGA fallback
    (module docstring "EMS/MMI driver policy — UPDATED 2026-08-07").

    Requires `gm.imt_keys` to include both "PGA" and "PGV" (true for
    `gmm.compute_mixture`'s output, `gmm.IMT_KEYS`) -- PGA is always used;
    PGV is only read for the MMI (non-EMS) path.
    """
    scale = gmice.scale_for_model(model)

    pga_i = gm.imt_index("PGA")
    pga_out = _chain_rule_channel(
        gm.mean_ln[pga_i], gm.tau[pga_i], gm.phi[pga_i], gm.sigma_model[pga_i],
        imt="PGA", unit_in="g", model=model,
    )

    if scale == "EMS":
        # Option A (D20 checkpoint condition 2, CLOSED 2026-08-07) — PGA
        # driven ONLY, Zanini's PGV-EMS pair intentionally not consulted
        # here (module docstring, `gmice.py`'s "RETIRED-FROM-FORWARD-USE
        # NOTICE"). `min_pgm`/PGV fallback logic below simply does not
        # apply to this branch.
        mean = pga_out["mean"]
        sigma = pga_out["sigma"]
        tau = pga_out["tau"]
        phi = pga_out["phi"]
        sigma_model = pga_out["sigma_model"]
        driver = np.full(mean.shape, "PGA", dtype="<U3")
        clamped = (mean < gmice.ZANINI_EMS_VALIDITY_MIN) | (mean > gmice.ZANINI_EMS_VALIDITY_MAX)
        mean = np.clip(mean, gmice.ZANINI_EMS_VALIDITY_MIN, gmice.ZANINI_EMS_VALIDITY_MAX)
    else:
        pgv_i = gm.imt_index("PGV")
        pgv_native = gm.to_linear("PGV")  # cm/s
        pgv_out = _chain_rule_channel(
            gm.mean_ln[pgv_i], gm.tau[pgv_i], gm.phi[pgv_i], gm.sigma_model[pgv_i],
            imt="PGV", unit_in="cm/s", model=model,
        )
        valid_pgv = np.isfinite(pgv_native) & (pgv_native > min_pgm)
        driver = np.where(valid_pgv, "PGV", "PGA")

        def _select(key: str) -> np.ndarray:
            return np.where(valid_pgv, pgv_out[key], pga_out[key])

        mean = _select("mean")
        sigma = _select("sigma")
        tau = _select("tau")
        phi = _select("phi")
        sigma_model = _select("sigma_model")
        clamped = np.zeros(mean.shape, dtype=bool)  # no MMI validity clamp in scope

    return IntensityChannel(
        scale=scale,
        model=model,
        mean=mean,
        sigma=sigma,
        tau=tau,
        phi=phi,
        sigma_model=sigma_model,
        driver=driver,
        clamped=clamped,
        sigma_gmice_pgv=float(gmice.sigma_gmice(model, "PGV")),
        sigma_gmice_pga=float(gmice.sigma_gmice(model, "PGA")),
        sigma_gmice_verified=gmice.sigma_gmice_verified(model),
        sigma_gmice_citation=gmice.sigma_gmice_citation(model),
    )


def compute_ems(gm: GMResult, *, model: str = gmice.DEFAULT_EMS_MODEL) -> IntensityChannel:
    """Convenience wrapper: the EMS-98 display channel (default Zanini & Hofer 2019)."""
    return compute_intensity(gm, model=model)


def compute_mmi(gm: GMResult, *, model: str = gmice.DEFAULT_MMI_MODEL) -> IntensityChannel:
    """Convenience wrapper: the MMI validation channel (default Worden et al. 2012)."""
    return compute_intensity(gm, model=model)
