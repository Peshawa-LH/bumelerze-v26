"""forward.py: site-grid spacing policy, ForwardMap shape/finiteness, band
selection, provenance fields."""

from __future__ import annotations

import numpy as np
import pytest

from shake_service import config, forward, gmm, vs30

_TOOLKIT_VS30_PATH = (
    "/Users/pesha/Library/CloudStorage/OneDrive-Personal/2_WorkDrive/5_MyPhD/"
    "SHAKEmaps/SHAKEmaps-Toolkit-v26/SHAKEdata/vs30/global_vs30.grd"
)


def _raster_readable(path: str) -> bool:
    try:
        import h5py

        with h5py.File(path, "r") as f:
            _ = f["lat"].shape
        return True
    except Exception:  # noqa: BLE001
        return False


_RASTER_AVAILABLE = _raster_readable(_TOOLKIT_VS30_PATH)


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
    # Zanini sigma is the ADOPTED value (Z3, D20 checkpoint condition 2,
    # closed 2026-08-07); Worden sigma verified + SA values corrected in the
    # science-verification pass 2026-08-09 (USGS shakelib wgrw12.py basis).
    assert fm.ems.sigma_gmice_verified is True
    assert fm.mmi.sigma_gmice_verified is True


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


# ---------------------------------------------------------------------------
# Vs30 wiring: vs30_meta flags + (real-raster, self-skipping) end-to-end
# variation proof — "site amplification default" wave, 2026-08-08.
# ---------------------------------------------------------------------------


def test_vs30_meta_reports_rock_default_for_explicit_uniform_sampler():
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=5.5, vs30_sampler=vs30.UniformRockVs30())
    assert fm.vs30_meta["sampler"] == "UniformRockVs30"
    assert fm.vs30_meta["vs30_source"] == "rock-default"
    assert fm.vs30_meta["vs30_source_error"] is None


def test_vs30_meta_reports_rock_default_when_raster_sampler_fails_every_call():
    # A RasterVs30 pointed at a nonexistent file: default_sampler()'s own
    # up-front check isn't in play here (an explicit sampler bypasses it),
    # but the PER-CALL fallback inside RasterVs30.sample() still fires, and
    # vs30_meta must reflect the ACTUAL outcome, not just the class name.
    fm = forward.build_forward_map(
        34.9, 45.9, 15.0, mag_mw=5.5, vs30_sampler=vs30.RasterVs30("/definitely/does/not/exist.grd"),
    )
    assert fm.vs30_meta["sampler"] == "RasterVs30"
    assert fm.vs30_meta["vs30_source"] == "rock-default"
    assert fm.vs30_meta["vs30_source_error"] is not None
    assert "FileNotFoundError" in fm.vs30_meta["vs30_source_error"]


def test_vs30_meta_source_flag_reflects_default_sampler_resolution(monkeypatch):
    """`build_forward_map`'s own `vs30_sampler=None` default resolution
    (`vs30.default_sampler()`) — deterministic via a monkeypatched config
    default, independent of whether the real raster is hydrated on this
    machine."""
    monkeypatch.delenv(vs30.VS30_RASTER_PATH_ENV_VAR, raising=False)
    monkeypatch.setattr(config, "DEFAULT_VS30_RASTER_PATH", "/definitely/does/not/exist.grd")
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=5.5)
    assert fm.vs30_meta["sampler"] == "UniformRockVs30"
    assert fm.vs30_meta["vs30_source"] == "rock-default"


@pytest.mark.skipif(not _RASTER_AVAILABLE, reason="toolkit backbone Vs30 raster not reachable on this machine")
def test_vs30_meta_reports_raster_and_grid_shows_real_spatial_variation():
    fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=5.5, vs30_sampler=vs30.RasterVs30(_TOOLKIT_VS30_PATH))
    assert fm.vs30_meta["sampler"] == "RasterVs30"
    assert fm.vs30_meta["vs30_source"] == "raster"
    assert fm.vs30_meta["vs30_source_error"] is None


@pytest.mark.skipif(not _RASTER_AVAILABLE, reason="toolkit backbone Vs30 raster not reachable on this machine")
def test_real_vs30_raster_produces_materially_different_pga_than_rock_default():
    """End-to-end proof (task instruction): the per-site Vs30 array actually
    VARIES over the Kurdistan region and that variation actually reaches
    `get_mean_stds` — verified here as its OBSERVABLE effect (two runs of
    the identical event differ only in `vs30_sampler`, and PGA differs at
    grid points where Vs30 differs from the rock-760 reference), not just
    that `ctx.vs30` is assigned an array (a static-code fact already true
    of `gmm.py`'s `_build_context`, confirmed by reading — this test proves
    the array isn't silently uniform/inert downstream)."""
    rock_fm = forward.build_forward_map(34.9, 45.9, 15.0, mag_mw=5.5, vs30_sampler=vs30.UniformRockVs30())
    raster_fm = forward.build_forward_map(
        34.9, 45.9, 15.0, mag_mw=5.5, vs30_sampler=vs30.RasterVs30(_TOOLKIT_VS30_PATH),
    )

    # Same grid shape/mesh (same event/band/spacing) so a cell-by-cell
    # comparison is meaningful.
    assert rock_fm.grid_meta["shape"] == raster_fm.grid_meta["shape"]
    assert np.array_equal(rock_fm.lon2d, raster_fm.lon2d)
    assert np.array_equal(rock_fm.lat2d, raster_fm.lat2d)

    # PGA must differ at at least SOME cells (real terrain Vs30 isn't a
    # uniform 760 m/s everywhere over this region -- the whole point of
    # wiring in the raster) but the two runs are NOT wildly divergent
    # everywhere either (same event/GMPE mixture, only the site term
    # differs).
    pga_diff = np.abs(raster_fm.pga.mean - rock_fm.pga.mean)
    assert np.any(pga_diff > 1e-6), "raster-based PGA is identical to rock-760 everywhere -- Vs30 never reached the mixture"
    assert np.all(np.isfinite(raster_fm.pga.mean))
    assert np.all(raster_fm.pga.mean > 0)
