"""forward.py: site-grid spacing policy, ForwardMap shape/finiteness, band
selection, provenance fields."""

from __future__ import annotations

import numpy as np
import pytest

from shake_service import config, forward, gmm


# ---------------------------------------------------------------------------
# config.forward_grid_spacing_km: the ≤200×200-at-large-extent policy
# ---------------------------------------------------------------------------


def test_spacing_matches_target_resolution_for_small_band():
    # Small band (100 km half-extent, 200 km span) stays well under the
    # 200-step cap even at the full target resolution -- spacing must equal
    # the target exactly (no coarsening needed).
    assert config.forward_grid_spacing_km("small") == pytest.approx(config.SITE_SPACING_KM_TARGET)


@pytest.mark.parametrize("band", ["moderate", "major"])
def test_spacing_caps_step_count_at_200_for_large_bands(band):
    spacing = config.forward_grid_spacing_km(band)
    half_extent = config.grid_extent_km(band)
    span = 2.0 * half_extent
    n_steps = max(int(round(span / spacing)) + 1, 2)
    assert n_steps <= config.MAX_GRID_STEPS_PER_AXIS


def test_spacing_monotone_non_decreasing_with_band_severity():
    small = config.forward_grid_spacing_km("small")
    moderate = config.forward_grid_spacing_km("moderate")
    major = config.forward_grid_spacing_km("major")
    assert small <= moderate <= major


def test_major_band_grid_is_at_most_200x200_sites():
    spacing = config.forward_grid_spacing_km("major")
    half_extent = config.grid_extent_km("major")
    n_steps = max(int(round((2 * half_extent) / spacing)) + 1, 2)
    assert n_steps * n_steps <= config.MAX_GRID_STEPS_PER_AXIS**2


# ---------------------------------------------------------------------------
# ForwardMap: shape, finiteness, band/weights consistency
# ---------------------------------------------------------------------------


def test_forward_map_shapes_consistent_moderate_band():
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=5.5)
    shape = fm.grid_meta["shape"]
    assert fm.band == "moderate"
    assert fm.lon2d.shape == shape
    assert fm.lat2d.shape == shape
    for channel in (fm.pga, fm.pgv):
        assert channel.mean.shape == shape
        assert channel.sigma_ln.shape == shape
        assert channel.tau_ln.shape == shape
        assert channel.phi_ln.shape == shape
        assert channel.sigma_model_ln.shape == shape
    for channel in (fm.ems, fm.mmi):
        assert channel.mean.shape == shape
        assert channel.sigma.shape == shape
        assert channel.driver.shape == shape
        assert channel.clamped.shape == shape


def test_forward_map_finite_everywhere():
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=6.0)
    for channel in (fm.pga, fm.pgv):
        assert np.all(np.isfinite(channel.mean))
        assert np.all(np.isfinite(channel.sigma_ln))
        assert np.all(channel.mean > 0)
    for channel in (fm.ems, fm.mmi):
        assert np.all(np.isfinite(channel.mean))
        assert np.all(np.isfinite(channel.sigma))
        assert np.all(channel.sigma > 0)


def test_forward_map_band_selection_major_for_halabja_magnitude():
    fm = forward.build_forward_map(34.9, 45.9, 19.0, mag_mw=7.3)
    assert fm.band == "major"
    assert fm.in_zagros_polygon is True
    assert fm.grid_meta["half_extent_km"] == 300.0


def test_forward_map_weights_match_band():
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=6.0)
    assert fm.weights == config.BAND_WEIGHTS[fm.band]


def test_forward_map_extrapolation_flags_present_and_consistent():
    fm = forward.build_forward_map(34.9, 45.9, 55.0, mag_mw=5.0)  # depth > 40km threshold
    assert isinstance(fm.extrapolation, gmm.ExtrapolationFlags)
    assert fm.depth_extrapolated is True
    assert fm.extrapolation.depth_extrapolated is True


def test_forward_map_ems_channel_is_pga_driven_only():
    # D20 checkpoint condition 2 (Option A, closed 2026-08-07): the EMS
    # display channel is PGA-driven ONLY, at the whole-product level too.
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=6.0)
    assert set(np.unique(fm.ems.driver)) == {"PGA"}
    assert set(np.unique(fm.mmi.driver)) <= {"PGV", "PGA"}  # MMI driver policy unchanged


def test_forward_map_ems_channel_stays_within_validity_envelope():
    from shake_service import gmice as _gmice

    fm = forward.build_forward_map(34.9, 45.9, 19.0, mag_mw=7.3)  # major band, high shaking near-source
    assert fm.ems.mean.min() >= _gmice.ZANINI_EMS_VALIDITY_MIN
    assert fm.ems.mean.max() <= _gmice.ZANINI_EMS_VALIDITY_MAX


def test_forward_map_data_used_is_catalog_only():
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=6.0)
    assert fm.data_used["source"] == "catalog"
    assert fm.data_used["channels"] == ()
    assert fm.data_used["n_observations"] == 0


def test_forward_map_version_block_has_expected_keys():
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=6.0)
    assert fm.version["openquake_pin"] == config.OPENQUAKE_PIN
    assert fm.version["ems_model"] == "Zaniniandhofer19"
    assert fm.version["mmi_model"] == "WordenEtAl12"
    assert "service_version" in fm.version


def test_forward_map_lon_lat_mesh_centered_on_epicenter():
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=5.0)
    assert fm.lon2d.min() < 45.9 < fm.lon2d.max()
    assert fm.lat2d.min() < 34.9 < fm.lat2d.max()


def test_forward_map_custom_gmice_models():
    fm = forward.build_forward_map(
        34.9, 45.9, 15.0, mag_mw=5.5, ems_model="Zaniniandhofer19", mmi_model="WordenEtAl12",
    )
    assert fm.ems.model == "Zaniniandhofer19"
    assert fm.mmi.model == "WordenEtAl12"
    # Zanini sigma is now the ADOPTED value (Z3, D20 checkpoint condition 2,
    # closed 2026-08-07) -- verified True; Worden's own sigma verification
    # remains a separate, still-open pre-launch item.
    assert fm.ems.sigma_gmice_verified is True
    assert fm.mmi.sigma_gmice_verified is False


# ---------------------------------------------------------------------------
# Performance sanity: a major-band grid (the largest the cap allows) must
# stay well within a "fast enough for near-real-time" budget.
# ---------------------------------------------------------------------------


def test_major_band_forward_map_is_fast():
    import time

    t0 = time.time()
    forward.build_forward_map(34.9, 45.9, 19.0, mag_mw=7.3)
    elapsed = time.time() - t0
    assert elapsed < 5.0
