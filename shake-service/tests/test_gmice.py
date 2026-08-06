"""GMICE round-trips, unit-conversion boundary, sigma-flag honesty, and the
discovered-and-fixed Worden SA branch-selection bug (gmice.py docstring)."""

from __future__ import annotations

import numpy as np
import pytest

from shake_service import gmice

# ---------------------------------------------------------------------------
# Round-trips (Zanini & Hofer 2019 EMS, Worden 2012 MMI) -- both directions,
# both native-unit paths (g and cm/s^2 for PGA; cm/s for PGV).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("unit_in", ["g", "cm/s^2"])
def test_zanini_pga_round_trip(unit_in):
    pga = np.array([0.001, 0.01, 0.05, 0.1, 0.3, 0.8])
    if unit_in == "cm/s^2":
        pga = pga * 980.665
    ems = gmice.zanini_hofer_2019_to_ems(pga, imt="PGA", unit_in=unit_in)
    back = gmice.zanini_hofer_2019_from_ems(ems, imt="PGA", unit_out=unit_in)
    assert back == pytest.approx(pga, rel=1e-9)


def test_zanini_pgv_round_trip():
    pgv = np.array([0.1, 1.0, 5.0, 20.0, 60.0])
    ems = gmice.zanini_hofer_2019_to_ems(pgv, imt="PGV", unit_in="cm/s")
    back = gmice.zanini_hofer_2019_from_ems(ems, imt="PGV", unit_out="cm/s")
    assert back == pytest.approx(pgv, rel=1e-9)


def test_zanini_rejects_sa():
    # SHAKEgmice.Zaniniandhofer19 has no SA branch -- honest rejection, not
    # a silent fabrication.
    with pytest.raises(ValueError):
        gmice.zanini_hofer_2019_to_ems(np.array([0.1]), imt="SA(0.3)", unit_in="g")


@pytest.mark.parametrize("imt", ["PGA", "PGV", "SA(0.3)", "SA(1.0)"])
def test_worden_round_trip_all_imts(imt):
    unit_in = "cm/s" if imt == "PGV" else "g"
    y = np.array([0.001, 0.01, 0.05, 0.1, 0.3]) if unit_in == "g" else np.array([0.5, 2.0, 10.0, 40.0, 90.0])
    mmi = gmice.worden_2012_to_mmi(y, imt=imt, unit_in=unit_in)
    back = gmice.worden_2012_from_mmi(mmi, imt=imt, unit_out=unit_in)
    assert back == pytest.approx(y, rel=1e-8)


# ---------------------------------------------------------------------------
# The discovered-and-fixed bug: toolkit's SHAKEgmice.WordenEtAl12 SA->MMI
# branch is dead code (checks self.output_type=='sa_03' inside a branch
# already gated on output_type=='MMI', so it can never fire). This port
# fixes the obvious slip; SA(0.3)/SA(1.0) must produce a real, finite MMI
# and use the SA-specific coefficients (not silently fall back to PGA's).
# ---------------------------------------------------------------------------


def test_worden_sa_to_mmi_is_not_dead_code():
    sa03 = gmice.worden_2012_to_mmi(np.array([0.1]), imt="SA(0.3)", unit_in="g")
    sa1 = gmice.worden_2012_to_mmi(np.array([0.1]), imt="SA(1.0)", unit_in="g")
    pga = gmice.worden_2012_to_mmi(np.array([0.1]), imt="PGA", unit_in="g")
    assert np.all(np.isfinite(sa03))
    assert np.all(np.isfinite(sa1))
    # SA(0.3)/SA(1.0) use their OWN coefficients, not PGA's (SHAKEgmice.py's
    # tables give different c1..c4 per IMT) -- a same-value collapse onto
    # the PGA branch would mean the fix silently degraded to the wrong table.
    assert sa03[0] != pytest.approx(pga[0])
    assert sa1[0] != pytest.approx(pga[0])
    assert sa03[0] != pytest.approx(sa1[0])


def test_worden_sa_coefficients_match_toolkit_transcription():
    # Independent hand computation from SHAKEgmice.py's own literal
    # coefficients (c1=1.26, c2=1.69, c3=-4.15, c4=4.14, t1=2.21 for sa_03),
    # not calling gmice.py's production code path for the reference value.
    pga_cm_s2 = 0.1 * 980.665
    log_y = np.log10(pga_cm_s2)
    expected = 1.26 + 1.69 * log_y if log_y <= 2.21 else -4.15 + 4.14 * log_y
    got = gmice.worden_2012_to_mmi(np.array([0.1]), imt="SA(0.3)", unit_in="g")
    assert got[0] == pytest.approx(expected, rel=1e-9)


# ---------------------------------------------------------------------------
# Unit-conversion boundary sanity (g <-> cm/s^2, factor 980.665)
# ---------------------------------------------------------------------------


def test_pga_unit_conversion_g_and_cm_s2_agree():
    pga_g = np.array([0.05, 0.2])
    pga_cm_s2 = pga_g * 980.665
    ems_g = gmice.zanini_hofer_2019_to_ems(pga_g, imt="PGA", unit_in="g")
    ems_cm_s2 = gmice.zanini_hofer_2019_to_ems(pga_cm_s2, imt="PGA", unit_in="cm/s^2")
    assert ems_g == pytest.approx(ems_cm_s2, rel=1e-9)


def test_pgv_rejects_non_cm_s_unit():
    with pytest.raises(ValueError):
        gmice.worden_2012_to_mmi(np.array([1.0]), imt="PGV", unit_in="m/s")


# ---------------------------------------------------------------------------
# Derivative (dIntensity/dlnY): sign and finiteness sanity -- both GMICEs are
# monotonically increasing in ground motion, so the derivative must be > 0.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("model,imt,unit_in,y", [
    ("Zaniniandhofer19", "PGA", "g", 0.1),
    ("Zaniniandhofer19", "PGV", "cm/s", 10.0),
    ("WordenEtAl12", "PGA", "g", 0.1),
    ("WordenEtAl12", "PGV", "cm/s", 10.0),
    ("WordenEtAl12", "SA(0.3)", "g", 0.1),
])
def test_derivative_is_positive_and_finite(model, imt, unit_in, y):
    deriv = gmice.dintensity_dlny(np.array([y]), imt=imt, unit_in=unit_in, model=model)
    assert np.isfinite(deriv[0])
    assert deriv[0] > 0


def test_derivative_matches_hand_central_difference():
    # Independent reference: hand-compute the central difference without
    # going through gmice.dintensity_dlny.
    y = np.array([0.05])
    eps = 1e-3
    hi = gmice.zanini_hofer_2019_to_ems(y * np.exp(eps), imt="PGA", unit_in="g")
    lo = gmice.zanini_hofer_2019_to_ems(y * np.exp(-eps), imt="PGA", unit_in="g")
    expected = (hi - lo) / (2 * eps)
    got = gmice.dintensity_dlny(y, imt="PGA", unit_in="g", model="Zaniniandhofer19")
    assert got == pytest.approx(expected, rel=1e-10)


def test_derivative_unit_invariance():
    # A unit change is only an additive shift in ln-space -- the derivative
    # must be identical whichever supported linear unit is used.
    pga_g = np.array([0.15])
    d_g = gmice.dintensity_dlny(pga_g, imt="PGA", unit_in="g", model="WordenEtAl12")
    d_cm = gmice.dintensity_dlny(pga_g * 980.665, imt="PGA", unit_in="cm/s^2", model="WordenEtAl12")
    assert d_g == pytest.approx(d_cm, rel=1e-8)


# ---------------------------------------------------------------------------
# Sigma tables -- values AND honesty flags carried forward verbatim.
# ---------------------------------------------------------------------------


def test_worden_sigma_values_and_verified_flag():
    assert gmice.sigma_gmice("WordenEtAl12", "PGA") == pytest.approx(0.66)
    assert gmice.sigma_gmice("WordenEtAl12", "PGV") == pytest.approx(0.63)
    assert gmice.sigma_gmice("WordenEtAl12", "SA(0.3)") == pytest.approx(0.79)
    assert gmice.sigma_gmice("WordenEtAl12", "SA(1.0)") == pytest.approx(0.73)
    assert gmice.WORDEN_SIGMA_VERIFIED is False
    assert gmice.sigma_gmice_verified("WordenEtAl12") is False


def test_zanini_sigma_placeholder_values_and_flag():
    assert gmice.sigma_gmice("Zaniniandhofer19", "PGA") == pytest.approx(0.70)
    assert gmice.sigma_gmice("Zaniniandhofer19", "PGV") == pytest.approx(0.70)
    assert gmice.ZANINI_SIGMA_IS_PLACEHOLDER is True
    assert gmice.sigma_gmice_verified("Zaniniandhofer19") is False


def test_sigma_gmice_raises_for_uncatalogued_combo():
    with pytest.raises(NotImplementedError):
        gmice.sigma_gmice("WordenEtAl12", "SA(3.0)".replace("3.0", "0.6"))  # 'SA(0.6)' -- not tabulated


def test_scale_for_model():
    assert gmice.scale_for_model("Zaniniandhofer19") == "EMS"
    assert gmice.scale_for_model("WordenEtAl12") == "MMI"
    with pytest.raises(KeyError):
        gmice.scale_for_model("NotAModel")
