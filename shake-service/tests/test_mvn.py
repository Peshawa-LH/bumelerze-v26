"""MVN conditioning: zero-observation identity, single-observation pull +
sigma reduction (near-field), far-field prior recovery, correlation model
sanity, co-located aggregation, and Option-C identity preservation. Plus an
integration test through `condition_forward_map` against a real
`gmm.compute_mixture` grid."""

from __future__ import annotations

import numpy as np
import pytest

from shake_service import mvn, vs30


def _line_grid(n=101, lon_min=40.0, lon_max=50.0, lat=35.0):
    return np.linspace(lon_min, lon_max, n), np.full(n, lat)


# ---------------------------------------------------------------------------
# Zero observations = identity (module docstring: "no silent fabricated
# update when there is nothing to condition on")
# ---------------------------------------------------------------------------


def test_zero_observations_is_identity():
    lon_grid, lat_grid = _line_grid()
    mu_prior = np.linspace(-1.0, 1.0, lon_grid.size)
    tau = np.full(lon_grid.size, 0.3)
    phi = np.full(lon_grid.size, 0.5)
    sigma_model = np.full(lon_grid.size, 0.1)

    res = mvn.condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior, tau_grid=tau, phi_grid=phi, sigma_model_grid=sigma_model,
        mu_prior_station_ln=[], observations=[],
    )
    assert np.array_equal(res.mu_cond_ln, mu_prior)
    assert np.array_equal(res.tau_cond, tau)
    assert np.array_equal(res.phi_cond, phi)
    assert np.array_equal(res.sigma_model, sigma_model)
    assert res.n_conditioning == 0
    assert res.n_colocated_merged == 0
    assert res.bias == 0.0
    assert res.bias_variance == 0.0


# ---------------------------------------------------------------------------
# One observation: near-field pull + sigma reduction; far-field prior
# recovery (isolated with tau=0, the pure spatially-decaying phi case --
# with tau>0 the fully-correlated between-event block still informs the
# far field a little, which is the physically-correct Engler MVN behaviour,
# tested separately below with a tolerance).
# ---------------------------------------------------------------------------


def test_single_observation_pulls_local_field_and_reduces_local_sigma():
    lon_grid, lat_grid = _line_grid()
    mu_prior = np.zeros(lon_grid.size)
    tau = np.full(lon_grid.size, 0.3)
    phi = np.full(lon_grid.size, 0.5)
    sigma_model = np.full(lon_grid.size, 0.1)
    prior_sigma = float(np.sqrt(0.3**2 + 0.5**2 + 0.1**2))

    obs_lon = 45.0
    obs = [mvn.StationObservation(lon=obs_lon, lat=35.0, value_ln=1.0, sigma_obs=0.05)]
    res = mvn.condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior, tau_grid=tau, phi_grid=phi, sigma_model_grid=sigma_model,
        mu_prior_station_ln=[0.0], observations=obs,
    )

    idx_near = int(np.argmin(np.abs(lon_grid - obs_lon)))
    # Pulled toward the observed value (1.0), close to it given a tight
    # sigma_obs=0.05.
    assert res.mu_cond_ln[idx_near] == pytest.approx(1.0, abs=0.02)
    # Local sigma is substantially reduced from the prior.
    assert res.sigma_cond[idx_near] < 0.3 * prior_sigma
    assert res.n_conditioning == 1


def test_far_field_recovers_prior_exactly_when_tau_is_zero():
    # tau=0 isolates the spatially-decaying (phi) component -- Jayaram &
    # Baker (2009)'s correlation range b(T=0.01s, case 1) ~= 8.67 km, so a
    # point ~450 km away is, to floating-point precision, uncorrelated with
    # the single station: the conditioned field there must equal the prior
    # exactly (mean AND sigma).
    lon_grid, lat_grid = _line_grid()
    mu_prior = np.zeros(lon_grid.size)
    tau = np.zeros(lon_grid.size)
    phi = np.full(lon_grid.size, 0.5)
    sigma_model = np.full(lon_grid.size, 0.1)
    prior_sigma = float(np.sqrt(0.5**2 + 0.1**2))

    obs = [mvn.StationObservation(lon=45.0, lat=35.0, value_ln=1.0, sigma_obs=0.05)]
    res = mvn.condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior, tau_grid=tau, phi_grid=phi, sigma_model_grid=sigma_model,
        mu_prior_station_ln=[0.0], observations=obs,
    )
    idx_far = int(np.argmax(np.abs(lon_grid - 45.0)))
    assert res.mu_cond_ln[idx_far] == pytest.approx(0.0, abs=1e-6)
    assert res.sigma_cond[idx_far] == pytest.approx(prior_sigma, rel=1e-9)


def test_far_field_sigma_close_to_prior_with_nonzero_tau():
    # With tau>0 the fully-correlated between-event block still informs the
    # far field a little (physically correct: a single station always
    # slightly updates the shared event term everywhere) -- but the effect
    # is small; sigma at 450 km must stay within 10% of the unconditioned
    # prior.
    lon_grid, lat_grid = _line_grid()
    mu_prior = np.zeros(lon_grid.size)
    tau = np.full(lon_grid.size, 0.3)
    phi = np.full(lon_grid.size, 0.5)
    sigma_model = np.full(lon_grid.size, 0.1)
    prior_sigma = float(np.sqrt(0.3**2 + 0.5**2 + 0.1**2))

    obs = [mvn.StationObservation(lon=45.0, lat=35.0, value_ln=1.0, sigma_obs=0.05)]
    res = mvn.condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior, tau_grid=tau, phi_grid=phi, sigma_model_grid=sigma_model,
        mu_prior_station_ln=[0.0], observations=obs,
    )
    idx_far = int(np.argmax(np.abs(lon_grid - 45.0)))
    assert res.sigma_cond[idx_far] == pytest.approx(prior_sigma, rel=0.10)


# ---------------------------------------------------------------------------
# Option-C identity: sigma_model untouched, and
# tau_cond^2+phi_cond^2+sigma_model^2 == sigma_cond^2 by construction.
# ---------------------------------------------------------------------------


def test_sigma_model_unchanged_by_conditioning():
    lon_grid, lat_grid = _line_grid(n=21)
    mu_prior = np.zeros(lon_grid.size)
    tau = np.full(lon_grid.size, 0.3)
    phi = np.full(lon_grid.size, 0.5)
    sigma_model = np.full(lon_grid.size, 0.17)

    obs = [mvn.StationObservation(lon=45.0, lat=35.0, value_ln=0.5, sigma_obs=0.1)]
    res = mvn.condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior, tau_grid=tau, phi_grid=phi, sigma_model_grid=sigma_model,
        mu_prior_station_ln=[0.0], observations=obs,
    )
    assert np.array_equal(res.sigma_model, sigma_model)


def test_option_c_identity_after_conditioning():
    lon_grid, lat_grid = _line_grid(n=21)
    mu_prior = np.zeros(lon_grid.size)
    tau = np.full(lon_grid.size, 0.3)
    phi = np.full(lon_grid.size, 0.5)
    sigma_model = np.full(lon_grid.size, 0.1)

    obs = [
        mvn.StationObservation(lon=44.0, lat=35.0, value_ln=0.4, sigma_obs=0.05),
        mvn.StationObservation(lon=46.0, lat=35.1, value_ln=-0.2, sigma_obs=0.08),
    ]
    res = mvn.condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior, tau_grid=tau, phi_grid=phi, sigma_model_grid=sigma_model,
        mu_prior_station_ln=[0.0, 0.0], observations=obs,
    )
    lhs = res.sigma_cond**2
    rhs = res.tau_cond**2 + res.phi_cond**2 + res.sigma_model**2
    assert lhs == pytest.approx(rhs, rel=1e-9)
    assert res.n_conditioning == 2


# ---------------------------------------------------------------------------
# Correlation model (Jayaram & Baker 2009) sanity, independent computation.
# ---------------------------------------------------------------------------


def test_jayaram_baker_correlation_matches_hand_formula():
    d = np.array([0.0, 5.0, 20.0])
    b = 8.5 + 17.2 * 0.01  # case 1, period=0.01 default
    expected = np.exp(-3.0 * d / b)
    got = mvn.jayaram_baker_2009(d)
    assert got == pytest.approx(expected, rel=1e-10)


def test_correlation_is_one_at_zero_distance_and_decays():
    d = np.array([0.0, 1.0, 10.0, 100.0])
    rho = mvn.jayaram_baker_2009(d)
    assert rho[0] == pytest.approx(1.0)
    assert np.all(np.diff(rho) < 0)  # strictly decreasing
    assert rho[-1] < 1e-10


def test_corr_matrix_rejects_unknown_model():
    with pytest.raises(KeyError):
        mvn.corr_matrix("not_a_model", np.array([1.0]))


# ---------------------------------------------------------------------------
# Co-located observation aggregation
# ---------------------------------------------------------------------------


def test_colocated_observations_are_merged_not_singular():
    lon_grid, lat_grid = _line_grid(n=11)
    mu_prior = np.zeros(lon_grid.size)
    tau = np.full(lon_grid.size, 0.3)
    phi = np.full(lon_grid.size, 0.5)
    sigma_model = np.full(lon_grid.size, 0.1)

    # Two observations at the exact same coordinate, different values --
    # would make Sigma_ss singular without aggregation.
    obs = [
        mvn.StationObservation(lon=45.0, lat=35.0, value_ln=0.5, sigma_obs=0.05),
        mvn.StationObservation(lon=45.0, lat=35.0, value_ln=0.7, sigma_obs=0.05),
    ]
    res = mvn.condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior, tau_grid=tau, phi_grid=phi, sigma_model_grid=sigma_model,
        mu_prior_station_ln=[0.0, 0.0], observations=obs,
    )
    assert res.n_colocated_merged == 1
    assert np.all(np.isfinite(res.mu_cond_ln))
    assert np.all(np.isfinite(res.sigma_cond))


def test_distinct_nearby_but_not_colocated_observations_are_not_merged():
    lon_grid, lat_grid = _line_grid(n=11)
    mu_prior = np.zeros(lon_grid.size)
    tau = np.full(lon_grid.size, 0.3)
    phi = np.full(lon_grid.size, 0.5)
    sigma_model = np.full(lon_grid.size, 0.1)

    obs = [
        mvn.StationObservation(lon=45.0, lat=35.0, value_ln=0.5, sigma_obs=0.05),
        mvn.StationObservation(lon=45.01, lat=35.0, value_ln=0.7, sigma_obs=0.05),
    ]
    res = mvn.condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior, tau_grid=tau, phi_grid=phi, sigma_model_grid=sigma_model,
        mu_prior_station_ln=[0.0, 0.0], observations=obs,
    )
    assert res.n_colocated_merged == 0


# ---------------------------------------------------------------------------
# Bias (Worden 2018) — reported, not applied to mu_cond (module docstring).
# ---------------------------------------------------------------------------


def test_bias_is_reported_but_not_subtracted_from_conditioning():
    lon_grid, lat_grid = _line_grid(n=21)
    mu_prior = np.zeros(lon_grid.size)
    tau = np.full(lon_grid.size, 0.3)
    phi = np.full(lon_grid.size, 0.5)
    sigma_model = np.full(lon_grid.size, 0.1)

    obs = [mvn.StationObservation(lon=45.0, lat=35.0, value_ln=1.0, sigma_obs=0.05)]
    res = mvn.condition_field(
        lon_grid=lon_grid, lat_grid=lat_grid,
        mu_prior_grid_ln=mu_prior, tau_grid=tau, phi_grid=phi, sigma_model_grid=sigma_model,
        mu_prior_station_ln=[0.0], observations=obs,
    )
    # Independent hand computation of the Worden bias (module docstring
    # formula), NOT calling mvn._estimate_bias.
    tau0_sq = 0.3**2
    w = 1.0 / (0.5**2 + 0.05**2)
    denom = 1.0 + tau0_sq * w
    expected_bias = tau0_sq * (w * 1.0) / denom
    assert res.bias == pytest.approx(expected_bias, rel=1e-8)
    # mu_cond at the station itself is pulled toward the observed value
    # (near-exact given a tight sigma_obs), NOT toward (value - bias) --
    # i.e. the bias is diagnostic only.
    idx_near = int(np.argmin(np.abs(lon_grid - 45.0)))
    assert res.mu_cond_ln[idx_near] == pytest.approx(1.0, abs=0.02)


# ---------------------------------------------------------------------------
# Integration: condition_forward_map against a real gmm.compute_mixture grid
# ---------------------------------------------------------------------------


def test_condition_forward_map_integration_with_real_gmm():
    from shake_service import gmm

    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=50.0, spacing_km=10.0)
    gm = gmm.compute_mixture(34.9, 45.9, 15.0, mag_mw=6.0, site_grid=grid)
    i = gm.imt_index("PGA")

    # A synthetic "station" observation right at the epicentre reporting
    # higher-than-predicted PGA.
    obs = [mvn.StationObservation(lon=45.9, lat=34.9, value_ln=gm.mean_ln[i].max() + 0.5, sigma_obs=0.05)]

    res = mvn.condition_forward_map(
        event_lat=34.9, event_lon=45.9, event_depth_km=15.0, mag_mw=6.0, imt="PGA",
        lon_grid=grid.lons, lat_grid=grid.lats,
        mu_prior_grid_ln=gm.mean_ln[i], tau_grid=gm.tau[i], phi_grid=gm.phi[i],
        sigma_model_grid=gm.sigma_model[i],
        observations=obs,
    )
    assert res.n_conditioning == 1
    assert np.all(np.isfinite(res.mu_cond_ln))
    assert np.all(np.isfinite(res.sigma_cond))
    assert np.all(res.sigma_cond <= res.tau_cond + res.phi_cond + res.sigma_model + 1e-9)
    # sigma_model (epistemic) is untouched by conditioning.
    assert np.array_equal(res.sigma_model, gm.sigma_model[i])
    # nearest grid point to the observation should be pulled up.
    dists = mvn._pairwise_distance_km(np.array([45.9]), np.array([34.9]), grid.lons, grid.lats)[0]
    idx_near = int(np.argmin(dists))
    assert res.mu_cond_ln[idx_near] > gm.mean_ln[i][idx_near]


def test_condition_forward_map_zero_observations_matches_prior():
    from shake_service import gmm

    grid = vs30.build_grid_km_spacing(34.9, 45.9, half_extent_km=30.0, spacing_km=15.0)
    gm = gmm.compute_mixture(34.9, 45.9, 15.0, mag_mw=5.5, site_grid=grid)
    i = gm.imt_index("PGV")

    res = mvn.condition_forward_map(
        event_lat=34.9, event_lon=45.9, event_depth_km=15.0, mag_mw=5.5, imt="PGV",
        lon_grid=grid.lons, lat_grid=grid.lats,
        mu_prior_grid_ln=gm.mean_ln[i], tau_grid=gm.tau[i], phi_grid=gm.phi[i],
        sigma_model_grid=gm.sigma_model[i],
        observations=[],
    )
    assert np.array_equal(res.mu_cond_ln, gm.mean_ln[i])
    assert res.n_conditioning == 0
