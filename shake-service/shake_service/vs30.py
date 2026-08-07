"""Site grid builder.

Wave A: a uniform-760 m/s ("rock") default grid — every site the same
Vs30, no raster dependency. gmpe-set-proposal-v2.md §5 lists this as the
documented fallback ("760 m/s per-cell fallback, counts in metadata").

Wave B (2026-08-07) adds `RasterVs30`, the real global Vs30 raster sampler
promised in wave A's docstring ("the real global grid arrives in wave B
from the toolkit's SHAKEdata") — see that class's own docstring for
provenance, the toolkit-parity verification, and the [REVIEW]->DEFAULT-ON
history (2026-08-08: `default_sampler()` now picks the raster by default —
see that function's own docstring).

This module defines the `Vs30Sampler` protocol both samplers implement, so
`gmm.py`/`forward.py` never have to change based on which sampler is
active — only the call site swaps `UniformRockVs30()` for `RasterVs30(...)`
(or `default_sampler()`, which picks automatically).

**Priority-chain parity note** (2026-08-08 toolkit-parity check): the
toolkit's `site_model.py::sample_vs30` is a FOUR-tier chain — event USGS
`SVEL` (from that event's OWN already-published `grid.xml`) -> SHAKEdata
backbone raster -> an optional user-supplied raster -> rock default.
Bumelerze's chain is deliberately TWO-tier — backbone raster ->
rock default — with no event-SVEL tier and no separate user-raster tier:
1. **No event-SVEL tier**: an event's own USGS `grid.xml` (the only source
   of its `SVEL` field) is not an input Bumelerze's own forward-map PRIOR
   ever consumes — `worker/pipeline.py`'s D21 auto-compare step fetches and
   parses that same `grid.xml` only to compare OUR already-computed product
   against USGS's, strictly AFTER our map is built. Feeding it back into our
   OWN site grid would be a circular, backwards data dependency (compute,
   then use the thing you're comparing against to recompute) — out of scope
   for this wave regardless of the toolkit's tier ordering, which is a
   reprocessing tool's concern (loading an EXISTING USGS map), not a
   forward-computing service's.
2. **No separate user-raster tier**: nothing today wires a per-request
   custom raster path into `build_forward_map`/the worker; `RasterVs30` IS
   the "backbone" tier, and `BUMELERZE_VS30_RASTER_PATH` already lets
   Peshawa point it at any raster he wants (a user override, just not a
   THIRD priority tier below the backbone) — the toolkit's extra tier only
   matters when both a backbone AND a distinct user raster are configured
   simultaneously, which has no Bumelerze use case yet.
Both simplifications are additive gaps (a future wave could add either
tier without touching `Vs30Sampler`'s protocol shape), never a correctness
divergence in what the raster tier itself does — see `RasterVs30`'s own
docstring for that comparison.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from shake_service import config

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
# DEFAULT-ON (Peshawa 2026-08-08 ruling, superseding the note below):
# `default_sampler()` now resolves to `RasterVs30(config.DEFAULT_VS30_RASTER_PATH)`
# whenever `BUMELERZE_VS30_RASTER_PATH` is unset AND that default path
# exists/is openable — the seeded Atlas maps carried NO spatial site effects
# (uniform rock-760 everywhere) because this sampler shipped opt-in-only;
# Peshawa's instruction: "make the calculation identical to the toolkit's
# approach ... let site amplification refine the map." The source file
# still lives on OneDrive (`SHAKEmaps-Toolkit-v26/SHAKEdata/vs30/
# global_vs30.grd`, ~610 MB) — a cloud-only/un-hydrated file can fail to
# read (`OSError`/deadlock-style errors on macOS) on a machine where it
# hasn't been downloaded, so `default_sampler()`'s resolution check (and
# `RasterVs30.sample()` itself, independently, every call) still falls back
# to `UniformRockVs30` — now LOUDLY (a structured stdout log line, `_log_fallback`
# below — PROJECT.md "structured logging in functions, no monitoring stack")
# — on ANY machine/CI where the file is missing/unreadable. Every product
# built from either path is tagged in its own `vs30_meta`
# (`forward.py`'s `ForwardMap.vs30_meta["vs30_source"]`: `"raster"` |
# `"rock-default"`, `sampler_outcome()` below) so a run is always auditable.
# `BUMELERZE_VS30_RASTER_PATH` remains the portable override for any other
# machine/CI that needs a different raster (or none — point it at a
# nonexistent path to force the rock-760 fallback deliberately).

#: Env var overriding the backbone Vs30 raster path (checked BEFORE
#: `config.DEFAULT_VS30_RASTER_PATH`. Kept as an env var (not JUST a
#: hardcoded path) so the service stays portable across machines/CI (D9 "no
#: dependency on ... Peshawa's local machine" spirit) even though the
#: default is now on.
VS30_RASTER_PATH_ENV_VAR: str = "BUMELERZE_VS30_RASTER_PATH"

# Padding (deg) added around the requested (lats, lons) bbox before the
# windowed raster read, so edge sites of the query aren't extrapolation-
# starved (mirrors site_model.py:_sample_vs30_raster's own `pad = 0.1`).
_RASTER_PAD_DEG: float = 0.1


def _log_fallback(event: str, **fields: object) -> None:
    """One structured JSON line to stdout — the same "no logging framework,
    structured lines only" convention `scripts/run_worker.py`'s own `_log`
    uses (PROJECT.md "structured logging in functions ... no extra
    monitoring stack"; solo-dev ops). `vs30.py` is a plain library module
    with no logger/callback threaded through every call site, so this is a
    deliberate, minimal print — LOUD on purpose: a silent Vs30 fallback is
    exactly the failure mode that shipped the Atlas with zero site effects
    for a full wave without anyone noticing."""
    payload = {"ts": _dt.datetime.now(_dt.timezone.utc).isoformat(), "event": event, **fields}
    print(json.dumps(payload, default=str))


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
    was actually used. Also LOUD (module-level `_log_fallback`, a stdout
    structured-log line) — a per-call raster failure after `default_sampler()`
    already picked `RasterVs30` (e.g. a query bbox outside the raster's
    coverage) must never fall back silently.

    **Toolkit parity** (verified against `SHAKEmaps-Toolkit-v26/modules/
    hazard/site/site_model.py::_sample_vs30_raster`, this session): same
    method — a windowed read (this class: `h5py`, boolean-mask lat/lon
    selection with the same `pad_deg=0.1` margin; the toolkit: `rasterio`,
    a `rasterio.windows.from_bounds` window with the same `pad = 0.1`) +
    `scipy.interpolate.RegularGridInterpolator(..., method="linear",
    bounds_error=False, fill_value=None)` — same source data, same
    interpolation call signature. The raster's own `_FillValue` HDF5
    attribute is `NaN` (confirmed this session), so `np.isfinite` is the
    correct nodata/water test both here and in the toolkit's own
    `sample_vs30` gate (`isfinite & > 0`); within Bumelerze's Kurdistan
    region bbox every observed window has been fully finite (verified this
    session against a real Persian-Gulf/water window too — this particular
    merged raster (`global_vs30_ca_waor_ut_jp_tw.grd`) carries real values
    there, not NaN — the NaN path is exercised by `_sample_raster`'s
    "entirely non-finite window" guard and the per-point `finite_mask`
    below regardless, in case a future raster/region does hit real nodata).

    **One documented, deliberate divergence**: `_sample_vs30_raster` itself
    does NOT clip its interpolated output, and neither does `site_model.py`'s
    `sample_vs30` (its gate is `isfinite & > 0`, then falls through to the
    NEXT priority tier — user raster, then rock default — on failure).
    Bumelerze's chain has no further tier after the raster (module docstring
    below: no event-SVEL or user-raster tier, by design), so there is
    nothing to "fall through" to — a failure here must resolve to a value,
    not a next attempt. This class therefore clips the interpolated output
    into the sampled window's own `[min, max]` (below), which the toolkit
    does NOT do at this exact call site but DOES do at the analogous one —
    `modules/engines/mvn.py::_sample_site_field_at_points` — which documents
    a real bug this exact clip fixed (`fill_value=None` extrapolating to
    Vs30=7653 m/s for an out-of-bbox station, crashing
    `AbrahamsonEtAl2014`'s basin-term interpolation). Values sampled from
    WITHIN the source window are bit-for-bit identical either way; only a
    query point that falls in the `pad_deg` extrapolation margin can differ
    (Bumelerze clips it into range; the toolkit's raster-read call site
    would pass the unclamped extrapolated value on, catching it later only
    if it happens to land <=0 or non-finite).
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
            _log_fallback(
                "vs30_raster_sample_failed_using_rock_default",
                raster_path=str(self.raster_path),
                rock_fallback_mps=self.rock_fallback,
                error=self.last_error,
                n_sites=int(np.asarray(lats).size),
            )
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
        # range — class docstring's "One documented, deliberate divergence"
        # section: NOT what `site_model.py::_sample_vs30_raster` itself
        # does (it doesn't clip), but the same safety principle as the
        # toolkit's analogous `mvn.py::_sample_site_field_at_points`.
        z_min, z_max = float(np.nanmin(z_sub)), float(np.nanmax(z_sub))
        return np.clip(out, z_min, z_max)


def default_vs30_raster_path() -> Path | None:
    """The backbone Vs30 raster path to try: `BUMELERZE_VS30_RASTER_PATH` if
    set (portable override, checked first), else
    `config.DEFAULT_VS30_RASTER_PATH` (default-on, Peshawa 2026-08-08
    ruling — module docstring's "DEFAULT-ON" note). `None` only if the env
    var is unset AND the config default is falsy (never true today; kept as
    a guard, not a real code path, so a future config change that clears
    the default degrades gracefully instead of raising)."""
    raw = os.environ.get(VS30_RASTER_PATH_ENV_VAR)
    if raw:
        return Path(raw)
    return Path(config.DEFAULT_VS30_RASTER_PATH) if config.DEFAULT_VS30_RASTER_PATH else None


def default_sampler(*, rock_fallback: float = DEFAULT_ROCK_VS30_MPS) -> "Vs30Sampler":
    """`RasterVs30` if the resolved path (`default_vs30_raster_path()`) is
    at least openable, else the wave-A `UniformRockVs30` fallback — LOUD
    (`_log_fallback`) on that path-exists/openable check so a machine
    running without the raster (any CI, any non-Peshawa machine, an
    un-hydrated OneDrive placeholder) is never silently downgraded. This is
    a best-effort, side-effect-free CHECK (opens the file, reads nothing
    heavy) — `RasterVs30.sample()` itself still falls back gracefully (and
    LOUDLY, its own docstring) on any later per-call read failure, so this
    is a fast-path optimisation, not the only safety net."""
    path = default_vs30_raster_path()
    if path is None:
        _log_fallback("vs30_raster_path_unconfigured_using_rock_default", rock_fallback_mps=rock_fallback)
        return UniformRockVs30(rock_fallback)
    if not path.exists():
        _log_fallback(
            "vs30_raster_path_missing_using_rock_default",
            raster_path=str(path), rock_fallback_mps=rock_fallback,
        )
        return UniformRockVs30(rock_fallback)
    try:
        import h5py

        with h5py.File(str(path), "r") as f:
            _ = f["lat"].shape  # cheap readability probe, no data read
    except Exception as exc:  # noqa: BLE001 -- fall back loudly, RasterVs30 would too
        _log_fallback(
            "vs30_raster_path_unreadable_using_rock_default",
            raster_path=str(path), rock_fallback_mps=rock_fallback,
            error=f"{type(exc).__name__}: {exc}",
        )
        return UniformRockVs30(rock_fallback)
    return RasterVs30(path, rock_fallback=rock_fallback)


def sampler_outcome(sampler: "Vs30Sampler") -> str:
    """`"raster"` if `sampler` is a `RasterVs30` whose LAST `.sample()` call
    actually used the raster (`sampler.last_error is None`); `"rock-default"`
    otherwise (a `UniformRockVs30`, or a `RasterVs30` whose last call fell
    back). Centralised here so every caller (`forward.py`'s
    `ForwardMap.vs30_meta["vs30_source"]`, any future one) agrees on the
    same classification instead of re-deriving it."""
    if isinstance(sampler, RasterVs30) and sampler.last_error is None:
        return "raster"
    return "rock-default"
