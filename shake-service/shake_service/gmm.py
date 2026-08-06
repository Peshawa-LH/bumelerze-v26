"""The core hazardlib GMPE adapter — builds the ContextMaker input for a
site grid around a point-source event, runs the D20 4-branch logic tree,
and combines the branches via the Option-C law-of-total-variance mixture.

Internal numeric contract (binding for the whole service, stated once
here): every `*_ln` field in `GMResult` is natural-log space; PGA and SA
are in units of **g**, PGV is in units of **cm/s**. This is exactly what
`openquake.hazardlib.contexts.get_mean_stds` returns natively (verified
this session against the installed openquake.engine==3.26.2 package) — the
adapter does not convert units, it only combines branches. Anything that
needs linear units (e.g. a sanity check, a product's display layer) should
call `to_linear()` at the boundary, never assume ln-space leaked upstream.

Mixture math (Option C, D20, gmpe-set-proposal-v2.md §4.2 "Between-model
spread handling"):
    mu_mix      = sum_i( w_i * mu_i )
    tau_mix     = sqrt( sum_i( w_i * tau_i^2 ) )
    phi_mix     = sqrt( sum_i( w_i * phi_i^2 ) )
    sigma_model = sqrt( sum_i( w_i * (mu_i - mu_mix)^2 ) )
tau/phi are combined *within* each branch's own within-model uncertainty
(never mixed with the between-model spread); sigma_model is the separate
epistemic channel `mvn` conditioning (a later wave) consumes on its own.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass

import numpy as np
from openquake.hazardlib import imt as imt_mod
from openquake.hazardlib.contexts import RuptureContext, get_mean_stds

from shake_service import config, distances, rupture_params
from shake_service.vs30 import SiteGrid

# The 4 product IMTs (gmpe-set-proposal-v2.md §6.1 example, D20).
IMT_KEYS: tuple[str, ...] = ("PGA", "PGV", "SA(0.3)", "SA(1.0)")


def _imt_objects() -> list:
    return [imt_mod.PGA(), imt_mod.PGV(), imt_mod.SA(0.3), imt_mod.SA(1.0)]


_GSIM_INSTANCE_CACHE: dict[str, object] = {}


def gsim_instance(branch: config.GsimBranch):
    """Import + instantiate (once, cached) the hazardlib GSIM class for a
    D20 logic-tree branch."""
    cached = _GSIM_INSTANCE_CACHE.get(branch.key)
    if cached is not None:
        return cached
    module = importlib.import_module(branch.module)
    cls = getattr(module, branch.class_name)
    instance = cls()
    _GSIM_INSTANCE_CACHE[branch.key] = instance
    return instance


def build_rupture_context(
    mag: float,
    rp: rupture_params.RuptureParams,
    site_grid: SiteGrid,
    dist_est: distances.DistanceEstimate,
) -> RuptureContext:
    """Assemble the hazardlib RuptureContext (a recarray-like object) the
    D20 GSIM set needs: scalar rupture parameters + per-site distance/site
    parameter arrays."""
    n = site_grid.n_sites
    ctx = RuptureContext()
    ctx.mag = mag
    ctx.rake = rp.rake_deg
    ctx.dip = rp.dip_deg
    ctx.ztor = rp.ztor_km
    ctx.sids = np.arange(n)
    ctx.vs30 = site_grid.vs30
    ctx.vs30measured = np.full(n, rp.vs30measured, dtype=bool)
    ctx.z1pt0 = np.full(n, rp.z1pt0, dtype=float)
    ctx.rjb = dist_est.rjb_km
    ctx.rrup = dist_est.rrup_km
    ctx.rx = np.full(n, rp.rx_km, dtype=float)
    return ctx


@dataclass(frozen=True)
class ExtrapolationFlags:
    """Out-of-range tagging (gmpe-set-proposal-v2.md §4.3) — informational,
    never used to exclude a branch from the mixture."""

    depth_extrapolated: bool
    magnitude_extrapolated_branches: tuple[str, ...]
    distance_extrapolated_branches: tuple[str, ...]

    @property
    def any_flag(self) -> bool:
        return bool(
            self.depth_extrapolated
            or self.magnitude_extrapolated_branches
            or self.distance_extrapolated_branches
        )


def compute_extrapolation_flags(
    mag: float, depth_km: float, band: str, in_zagros_polygon: bool
) -> ExtrapolationFlags:
    depth_flag = depth_km > config.DEPTH_EXTRAPOLATION_THRESHOLD_KM

    mag_flagged: list[str] = []
    dist_flagged: list[str] = []
    grid_extent = config.grid_extent_km(band)

    for key, validity in config.BRANCH_VALIDITY.items():
        mag_ceiling = validity.mag_max_ss
        if in_zagros_polygon and validity.mag_max_rv is not None:
            mag_ceiling = validity.mag_max_rv
        if mag < validity.mag_min or mag > mag_ceiling:
            mag_flagged.append(key)
        if grid_extent > validity.max_distance_km:
            dist_flagged.append(key)

    return ExtrapolationFlags(
        depth_extrapolated=depth_flag,
        magnitude_extrapolated_branches=tuple(mag_flagged),
        distance_extrapolated_branches=tuple(dist_flagged),
    )


def mix_option_c(
    mean: np.ndarray, tau: np.ndarray, phi: np.ndarray, weight_vec: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """The Option-C law-of-total-variance mixture, as a standalone pure
    function so it can be unit-tested against an independently-written
    reference computation (see tests/test_gmm.py) without going through
    the full ContextMaker pipeline.

    :param mean: array of branch means, shape (G, ...) — G = number of
        branches on axis 0, any trailing shape (e.g. (M, N) for IMT x site).
    :param tau: same shape as mean, inter-event sigma per branch.
    :param phi: same shape as mean, intra-event sigma per branch.
    :param weight_vec: shape (G,), must sum to 1 (not enforced here — the
        caller's config is the source of truth, checked in config tests).
    :returns: (mean_mix, tau_mix, phi_mix, sigma_model), each with mean's
        trailing shape (the G axis is consumed).
    """
    g = mean.shape[0]
    w = weight_vec.reshape((g,) + (1,) * (mean.ndim - 1))

    mean_mix = np.sum(w * mean, axis=0)
    tau_mix = np.sqrt(np.sum(w * tau**2, axis=0))
    phi_mix = np.sqrt(np.sum(w * phi**2, axis=0))
    sigma_model = np.sqrt(np.sum(w * (mean - mean_mix[None, ...]) ** 2, axis=0))

    return mean_mix, tau_mix, phi_mix, sigma_model


@dataclass(frozen=True)
class GMResult:
    """Mixture ground-motion result for a site grid: one (M, N) array per
    channel (M = len(IMT_KEYS), N = number of sites), all ln-space per the
    module docstring's unit contract."""

    imt_keys: tuple[str, ...]
    band: str
    weights: dict[str, float]

    mean_ln: np.ndarray  # (M, N) mixture mean
    tau: np.ndarray  # (M, N) mixture within-branch inter-event sigma
    phi: np.ndarray  # (M, N) mixture within-branch intra-event sigma
    sigma_model: np.ndarray  # (M, N) between-model epistemic spread

    per_branch_mean_ln: dict[str, np.ndarray]  # branch key -> (M, N), debug/test use
    extrapolation: ExtrapolationFlags
    in_zagros_polygon: bool

    def imt_index(self, imt_key: str) -> int:
        return self.imt_keys.index(imt_key)

    def to_linear(self, imt_key: str) -> np.ndarray:
        """Convenience boundary conversion: exp(mean_ln) for one IMT ->
        g for PGA/SA, cm/s for PGV. Callers needing linear units (product
        export, sanity checks) should use this rather than assuming the
        internal contract."""
        return np.exp(self.mean_ln[self.imt_index(imt_key)])


def compute_mixture(
    event_lat: float,
    event_lon: float,
    event_depth_km: float,
    mag_mw: float,
    site_grid: SiteGrid,
) -> GMResult:
    """Run the full D20 4-branch tree over a site grid and combine via the
    Option-C mixture. This is the single entry point the rest of the
    service (and `mvn` conditioning, in a later wave) calls."""
    band = config.magnitude_band(mag_mw)
    weights = config.band_weights(band)

    rp = rupture_params.derive_rupture_params(event_lat, event_lon, event_depth_km)
    repi = distances.repi_km(event_lat, event_lon, site_grid.lats, site_grid.lons)
    dist_est = distances.expected_rjb_rrup(repi, mag_mw, rp.in_zagros_polygon)

    ctx = build_rupture_context(mag_mw, rp, site_grid, dist_est)

    gsims = [gsim_instance(branch) for branch in config.GSIM_BRANCHES]
    imts = _imt_objects()

    # (4, G, M, N): axis 0 = [mean, sig, tau, phi]
    raw = get_mean_stds(gsims, ctx, imts)
    mean = raw[0]  # (G, M, N)
    tau = raw[2]  # (G, M, N)
    phi = raw[3]  # (G, M, N)

    weight_vec = np.array([weights[b.key] for b in config.GSIM_BRANCHES])  # (G,)
    mean_mix, tau_mix, phi_mix, sigma_model = mix_option_c(mean, tau, phi, weight_vec)

    per_branch_mean = {
        branch.key: mean[i] for i, branch in enumerate(config.GSIM_BRANCHES)
    }

    extrapolation = compute_extrapolation_flags(
        mag_mw, event_depth_km, band, rp.in_zagros_polygon
    )

    return GMResult(
        imt_keys=IMT_KEYS,
        band=band,
        weights=weights,
        mean_ln=mean_mix,
        tau=tau_mix,
        phi=phi_mix,
        sigma_model=sigma_model,
        per_branch_mean_ln=per_branch_mean,
        extrapolation=extrapolation,
        in_zagros_polygon=rp.in_zagros_polygon,
    )
