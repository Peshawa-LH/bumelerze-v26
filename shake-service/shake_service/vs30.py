"""Site grid builder.

Wave A: a uniform-760 m/s ("rock") default grid — every site the same
Vs30, no raster dependency. gmpe-set-proposal-v2.md §5 lists this as the
documented fallback ("760 m/s per-cell fallback, counts in metadata").

Wave B (2026-08-07) adds `RasterVs30`, the real global Vs30 raster sampler
promised in wave A's docstring ("the real global grid arrives in wave B
from the toolkit's SHAKEdata") — see that class's own docstring for
provenance + the [REVIEW] hydration note.

This module defines the `Vs30Sampler` protocol both samplers implement, so
`gmm.py`/`forward.py` never have to change based on which sampler is
active — only the call site swaps `UniformRockVs30()` for `RasterVs30(...)`
(or `default_sampler()`, which picks automatically).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
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


# ---------------------------------------------------------------------------
# Wave B: the real global Vs30 raster sampler
# ---------------------------------------------------------------------------
#
# Provenance (D9 "extract, don't entangle"): the DATA SOURCE is
# `SHAKEmaps-Toolkit-v26/SHAKEdata/vs30/global_vs30.grd` (read-only, never
# copied/modified) — the same backbone raster
# `modules/hazard/site/site_model.py:sample_vs30`'s "backbone_raster"
# priority tier samples. That file, despite its `.grd` extension, is a
# GMT/`grdconvert`-produced NetCDF4-classic grid (a plain HDF5 container
# under the hood — confirmed this session: `lat` (16801,), `lon` (43201,),
# `z` (16801, 43201) float32 datasets, COARDS/CF-1.5 conventions, 30
# arc-second global coverage lat[-56,84] lon[-180,180]).
#
# READING-LIBRARY ADAPTATION (flagged, not a behaviour change): the
# toolkit's `site_model.py:_sample_vs30_raster` reads this file via
# `rasterio` (a GDAL wrapper) with a windowed read + `RegularGridInterpolator`
# sampling. `rasterio` is not in shake-service's pinned dependency set (D20
# §6.3 keeps the pin minimal); `h5py` already is (a transitive dependency
# of `openquake.engine`, confirmed installed at 3.16.0). Since the file is
# a plain HDF5 container with named `lat`/`lon`/`z` datasets, this sampler
# reads it directly via `h5py` — same windowed-read + linear-interpolation
# *method* as the toolkit, same source data, no GDAL/rasterio dependency
# added. Numerically equivalent (both are a windowed slice + the same
# `scipy.interpolate.RegularGridInterpolator` call); only the file-opening
# library differs.
#
# [REVIEW] (for Peshawa): this sampler is OFF by default (see
# `default_sampler()` below) unless `BUMELERZE_VS30_RASTER_PATH` is set to
# the file's path, because the source file lives on OneDrive
# (`SHAKEmaps-Toolkit-v26/SHAKEdata/vs30/global_vs30.grd`, ~610 MB) — a
# cloud-only/un-hydrated file can fail to read (`OSError`/deadlock-style
# errors on macOS) on a machine where it hasn't been downloaded. Please set
# that file to **"Always keep on this device"** in OneDrive if you want
# shake-service to use the real Vs30 raster (verified readable and correct
# this session — 610 MB, fully hydrated, ~490 m/s mean Vs30 over the
# Kurdistan region bbox). Until then (or on any other machine/CI), the
# service safely falls back to `UniformRockVs30` — the wave-A default —
# and every product built from it is tagged accordingly.

#: Env var pointing at the backbone Vs30 raster (unset by default — see the
#: [REVIEW] note above). Kept as an env var, not a hardcoded path, so the
#: service stays portable across machines/CI (D9 "no dependency on ...
#: Peshawa's local machine" spirit) while still letting Peshawa opt in.
VS30_RASTER_PATH_ENV_VAR: str = "BUMELERZE_VS30_RASTER_PATH"

# Padding (deg) added around the requested (lats, lons) bbox before the
# windowed raster read, so edge sites of the query aren't extrapolation-
# starved (mirrors site_model.py:_sample_vs30_raster's own `pad = 0.1`).
_RASTER_PAD_DEG: float = 0.1


class RasterVs30:
    """Samples the real backbone Vs30 raster via a windowed `h5py` read +
    linear interpolation (module-level docstring: reading-library
    adaptation from the toolkit's rasterio-based sampler, same method/data,
    no numerical behaviour change).

    Never raises out of `.sample()`: any read failure (missing file,
    unhydrated OneDrive placeholder, bbox outside the raster's coverage,
    ...) falls back to `UniformRockVs30(rock_fallback)` for THAT call, and
    records the failure on `self.last_error` (a string, or `None` after a
    successful sample) so a caller/test can tell whether the real raster
    was actually used.
    """

    METADATA_TAG = "vs30_raster"

    def __init__(
        self,
        raster_path: str | Path,
        *,
        rock_fallback: float = DEFAULT_ROCK_VS30_MPS,
        pad_deg: float = _RASTER_PAD_DEG,
    ) -> None:
        self.raster_path = Path(raster_path)
        self.rock_fallback = float(rock_fallback)
        self.pad_deg = float(pad_deg)
        self.last_error: str | None = None
        self._fallback = UniformRockVs30(self.rock_fallback)

    def sample(self, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
        lats = np.asarray(lats, dtype=float)
        lons = np.asarray(lons, dtype=float)
        try:
            out = self._sample_raster(lats, lons)
            self.last_error = None
            return out
        except Exception as exc:  # noqa: BLE001 -- an honest, recorded fallback, never a crash
            self.last_error = f"{type(exc).__name__}: {exc}"
            return self._fallback.sample(lats, lons)

    def _sample_raster(self, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
        import h5py
        from scipy.interpolate import RegularGridInterpolator

        if not self.raster_path.exists():
            raise FileNotFoundError(f"Vs30 raster not found: {self.raster_path}")

        lon_min, lon_max = float(lons.min()) - self.pad_deg, float(lons.max()) + self.pad_deg
        lat_min, lat_max = float(lats.min()) - self.pad_deg, float(lats.max()) + self.pad_deg

        with h5py.File(str(self.raster_path), "r") as f:
            lat_full = f["lat"][:]
            lon_full = f["lon"][:]
            lat_idx = np.where((lat_full >= lat_min) & (lat_full <= lat_max))[0]
            lon_idx = np.where((lon_full >= lon_min) & (lon_full <= lon_max))[0]
            if lat_idx.size == 0 or lon_idx.size == 0:
                raise ValueError(
                    f"requested bbox lon[{lon_min},{lon_max}] lat[{lat_min},{lat_max}] "
                    f"falls outside the raster's coverage"
                )
            lat_sub = lat_full[lat_idx.min() : lat_idx.max() + 1]
            lon_sub = lon_full[lon_idx.min() : lon_idx.max() + 1]
            # `z` is (lat, lon) -- matches the ascending lat/lon axes read
            # above (COARDS convention: dims declared in storage order).
            z_sub = f["z"][lat_idx.min() : lat_idx.max() + 1, lon_idx.min() : lon_idx.max() + 1]
            z_sub = np.asarray(z_sub, dtype=float)

        if not np.any(np.isfinite(z_sub)):
            raise ValueError("sampled raster window is entirely non-finite (e.g. open ocean)")

        interp = RegularGridInterpolator(
            (lat_sub, lon_sub), z_sub, method="linear", bounds_error=False, fill_value=None,
        )
        pts = np.stack([lats, lons], axis=-1)
        out = interp(pts)

        finite_mask = np.isfinite(out)
        if not np.all(finite_mask):
            out = np.where(finite_mask, out, self.rock_fallback)

        # Never let extrapolation leave the sampled window's own physical
        # range (same safety clip as the toolkit's `site_model.py`'s
        # `_sample_regular_grid` callers / `mvn.py`'s
        # `_sample_site_field_at_points`, which found real GMPE-crashing
        # extrapolation overshoots without it).
        z_min, z_max = float(np.nanmin(z_sub)), float(np.nanmax(z_sub))
        return np.clip(out, z_min, z_max)


def default_vs30_raster_path() -> Path | None:
    """The backbone Vs30 raster path from `BUMELERZE_VS30_RASTER_PATH`, or
    `None` if unset."""
    raw = os.environ.get(VS30_RASTER_PATH_ENV_VAR)
    return Path(raw) if raw else None


def default_sampler(*, rock_fallback: float = DEFAULT_ROCK_VS30_MPS) -> "Vs30Sampler":
    """`RasterVs30` if `BUMELERZE_VS30_RASTER_PATH` is set (and the file is
    at least openable), else the wave-A `UniformRockVs30` fallback. This is
    a best-effort, side-effect-free CHECK (opens the file, reads nothing
    heavy) — `RasterVs30.sample()` itself still falls back gracefully on
    any later read failure (module docstring), so this is a fast-path
    optimisation, not the only safety net."""
    path = default_vs30_raster_path()
    if path is None:
        return UniformRockVs30(rock_fallback)
    try:
        import h5py

        with h5py.File(str(path), "r") as f:
            _ = f["lat"].shape  # cheap readability probe, no data read
    except Exception:  # noqa: BLE001 -- fall back quietly, RasterVs30 would too
        return UniformRockVs30(rock_fallback)
    return RasterVs30(path, rock_fallback=rock_fallback)
