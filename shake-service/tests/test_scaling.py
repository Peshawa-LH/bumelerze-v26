"""Wells & Coppersmith (1994) scaling port (hazard-science audit wave,
2026-08-08) — coefficient-regression pins against the toolkit's verbatim
tables, mechanism classification, and the vertical-half-width helper that
feeds `rupture_params.derive_rupture_params(half_width_model="wc94")`."""

from __future__ import annotations

import math

import pytest

from shake_service import scaling


# ---------------------------------------------------------------------------
# Coefficient-regression pins (verbatim toolkit `_WC94_*` tables — the same
# discipline as test_gmice.py's Bilal/Worden pins: any silent edit of a
# transcribed coefficient fails a test).
# ---------------------------------------------------------------------------


def test_wc94_reverse_mechanism_regression_pin():
    # R row: length a=-2.42 b=0.58; width a=-1.61 b=0.41; area a=-3.99 b=0.98.
    wc = scaling.wells_coppersmith_1994(7.3, mechanism="R")
    assert wc["mechanism"] == "R"
    assert wc["length_km"] == pytest.approx(10.0 ** (-2.42 + 0.58 * 7.3), rel=1e-12)
    assert wc["width_km"] == pytest.approx(10.0 ** (-1.61 + 0.41 * 7.3), rel=1e-12)
    assert wc["area_km2"] == pytest.approx(10.0 ** (-3.99 + 0.98 * 7.3), rel=1e-12)
    assert wc["sigma_log10_length"] == pytest.approx(0.16)
    assert wc["sigma_log10_width"] == pytest.approx(0.15)
    assert wc["sigma_log10_area"] == pytest.approx(0.26)


@pytest.mark.parametrize(
    "mech,a_w,b_w",
    [("ALL", -1.01, 0.32), ("SS", -0.76, 0.27), ("R", -1.61, 0.41), ("N", -1.14, 0.35)],
)
def test_wc94_width_rows_all_mechanisms(mech, a_w, b_w):
    wc = scaling.wells_coppersmith_1994(6.0, mechanism=mech)
    assert wc["width_km"] == pytest.approx(10.0 ** (a_w + b_w * 6.0), rel=1e-12)


def test_wc94_dimensions_grow_with_magnitude():
    small = scaling.wells_coppersmith_1994(4.0, mechanism="R")
    large = scaling.wells_coppersmith_1994(7.0, mechanism="R")
    for key in ("length_km", "width_km", "area_km2"):
        assert large[key] > small[key]


# ---------------------------------------------------------------------------
# Mechanism classification (verbatim `rake_to_mechanism` port).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "rake,mech",
    [
        (0.0, "SS"),
        (180.0, "SS"),
        (-170.0, "SS"),
        (90.0, "R"),
        (75.0, "R"),
        (-90.0, "N"),
        (-100.0, "N"),
        (45.0, "ALL"),  # oblique — not classifiable
        (None, "ALL"),
        (450.0, "R"),  # wraps to 90
    ],
)
def test_rake_to_mechanism(rake, mech):
    assert scaling.rake_to_mechanism(rake) == mech


def test_mechanism_aliases_and_rake_fallback():
    assert scaling.wells_coppersmith_1994(6.0, mechanism="thrust")["mechanism"] == "R"
    assert scaling.wells_coppersmith_1994(6.0, mechanism="strike-slip")["mechanism"] == "SS"
    # no mechanism -> derived from rake
    assert scaling.wells_coppersmith_1994(6.0, rake=90.0)["mechanism"] == "R"
    # neither -> ALL
    assert scaling.wells_coppersmith_1994(6.0)["mechanism"] == "ALL"


# ---------------------------------------------------------------------------
# Vertical half-width helper (the ztor refinement).
# ---------------------------------------------------------------------------


def test_vertical_half_width_is_projected_through_dip():
    wc = scaling.wells_coppersmith_1994(7.3, rake=90.0)
    expected = wc["width_km"] / 2.0 * math.sin(math.radians(45.0))
    assert scaling.vertical_half_width_km(7.3, 45.0, rake=90.0) == pytest.approx(expected, rel=1e-12)
    # vertical fault projects the full half-width; flat fault projects none
    assert scaling.vertical_half_width_km(7.3, 90.0, rake=90.0) == pytest.approx(
        wc["width_km"] / 2.0, rel=1e-12
    )
    assert scaling.vertical_half_width_km(7.3, 0.0, rake=90.0) == pytest.approx(0.0, abs=1e-12)
