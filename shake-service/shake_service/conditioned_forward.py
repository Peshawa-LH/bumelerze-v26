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
- EMS/MMI are RECOMPUTED from the (possibly floored, see below) conditioned
  PGA/PGV (not conditioned directly — DYFI observations already fed the
  ground-motion IMTs via `dyfi_observations.py`'s GMICE-reverse step, so
  re-running the FORWARD GMICE chain rule, exactly `intensity.py`'s own
  `compute_intensity`, is the correct "IPE reapplied to the new posterior"
  step — it needs a `gmm.GMResult`-shaped object, which this module builds
  as a minimal 2-channel (PGA, PGV) stand-in around the conditioned arrays,
  not a full mixture re-run (the mixture is already baked into
  `tau_cond`/`phi_cond`/`sigma_model` from the conditioning step).

Small-N conditioning floor (`docs/decisions.md` D20 checkpoint condition
3, 2026-08-07 finding + engineering-proposed default, D14 pattern — **PROPOSED,
NOT yet confirmed by Peshawa**, `config.MIN_CONDITIONING_OBSERVATIONS`)
----------------------------------------------------------------------------
`validation/SUMMARY.md`'s cross-event table found that conditioning on a
very small in-domain DYFI sample can make a bare prior WORSE, not better:
`us1000hwdw` (Mw 6.3) conditioned on only 5 observations flipped an already
PASSING bare-prior PGA bias (-0.091) to a narrow conditioned FAIL (+0.339)
— a handful of unrepresentative observations getting outsized leverage via
the correlated tau term. The proposed default: conditioning engages, per
IMT independently, only when that IMT's ACTUAL conditioning count
(`mvn.ConditionedField.n_conditioning`, i.e. after `mvn.py`'s own
colocated-observation merge — the same count already reported in
`ForwardMap.data_used["n_observations"]`) is `>= min_conditioning_observations`
(default `config.MIN_CONDITIONING_OBSERVATIONS`, currently 10). Below the
floor, `mvn.condition_forward_map` is still CALLED (so the raw
`ConditionedField` diagnostics — bias, var_reduction, n_conditioning — stay
available on the returned `ConditionedForwardMapResult` for audit/report
purposes) but its posterior is NOT used to build the published channel;
the BARE prior channel from `fm` is published instead, and
`data_used["conditioning_floor"]` records, per IMT, that observations
existed but fell below the floor (never silently indistinguishable from
"no observations at all").
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np

from shake_service import config, forward, gmice, gmm, intensity, mvn, vs30


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
    min_conditioning_observations: int = config.MIN_CONDITIONING_OBSERVATIONS,
) -> ConditionedForwardMapResult:
    """Condition `fm`'s PGA and PGV fields (independently — `mvn.py` is
    single-IMT) on `observations_pga`/`observations_pgv`, then rebuild the
    EMS/MMI intensity channels from the conditioned ground motion. Returns
    a NEW `ForwardMap` (site grid, event, band, weights, grid/vs30 meta,
    extrapolation flags all carried over unchanged from `fm` — only the
    four data channels + `data_used`/`version` provenance change) plus the
    raw `mvn.ConditionedField`s for reporting.

    `min_conditioning_observations` (module docstring "Small-N conditioning
    floor", PROPOSED default `config.MIN_CONDITIONING_OBSERVATIONS`):
    `mvn.condition_forward_map` is ALWAYS called for both IMTs (so
    `result.pga`/`result.pgv` always carry real diagnostics), but the
    PUBLISHED channel for an IMT falls back to `fm`'s bare (unconditioned)
    prior whenever that IMT's actual conditioning count
    (`ConditionedField.n_conditioning`, post any `mvn.py`-internal
    colocated-observation merge) is below this floor. Pass `0` to disable
    the floor entirely (e.g. a unit test exercising the raw conditioning
    mechanism on a deliberately small synthetic sample).
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

    # Small-N conditioning floor (module docstring): decide, per IMT
    # independently, whether the ACTUAL conditioning count clears the floor.
    # `mvn.condition_forward_map` above was already called unconditionally
    # for both IMTs, so `cond_pga`/`cond_pgv` diagnostics are always
    # available on the returned result even when floored.
    pga_floored = cond_pga.n_conditioning < min_conditioning_observations
    pgv_floored = cond_pgv.n_conditioning < min_conditioning_observations

    if pga_floored:
        pga_mean_ln = np.log(np.asarray(fm.pga.mean, dtype=float)).ravel()
        pga_tau_arr = np.asarray(fm.pga.tau_ln, dtype=float).ravel()
        pga_phi_arr = np.asarray(fm.pga.phi_ln, dtype=float).ravel()
        pga_sigma_model_arr = np.asarray(fm.pga.sigma_model_ln, dtype=float).ravel()
    else:
        pga_mean_ln = cond_pga.mu_cond_ln
        pga_tau_arr = cond_pga.tau_cond
        pga_phi_arr = cond_pga.phi_cond
        pga_sigma_model_arr = cond_pga.sigma_model

    if pgv_floored:
        pgv_mean_ln = np.log(np.asarray(fm.pgv.mean, dtype=float)).ravel()
        pgv_tau_arr = np.asarray(fm.pgv.tau_ln, dtype=float).ravel()
        pgv_phi_arr = np.asarray(fm.pgv.phi_ln, dtype=float).ravel()
        pgv_sigma_model_arr = np.asarray(fm.pgv.sigma_model_ln, dtype=float).ravel()
    else:
        pgv_mean_ln = cond_pgv.mu_cond_ln
        pgv_tau_arr = cond_pgv.tau_cond
        pgv_phi_arr = cond_pgv.phi_cond
        pgv_sigma_model_arr = cond_pgv.sigma_model

    pga_channel = forward.GroundMotionChannel(
        imt="PGA", unit="g",
        mean=np.exp(pga_mean_ln).reshape(shape),
        sigma_ln=np.sqrt(pga_tau_arr**2 + pga_phi_arr**2 + pga_sigma_model_arr**2).reshape(shape),
        tau_ln=pga_tau_arr.reshape(shape),
        phi_ln=pga_phi_arr.reshape(shape),
        sigma_model_ln=pga_sigma_model_arr.reshape(shape),
    )
    pgv_channel = forward.GroundMotionChannel(
        imt="PGV", unit="cm/s",
        mean=np.exp(pgv_mean_ln).reshape(shape),
        sigma_ln=np.sqrt(pgv_tau_arr**2 + pgv_phi_arr**2 + pgv_sigma_model_arr**2).reshape(shape),
        tau_ln=pgv_tau_arr.reshape(shape),
        phi_ln=pgv_phi_arr.reshape(shape),
        sigma_model_ln=pgv_sigma_model_arr.reshape(shape),
    )

    # A minimal (PGA, PGV)-only GMResult stand-in so `intensity.py`'s own
    # (untouched) chain-rule code can be reused verbatim on the (possibly
    # floored, per IMT) posterior, rather than re-deriving its formula here
    # a second time.
    gm_cond = gmm.GMResult(
        imt_keys=("PGA", "PGV"),
        band=fm.band,
        weights=fm.weights,
        mean_ln=np.stack([pga_mean_ln, pgv_mean_ln], axis=0),
        tau=np.stack([pga_tau_arr, pgv_tau_arr], axis=0),
        phi=np.stack([pga_phi_arr, pgv_phi_arr], axis=0),
        sigma_model=np.stack([pga_sigma_model_arr, pgv_sigma_model_arr], axis=0),
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
        clamped=np.asarray(ems_out.clamped, dtype=bool).reshape(shape),
    )
    mmi_channel = forward.IntensityGrid(
        scale=mmi_out.scale, model=mmi_out.model,
        mean=mmi_out.mean.reshape(shape), sigma=mmi_out.sigma.reshape(shape),
        tau=mmi_out.tau.reshape(shape), phi=mmi_out.phi.reshape(shape),
        sigma_model=mmi_out.sigma_model.reshape(shape),
        driver=mmi_out.driver.reshape(shape),
        sigma_gmice_verified=mmi_out.sigma_gmice_verified,
        sigma_gmice_citation=mmi_out.sigma_gmice_citation,
        clamped=np.asarray(mmi_out.clamped, dtype=bool).reshape(shape),
    )

    # Small-N conditioning floor metadata (module docstring) -- one note per
    # IMT that had in-domain observations but not enough to clear the floor,
    # so "below the floor" stays distinguishable from "no observations at
    # all" in any product/report that reads `data_used`.
    floor_notes: list[str] = []
    if pga_floored and cond_pga.n_conditioning > 0:
        floor_notes.append(
            f"PGA: {cond_pga.n_conditioning} in-domain observation(s) available, below the "
            f"conditioning floor of {min_conditioning_observations} -- bare prior published for this channel"
        )
    if pgv_floored and cond_pgv.n_conditioning > 0:
        floor_notes.append(
            f"PGV: {cond_pgv.n_conditioning} in-domain observation(s) available, below the "
            f"conditioning floor of {min_conditioning_observations} -- bare prior published for this channel"
        )

    conditioned_fm = dataclasses.replace(
        fm,
        pga=pga_channel, pgv=pgv_channel, ems=ems_channel, mmi=mmi_channel,
        data_used={
            # Merged (not replaced) so upstream provenance set by
            # forward.build_forward_map — D22's "distance_method"/
            # "rupture_quads_used" — survives conditioning rather than
            # being silently dropped; the keys below (source/channels/
            # n_observations/...) still take precedence, unchanged from
            # before this merge (this module owns them, same as always).
            **fm.data_used,
            "source": "catalog+dyfi",
            "channels": ("PGA", "PGV"),
            "n_observations": {"PGA": cond_pga.n_conditioning, "PGV": cond_pgv.n_conditioning},
            "conditioning_applied": {"PGA": not pga_floored, "PGV": not pgv_floored},
            "conditioning_floor": min_conditioning_observations,
            "conditioning_floor_notes": floor_notes,
        },
        version={
            **fm.version,
            "conditioning": "mvn (Engler et al. 2022), wave D DYFI-derived station observations",
        },
    )

    return ConditionedForwardMapResult(forward_map=conditioned_fm, pga=cond_pga, pgv=cond_pgv)
