"""Site grid builder.

Wave A: a uniform-760 m/s ("rock") default grid — every site the same
Vs30, no raster dependency. gmpe-set-proposal-v2.md §5 lists this as the
documented fallback ("760 m/s per-cell fallback, counts in metadata") and
explicitly defers the real global Vs30 raster sampler to a later wave
("the real global grid arrives in wave B from the toolkit's SHAKEdata").

This module also defines the `Vs30Sampler` protocol wave B's raster
sampler will implement, so `gmm.py` never has to change when the real
sampler lands — only the call site swaps `UniformRockVs30()` for the
raster-backed implementation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

# USGS/ShakeMap convention for "generic rock" reference site condition —
# also NEHRP-adjacent (B/C boundary), the standard GMPE reference Vs30.
DEFAULT_ROCK_VS30_MPS: float = 760.0


@dataclass(frozen=True)
class SiteGrid:
    """A grid of sites: parallel arrays of lat, lon, and vs30 (m/s)."""

    lats: np.ndarray
    lons: np.ndarray
    vs30: np.ndarray

    def __post_init__(self) -> None:
        if not (self.lats.shape == self.lons.shape == self.vs30.shape):
            raise ValueError("lats, lons, vs30 must share the same shape")

    @property
    def n_sites(self) -> int:
        return int(self.lats.size)


class Vs30Sampler(Protocol):
    """Interface any Vs30 source (uniform default, or wave B's raster
    sampler) must satisfy so `gmm.py` can stay source-agnostic."""

    def sample(self, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
        """Return a Vs30 array (m/s), same shape as lats/lons."""
        ...


class UniformRockVs30:
    """Wave A default: every site gets the same rock Vs30. `.sample()`
    fabricates data rather than looking anything up — the metadata flag
    below is what tells downstream consumers (and Peshawa) that this run
    used the fallback, not a real site model."""

    #: Attached to every product this sampler produces, per §5's
    #: "counts in metadata" instruction.
    METADATA_TAG = "vs30_uniform_rock_fallback"

    def __init__(self, vs30_mps: float = DEFAULT_ROCK_VS30_MPS) -> None:
        self.vs30_mps = vs30_mps

    def sample(self, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
        lats = np.asarray(lats)
        return np.full(lats.shape, self.vs30_mps, dtype=float)


def build_grid_km_spacing(
    center_lat: float,
    center_lon: float,
    half_extent_km: float,
    spacing_km: float,
    sampler: Vs30Sampler | None = None,
) -> SiteGrid:
    """Build a regular lat/lon grid centred on an epicentre, spanning
    +/- half_extent_km in both the N-S and E-W directions (flat-earth
    approximation — fine at the <=300 km grid extents the G8 policy uses),
    with Vs30 sampled per `sampler` (defaults to uniform rock 760 m/s).

    Returns row-major flattened 1-D arrays (lats, lons, vs30) — the shape
    ContextMaker/get_mean_stds expects for a site array.
    """
    if sampler is None:
        sampler = UniformRockVs30()

    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * max(np.cos(np.radians(center_lat)), 1e-6)

    n_steps = max(int(round((2 * half_extent_km) / spacing_km)) + 1, 2)
    lat_offsets_km = np.linspace(-half_extent_km, half_extent_km, n_steps)
    lon_offsets_km = np.linspace(-half_extent_km, half_extent_km, n_steps)

    dlat = lat_offsets_km / km_per_deg_lat
    dlon = lon_offsets_km / km_per_deg_lon

    lat_grid, lon_grid = np.meshgrid(center_lat + dlat, center_lon + dlon, indexing="ij")
    lats = lat_grid.ravel()
    lons = lon_grid.ravel()
    vs30 = sampler.sample(lats, lons)

    return SiteGrid(lats=lats, lons=lons, vs30=vs30)
