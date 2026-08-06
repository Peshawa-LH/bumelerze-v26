"""Site grid builder: shape/extent sanity, uniform-rock default, sampler
substitutability."""

import numpy as np
import pytest

from shake_service import vs30


def test_uniform_rock_default_is_760():
    sampler = vs30.UniformRockVs30()
    out = sampler.sample(np.array([34.9, 35.0]), np.array([45.9, 46.0]))
    assert np.all(out == 760.0)


def test_uniform_rock_custom_value():
    sampler = vs30.UniformRockVs30(vs30_mps=350.0)
    out = sampler.sample(np.array([0.0]), np.array([0.0]))
    assert out[0] == 350.0


def test_site_grid_rejects_mismatched_shapes():
    with pytest.raises(ValueError):
        vs30.SiteGrid(
            lats=np.array([1.0, 2.0]),
            lons=np.array([1.0]),
            vs30=np.array([760.0, 760.0]),
        )


def test_build_grid_covers_requested_extent_roughly():
    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=100.0, spacing_km=20.0)
    # center should be within the lat/lon bounds, extent should reach out
    # to roughly +/-100 km (allow generous tolerance for the flat-earth approx)
    assert grid.lats.min() < 34.9 < grid.lats.max()
    assert grid.lons.min() < 45.9 < grid.lons.max()
    lat_span_km = (grid.lats.max() - grid.lats.min()) * 111.32
    assert 150.0 < lat_span_km < 250.0


def test_build_grid_default_sampler_is_uniform_rock():
    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=50.0, spacing_km=25.0)
    assert np.all(grid.vs30 == vs30.DEFAULT_ROCK_VS30_MPS)


def test_build_grid_n_sites_matches_array_lengths():
    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=50.0, spacing_km=25.0)
    assert grid.n_sites == grid.lats.size == grid.lons.size == grid.vs30.size


def test_custom_sampler_is_used():
    class FixedSampler:
        def sample(self, lats, lons):
            return np.full(np.asarray(lats).shape, 300.0)

    grid = vs30.build_grid_km_spacing(
        34.9, 45.9, half_extent_km=30.0, spacing_km=15.0, sampler=FixedSampler()
    )
    assert np.all(grid.vs30 == 300.0)
