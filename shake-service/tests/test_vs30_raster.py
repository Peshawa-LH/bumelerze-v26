"""RasterVs30 (wave B) + default-on resolution (wave "site-amplification
default", 2026-08-08): fallback safety (always, no external dependency),
default-on/off resolution logic against a monkeypatched
`config.DEFAULT_VS30_RASTER_PATH` (deterministic regardless of whether the
real 610 MB toolkit raster happens to be hydrated on the machine running
these tests), plus a real-raster integration check that self-skips when
that file isn't reachable on THIS machine (OneDrive-hosted, cloud-only
files can be unhydrated — task instruction: never block the wave on
this)."""

from __future__ import annotations

import json
import os

import numpy as np
import pytest

from shake_service import config, vs30

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


def test_default_sampler_falls_back_when_no_path_configured_anywhere(monkeypatch):
    """Env var unset AND the config default itself points nowhere (the
    "no raster configured anywhere" case — deterministic regardless of
    whether the real toolkit raster is hydrated on this machine)."""
    monkeypatch.delenv(vs30.VS30_RASTER_PATH_ENV_VAR, raising=False)
    monkeypatch.setattr(config, "DEFAULT_VS30_RASTER_PATH", "/definitely/does/not/exist.grd")
    sampler = vs30.default_sampler()
    assert isinstance(sampler, vs30.UniformRockVs30)


def test_default_sampler_uses_config_default_path_when_env_var_unset(monkeypatch):
    """Wave "default-on Vs30" (2026-08-08): with NO env var override, the
    resolution falls through to `config.DEFAULT_VS30_RASTER_PATH` — this is
    the behaviour change from wave B's "off unless env var is set"."""
    monkeypatch.delenv(vs30.VS30_RASTER_PATH_ENV_VAR, raising=False)
    monkeypatch.setattr(config, "DEFAULT_VS30_RASTER_PATH", "/definitely/does/not/exist.grd")
    assert str(vs30.default_vs30_raster_path()) == "/definitely/does/not/exist.grd"


def test_default_sampler_falls_back_when_env_var_points_nowhere(monkeypatch):
    monkeypatch.setenv(vs30.VS30_RASTER_PATH_ENV_VAR, "/definitely/does/not/exist.grd")
    sampler = vs30.default_sampler()
    assert isinstance(sampler, vs30.UniformRockVs30)


def test_env_var_overrides_config_default(monkeypatch):
    monkeypatch.setattr(config, "DEFAULT_VS30_RASTER_PATH", "/config/default/path.grd")
    monkeypatch.setenv(vs30.VS30_RASTER_PATH_ENV_VAR, "/env/override/path.grd")
    assert str(vs30.default_vs30_raster_path()) == "/env/override/path.grd"


def test_default_vs30_raster_path_reads_env_var(monkeypatch):
    monkeypatch.setenv(vs30.VS30_RASTER_PATH_ENV_VAR, "/some/path.grd")
    assert str(vs30.default_vs30_raster_path()) == "/some/path.grd"


def test_default_vs30_raster_path_none_when_nothing_configured(monkeypatch):
    monkeypatch.delenv(vs30.VS30_RASTER_PATH_ENV_VAR, raising=False)
    monkeypatch.setattr(config, "DEFAULT_VS30_RASTER_PATH", "")
    assert vs30.default_vs30_raster_path() is None


def test_default_config_path_points_at_the_toolkit_global_grid():
    """The config constant itself — no monkeypatching — matches the
    documented toolkit path (task instruction: default to
    `.../SHAKEmaps-Toolkit-v26/SHAKEdata/vs30/global_vs30.grd`)."""
    assert config.DEFAULT_VS30_RASTER_PATH == _TOOLKIT_VS30_PATH


# ---------------------------------------------------------------------------
# LOUD fallback logging — a structured stdout JSON line, never a silent
# downgrade (module docstring / vs30.py's `_log_fallback`).
# ---------------------------------------------------------------------------


def test_default_sampler_logs_loudly_on_missing_path(monkeypatch, capsys):
    monkeypatch.delenv(vs30.VS30_RASTER_PATH_ENV_VAR, raising=False)
    monkeypatch.setattr(config, "DEFAULT_VS30_RASTER_PATH", "/definitely/does/not/exist.grd")
    vs30.default_sampler()
    out = capsys.readouterr().out.strip()
    assert out, "expected a structured log line on fallback, got no stdout output"
    payload = json.loads(out.splitlines()[-1])
    assert payload["event"] == "vs30_raster_path_missing_using_rock_default"
    assert payload["raster_path"] == "/definitely/does/not/exist.grd"


def test_raster_vs30_logs_loudly_on_per_call_sample_failure(capsys):
    sampler = vs30.RasterVs30("/definitely/does/not/exist.grd")
    sampler.sample(np.array([1.0]), np.array([1.0]))
    out = capsys.readouterr().out.strip()
    payload = json.loads(out.splitlines()[-1])
    assert payload["event"] == "vs30_raster_sample_failed_using_rock_default"
    assert "FileNotFoundError" in payload["error"]


def test_sampler_outcome_classifies_rock_and_raster():
    assert vs30.sampler_outcome(vs30.UniformRockVs30()) == "rock-default"

    failing = vs30.RasterVs30("/definitely/does/not/exist.grd")
    failing.sample(np.array([1.0]), np.array([1.0]))
    assert failing.last_error is not None
    assert vs30.sampler_outcome(failing) == "rock-default"


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


@pytest.mark.skipif(not _RASTER_AVAILABLE, reason="toolkit backbone Vs30 raster not reachable on this machine")
def test_default_sampler_picks_raster_with_no_env_var_set(monkeypatch):
    """The default-on behaviour itself: nothing set at all (no env var),
    real `config.DEFAULT_VS30_RASTER_PATH` -- this is the exact call shape
    `forward.build_forward_map`'s own `vs30_sampler=None` default makes."""
    monkeypatch.delenv(vs30.VS30_RASTER_PATH_ENV_VAR, raising=False)
    sampler = vs30.default_sampler()
    assert isinstance(sampler, vs30.RasterVs30)


@pytest.mark.skipif(not _RASTER_AVAILABLE, reason="toolkit backbone Vs30 raster not reachable on this machine")
def test_sampler_outcome_raster_on_real_success():
    sampler = vs30.RasterVs30(_TOOLKIT_VS30_PATH)
    sampler.sample(np.array([34.9]), np.array([45.9]))
    assert vs30.sampler_outcome(sampler) == "raster"
