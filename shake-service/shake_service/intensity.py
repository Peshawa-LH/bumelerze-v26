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

EMS/MMI driver policy ("PGV-driven with PGA fallback", D9 task scope)
----------------------------------------------------------------------------
Both the EMS display channel (Zanini & Hofer 2019) and the MMI validation
channel (Worden et al. 2012) are computed from **PGV** at every site by
default (PGV correlates better with felt/damage intensity at the periods
that matter for masonry/soft-story stock — the standard ShakeMap-family
rationale for preferring PGV-driven MMI/EMS where both are available), with
a per-site fallback to **PGA** wherever the PGV channel is not usable
(non-finite or <= `MIN_PGM_LINEAR`, e.g. a pathological/zero grid value).
`IntensityChannel.driver` records which ground-motion channel was actually
used at each site (`'PGV'` or `'PGA'`), so a product/consumer can audit it.
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
    `model='Zaniniandhofer19'`, MMI for `model='WordenEtAl12'`), PGV-driven
    with a per-site PGA fallback (module docstring policy).

    Requires `gm.imt_keys` to include both "PGA" and "PGV" (true for
    `gmm.compute_mixture`'s output, `gmm.IMT_KEYS`).
    """
    pga_i = gm.imt_index("PGA")
    pgv_i = gm.imt_index("PGV")

    pgv_native = gm.to_linear("PGV")  # cm/s
    pga_native = gm.to_linear("PGA")  # g

    pgv_out = _chain_rule_channel(
        gm.mean_ln[pgv_i], gm.tau[pgv_i], gm.phi[pgv_i], gm.sigma_model[pgv_i],
        imt="PGV", unit_in="cm/s", model=model,
    )
    pga_out = _chain_rule_channel(
        gm.mean_ln[pga_i], gm.tau[pga_i], gm.phi[pga_i], gm.sigma_model[pga_i],
        imt="PGA", unit_in="g", model=model,
    )

    valid_pgv = np.isfinite(pgv_native) & (pgv_native > min_pgm)
    driver = np.where(valid_pgv, "PGV", "PGA")

    def _select(key: str) -> np.ndarray:
        return np.where(valid_pgv, pgv_out[key], pga_out[key])

    return IntensityChannel(
        scale=gmice.scale_for_model(model),
        model=model,
        mean=_select("mean"),
        sigma=_select("sigma"),
        tau=_select("tau"),
        phi=_select("phi"),
        sigma_model=_select("sigma_model"),
        driver=driver,
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
