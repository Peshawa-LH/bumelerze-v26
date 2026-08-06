"""mvn — Multivariate-normal (Engler et al. 2022) conditioning of a forward
ground-motion field on point observations, single IMT, D9's "mvn conditioning"
step (the second half of `gmpe_forward -> mvn`).

Provenance (D9 "extract, don't entangle" — wave B, 2026-08-07)
----------------------------------------------------------------------------
Ported from, read-only, never modified:
  SHAKEmaps-Toolkit-v26/modules/engines/mvn.py
    (`_condition_field`, `_engler_partition`, `_aggregate_colocated_points`,
    `_estimate_bias`, `_pairwise_distance_km`) — Engler et al. (2022) direct
    MVN on total residuals (station-station / grid-station covariance split
    into a fully-correlated between-event block and a spatially-correlated
    within-event block) + Worden et al. (2018) between-event bias
    (diagnostics only, never subtracted — see `_estimate_bias`'s docstring,
    reproduced below).
  SHAKEmaps-Toolkit-v26/modules/hazard/correlation/models.py
    (`jayaram_baker_2009`) — the single-IMT spatial correlation model this
    module's default `correlation_model` uses.

The core math (`_condition_field`, `_engler_partition`,
`_aggregate_colocated_points`, `_estimate_bias`, the correlation formula) is
reproduced VERBATIM, arithmetic-for-arithmetic. What is adapted is the
INTERFACE: the toolkit's `run_mvn` takes toolkit-internal `site`/`rupture`/
`event`/`ObservationSet` objects and a channel-routing/CDI-filter pipeline
(M4b-3, multi-channel, cross-IMT — all out of this wave's scope, which is
task-scoped to "station PGA/PGV or intensity observations from felt cells
later", single target IMT). Here the low-level `condition_field` operates on
plain arrays (grid + `StationObservation`s) so it is directly unit-testable
against synthetic data without a hazardlib round trip; the higher-level
`condition_forward_map` wraps it with a real `gmm.compute_mixture` call to
evaluate the prior AT the station coordinates exactly (not interpolated
from the grid — the same "one combined GMPE evaluation" idea `run_mvn`
itself uses, `_sample_site_field_at_points`/combined-site pattern), so a
caller only needs event params + station lon/lat/value/sigma.

Scope narrowing vs. the toolkit (documented, not a silent gap)
----------------------------------------------------------------------------
- Single-IMT, same-IMT conditioning only (toolkit M4a scope,
  `channels=('stations',)` in the toolkit's own vocabulary) — no GMICE
  channel routing (DYFI/CDI intensity observations conditioning a
  ground-motion IMT), no native cross-IMT joint conditioning (M4b-4). The
  task's own scope note calls this out explicitly ("intensity observations
  from felt cells later").
- `sigma_model` (epistemic, the D20 logic-tree spread) is excluded from the
  conditioning covariance and carried forward UNCHANGED, exactly as the
  toolkit's own reviewer instruction requires (module docstring point 5
  there, reproduced in `ConditionedField`'s docstring below).
- UQ-A correlated-field sampling (`sample_conditioned_fields`) is not
  ported — a documented later addition, not needed for this wave's tests
  (mean/tau/phi conditioning behaviour only).

Earth-radius note (flagged, not a behaviour-changing adaptation)
----------------------------------------------------------------------------
The toolkit's `mvn.py` uses `EARTH_RADIUS_KM = 6371.0` for its own
station-station/grid-station haversine distances (its docstring: "kept
consistent with hazard/source/rupture.py"). `shake_service.distances.py`
(wave A, the GSIM point-to-rupture-distance path via ps2ff) instead uses
`6371.0088` (IUGG mean radius). This module reproduces the toolkit mvn.py's
own `6371.0` verbatim (a different radius convention for a different
purpose — conditioning-covariance point-to-point distance, not
epicentral-to-rupture distance) rather than silently harmonising it with
`distances.py`; the discrepancy is ~0.0001% of Earth's radius, immaterial
to any correlation-model result, but recorded here per the task's
flag-loudly instruction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Sequence, Tuple

import numpy as np
from scipy.linalg import cho_factor, cho_solve

from shake_service import gmm, vs30

EARTH_RADIUS_KM: float = 6371.0  # toolkit mvn.py's own convention -- see module docstring.

DEFAULT_CORRELATION_MODEL = "jayaram_baker_2009"

# Same numerical-stability constants as the toolkit (mvn.py module-level
# docstrings for each), reproduced verbatim.
_CHOLESKY_JITTER_REL = 1e-8
_COLOCATION_TOL_DEG = 1e-6
_COLOCATION_WEIGHT_EPS = 1e-12


# ---------------------------------------------------------------------------
# Correlation model: Jayaram & Baker (2009), the toolkit's default
# (`hazard/correlation/models.py:jayaram_baker_2009`), reproduced verbatim.
# ---------------------------------------------------------------------------

# HONESTY FLAG (carried forward from the toolkit, same policy as
# gmice.WORDEN_SIGMA_VERIFIED): these b(T) coefficients are a documented
# recollection of Jayaram & Baker (2009)'s published table, not
# independently re-verified against the primary PDF.
JAYARAM_BAKER_2009_VERIFIED = False


def _jayaram_baker_2009_b(period: float, case: int) -> float:
    if case == 1:
        return 8.5 + 17.2 * period if period < 1.0 else 22.0 + 3.7 * period
    if case == 2:
        return 40.7 - 15.0 * period if period < 1.0 else 22.0 + 3.7 * period
    raise ValueError(f"jayaram_baker_2009: case must be 1 or 2, got {case!r}")


def jayaram_baker_2009(dist_km: np.ndarray, *, period: float = 0.01, case: int = 1) -> np.ndarray:
    """`rho(h) = exp(-3h / b(T))` — Jayaram & Baker (2009) exponential
    model. `period=0.01` (default) is the common PGA proxy (SA is not
    itself in the paper's table; a very short period stands in for it,
    ShakeMap-family convention)."""
    dist_km = np.asarray(dist_km, dtype=float)
    b = _jayaram_baker_2009_b(float(period), int(case))
    return np.exp(-3.0 * dist_km / b)


_CORRELATION_MODELS = {"jayaram_baker_2009": jayaram_baker_2009}


def corr_matrix(name: str, dist_km: np.ndarray, **params: Any) -> np.ndarray:
    """Evaluate a named correlation model, clipped into [0, 1] (a
    correlation model may only ever attenuate, never invert/amplify — same
    range guard as the toolkit's `hazard/correlation/base.py:corr_matrix`)."""
    if name not in _CORRELATION_MODELS:
        raise KeyError(f"mvn: unknown correlation model {name!r} (available: {sorted(_CORRELATION_MODELS)})")
    dist_km = np.asarray(dist_km, dtype=float)
    rho = np.asarray(_CORRELATION_MODELS[name](dist_km, **params), dtype=float)
    return np.clip(rho, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Small geometry helper (verbatim port of `_pairwise_distance_km`)
# ---------------------------------------------------------------------------


def _pairwise_distance_km(lon_a, lat_a, lon_b, lat_b) -> np.ndarray:
    """(len(a), len(b)) great-circle distance matrix, km (haversine,
    spherical Earth, module-level `EARTH_RADIUS_KM`)."""
    lon_a = np.radians(np.asarray(lon_a, dtype=float))[:, None]
    lat_a = np.radians(np.asarray(lat_a, dtype=float))[:, None]
    lon_b = np.radians(np.asarray(lon_b, dtype=float))[None, :]
    lat_b = np.radians(np.asarray(lat_b, dtype=float))[None, :]
    dlat = lat_b - lat_a
    dlon = lon_b - lon_a
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat_a) * np.cos(lat_b) * np.sin(dlon / 2.0) ** 2
    c = 2.0 * np.arctan2(np.sqrt(a), np.sqrt(np.clip(1.0 - a, 0.0, None)))
    return EARTH_RADIUS_KM * c


# ---------------------------------------------------------------------------
# Between-event bias (Worden et al. 2018) — diagnostics only, never
# subtracted (verbatim port of `_estimate_bias`).
# ---------------------------------------------------------------------------


def _estimate_bias(
    residual_ln: np.ndarray, phi: np.ndarray, sigma_obs: np.ndarray, tau: np.ndarray,
) -> Tuple[float, float, float]:
    """Between-event bias — a tau-weighted shrinkage (empirical-Bayes)
    estimate of the shared event term (Worden et al. 2018).

    Model: `residual_i = B + w_i`, `w_i ~ N(0, phi_i^2 + sigma_obs_i^2)`
    independent given the (single, shared) event term `B ~ N(0, tau0^2)`
    (`tau0^2` = `mean(tau_i^2)` over the conditioning stations). Returns
    `(bias, bias_variance, tau0_squared)`; `(0.0, 0.0, 0.0)` when there are
    no conditioning stations.

    NOT subtracted from the residuals used in `_condition_field` — the
    between-event shift is inferred and spread to the whole grid by the
    fully-correlated `tau*tau^T` covariance block already in the MVN
    (Engler direct MVN); subtracting the Worden bias too would DOUBLE-remove
    it (the toolkit's own F1 finding, 2026-07-05). This function exists for
    REPORTING/diagnostics only (`ConditionedField.bias`/`bias_variance`).
    """
    n = residual_ln.size
    if n == 0:
        return 0.0, 0.0, 0.0
    tau0_sq = float(np.mean(np.asarray(tau, dtype=float) ** 2))
    w = 1.0 / (np.asarray(phi, dtype=float) ** 2 + np.asarray(sigma_obs, dtype=float) ** 2)
    sw = float(np.sum(w))
    denom = 1.0 + tau0_sq * sw
    if denom <= 0:
        return 0.0, 0.0, tau0_sq
    bias = tau0_sq * float(np.sum(w * residual_ln)) / denom
    bias_var = tau0_sq / denom
    return bias, bias_var, tau0_sq


# ---------------------------------------------------------------------------
# Co-located-observation aggregation (verbatim port of
# `_aggregate_colocated_points`)
# ---------------------------------------------------------------------------


def _aggregate_colocated_points(
    lon: np.ndarray, lat: np.ndarray, value_ln: np.ndarray, sigma_obs: np.ndarray,
    mu_prior_ln: np.ndarray, phi: np.ndarray, tau: np.ndarray,
    *, tol_deg: float = _COLOCATION_TOL_DEG,
) -> Tuple[Dict[str, np.ndarray], int]:
    """Merge genuinely co-located conditioning points (within `tol_deg`)
    into one precision-weighted super-observation each — co-located rows
    share the fully-correlated within-event field (C(0)=1), so they differ
    only by independent `sigma_obs` noise; with `sigma_obs~=0` that makes
    the station-station covariance singular. Merging removes the
    singularity at its source rather than masking it with jitter.

    Returns `(agg, n_merged)`; `agg` has keys
    `lon/lat/value_ln/sigma_obs/mu_prior_ln/phi/tau` (all 1-D, length
    n_unique), `n_merged = n_input - n_unique` (0 when nothing colocated).
    """
    n = int(np.asarray(lon).size)
    if n <= 1:
        return {
            "lon": np.asarray(lon, dtype=float), "lat": np.asarray(lat, dtype=float),
            "value_ln": np.asarray(value_ln, dtype=float), "sigma_obs": np.asarray(sigma_obs, dtype=float),
            "mu_prior_ln": np.asarray(mu_prior_ln, dtype=float),
            "phi": np.asarray(phi, dtype=float), "tau": np.asarray(tau, dtype=float),
        }, 0

    lon = np.asarray(lon, dtype=float)
    lat = np.asarray(lat, dtype=float)
    value_ln = np.asarray(value_ln, dtype=float)
    sigma_obs = np.asarray(sigma_obs, dtype=float)
    mu_prior_ln = np.asarray(mu_prior_ln, dtype=float)
    phi = np.asarray(phi, dtype=float)
    tau = np.asarray(tau, dtype=float)

    decimals = max(0, int(round(-np.log10(tol_deg))))
    keys = np.stack([np.round(lon, decimals), np.round(lat, decimals)], axis=1)
    _uniq, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = np.asarray(inverse).ravel()

    n_groups = int(inverse.max()) + 1
    if n_groups == n:
        return {
            "lon": lon, "lat": lat, "value_ln": value_ln, "sigma_obs": sigma_obs,
            "mu_prior_ln": mu_prior_ln, "phi": phi, "tau": tau,
        }, 0

    first_seen = np.full(n_groups, n, dtype=int)
    for row, gid in enumerate(inverse):
        if row < first_seen[gid]:
            first_seen[gid] = row
    group_order = np.argsort(first_seen)

    out = {k: np.empty(n_groups, dtype=float) for k in
           ("lon", "lat", "value_ln", "sigma_obs", "mu_prior_ln", "phi", "tau")}
    for out_pos, gid in enumerate(group_order):
        members = np.nonzero(inverse == gid)[0]
        if members.size == 1:
            i = members[0]
            out["lon"][out_pos] = lon[i]; out["lat"][out_pos] = lat[i]
            out["value_ln"][out_pos] = value_ln[i]; out["sigma_obs"][out_pos] = sigma_obs[i]
            out["mu_prior_ln"][out_pos] = mu_prior_ln[i]
            out["phi"][out_pos] = phi[i]; out["tau"][out_pos] = tau[i]
            continue
        w = 1.0 / (sigma_obs[members] ** 2 + _COLOCATION_WEIGHT_EPS)
        sw = float(np.sum(w))
        out["value_ln"][out_pos] = float(np.sum(w * value_ln[members]) / sw)
        out["sigma_obs"][out_pos] = float(np.sqrt(1.0 / sw))
        out["lon"][out_pos] = float(np.mean(lon[members]))
        out["lat"][out_pos] = float(np.mean(lat[members]))
        out["mu_prior_ln"][out_pos] = float(np.mean(mu_prior_ln[members]))
        out["phi"][out_pos] = float(np.mean(phi[members]))
        out["tau"][out_pos] = float(np.mean(tau[members]))

    return out, int(n - n_groups)


# ---------------------------------------------------------------------------
# Core MVN conditioning (verbatim port of `_condition_field` +
# `_engler_partition`)
# ---------------------------------------------------------------------------


def _condition_field(
    *,
    mu_prior_grid_ln: np.ndarray, phi_grid: np.ndarray, tau_grid: np.ndarray,
    lon_grid: np.ndarray, lat_grid: np.ndarray,
    mu_prior_station_ln: np.ndarray, phi_station: np.ndarray, tau_station: np.ndarray,
    lon_station: np.ndarray, lat_station: np.ndarray,
    value_ln_station: np.ndarray, sigma_obs_station: np.ndarray,
    correlation_model: str, correlation_params: Optional[Dict[str, Any]],
    grid_block_size: int,
) -> Dict[str, np.ndarray]:
    """The MVN conditioning math (module docstring). All inputs 1-D,
    ln-space. Returns `mu_cond`, `tau_cond`, `phi_cond`, `var_reduction`,
    `n_conditioning`, `n_colocated_merged`, plus the post-aggregation
    station arrays."""
    n_grid = lon_grid.size
    n_station = lon_station.size
    corr_params = correlation_params or {}

    if n_station == 0:
        # Degenerate passthrough: no silent fabricated update when there is
        # nothing to condition on.
        return {
            "mu_cond": np.asarray(mu_prior_grid_ln, dtype=float).copy(),
            "tau_cond": np.asarray(tau_grid, dtype=float).copy(),
            "phi_cond": np.asarray(phi_grid, dtype=float).copy(),
            "var_reduction": np.zeros(n_grid, dtype=float),
            "n_conditioning": 0, "n_colocated_merged": 0,
        }

    agg, n_merged = _aggregate_colocated_points(
        lon_station, lat_station, value_ln_station, sigma_obs_station,
        mu_prior_station_ln, phi_station, tau_station,
    )
    lon_station = agg["lon"]; lat_station = agg["lat"]
    value_ln_station = agg["value_ln"]; sigma_obs_station = agg["sigma_obs"]
    mu_prior_station_ln = agg["mu_prior_ln"]
    phi_station = agg["phi"]; tau_station = agg["tau"]
    n_station = lon_station.size

    dist_ss = _pairwise_distance_km(lon_station, lat_station, lon_station, lat_station)
    c_ss = corr_matrix(correlation_model, dist_ss, **corr_params)

    sigma_b_ss = np.outer(tau_station, tau_station)
    sigma_w_ss = np.outer(phi_station, phi_station) * c_ss
    sigma_ss = sigma_b_ss + sigma_w_ss + np.diag(np.asarray(sigma_obs_station, dtype=float) ** 2)

    jitter = _CHOLESKY_JITTER_REL * float(np.mean(np.diag(sigma_ss)))
    sigma_ss = sigma_ss + np.eye(n_station) * jitter

    c_and_lower = cho_factor(sigma_ss, lower=True)

    r = np.asarray(value_ln_station, dtype=float) - np.asarray(mu_prior_station_ln, dtype=float)
    alpha = cho_solve(c_and_lower, r)

    tau_solve = cho_solve(c_and_lower, tau_station)
    q_b = float(np.dot(tau_station, tau_solve))

    mu_cond = np.empty(n_grid, dtype=float)
    var_reduction = np.empty(n_grid, dtype=float)
    tau_reduction_raw = np.empty(n_grid, dtype=float)
    phi_reduction_raw = np.empty(n_grid, dtype=float)

    block = max(1, int(grid_block_size))
    for start in range(0, n_grid, block):
        end = min(start + block, n_grid)
        lon_blk = lon_grid[start:end]; lat_blk = lat_grid[start:end]
        tau_blk = tau_grid[start:end]; phi_blk = phi_grid[start:end]

        dist_gs = _pairwise_distance_km(lon_blk, lat_blk, lon_station, lat_station)
        c_gs = corr_matrix(correlation_model, dist_gs, **corr_params)

        sigma_b_gs = np.outer(tau_blk, tau_station)
        sigma_w_gs = np.outer(phi_blk, phi_station) * c_gs
        sigma_gs = sigma_b_gs + sigma_w_gs

        mu_cond[start:end] = mu_prior_grid_ln[start:end] + sigma_gs @ alpha

        v_total = cho_solve(c_and_lower, sigma_gs.T)
        var_reduction[start:end] = np.einsum("gs,sg->g", sigma_gs, v_total)

        tau_reduction_raw[start:end] = (tau_blk**2) * q_b
        v_w = cho_solve(c_and_lower, sigma_w_gs.T)
        phi_reduction_raw[start:end] = np.einsum("gs,sg->g", sigma_w_gs, v_w)

    tau_cond, phi_cond = _engler_partition(
        tau_grid=tau_grid, phi_grid=phi_grid, var_reduction=var_reduction,
        tau_reduction_raw=tau_reduction_raw, phi_reduction_raw=phi_reduction_raw,
    )

    return {
        "mu_cond": mu_cond, "tau_cond": tau_cond, "phi_cond": phi_cond,
        "var_reduction": var_reduction,
        "n_conditioning": int(n_station), "n_colocated_merged": int(n_merged),
        "station_lon": lon_station, "station_lat": lat_station,
        "station_phi": phi_station, "station_tau": tau_station,
        "station_sigma_obs": sigma_obs_station, "station_residual": r,
    }


def _engler_partition(
    *, tau_grid: np.ndarray, phi_grid: np.ndarray, var_reduction: np.ndarray,
    tau_reduction_raw: np.ndarray, phi_reduction_raw: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray]:
    """Partition the (exact) total aleatory variance reduction into
    `tau_cond`/`phi_cond` (the "Engler partition"). Each latent component
    (shared between-event term `B`, spatially correlated within-event
    field `W`) has its OWN exact marginal variance reduction under standard
    Gaussian conditioning; their sum does not exactly equal the total
    reduction (conditioning induces a posterior covariance between `B` and
    `W` this "own-component" view doesn't track), so both are rescaled by
    the single factor that makes them sum EXACTLY to the total reduction —
    preserving their relative split while guaranteeing
    `tau_cond^2 + phi_cond^2 + sigma_model^2 == sigma_total^2` holds exactly."""
    tau_grid = np.asarray(tau_grid, dtype=float)
    phi_grid = np.asarray(phi_grid, dtype=float)
    var_reduction = np.asarray(var_reduction, dtype=float)

    sigma2_prior = tau_grid**2 + phi_grid**2
    sigma2_cond_target = np.clip(sigma2_prior - var_reduction, 0.0, None)

    denom = tau_reduction_raw + phi_reduction_raw
    scale = np.ones_like(denom)
    nonzero = denom > 1e-300
    scale[nonzero] = var_reduction[nonzero] / denom[nonzero]

    tau_cond2 = np.clip(tau_grid**2 - tau_reduction_raw * scale, 0.0, None)
    phi_cond2 = np.clip(phi_grid**2 - phi_reduction_raw * scale, 0.0, None)

    resid = sigma2_cond_target - (tau_cond2 + phi_cond2)
    phi_cond2 = np.clip(phi_cond2 + resid, 0.0, None)
    resid2 = sigma2_cond_target - (tau_cond2 + phi_cond2)
    tau_cond2 = np.clip(tau_cond2 + resid2, 0.0, None)

    return np.sqrt(tau_cond2), np.sqrt(phi_cond2)


# ---------------------------------------------------------------------------
# Public, wave-A/B-shaped interface
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StationObservation:
    """One point conditioning observation, ln-space (or linear-MMI/EMS for
    a future intensity-target run — not exercised in this wave)."""

    lon: float
    lat: float
    value_ln: float
    sigma_obs: float = 1e-6  # near-zero default: "trust this instrument almost exactly"


@dataclass(frozen=True)
class ConditionedField:
    """MVN-conditioned field: posterior mean + the Option-C aleatory split
    (tau_cond/phi_cond), with `sigma_model` carried forward UNCHANGED
    (epistemic, excluded from the conditioning covariance by construction —
    toolkit reviewer instruction, module docstring)."""

    mu_cond_ln: np.ndarray
    tau_cond: np.ndarray
    phi_cond: np.ndarray
    sigma_model: np.ndarray
    var_reduction: np.ndarray
    n_conditioning: int
    n_colocated_merged: int
    bias: float
    bias_variance: float
    correlation_model: str
    correlation_params: dict = field(default_factory=dict)

    @property
    def sigma_cond(self) -> np.ndarray:
        """Total conditioned sigma — Option-C identity,
        `tau_cond^2 + phi_cond^2 + sigma_model^2`."""
        return np.sqrt(self.tau_cond**2 + self.phi_cond**2 + self.sigma_model**2)


def condition_field(
    *,
    lon_grid: np.ndarray, lat_grid: np.ndarray,
    mu_prior_grid_ln: np.ndarray, tau_grid: np.ndarray, phi_grid: np.ndarray,
    sigma_model_grid: np.ndarray,
    mu_prior_station_ln: Sequence[float],
    observations: Sequence[StationObservation],
    phi_station: Optional[Sequence[float]] = None,
    tau_station: Optional[Sequence[float]] = None,
    correlation_model: str = DEFAULT_CORRELATION_MODEL,
    correlation_params: Optional[Dict[str, Any]] = None,
    grid_block_size: int = 20000,
) -> ConditionedField:
    """Condition a prior ln-space field (flat grid arrays) on point
    observations, given the prior ALREADY EVALUATED at each observation's
    coordinates (`mu_prior_station_ln`, one value per `observations` entry —
    the caller supplies this because evaluating the exact prior generally
    needs the same GMPE call the grid itself came from; see
    `condition_forward_map` for the end-to-end version that does this via
    `gmm.compute_mixture`).

    `phi_station`/`tau_station`: the prior's own aleatory sigma AT the
    station coordinates. If omitted, the NEAREST grid point's phi/tau is
    used as a proxy (the prior's sigma varies smoothly with distance from
    the source, so this is a reasonable local stand-in) — pass them
    explicitly (as `condition_forward_map` does, evaluated exactly via the
    same GMPE call as the mean) for an exact conditioning run.
    """
    lon_grid = np.asarray(lon_grid, dtype=float).ravel()
    lat_grid = np.asarray(lat_grid, dtype=float).ravel()
    mu_prior_grid_ln = np.asarray(mu_prior_grid_ln, dtype=float).ravel()
    tau_grid = np.asarray(tau_grid, dtype=float).ravel()
    phi_grid = np.asarray(phi_grid, dtype=float).ravel()
    sigma_model_grid = np.asarray(sigma_model_grid, dtype=float).ravel()

    n_station = len(observations)
    lon_station = np.array([o.lon for o in observations], dtype=float)
    lat_station = np.array([o.lat for o in observations], dtype=float)
    value_ln_station = np.array([o.value_ln for o in observations], dtype=float)
    sigma_obs_station = np.array([o.sigma_obs for o in observations], dtype=float)
    mu_prior_station_ln_arr = np.asarray(mu_prior_station_ln, dtype=float)
    if mu_prior_station_ln_arr.size != n_station:
        raise ValueError(
            f"condition_field: mu_prior_station_ln has {mu_prior_station_ln_arr.size} "
            f"values, expected {n_station} (one per observation)"
        )

    if n_station == 0:
        phi_station_arr = np.zeros(0)
        tau_station_arr = np.zeros(0)
    elif phi_station is not None and tau_station is not None:
        phi_station_arr = np.asarray(phi_station, dtype=float)
        tau_station_arr = np.asarray(tau_station, dtype=float)
    else:
        # Nearest-grid-point phi/tau proxy (module docstring).
        nearest = np.argmin(
            _pairwise_distance_km(lon_station, lat_station, lon_grid, lat_grid), axis=1
        )
        phi_station_arr = phi_grid[nearest]
        tau_station_arr = tau_grid[nearest]

    result = _condition_field(
        mu_prior_grid_ln=mu_prior_grid_ln, phi_grid=phi_grid, tau_grid=tau_grid,
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_station_ln=mu_prior_station_ln_arr,
        phi_station=phi_station_arr, tau_station=tau_station_arr,
        lon_station=lon_station, lat_station=lat_station,
        value_ln_station=value_ln_station, sigma_obs_station=sigma_obs_station,
        correlation_model=correlation_model, correlation_params=correlation_params,
        grid_block_size=grid_block_size,
    )

    if result["n_conditioning"] > 0:
        bias, bias_var, _tau0_sq = _estimate_bias(
            result["station_residual"], result["station_phi"],
            result["station_sigma_obs"], result["station_tau"],
        )
    else:
        bias, bias_var = 0.0, 0.0

    return ConditionedField(
        mu_cond_ln=result["mu_cond"], tau_cond=result["tau_cond"], phi_cond=result["phi_cond"],
        sigma_model=sigma_model_grid,
        var_reduction=result["var_reduction"],
        n_conditioning=result["n_conditioning"], n_colocated_merged=result["n_colocated_merged"],
        bias=bias, bias_variance=bias_var,
        correlation_model=correlation_model, correlation_params=dict(correlation_params or {}),
    )


def condition_forward_map(
    *,
    event_lat: float, event_lon: float, event_depth_km: float, mag_mw: float,
    imt: str,
    lon_grid: np.ndarray, lat_grid: np.ndarray,
    mu_prior_grid_ln: np.ndarray, tau_grid: np.ndarray, phi_grid: np.ndarray,
    sigma_model_grid: np.ndarray,
    observations: Sequence[StationObservation],
    vs30_sampler: Optional[vs30.Vs30Sampler] = None,
    correlation_model: str = DEFAULT_CORRELATION_MODEL,
    correlation_params: Optional[Dict[str, Any]] = None,
    grid_block_size: int = 20000,
) -> ConditionedField:
    """End-to-end conditioning: evaluates the SAME D20 GMPE mixture
    (`gmm.compute_mixture`) EXACTLY at each observation's coordinates (not
    interpolated from the grid), then calls `condition_field`. This mirrors
    the toolkit's own `run_mvn` design (one combined-site GMPE evaluation
    covers both the grid and the conditioning points) without needing the
    toolkit's `site`/`rupture`/`event` objects — `gmm.compute_mixture`
    already accepts an arbitrary (non-mesh) `vs30.SiteGrid`.

    `lon_grid`/`lat_grid`/`mu_prior_grid_ln`/`tau_grid`/`phi_grid`/
    `sigma_model_grid` are the flat (already-computed) forward-map arrays
    for `imt` (e.g. from a `forward.ForwardMap`'s `.pga`/`.pgv` channel,
    `.mean`/`.tau_ln`/`.phi_ln`/`.sigma_model_ln`, raveled) — this function
    does not recompute the grid, only the station-point evaluation.
    """
    if len(observations) == 0:
        return condition_field(
            lon_grid=lon_grid, lat_grid=lat_grid,
            mu_prior_grid_ln=mu_prior_grid_ln, tau_grid=tau_grid, phi_grid=phi_grid,
            sigma_model_grid=sigma_model_grid,
            mu_prior_station_ln=[], observations=[],
            correlation_model=correlation_model, correlation_params=correlation_params,
            grid_block_size=grid_block_size,
        )

    station_lons = np.array([o.lon for o in observations], dtype=float)
    station_lats = np.array([o.lat for o in observations], dtype=float)
    sampler = vs30_sampler or vs30.UniformRockVs30()
    station_vs30 = sampler.sample(station_lats, station_lons)
    station_grid = vs30.SiteGrid(lats=station_lats, lons=station_lons, vs30=station_vs30)

    station_gm = gmm.compute_mixture(
        event_lat, event_lon, event_depth_km, mag_mw=mag_mw, site_grid=station_grid,
    )
    i = station_gm.imt_index(imt)
    mu_prior_station_ln = station_gm.mean_ln[i]
    phi_station = station_gm.phi[i]
    tau_station = station_gm.tau[i]

    return condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior_grid_ln, tau_grid=tau_grid, phi_grid=phi_grid,
        sigma_model_grid=sigma_model_grid,
        mu_prior_station_ln=mu_prior_station_ln, observations=observations,
        phi_station=phi_station, tau_station=tau_station,
        correlation_model=correlation_model, correlation_params=correlation_params,
        grid_block_size=grid_block_size,
    )
