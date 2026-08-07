"""VirtualIPE-equivalent chain-rule engine: hand-computed reference case,
Option-C identity preservation, PGV-driven/PGA-fallback selection, and
integration shape/finiteness checks against a real `gmm.compute_mixture`
grid."""

from __future__ import annotations

import numpy as np
import pytest

from shake_service import gmice, gmm, intensity, vs30


# ---------------------------------------------------------------------------
# Hand-computed reference case (single site, values chosen by hand) --
# independently re-derives the chain rule without calling
# `intensity._chain_rule_channel`, so a shared bug would still be caught.
# ---------------------------------------------------------------------------


def test_chain_rule_matches_hand_computation_single_site_ems_pgv():
    mean_ln = np.array([np.log(8.0)])  # PGV = 8 cm/s
    tau_ln = np.array([0.35])
    phi_ln = np.array([0.55])
    sigma_model_ln = np.array([0.12])

    out = intensity._chain_rule_channel(
        mean_ln, tau_ln, phi_ln, sigma_model_ln, imt="PGV", unit_in="cm/s", model="Zaniniandhofer19",
    )

    # Independent reference: central difference computed by hand from
    # gmice.zanini_hofer_2019_to_ems (NOT via gmice.dintensity_dlny).
    y = 8.0
    eps = 1e-3
    hi = gmice.zanini_hofer_2019_to_ems(np.array([y * np.exp(eps)]), imt="PGV", unit_in="cm/s")[0]
    lo = gmice.zanini_hofer_2019_to_ems(np.array([y * np.exp(-eps)]), imt="PGV", unit_in="cm/s")[0]
    deriv_ref = (hi - lo) / (2 * eps)
    sigma_g_ref = 0.70  # gmice.ZANINI_SIGMA_TABLE["PGV"]

    tau_ref = abs(deriv_ref) * 0.35
    phi_ref = np.sqrt((deriv_ref * 0.55) ** 2 + sigma_g_ref**2)
    sigma_model_ref = abs(deriv_ref) * 0.12
    sigma_ref = np.sqrt(tau_ref**2 + phi_ref**2 + sigma_model_ref**2)
    mean_ref = 4.16 + 1.62 * np.log10(y)  # Zanini PGV->EMS, hand-transcribed

    assert out["mean"][0] == pytest.approx(mean_ref, rel=1e-8)
    assert out["tau"][0] == pytest.approx(tau_ref, rel=1e-6)
    assert out["phi"][0] == pytest.approx(phi_ref, rel=1e-6)
    assert out["sigma_model"][0] == pytest.approx(sigma_model_ref, rel=1e-6)
    assert out["sigma"][0] == pytest.approx(sigma_ref, rel=1e-6)


def test_chain_rule_matches_hand_computation_single_site_mmi_pga():
    mean_ln = np.array([np.log(0.12)])  # PGA = 0.12 g
    tau_ln = np.array([0.30])
    phi_ln = np.array([0.50])
    sigma_model_ln = np.array([0.08])

    out = intensity._chain_rule_channel(
        mean_ln, tau_ln, phi_ln, sigma_model_ln, imt="PGA", unit_in="g", model="WordenEtAl12",
    )

    y_cm_s2 = 0.12 * 980.665
    log_y = np.log10(y_cm_s2)
    c1, c2, c3, c4, t1 = 1.78, 1.55, -1.60, 3.70, 1.57
    mean_ref = c1 + c2 * log_y if log_y <= t1 else c3 + c4 * log_y

    eps = 1e-3
    y_g = 0.12
    hi = gmice.worden_2012_to_mmi(np.array([y_g * np.exp(eps)]), imt="PGA", unit_in="g")[0]
    lo = gmice.worden_2012_to_mmi(np.array([y_g * np.exp(-eps)]), imt="PGA", unit_in="g")[0]
    deriv_ref = (hi - lo) / (2 * eps)
    sigma_g_ref = 0.66  # gmice.WORDEN_SIGMA_TABLE["PGA"]

    tau_ref = abs(deriv_ref) * 0.30
    phi_ref = np.sqrt((deriv_ref * 0.50) ** 2 + sigma_g_ref**2)
    sigma_model_ref = abs(deriv_ref) * 0.08
    sigma_ref = np.sqrt(tau_ref**2 + phi_ref**2 + sigma_model_ref**2)

    assert out["mean"][0] == pytest.approx(mean_ref, rel=1e-8)
    assert out["tau"][0] == pytest.approx(tau_ref, rel=1e-6)
    assert out["phi"][0] == pytest.approx(phi_ref, rel=1e-6)
    assert out["sigma_model"][0] == pytest.approx(sigma_model_ref, rel=1e-6)
    assert out["sigma"][0] == pytest.approx(sigma_ref, rel=1e-6)


# ---------------------------------------------------------------------------
# Option-C identity: sigma^2 == tau^2 + phi^2 + sigma_model^2, by
# construction -- re-asserted here as a standalone property, any model/imt.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("model,imt,unit_in,y", [
    ("Zaniniandhofer19", "PGA", "g", 0.2),
    ("Zaniniandhofer19", "PGV", "cm/s", 15.0),
    ("WordenEtAl12", "PGA", "g", 0.2),
    ("WordenEtAl12", "PGV", "cm/s", 15.0),
])
def test_option_c_identity_holds(model, imt, unit_in, y):
    out = intensity._chain_rule_channel(
        np.array([np.log(y)]), np.array([0.3]), np.array([0.5]), np.array([0.1]),
        imt=imt, unit_in=unit_in, model=model,
    )
    lhs = out["sigma"][0] ** 2
    rhs = out["tau"][0] ** 2 + out["phi"][0] ** 2 + out["sigma_model"][0] ** 2
    assert lhs == pytest.approx(rhs, rel=1e-10)


# ---------------------------------------------------------------------------
# PGV-driven / PGA-fallback selection -- MMI (Worden) channel ONLY.
# The EMS (Zanini) channel's driver policy changed 2026-08-07 (D20
# checkpoint condition 2, Option A): see "EMS is PGA-driven only" below.
# ---------------------------------------------------------------------------


def _toy_gmresult(pgv_mean_ln, pga_mean_ln) -> gmm.GMResult:
    """A 2-site, 2-IMT (PGA, PGV) toy GMResult for driver-selection tests --
    bypasses hazardlib entirely (pure dataclass construction)."""
    n = len(pgv_mean_ln)
    imt_keys = ("PGA", "PGV")
    mean_ln = np.stack([np.asarray(pga_mean_ln, dtype=float), np.asarray(pgv_mean_ln, dtype=float)])
    tau = np.full((2, n), 0.3)
    phi = np.full((2, n), 0.5)
    sigma_model = np.full((2, n), 0.1)
    return gmm.GMResult(
        imt_keys=imt_keys, band="moderate", weights={},
        mean_ln=mean_ln, tau=tau, phi=phi, sigma_model=sigma_model,
        per_branch_mean_ln={}, extrapolation=gmm.compute_extrapolation_flags(5.5, 10.0, "moderate", True),
        in_zagros_polygon=True,
    )


def test_mmi_driver_is_pgv_when_pgv_valid():
    gm = _toy_gmresult(pgv_mean_ln=[np.log(5.0), np.log(20.0)], pga_mean_ln=[np.log(0.05), np.log(0.2)])
    out = intensity.compute_mmi(gm)
    assert list(out.driver) == ["PGV", "PGV"]


def test_mmi_driver_falls_back_to_pga_when_pgv_invalid():
    # Site 0: PGV effectively zero (below MIN_PGM_LINEAR) -> PGA fallback.
    # Site 1: normal PGV -> PGV driven.
    gm = _toy_gmresult(
        pgv_mean_ln=[np.log(1e-15), np.log(20.0)],
        pga_mean_ln=[np.log(0.05), np.log(0.2)],
    )
    out = intensity.compute_mmi(gm)
    assert list(out.driver) == ["PGA", "PGV"]
    # site 0's mean must equal the PGA-only chain-rule result exactly
    pga_only = intensity._chain_rule_channel(
        gm.mean_ln[0][:1], gm.tau[0][:1], gm.phi[0][:1], gm.sigma_model[0][:1],
        imt="PGA", unit_in="g", model="WordenEtAl12",
    )
    assert out.mean[0] == pytest.approx(pga_only["mean"][0])


# ---------------------------------------------------------------------------
# EMS is PGA-driven ONLY (D20 checkpoint condition 2, Option A, closed
# 2026-08-07) -- `research/zanini-gmice-investigation.md`. Zanini's PGV-EMS
# coefficient pair is retired from this forward path regardless of whether
# PGV itself is "valid" by the old fallback rule; driver must always read
# "PGA", and the mean must match a direct PGA-only chain-rule computation.
# ---------------------------------------------------------------------------


def test_ems_driver_is_always_pga_even_when_pgv_is_valid():
    gm = _toy_gmresult(pgv_mean_ln=[np.log(5.0), np.log(20.0)], pga_mean_ln=[np.log(0.05), np.log(0.2)])
    out = intensity.compute_ems(gm)
    assert list(out.driver) == ["PGA", "PGA"]


def test_ems_mean_matches_pga_only_chain_rule_regardless_of_pgv():
    # Two GMResults that differ ONLY in their PGV column -- the EMS output
    # must be identical, proving PGV is never consulted on this path.
    gm_a = _toy_gmresult(pgv_mean_ln=[np.log(5.0)], pga_mean_ln=[np.log(0.05)])
    gm_b = _toy_gmresult(pgv_mean_ln=[np.log(500.0)], pga_mean_ln=[np.log(0.05)])
    out_a = intensity.compute_ems(gm_a)
    out_b = intensity.compute_ems(gm_b)
    assert out_a.mean[0] == pytest.approx(out_b.mean[0])

    pga_only = intensity._chain_rule_channel(
        gm_a.mean_ln[0], gm_a.tau[0], gm_a.phi[0], gm_a.sigma_model[0],
        imt="PGA", unit_in="g", model="Zaniniandhofer19",
    )
    # pga_only["mean"] is the RAW (pre-clamp) chain-rule value -- compare
    # after applying the same clamp `compute_intensity` applies, since 0.05g
    # is comfortably inside [2.0, 9.5] here so the clamp is a no-op, but do
    # it explicitly rather than assuming that.
    expected = np.clip(pga_only["mean"][0], gmice.ZANINI_EMS_VALIDITY_MIN, gmice.ZANINI_EMS_VALIDITY_MAX)
    assert out_a.mean[0] == pytest.approx(expected)


def test_ems_clamped_flag_true_below_validity_min():
    # A very small PGA (~1e-6 g) drives the raw Zanini PGA-EMS value well
    # below 2.0 -- must be clamped to the floor with `clamped=True`.
    gm = _toy_gmresult(pgv_mean_ln=[np.log(1.0)], pga_mean_ln=[np.log(1e-6)])
    out = intensity.compute_ems(gm)
    assert out.clamped[0] == True  # noqa: E712 -- explicit numpy bool check
    assert out.mean[0] == pytest.approx(gmice.ZANINI_EMS_VALIDITY_MIN)


def test_ems_clamped_flag_true_above_validity_max():
    # A very large PGA (~50g) drives the raw Zanini PGA-EMS value well
    # above 9.5 -- must be clamped to the ceiling with `clamped=True`.
    gm = _toy_gmresult(pgv_mean_ln=[np.log(1.0)], pga_mean_ln=[np.log(50.0)])
    out = intensity.compute_ems(gm)
    assert out.clamped[0] == True  # noqa: E712
    assert out.mean[0] == pytest.approx(gmice.ZANINI_EMS_VALIDITY_MAX)


def test_ems_clamped_flag_false_inside_validity_envelope():
    # A moderate PGA (~0.1g) keeps the raw Zanini value comfortably inside
    # [2.0, 9.5] -- clamped must read False and mean must be the raw value.
    gm = _toy_gmresult(pgv_mean_ln=[np.log(10.0)], pga_mean_ln=[np.log(0.1)])
    out = intensity.compute_ems(gm)
    assert out.clamped[0] == False  # noqa: E712
    assert gmice.ZANINI_EMS_VALIDITY_MIN < out.mean[0] < gmice.ZANINI_EMS_VALIDITY_MAX


def test_mmi_clamped_flag_always_false():
    # No MMI validity clamp in scope -- `clamped` must be all-False even at
    # extreme ground motion.
    gm = _toy_gmresult(pgv_mean_ln=[np.log(1e-9), np.log(5000.0)], pga_mean_ln=[np.log(1e-9), np.log(50.0)])
    out = intensity.compute_mmi(gm)
    assert list(out.clamped) == [False, False]


def test_compute_mmi_uses_worden_model_by_default():
    gm = _toy_gmresult(pgv_mean_ln=[np.log(10.0)], pga_mean_ln=[np.log(0.1)])
    out = intensity.compute_mmi(gm)
    assert out.model == "WordenEtAl12"
    assert out.scale == "MMI"


def test_compute_ems_uses_zanini_model_by_default():
    gm = _toy_gmresult(pgv_mean_ln=[np.log(10.0)], pga_mean_ln=[np.log(0.1)])
    out = intensity.compute_ems(gm)
    assert out.model == "Zaniniandhofer19"
    assert out.scale == "EMS"


# ---------------------------------------------------------------------------
# Integration: a real gmm.compute_mixture grid -> both channels, finite
# everywhere, positive sigma everywhere.
# ---------------------------------------------------------------------------


def test_integration_with_real_gmm_grid_finite_and_positive_sigma():
    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=20.0, spacing_km=10.0)
    gm = gmm.compute_mixture(34.9, 45.9, 15.0, mag_mw=6.0, site_grid=grid)

    ems = intensity.compute_ems(gm)
    mmi = intensity.compute_mmi(gm)

    for channel in (ems, mmi):
        assert np.all(np.isfinite(channel.mean))
        assert np.all(np.isfinite(channel.sigma))
        assert np.all(channel.sigma > 0)
        assert np.all(channel.tau >= 0)
        assert np.all(channel.phi > 0)
        assert channel.mean.shape == (grid.n_sites,)
        assert set(np.unique(channel.driver)) <= {"PGV", "PGA"}
        assert channel.clamped.dtype == np.bool_

    assert ems.scale == "EMS"
    assert mmi.scale == "MMI"
    # EMS is PGA-driven ONLY (D20 checkpoint condition 2, Option A).
    assert set(np.unique(ems.driver)) == {"PGA"}
    # EMS stays within the paper's stated validity envelope (writer-boundary clamp).
    assert ems.mean.min() >= gmice.ZANINI_EMS_VALIDITY_MIN
    assert ems.mean.max() <= gmice.ZANINI_EMS_VALIDITY_MAX
    # sigma honesty flags surfaced on the product -- Zanini sigma is now the
    # ADOPTED value (Z3, closed 2026-08-07); Worden verification stays open.
    assert ems.sigma_gmice_verified is True
    assert mmi.sigma_gmice_verified is False
