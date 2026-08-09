"""Magnitude conversion: known Scordilis (2006) values, passthrough, ML proxy
flagging, out-of-range tagging."""

import pytest

from shake_service import magnitude


def test_mw_family_is_passthrough():
    for mag_type in ["mw", "Mww", "MWC", "mwr", "mwp", "Moment"]:
        rec = magnitude.to_moment_magnitude(6.3, mag_type)
        assert rec.mw == 6.3
        assert rec.method == "passthrough"
        assert rec.in_published_range is None
        assert rec.review_flags == ()


def test_mb_known_value_matches_hand_computation():
    # Mw = 0.85*mb + 1.03 (Scordilis 2006 eq. 22, web-verified 2026-08-09;
    # the old 0.67/2.07 expectation was the paper's Ms relation, eq. 14)
    rec = magnitude.to_moment_magnitude(5.0, "mb")
    assert rec.mw == pytest.approx(0.85 * 5.0 + 1.03)
    assert rec.method == "scordilis2006_mb"
    assert rec.in_published_range is True
    assert rec.review_flags == ()


def test_mb_out_of_published_range_is_tagged():
    rec = magnitude.to_moment_magnitude(3.0, "mb")  # below 3.5 floor
    assert rec.in_published_range is False
    assert "magnitude_outside_published_range" in rec.review_flags

    rec2 = magnitude.to_moment_magnitude(6.8, "mb")  # above 6.2 ceiling
    assert rec2.in_published_range is False
    assert "magnitude_outside_published_range" in rec2.review_flags


def test_ml_uses_mb_relation_as_flagged_proxy():
    rec_ml = magnitude.to_moment_magnitude(4.5, "ml")
    rec_mb = magnitude.to_moment_magnitude(4.5, "mb")
    # Same numeric relation applied...
    assert rec_ml.mw == rec_mb.mw
    # ...but ML is always flagged as a proxy, unlike a genuine mb reading.
    assert "ml_proxy_via_mb_relation" in rec_ml.review_flags
    assert rec_ml.method == "scordilis2006_mb_proxy_for_ml"
    assert rec_mb.review_flags == ()


def test_ml_case_insensitive():
    rec_lower = magnitude.to_moment_magnitude(4.0, "ml")
    rec_upper = magnitude.to_moment_magnitude(4.0, "ML")
    assert rec_lower.mw == rec_upper.mw


def test_unrecognized_type_raises_rather_than_guessing():
    with pytest.raises(ValueError):
        magnitude.to_moment_magnitude(5.0, "md")  # duration magnitude, not handled

    with pytest.raises(ValueError):
        magnitude.to_moment_magnitude(5.0, "ms")  # Scordilis Ms relation not implemented yet


def test_classify_mag_type_handles_whitespace_and_case():
    assert magnitude.classify_mag_type("  Mb ") == "mb"
    assert magnitude.classify_mag_type("MW") == "mw"
    assert magnitude.classify_mag_type("Ml") == "ml"
