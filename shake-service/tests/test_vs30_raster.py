"""RasterVs30 (wave B): fallback safety (always, no external dependency),
plus a real-raster integration check that self-skips when the toolkit's
backbone Vs30 raster isn't reachable on this machine (OneDrive-hosted,
cloud-only files can be unhydrated — task instruction: never block the
wave on this)."""

from __future__ import annotations

import os

import numpy as np
import pytest

from shake_service import vs30

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
# Fallback safety — must hold regardless of machine/CI state, no raster
# access needed.
# ---------------------------------------------------------------------------


def test_missing_file_falls_back_to_rock_default():
    sampler = vs30.RasterVs30("/definitely/does/not/exist.grd")
    out = sampler.sample(np.array([34.9]), np.array([45.9]))
    assert out[0] == vs30.DEFAULT_ROCK_VS30_MPS
    assert sampler.last_error is not None
    assert "FileNotFoundError" in sampler.last_error


def test_custom_rock_fallback_value_used_on_failure():
    sampler = vs30.RasterVs30("/definitely/does/not/exist.grd", rock_fallback=400.0)
    out = sampler.sample(np.array([34.9]), np.array([45.9]))
    assert out[0] == 400.0


def test_sample_never_raises_on_bad_path():
    sampler = vs30.RasterVs30("/definitely/does/not/exist.grd")
    # must not raise, for any shape of input
    out = sampler.sample(np.array([1.0, 2.0, 3.0]), np.array([4.0, 5.0, 6.0]))
    assert out.shape == (3,)


def test_default_sampler_falls_back_when_env_var_unset(monkeypatch):
    monkeypatch.delenv(vs30.VS30_RASTER_PATH_ENV_VAR, raising=False)
    sampler = vs30.default_sampler()
    assert isinstance(sampler, vs30.UniformRockVs30)


def test_default_sampler_falls_back_when_env_var_points_nowhere(monkeypatch):
    monkeypatch.setenv(vs30.VS30_RASTER_PATH_ENV_VAR, "/definitely/does/not/exist.grd")
    sampler = vs30.default_sampler()
    assert isinstance(sampler, vs30.UniformRockVs30)


def test_default_vs30_raster_path_reads_env_var(monkeypatch):
    monkeypatch.setenv(vs30.VS30_RASTER_PATH_ENV_VAR, "/some/path.grd")
    assert str(vs30.default_vs30_raster_path()) == "/some/path.grd"
    monkeypatch.delenv(vs30.VS30_RASTER_PATH_ENV_VAR, raising=False)
    assert vs30.default_vs30_raster_path() is None


def test_raster_vs30_satisfies_vs30sampler_protocol_shape_contract():
    # Even on failure, output shape must match input shape (the
    # Vs30Sampler protocol's contract) -- 2-D input included.
    sampler = vs30.RasterVs30("/definitely/does/not/exist.grd")
    lats = np.array([[34.9, 35.0], [35.1, 35.2]])
    lons = np.array([[45.9, 46.0], [46.1, 46.2]])
    out = sampler.sample(lats, lons)
    assert out.shape == lats.shape


# ---------------------------------------------------------------------------
# Real-raster integration (self-skips if the OneDrive file isn't hydrated/
# reachable on this machine — never blocks the wave, per task instruction).
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _RASTER_AVAILABLE, reason="toolkit backbone Vs30 raster not reachable on this machine")
def test_real_raster_samples_plausible_vs30_over_kurdistan():
    sampler = vs30.RasterVs30(_TOOLKIT_VS30_PATH)
    lats = np.array([34.9, 35.5, 36.2])  # Halabja, Sulaymaniyah-ish, Erbil-ish
    lons = np.array([45.9, 45.5, 44.0])
    out = sampler.sample(lats, lons)
    assert sampler.last_error is None
    assert np.all(np.isfinite(out))
    # Plausible Vs30 range for this terrain (mountainous/rock to alluvial) --
    # a wide, generous sanity band, not a scientific claim.
    assert np.all(out > 100.0)
    assert np.all(out < 1500.0)


@pytest.mark.skipif(not _RASTER_AVAILABLE, reason="toolkit backbone Vs30 raster not reachable on this machine")
def test_real_raster_used_via_build_grid_km_spacing():
    sampler = vs30.RasterVs30(_TOOLKIT_VS30_PATH)
    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=50.0, spacing_km=10.0, sampler=sampler)
    assert grid.n_sites > 0
    assert np.all(np.isfinite(grid.vs30))
    # NOT the uniform-rock fallback everywhere -- real spatial variation.
    assert grid.vs30.std() > 1.0


@pytest.mark.skipif(not _RASTER_AVAILABLE, reason="toolkit backbone Vs30 raster not reachable on this machine")
def test_default_sampler_picks_raster_when_env_var_set_and_readable(monkeypatch):
    monkeypatch.setenv(vs30.VS30_RASTER_PATH_ENV_VAR, _TOOLKIT_VS30_PATH)
    sampler = vs30.default_sampler()
    assert isinstance(sampler, vs30.RasterVs30)
