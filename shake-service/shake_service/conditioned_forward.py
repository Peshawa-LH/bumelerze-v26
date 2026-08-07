"""conditioned_forward — glue: take a bare `forward.ForwardMap` (the
unconditioned `gmpe_forward` prior) + per-IMT `mvn.StationObservation` lists
(from `dyfi_observations.py` or real instrumental stations later) and
produce a NEW `forward.ForwardMap` with PGA/PGV/EMS/MMI all replaced by
their `mvn`-conditioned counterparts — same shape/type as the bare map, so
`comparison.py`'s grid-vs-grid tooling needs ZERO changes to compare a
conditioned map (wave D, `docs/decisions.md` D20 checkpoint outcome).

Design notes
----------------------------------------------------------------------------
- `mvn.py` is explicitly single-IMT scope (its own module docstring); this
  module calls `mvn.condition_forward_map` once per IMT (PGA, then PGV) —
  `mvn.py` itself is untouched, per the task's "WEIGHTS/mvn conditioning
  engine MUST NOT BE TOUCHED" instruction.
- EMS/MMI are RECOMPUTED from the conditioned PGA/PGV (not conditioned
  directly — DYFI observations already fed the ground-motion IMTs via
  `dyfi_observations.py`'s GMICE-reverse step, so re-running the FORWARD
  GMICE chain rule on the conditioned PGA/PGV, exactly `intensity.py`'s own
  `compute_intensity`, is the correct "IPE reapplied to the new posterior"
  step — it needs a `gmm.GMResult`-shaped object, which this module builds
  as a minimal 2-channel (PGA, PGV) stand-in around the conditioned arrays,
  not a full mixture re-run (the mixture is already baked into
  `tau_cond`/`phi_cond`/`sigma_model` from the conditioning step).
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np

from shake_service import forward, gmice, gmm, intensity, mvn, vs30


@dataclass(frozen=True)
class ConditionedForwardMapResult:
    """The conditioned `ForwardMap` plus the raw per-IMT `mvn.ConditionedField`
    diagnostics (`n_conditioning`, `bias`, `var_reduction`, ...) a report
    needs but `ForwardMap` itself doesn't carry."""

    forward_map: forward.ForwardMap
    pga: mvn.ConditionedField
    pgv: mvn.ConditionedField


def condition_forward_map_on_dyfi(
    fm: forward.ForwardMap,
    *,
    event_lat: float,
    event_lon: float,
    event_depth_km: float,
    mag_mw: float,
    observations_pga: Sequence[mvn.StationObservation],
    observations_pgv: Sequence[mvn.StationObservation],
    vs30_sampler: vs30.Vs30Sampler | None = None,
    correlation_model: str = mvn.DEFAULT_CORRELATION_MODEL,
    correlation_params: dict[str, Any] | None = None,
    ems_model: str = gmice.DEFAULT_EMS_MODEL,
    mmi_model: str = gmice.DEFAULT_MMI_MODEL,
) -> ConditionedForwardMapResult:
    """Condition `fm`'s PGA and PGV fields (independently — `mvn.py` is
    single-IMT) on `observations_pga`/`observations_pgv`, then rebuild the
    EMS/MMI intensity channels from the conditioned ground motion. Returns
    a NEW `ForwardMap` (site grid, event, band, weights, grid/vs30 meta,
    extrapolation flags all carried over unchanged from `fm` — only the
    four data channels + `data_used`/`version` provenance change) plus the
    raw `mvn.ConditionedField`s for reporting.
    """
    shape = fm.pga.mean.shape
    lon_grid = np.asarray(fm.lon2d, dtype=float).ravel()
    lat_grid = np.asarray(fm.lat2d, dtype=float).ravel()

    cond_pga = mvn.condition_forward_map(
        event_lat=event_lat, event_lon=event_lon, event_depth_km=event_depth_km, mag_mw=mag_mw,
        imt="PGA",
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=np.log(np.asarray(fm.pga.mean, dtype=float)).ravel(),
        tau_grid=np.asarray(fm.pga.tau_ln, dtype=float).ravel(),
        phi_grid=np.asarray(fm.pga.phi_ln, dtype=float).ravel(),
        sigma_model_grid=np.asarray(fm.pga.sigma_model_ln, dtype=float).ravel(),
        observations=observations_pga,
        vs30_sampler=vs30_sampler,
        correlation_model=correlation_model, correlation_params=correlation_params,
    )
    cond_pgv = mvn.condition_forward_map(
        event_lat=event_lat, event_lon=event_lon, event_depth_km=event_depth_km, mag_mw=mag_mw,
        imt="PGV",
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=np.log(np.asarray(fm.pgv.mean, dtype=float)).ravel(),
        tau_grid=np.asarray(fm.pgv.tau_ln, dtype=float).ravel(),
        phi_grid=np.asarray(fm.pgv.phi_ln, dtype=float).ravel(),
        sigma_model_grid=np.asarray(fm.pgv.sigma_model_ln, dtype=float).ravel(),
        observations=observations_pgv,
        vs30_sampler=vs30_sampler,
        correlation_model=correlation_model, correlation_params=correlation_params,
    )

    pga_channel = forward.GroundMotionChannel(
        imt="PGA", unit="g",
        mean=np.exp(cond_pga.mu_cond_ln).reshape(shape),
        sigma_ln=cond_pga.sigma_cond.reshape(shape),
        tau_ln=cond_pga.tau_cond.reshape(shape),
        phi_ln=cond_pga.phi_cond.reshape(shape),
        sigma_model_ln=cond_pga.sigma_model.reshape(shape),
    )
    pgv_channel = forward.GroundMotionChannel(
        imt="PGV", unit="cm/s",
        mean=np.exp(cond_pgv.mu_cond_ln).reshape(shape),
        sigma_ln=cond_pgv.sigma_cond.reshape(shape),
        tau_ln=cond_pgv.tau_cond.reshape(shape),
        phi_ln=cond_pgv.phi_cond.reshape(shape),
        sigma_model_ln=cond_pgv.sigma_model.reshape(shape),
    )

    # A minimal (PGA, PGV)-only GMResult stand-in so `intensity.py`'s own
    # (untouched) chain-rule code can be reused verbatim on the conditioned
    # posterior, rather than re-deriving its formula here a second time.
    gm_cond = gmm.GMResult(
        imt_keys=("PGA", "PGV"),
        band=fm.band,
        weights=fm.weights,
        mean_ln=np.stack([cond_pga.mu_cond_ln, cond_pgv.mu_cond_ln], axis=0),
        tau=np.stack([cond_pga.tau_cond, cond_pgv.tau_cond], axis=0),
        phi=np.stack([cond_pga.phi_cond, cond_pgv.phi_cond], axis=0),
        sigma_model=np.stack([cond_pga.sigma_model, cond_pgv.sigma_model], axis=0),
        per_branch_mean_ln={},
        extrapolation=fm.extrapolation,
        in_zagros_polygon=fm.in_zagros_polygon,
    )
    ems_out = intensity.compute_intensity(gm_cond, model=ems_model)
    mmi_out = intensity.compute_intensity(gm_cond, model=mmi_model)

    ems_channel = forward.IntensityGrid(
        scale=ems_out.scale, model=ems_out.model,
        mean=ems_out.mean.reshape(shape), sigma=ems_out.sigma.reshape(shape),
        tau=ems_out.tau.reshape(shape), phi=ems_out.phi.reshape(shape),
        sigma_model=ems_out.sigma_model.reshape(shape),
        driver=ems_out.driver.reshape(shape),
        sigma_gmice_verified=ems_out.sigma_gmice_verified,
        sigma_gmice_citation=ems_out.sigma_gmice_citation,
    )
    mmi_channel = forward.IntensityGrid(
        scale=mmi_out.scale, model=mmi_out.model,
        mean=mmi_out.mean.reshape(shape), sigma=mmi_out.sigma.reshape(shape),
        tau=mmi_out.tau.reshape(shape), phi=mmi_out.phi.reshape(shape),
        sigma_model=mmi_out.sigma_model.reshape(shape),
        driver=mmi_out.driver.reshape(shape),
        sigma_gmice_verified=mmi_out.sigma_gmice_verified,
        sigma_gmice_citation=mmi_out.sigma_gmice_citation,
    )

    conditioned_fm = dataclasses.replace(
        fm,
        pga=pga_channel, pgv=pgv_channel, ems=ems_channel, mmi=mmi_channel,
        data_used={
            "source": "catalog+dyfi",
            "channels": ("PGA", "PGV"),
            "n_observations": {"PGA": cond_pga.n_conditioning, "PGV": cond_pgv.n_conditioning},
        },
        version={
            **fm.version,
            "conditioning": "mvn (Engler et al. 2022), wave D DYFI-derived station observations",
        },
    )

    return ConditionedForwardMapResult(forward_map=conditioned_fm, pga=cond_pga, pgv=cond_pgv)
