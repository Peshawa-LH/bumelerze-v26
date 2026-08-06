"""The big one: hazardlib adapter + Option-C mixture correctness, plus the
smoke grid.

The mixture-correctness test independently re-implements the Option-C
formula from raw `get_mean_stds` output — it does NOT call
`shake_service.gmm.mix_option_c` for the reference values, so a bug shared
between production code and test code would still be caught (not a
tautology, per the task brief).
"""

from __future__ import annotations

import numpy as np
import pytest
from openquake.hazardlib import imt as imt_mod
from openquake.hazardlib.contexts import RuptureContext, get_mean_stds

from shake_service import config, gmm, rupture_params, vs30


def _build_single_site_ctx(mag: float, rjb: float, rrup: float, in_zagros: bool) -> RuptureContext:
    rp = rupture_params.derive_rupture_params(34.9 if in_zagros else 33.3, 45.9 if in_zagros else 44.4, 15.0)
    ctx = RuptureContext()
    ctx.mag = mag
    ctx.rake = rp.rake_deg
    ctx.dip = rp.dip_deg
    ctx.ztor = rp.ztor_km
    ctx.sids = np.arange(1)
    ctx.vs30 = np.array([760.0])
    ctx.vs30measured = np.array([False])
    ctx.z1pt0 = np.array([rp.z1pt0])
    ctx.rjb = np.array([rjb])
    ctx.rrup = np.array([rrup])
    ctx.rx = np.array([0.0])
    return ctx


# ---------------------------------------------------------------------------
# Weights sum to 1 (also covered in test_config.py; re-asserted here as the
# precondition the mixture test below depends on)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("band", ["small", "moderate", "major"])
def test_band_weights_precondition(band):
    assert sum(config.BAND_WEIGHTS[band].values()) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# THE BIG ONE: independent-reference Option-C mixture correctness
# ---------------------------------------------------------------------------


def test_mixture_matches_independent_reference_computation():
    band = "moderate"
    weights = config.BAND_WEIGHTS[band]
    mag = 6.0
    rjb = 20.0
    rrup = 21.0
    in_zagros = True

    ctx = _build_single_site_ctx(mag, rjb, rrup, in_zagros)
    gsims = [gmm.gsim_instance(b) for b in config.GSIM_BRANCHES]
    imts = [imt_mod.PGA(), imt_mod.PGV(), imt_mod.SA(0.3), imt_mod.SA(1.0)]

    raw = get_mean_stds(gsims, ctx, imts)  # (4, G, M, N)
    mean, tau, phi = raw[0], raw[2], raw[3]

    # --- independent reference computation (hand-written here, not reusing
    # shake_service.gmm.mix_option_c) ---
    g = len(config.GSIM_BRANCHES)
    m = len(imts)
    ref_mean = np.zeros(m)
    ref_tau = np.zeros(m)
    ref_phi = np.zeros(m)
    for imt_i in range(m):
        wsum_mean = 0.0
        wsum_tau2 = 0.0
        wsum_phi2 = 0.0
        for branch_i, branch in enumerate(config.GSIM_BRANCHES):
            w = weights[branch.key]
            wsum_mean += w * mean[branch_i, imt_i, 0]
            wsum_tau2 += w * tau[branch_i, imt_i, 0] ** 2
            wsum_phi2 += w * phi[branch_i, imt_i, 0] ** 2
        ref_mean[imt_i] = wsum_mean
        ref_tau[imt_i] = wsum_tau2**0.5
        ref_phi[imt_i] = wsum_phi2**0.5

    ref_sigma_model = np.zeros(m)
    for imt_i in range(m):
        acc = 0.0
        for branch_i, branch in enumerate(config.GSIM_BRANCHES):
            w = weights[branch.key]
            acc += w * (mean[branch_i, imt_i, 0] - ref_mean[imt_i]) ** 2
        ref_sigma_model[imt_i] = acc**0.5

    # --- now the production function ---
    weight_vec = np.array([weights[b.key] for b in config.GSIM_BRANCHES])
    prod_mean, prod_tau, prod_phi, prod_sigma_model = gmm.mix_option_c(mean, tau, phi, weight_vec)

    assert prod_mean[:, 0] == pytest.approx(ref_mean, rel=1e-10)
    assert prod_tau[:, 0] == pytest.approx(ref_tau, rel=1e-10)
    assert prod_phi[:, 0] == pytest.approx(ref_phi, rel=1e-10)
    assert prod_sigma_model[:, 0] == pytest.approx(ref_sigma_model, rel=1e-10)

    # sanity: g branches actually contributed (weights nontrivial)
    assert g == 4


def test_mixture_sigma_model_zero_when_branch_means_equal_degenerate():
    # Degenerate check: if every branch reports the identical mean, the
    # between-model spread must be exactly zero, regardless of tau/phi.
    g, m, n = 4, 2, 3
    mean = np.full((g, m, n), -2.5)
    tau = np.random.default_rng(0).uniform(0.2, 0.4, size=(g, m, n))
    phi = np.random.default_rng(1).uniform(0.3, 0.6, size=(g, m, n))
    weight_vec = np.array([0.25, 0.15, 0.35, 0.25])

    mean_mix, tau_mix, phi_mix, sigma_model = gmm.mix_option_c(mean, tau, phi, weight_vec)

    assert np.allclose(sigma_model, 0.0, atol=1e-12)
    assert np.allclose(mean_mix, -2.5)
    # tau/phi mixtures must still be positive (within-model spread survives
    # even when branches agree on the mean)
    assert np.all(tau_mix > 0)
    assert np.all(phi_mix > 0)


def test_mixture_weight_vec_sum_precondition_matches_config():
    for band in ("small", "moderate", "major"):
        weight_vec = np.array([config.BAND_WEIGHTS[band][k] for k in config.GSIM_KEYS])
        assert weight_vec.sum() == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# compute_mixture() integration: shapes, finiteness, weights match band
# ---------------------------------------------------------------------------


def test_compute_mixture_shapes_and_band_selection():
    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=50.0, spacing_km=25.0)
    res = gmm.compute_mixture(34.9, 45.9, 15.0, mag_mw=6.0, site_grid=grid)

    assert res.band == "moderate"
    assert res.weights == config.BAND_WEIGHTS["moderate"]
    m = len(res.imt_keys)
    n = grid.n_sites
    assert res.mean_ln.shape == (m, n)
    assert res.tau.shape == (m, n)
    assert res.phi.shape == (m, n)
    assert res.sigma_model.shape == (m, n)
    assert np.all(np.isfinite(res.mean_ln))
    assert np.all(np.isfinite(res.tau))
    assert np.all(np.isfinite(res.phi))
    assert np.all(np.isfinite(res.sigma_model))
    assert np.all(res.tau > 0)
    assert np.all(res.phi > 0)


def test_compute_mixture_in_zagros_polygon_true_for_halabja():
    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=20.0, spacing_km=20.0)
    res = gmm.compute_mixture(34.9, 45.9, 19.0, mag_mw=7.3, site_grid=grid)
    assert res.in_zagros_polygon is True
    assert res.band == "major"


def test_compute_mixture_to_linear_conversion():
    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=20.0, spacing_km=20.0)
    res = gmm.compute_mixture(34.9, 45.9, 15.0, mag_mw=5.5, site_grid=grid)
    pga_linear = res.to_linear("PGA")
    assert np.all(pga_linear > 0)
    assert np.allclose(pga_linear, np.exp(res.mean_ln[res.imt_index("PGA")]))


def test_extrapolation_flags_depth_over_40():
    flags = gmm.compute_extrapolation_flags(mag=5.0, depth_km=55.0, band="small", in_zagros_polygon=True)
    assert flags.depth_extrapolated is True


def test_extrapolation_flags_depth_under_40():
    flags = gmm.compute_extrapolation_flags(mag=5.0, depth_km=15.0, band="small", in_zagros_polygon=True)
    assert flags.depth_extrapolated is False


def test_extrapolation_flags_major_band_distance_flags_short_ceiling_branches():
    # major band = 300 km grid extent; ASB14 and KALE15 ceilings are 200 km.
    flags = gmm.compute_extrapolation_flags(mag=6.8, depth_km=10.0, band="major", in_zagros_polygon=True)
    assert "ASB14" in flags.distance_extrapolated_branches
    assert "KALE15" in flags.distance_extrapolated_branches
    assert "BSSA14" not in flags.distance_extrapolated_branches  # valid to 400 km


def test_extrapolation_flags_small_band_no_distance_flags():
    # small band = 100 km grid extent; every branch's ceiling is >= 200 km.
    flags = gmm.compute_extrapolation_flags(mag=4.0, depth_km=10.0, band="small", in_zagros_polygon=True)
    assert flags.distance_extrapolated_branches == ()


def test_extrapolation_flags_magnitude_below_floor():
    # M3.0 is below every branch's mag_min except BSSA14 (3.0)
    flags = gmm.compute_extrapolation_flags(mag=3.0, depth_km=10.0, band="small", in_zagros_polygon=True)
    assert "CY14" in flags.magnitude_extrapolated_branches
    assert "ASB14" in flags.magnitude_extrapolated_branches
    assert "KALE15" in flags.magnitude_extrapolated_branches
    assert "BSSA14" not in flags.magnitude_extrapolated_branches


# ---------------------------------------------------------------------------
# Smoke grid: M6, 35.5N 45.5E, 50x50 sites — plausible finite ln-PGA everywhere
# ---------------------------------------------------------------------------


def test_smoke_grid_m6_halabja_region_finite_and_plausible():
    grid = vs30.build_grid_km_spacing(35.5, 45.5, half_extent_km=125.0, spacing_km=5.1)
    assert grid.n_sites >= 2500  # ~50x50

    res = gmm.compute_mixture(35.5, 45.5, event_depth_km=19.0, mag_mw=6.0, site_grid=grid)

    assert np.all(np.isfinite(res.mean_ln))
    assert np.all(np.isfinite(res.tau))
    assert np.all(np.isfinite(res.phi))
    assert np.all(np.isfinite(res.sigma_model))

    pga_g = res.to_linear("PGA")
    assert np.all(pga_g > 1e-5)
    assert np.all(pga_g < 2.0)

    pgv_cms = res.to_linear("PGV")
    assert np.all(np.isfinite(pgv_cms))
    assert np.all(pgv_cms > 0)
