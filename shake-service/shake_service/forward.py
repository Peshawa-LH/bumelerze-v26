"""The forward-map engine: event params (lat/lon/depth/Mw) -> a `ForwardMap`
(site grid + ground-motion + intensity fields + provenance) — D9's
"gmpe_forward prior" end to end, one call. This is the un-conditioned prior
`mvn.py` conditions on point observations in a later step.

Pipeline: `vs30.build_grid_km_spacing` (site grid, magnitude-scaled extent
per `config.grid_extent_km`/`config.forward_grid_spacing_km`) ->
`gmm.compute_mixture` (D20 4-branch GMPE mixture) -> `intensity.compute_ems`
+ `intensity.compute_mmi` (VirtualIPE-equivalent chain rule) -> `ForwardMap`.

No toolkit module is ported verbatim here (this is new wave-B glue code,
unlike gmice.py/intensity.py/mvn.py) — the shape of the output (grids + a
provenance/version block) follows the *pattern* the toolkit's `HazardField`/
export-bundle contract established (`docs/data_contracts.md`
"HazardField", "Run identity & export bundle"), adapted to a plain
in-memory dataclass rather than a file-export bundle (product export is a
later wave).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from shake_service import config, gmice, gmm, intensity, vs30

SERVICE_VERSION = "0.1.0"  # shake-service package version (pyproject.toml)


@dataclass(frozen=True)
class GroundMotionChannel:
    """One ground-motion IMT's field over the site grid, 2-D (ny, nx),
    LINEAR units (g for PGA/SA, cm/s for PGV) for `mean`; sigma components
    stay ln-space (the wave-A/gmm.py contract)."""

    imt: str
    unit: str  # "g" | "cm/s"
    mean: np.ndarray  # linear, shape (ny, nx)
    sigma_ln: np.ndarray
    tau_ln: np.ndarray
    phi_ln: np.ndarray
    sigma_model_ln: np.ndarray


@dataclass(frozen=True)
class IntensityGrid:
    """One intensity channel (EMS or MMI), 2-D (ny, nx) — the same fields
    as `intensity.IntensityChannel`, reshaped onto the site mesh."""

    scale: str
    model: str
    mean: np.ndarray
    sigma: np.ndarray
    tau: np.ndarray
    phi: np.ndarray
    sigma_model: np.ndarray
    driver: np.ndarray
    sigma_gmice_verified: bool
    sigma_gmice_citation: str


@dataclass(frozen=True)
class ForwardMap:
    """The full forward-map product: site grid, ground-motion channels
    (PGA/PGV), intensity channels (EMS/MMI), and provenance."""

    lon2d: np.ndarray  # (ny, nx)
    lat2d: np.ndarray  # (ny, nx)
    pga: GroundMotionChannel
    pgv: GroundMotionChannel
    ems: IntensityGrid
    mmi: IntensityGrid

    event: dict[str, float]  # lat, lon, depth_km, mag_mw
    band: str
    weights: dict[str, float]

    grid_meta: dict[str, Any]  # half_extent_km, spacing_km, shape, n_sites
    vs30_meta: dict[str, Any]  # whatever the sampler's own metadata carries

    extrapolation: gmm.ExtrapolationFlags
    in_zagros_polygon: bool
    depth_extrapolated: bool  # convenience mirror of extrapolation.depth_extrapolated

    data_used: dict[str, Any] = field(
        default_factory=lambda: {"source": "catalog", "channels": (), "n_observations": 0}
    )
    version: dict[str, str] = field(default_factory=dict)


def _reshape(flat: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    return np.asarray(flat, dtype=float).reshape(shape)


def build_forward_map(
    event_lat: float,
    event_lon: float,
    event_depth_km: float,
    mag_mw: float,
    *,
    vs30_sampler: vs30.Vs30Sampler | None = None,
    ems_model: str = gmice.DEFAULT_EMS_MODEL,
    mmi_model: str = gmice.DEFAULT_MMI_MODEL,
) -> ForwardMap:
    """Build the un-conditioned forward map for one event.

    Args:
        event_lat, event_lon, event_depth_km, mag_mw: catalog event params.
        vs30_sampler: a `vs30.Vs30Sampler`. Defaults to `None`, which
            resolves to `vs30.default_sampler()` — the real Vs30 raster
            (`vs30.RasterVs30`) when `BUMELERZE_VS30_RASTER_PATH` is set
            and readable, else the wave-A `UniformRockVs30` rock-760
            fallback (never fails/blocks on an unhydrated/missing raster —
            `vs30.py`'s `[REVIEW]` note). Pass `vs30.UniformRockVs30()`
            explicitly to force the fallback regardless of environment.
        ems_model / mmi_model: `gmice` model names for the two intensity
            channels (defaults: Zanini & Hofer 2019 / Worden et al. 2012).
    """
    band = config.magnitude_band(mag_mw)
    half_extent_km = config.grid_extent_km(band)
    spacing_km = config.forward_grid_spacing_km(band)

    resolved_sampler = vs30_sampler if vs30_sampler is not None else vs30.default_sampler()
    site_grid = vs30.build_grid_km_spacing(
        event_lat, event_lon, half_extent_km=half_extent_km, spacing_km=spacing_km,
        sampler=resolved_sampler,
    )

    # vs30.build_grid_km_spacing returns flat (row-major) 1-D arrays; recover
    # the 2-D mesh shape from the same n_steps formula that module uses.
    n_steps = max(int(round((2 * half_extent_km) / spacing_km)) + 1, 2)
    shape = (n_steps, n_steps)
    if site_grid.n_sites != shape[0] * shape[1]:
        # Defensive: build_grid_km_spacing's own n_steps computation is the
        # source of truth; if it ever diverges from this local re-derivation
        # (e.g. a future edit changes its rounding), fail loudly rather than
        # silently reshape into the wrong mesh.
        raise AssertionError(
            f"forward.build_forward_map: site grid has {site_grid.n_sites} sites, "
            f"expected {shape[0] * shape[1]} for shape {shape} — n_steps re-derivation "
            f"has drifted from vs30.build_grid_km_spacing's own formula."
        )

    gm = gmm.compute_mixture(event_lat, event_lon, event_depth_km, mag_mw=mag_mw, site_grid=site_grid)

    pga_i = gm.imt_index("PGA")
    pgv_i = gm.imt_index("PGV")
    pga = GroundMotionChannel(
        imt="PGA", unit="g",
        mean=_reshape(gm.to_linear("PGA"), shape),
        sigma_ln=_reshape(np.sqrt(gm.tau[pga_i] ** 2 + gm.phi[pga_i] ** 2 + gm.sigma_model[pga_i] ** 2), shape),
        tau_ln=_reshape(gm.tau[pga_i], shape),
        phi_ln=_reshape(gm.phi[pga_i], shape),
        sigma_model_ln=_reshape(gm.sigma_model[pga_i], shape),
    )
    pgv = GroundMotionChannel(
        imt="PGV", unit="cm/s",
        mean=_reshape(gm.to_linear("PGV"), shape),
        sigma_ln=_reshape(np.sqrt(gm.tau[pgv_i] ** 2 + gm.phi[pgv_i] ** 2 + gm.sigma_model[pgv_i] ** 2), shape),
        tau_ln=_reshape(gm.tau[pgv_i], shape),
        phi_ln=_reshape(gm.phi[pgv_i], shape),
        sigma_model_ln=_reshape(gm.sigma_model[pgv_i], shape),
    )

    ems_channel = intensity.compute_intensity(gm, model=ems_model)
    mmi_channel = intensity.compute_intensity(gm, model=mmi_model)

    ems = IntensityGrid(
        scale=ems_channel.scale, model=ems_channel.model,
        mean=_reshape(ems_channel.mean, shape), sigma=_reshape(ems_channel.sigma, shape),
        tau=_reshape(ems_channel.tau, shape), phi=_reshape(ems_channel.phi, shape),
        sigma_model=_reshape(ems_channel.sigma_model, shape),
        driver=np.asarray(ems_channel.driver).reshape(shape),
        sigma_gmice_verified=ems_channel.sigma_gmice_verified,
        sigma_gmice_citation=ems_channel.sigma_gmice_citation,
    )
    mmi = IntensityGrid(
        scale=mmi_channel.scale, model=mmi_channel.model,
        mean=_reshape(mmi_channel.mean, shape), sigma=_reshape(mmi_channel.sigma, shape),
        tau=_reshape(mmi_channel.tau, shape), phi=_reshape(mmi_channel.phi, shape),
        sigma_model=_reshape(mmi_channel.sigma_model, shape),
        driver=np.asarray(mmi_channel.driver).reshape(shape),
        sigma_gmice_verified=mmi_channel.sigma_gmice_verified,
        sigma_gmice_citation=mmi_channel.sigma_gmice_citation,
    )

    return ForwardMap(
        lon2d=_reshape(site_grid.lons, shape),
        lat2d=_reshape(site_grid.lats, shape),
        pga=pga, pgv=pgv, ems=ems, mmi=mmi,
        event={
            "lat": float(event_lat), "lon": float(event_lon),
            "depth_km": float(event_depth_km), "mag_mw": float(mag_mw),
        },
        band=band,
        weights=gm.weights,
        grid_meta={
            "half_extent_km": half_extent_km,
            "spacing_km": spacing_km,
            "shape": shape,
            "n_sites": site_grid.n_sites,
        },
        vs30_meta={
            "sampler": type(resolved_sampler).__name__,
            "vs30_source_error": getattr(resolved_sampler, "last_error", None),
        },
        extrapolation=gm.extrapolation,
        in_zagros_polygon=gm.in_zagros_polygon,
        depth_extrapolated=gm.extrapolation.depth_extrapolated,
        data_used={"source": "catalog", "channels": (), "n_observations": 0},
        version={
            "service_version": SERVICE_VERSION,
            "openquake_pin": config.OPENQUAKE_PIN,
            "ems_model": ems_model,
            "mmi_model": mmi_model,
            "gsim_branches": ",".join(config.GSIM_KEYS),
        },
    )
