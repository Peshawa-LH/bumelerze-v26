"""conditioned_forward.condition_forward_map_on_dyfi: zero-observation
identity, synthetic-observation pull direction/magnitude (both IMTs +
recomputed EMS/MMI), and a full synthetic-DyfiBox -> conditioned ForwardMap
pipeline test (no network access — mirrors `tests/test_mvn.py`'s own
integration-test style, one level up the stack)."""

from __future__ import annotations

import numpy as np
import pytest

from shake_service import conditioned_forward, dyfi_observations as dyfi, forward, mvn, vs30


EVENT_LAT, EVENT_LON, EVENT_DEPTH_KM, MAG_MW = 34.9, 45.9, 15.0, 5.5


def _small_forward_map() -> forward.ForwardMap:
    # moderate band (Mw 5.5) keeps the grid small/fast for a unit test.
    # Pinned to UniformRockVs30 explicitly: this module tests the
    # CONDITIONING mechanism (pull direction/magnitude, small-N floor),
    # not vs30 integration -- every `condition_forward_map_on_dyfi` call
    # below also omits `vs30_sampler`, which resolves (inside `mvn.py`) to
    # its OWN independent `UniformRockVs30()` default. Since
    # `forward.build_forward_map`'s own default is now the real Vs30
    # raster (`vs30.default_sampler()`, machine-dependent), leaving this
    # fixture on its own default would silently mismatch the prior's Vs30
    # against the conditioning step's station-point Vs30 -- pinning both
    # to the same explicit rock-760 sampler keeps this file deterministic
    # and isolates the mechanism under test (a real end-to-end
    # same-sampler consistency check lives in `worker/pipeline.py`'s own
    # wiring + `tests/test_worker_pipeline.py`, not here).
    return forward.build_forward_map(
        EVENT_LAT, EVENT_LON, EVENT_DEPTH_KM, mag_mw=MAG_MW, vs30_sampler=vs30.UniformRockVs30(),
    )


# ---------------------------------------------------------------------------
# Zero observations = identity (mirrors mvn.py's own "no silent fabricated
# update" contract, one level up: the whole ForwardMap should come back
# unchanged).
# ---------------------------------------------------------------------------


def test_zero_observations_reproduces_bare_forward_map_exactly():
    fm = _small_forward_map()
    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=EVENT_LAT, event_lon=EVENT_LON, event_depth_km=EVENT_DEPTH_KM, mag_mw=MAG_MW,
        observations_pga=[], observations_pgv=[],
    )
    cond_fm = result.forward_map

    assert np.array_equal(cond_fm.pga.mean, fm.pga.mean)
    assert np.array_equal(cond_fm.pga.sigma_ln, fm.pga.sigma_ln)
    assert np.array_equal(cond_fm.pgv.mean, fm.pgv.mean)
    assert np.array_equal(cond_fm.pgv.sigma_ln, fm.pgv.sigma_ln)
    # EMS/MMI recomputed from the (unchanged) conditioned PGA/PGV should
    # match the bare map's own EMS/MMI to floating precision (same chain
    # rule, same inputs, just routed through the GMResult stand-in).
    assert cond_fm.ems.mean == pytest.approx(fm.ems.mean, rel=1e-10)
    assert cond_fm.mmi.mean == pytest.approx(fm.mmi.mean, rel=1e-10)

    assert result.pga.n_conditioning == 0
    assert result.pgv.n_conditioning == 0
    # lon/lat/event/band/grid_meta all carried over unchanged.
    assert np.array_equal(cond_fm.lon2d, fm.lon2d)
    assert np.array_equal(cond_fm.lat2d, fm.lat2d)
    assert cond_fm.event == fm.event
    assert cond_fm.band == fm.band


# ---------------------------------------------------------------------------
# Synthetic observation at a known offset: pull direction + magnitude.
# ---------------------------------------------------------------------------


def test_synthetic_high_observation_pulls_pga_and_pgv_up_near_the_station():
    fm = _small_forward_map()
    shape = fm.grid_meta["shape"]

    # Pick the grid point nearest the epicentre as the "station" location
    # (guarantees it's inside the grid) and a far corner as the control.
    dist_from_event = np.hypot(fm.lon2d - EVENT_LON, fm.lat2d - EVENT_LAT)
    near_idx = np.unravel_index(np.argmin(dist_from_event), shape)
    far_idx = np.unravel_index(np.argmax(dist_from_event), shape)
    station_lon = float(fm.lon2d[near_idx])
    station_lat = float(fm.lat2d[near_idx])

    prior_pga_ln = float(np.log(fm.pga.mean[near_idx]))
    prior_pgv_ln = float(np.log(fm.pgv.mean[near_idx]))
    # A synthetic observation reporting noticeably MORE shaking than the
    # prior predicts, with a tight sigma_obs (high-confidence "instrument").
    obs_pga = [mvn.StationObservation(lon=station_lon, lat=station_lat, value_ln=prior_pga_ln + 1.0, sigma_obs=0.05)]
    obs_pgv = [mvn.StationObservation(lon=station_lon, lat=station_lat, value_ln=prior_pgv_ln + 1.0, sigma_obs=0.05)]

    # min_conditioning_observations=0: this test exercises the raw
    # conditioning MECHANISM (pull direction/magnitude) with a single
    # synthetic observation, deliberately below the production small-N
    # floor (config.MIN_CONDITIONING_OBSERVATIONS, default 10) -- the floor
    # itself is covered by the dedicated tests below.
    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=EVENT_LAT, event_lon=EVENT_LON, event_depth_km=EVENT_DEPTH_KM, mag_mw=MAG_MW,
        observations_pga=obs_pga, observations_pgv=obs_pgv,
        min_conditioning_observations=0,
    )
    cond_fm = result.forward_map

    # Pull direction + magnitude: conditioned mean near the station is
    # HIGHER than the prior and CLOSE to the observed value (tight sigma_obs).
    assert cond_fm.pga.mean[near_idx] > fm.pga.mean[near_idx]
    assert cond_fm.pgv.mean[near_idx] > fm.pgv.mean[near_idx]
    assert float(np.log(cond_fm.pga.mean[near_idx])) == pytest.approx(prior_pga_ln + 1.0, abs=0.05)
    assert float(np.log(cond_fm.pgv.mean[near_idx])) == pytest.approx(prior_pgv_ln + 1.0, abs=0.05)

    # Sigma reduced locally (more confident near a tight observation).
    assert cond_fm.pga.sigma_ln[near_idx] < fm.pga.sigma_ln[near_idx]
    assert cond_fm.pgv.sigma_ln[near_idx] < fm.pgv.sigma_ln[near_idx]

    # Far field barely moves relative to the local pull (mvn.py's own
    # tested far-field-recovery behaviour, one level up the stack) -- not
    # exactly equal (tau>0 informs the whole grid a little) but far smaller
    # than the near-field pull.
    near_pull = abs(float(np.log(cond_fm.pga.mean[near_idx])) - prior_pga_ln)
    far_pull = abs(float(np.log(cond_fm.pga.mean[far_idx])) - float(np.log(fm.pga.mean[far_idx])))
    assert far_pull < 0.25 * near_pull

    # sigma_model (epistemic) untouched by conditioning, same Option-C
    # contract mvn.py itself guarantees.
    assert np.array_equal(cond_fm.pga.sigma_model_ln, fm.pga.sigma_model_ln)
    assert np.array_equal(cond_fm.pgv.sigma_model_ln, fm.pgv.sigma_model_ln)

    # EMS/MMI recomputed from the conditioned PGA/PGV must also increase
    # near the station (GMICE PGA/PGV -> intensity is monotonically
    # increasing) -- proves the intensity recompute step is actually wired
    # to the conditioned ground motion, not silently left as the bare prior's.
    assert cond_fm.ems.mean[near_idx] > fm.ems.mean[near_idx]
    assert cond_fm.mmi.mean[near_idx] > fm.mmi.mean[near_idx]

    assert result.pga.n_conditioning == 1
    assert result.pgv.n_conditioning == 1


def test_synthetic_low_observation_pulls_field_down_near_the_station():
    # The mirror-image direction check (task: "verify pull direction AND
    # magnitude" -- a below-prior observation must pull down, not up).
    fm = _small_forward_map()
    shape = fm.grid_meta["shape"]
    dist_from_event = np.hypot(fm.lon2d - EVENT_LON, fm.lat2d - EVENT_LAT)
    near_idx = np.unravel_index(np.argmin(dist_from_event), shape)
    station_lon = float(fm.lon2d[near_idx])
    station_lat = float(fm.lat2d[near_idx])

    prior_pga_ln = float(np.log(fm.pga.mean[near_idx]))
    prior_pgv_ln = float(np.log(fm.pgv.mean[near_idx]))
    obs_pga = [mvn.StationObservation(lon=station_lon, lat=station_lat, value_ln=prior_pga_ln - 1.0, sigma_obs=0.05)]
    # EMS is PGA-driven only (D20 checkpoint condition 2) -- conditioning
    # PGV too still matters for the MMI channel's own PGV-driven path.
    obs_pgv = [mvn.StationObservation(lon=station_lon, lat=station_lat, value_ln=prior_pgv_ln - 1.0, sigma_obs=0.05)]

    # min_conditioning_observations=0: see the identical note in the
    # "pulls up" test above -- this test also exercises the raw mechanism
    # below the production floor.
    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=EVENT_LAT, event_lon=EVENT_LON, event_depth_km=EVENT_DEPTH_KM, mag_mw=MAG_MW,
        observations_pga=obs_pga, observations_pgv=obs_pgv,
        min_conditioning_observations=0,
    )
    cond_fm = result.forward_map
    assert cond_fm.pga.mean[near_idx] < fm.pga.mean[near_idx]
    assert cond_fm.pgv.mean[near_idx] < fm.pgv.mean[near_idx]
    assert cond_fm.ems.mean[near_idx] < fm.ems.mean[near_idx]


# ---------------------------------------------------------------------------
# Full synthetic pipeline: DyfiBox -> station observations -> conditioned map
# (no network access; proves the two modules compose correctly end to end).
# ---------------------------------------------------------------------------


def test_synthetic_dyfi_box_pipeline_produces_finite_conditioned_map():
    fm = _small_forward_map()
    shape = fm.grid_meta["shape"]
    dist_from_event = np.hypot(fm.lon2d - EVENT_LON, fm.lat2d - EVENT_LAT)
    near_idx = np.unravel_index(np.argmin(dist_from_event), shape)
    station_lon = float(fm.lon2d[near_idx])
    station_lat = float(fm.lat2d[near_idx])

    boxes = [
        dyfi.DyfiBox(lon=station_lon, lat=station_lat, cdi=8.0, nresp=20, dist_km=5.0, stddev_usgs=0.15, name="synthetic"),
        dyfi.DyfiBox(lon=station_lon + 0.3, lat=station_lat + 0.2, cdi=6.0, nresp=10, dist_km=40.0, stddev_usgs=0.2, name="synthetic2"),
    ]
    obs_pga = dyfi.dyfi_boxes_to_station_observations(boxes, imt="PGA")
    obs_pgv = dyfi.dyfi_boxes_to_station_observations(boxes, imt="PGV")
    assert len(obs_pga) == 2 and len(obs_pgv) == 2

    # 2 observations, well below the default small-N conditioning floor
    # (config.MIN_CONDITIONING_OBSERVATIONS, default 10) -- this pipeline
    # test therefore exercises the FLOORED path (bare prior published) by
    # default, on top of proving the two modules compose end to end; the
    # dedicated floor tests below cover both sides of the threshold
    # explicitly.
    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=EVENT_LAT, event_lon=EVENT_LON, event_depth_km=EVENT_DEPTH_KM, mag_mw=MAG_MW,
        observations_pga=obs_pga, observations_pgv=obs_pgv,
    )
    cond_fm = result.forward_map

    for channel in (cond_fm.pga, cond_fm.pgv):
        assert np.all(np.isfinite(channel.mean))
        assert np.all(np.isfinite(channel.sigma_ln))
        assert np.all(channel.mean > 0.0)
        assert np.all(channel.sigma_ln > 0.0)
    for channel in (cond_fm.ems, cond_fm.mmi):
        assert np.all(np.isfinite(channel.mean))
        assert np.all(np.isfinite(channel.sigma))

    assert cond_fm.data_used["source"] == "catalog+dyfi"
    assert cond_fm.data_used["n_observations"] == {"PGA": 2, "PGV": 2}
    assert cond_fm.data_used["conditioning_applied"] == {"PGA": False, "PGV": False}
    assert "conditioning" in cond_fm.version


# ---------------------------------------------------------------------------
# Small-N conditioning floor (D20 checkpoint condition 3, PROPOSED default
# config.MIN_CONDITIONING_OBSERVATIONS=10) -- below the floor, the bare
# prior is published (per IMT) with a metadata note; at/above it,
# conditioning proceeds as normal.
# ---------------------------------------------------------------------------


def _n_synthetic_observations(n: int, *, lon: float, lat: float, value_ln: float) -> list[mvn.StationObservation]:
    """`n` distinct-location synthetic observations, all agreeing on the
    same `value_ln` -- distinct lon/lat avoids `mvn.py`'s own colocated-
    observation merge from collapsing the count before it reaches this
    module's floor check."""
    return [
        mvn.StationObservation(lon=lon + 0.01 * i, lat=lat, value_ln=value_ln, sigma_obs=0.1)
        for i in range(n)
    ]


def test_below_floor_publishes_bare_prior_with_metadata_note():
    fm = _small_forward_map()
    shape = fm.grid_meta["shape"]
    dist_from_event = np.hypot(fm.lon2d - EVENT_LON, fm.lat2d - EVENT_LAT)
    near_idx = np.unravel_index(np.argmin(dist_from_event), shape)
    station_lon = float(fm.lon2d[near_idx])
    station_lat = float(fm.lat2d[near_idx])

    prior_pga_ln = float(np.log(fm.pga.mean[near_idx]))
    prior_pgv_ln = float(np.log(fm.pgv.mean[near_idx]))
    # 4 observations -- one short of the confirmed floor (5; Peshawa's
    # 2026-08-08 soft-transition ruling replaced the earlier proposed 10).
    obs_pga = _n_synthetic_observations(4, lon=station_lon, lat=station_lat, value_ln=prior_pga_ln + 1.0)
    obs_pgv = _n_synthetic_observations(4, lon=station_lon, lat=station_lat, value_ln=prior_pgv_ln + 1.0)

    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=EVENT_LAT, event_lon=EVENT_LON, event_depth_km=EVENT_DEPTH_KM, mag_mw=MAG_MW,
        observations_pga=obs_pga, observations_pgv=obs_pgv,
    )
    cond_fm = result.forward_map

    # Bare prior published: the map is numerically IDENTICAL to the
    # unconditioned forward map, even though 4 real observations were fed
    # in and diagnostics for them exist.
    assert np.array_equal(cond_fm.pga.mean, fm.pga.mean)
    assert np.array_equal(cond_fm.pgv.mean, fm.pgv.mean)
    assert cond_fm.ems.mean == pytest.approx(fm.ems.mean, rel=1e-10)

    # Diagnostics still available for audit (mvn.condition_forward_map was
    # still called) -- 4 observations really were conditioned internally,
    # just not used to build the published channel.
    assert result.pga.n_conditioning == 4
    assert result.pgv.n_conditioning == 4

    # Metadata note: observations existed but were below the floor -- never
    # silently indistinguishable from "no observations at all".
    assert cond_fm.data_used["n_observations"] == {"PGA": 4, "PGV": 4}
    assert cond_fm.data_used["conditioning_applied"] == {"PGA": False, "PGV": False}
    assert cond_fm.data_used["conditioning_floor"] == 5
    notes = cond_fm.data_used["conditioning_floor_notes"]
    assert any("PGA" in n and "4" in n and "below" in n for n in notes)
    assert any("PGV" in n and "4" in n and "below" in n for n in notes)


def test_small_n_band_conditions_with_inflated_sigma():
    """Peshawa's 2026-08-08 ruling: in the band [5, 10) conditioning ENGAGES
    (map differs from the bare prior) but with observation sigma inflated
    x2, so the pull is gentler than the same observations at full weight."""
    fm = _small_forward_map()
    shape = fm.grid_meta["shape"]
    dist_from_event = np.hypot(fm.lon2d - EVENT_LON, fm.lat2d - EVENT_LAT)
    near_idx = np.unravel_index(np.argmin(dist_from_event), shape)
    station_lon = float(fm.lon2d[near_idx])
    station_lat = float(fm.lat2d[near_idx])
    prior_pga_ln = float(np.log(fm.pga.mean[near_idx]))
    prior_pgv_ln = float(np.log(fm.pgv.mean[near_idx]))
    obs_pga = _n_synthetic_observations(9, lon=station_lon, lat=station_lat, value_ln=prior_pga_ln + 1.0)
    obs_pgv = _n_synthetic_observations(9, lon=station_lon, lat=station_lat, value_ln=prior_pgv_ln + 1.0)

    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=EVENT_LAT, event_lon=EVENT_LON, event_depth_km=EVENT_DEPTH_KM, mag_mw=MAG_MW,
        observations_pga=obs_pga, observations_pgv=obs_pgv,
    )
    cond_fm = result.forward_map

    # Conditioning engaged: published map is NOT the bare prior...
    assert not np.array_equal(cond_fm.pga.mean, fm.pga.mean)
    assert cond_fm.data_used["conditioning_applied"] == {"PGA": True, "PGV": True}
    # ...and the inflation is disclosed in metadata.
    inflation = cond_fm.data_used["small_n_sigma_inflation"]
    assert inflation["PGA"] is True and inflation["PGV"] is True
    assert inflation["factor"] == pytest.approx(2.0)
    notes = cond_fm.data_used["conditioning_floor_notes"]
    assert any("sigma inflated" in n and "PGA" in n for n in notes)

    # Gentler than full-weight conditioning: the pull toward the (+1.0 ln)
    # observations at the station cell is strictly smaller than the same
    # 9 observations conditioned WITHOUT inflation (threshold disabled).
    full = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=EVENT_LAT, event_lon=EVENT_LON, event_depth_km=EVENT_DEPTH_KM, mag_mw=MAG_MW,
        observations_pga=obs_pga, observations_pgv=obs_pgv,
        small_n_sigma_inflation_threshold=0,
    )
    pull_soft = float(np.log(cond_fm.pga.mean[near_idx])) - prior_pga_ln
    pull_full = float(np.log(full.forward_map.pga.mean[near_idx])) - prior_pga_ln
    assert 0.0 < pull_soft < pull_full


def test_at_floor_conditions_normally():
    fm = _small_forward_map()
    shape = fm.grid_meta["shape"]
    dist_from_event = np.hypot(fm.lon2d - EVENT_LON, fm.lat2d - EVENT_LAT)
    near_idx = np.unravel_index(np.argmin(dist_from_event), shape)
    station_lon = float(fm.lon2d[near_idx])
    station_lat = float(fm.lat2d[near_idx])

    prior_pga_ln = float(np.log(fm.pga.mean[near_idx]))
    prior_pgv_ln = float(np.log(fm.pgv.mean[near_idx]))
    # 10 observations -- exactly at the default floor.
    obs_pga = _n_synthetic_observations(10, lon=station_lon, lat=station_lat, value_ln=prior_pga_ln + 1.0)
    obs_pgv = _n_synthetic_observations(10, lon=station_lon, lat=station_lat, value_ln=prior_pgv_ln + 1.0)

    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=EVENT_LAT, event_lon=EVENT_LON, event_depth_km=EVENT_DEPTH_KM, mag_mw=MAG_MW,
        observations_pga=obs_pga, observations_pgv=obs_pgv,
    )
    cond_fm = result.forward_map

    # Conditioning actually applied: the map differs from the bare prior,
    # pulled toward the (higher) observed values near the station cluster.
    assert not np.array_equal(cond_fm.pga.mean, fm.pga.mean)
    assert cond_fm.pga.mean[near_idx] > fm.pga.mean[near_idx]
    assert cond_fm.pgv.mean[near_idx] > fm.pgv.mean[near_idx]

    assert result.pga.n_conditioning == 10
    assert result.pgv.n_conditioning == 10
    assert cond_fm.data_used["conditioning_applied"] == {"PGA": True, "PGV": True}
    assert cond_fm.data_used["conditioning_floor_notes"] == []


def test_custom_floor_can_be_disabled():
    fm = _small_forward_map()
    shape = fm.grid_meta["shape"]
    dist_from_event = np.hypot(fm.lon2d - EVENT_LON, fm.lat2d - EVENT_LAT)
    near_idx = np.unravel_index(np.argmin(dist_from_event), shape)
    station_lon = float(fm.lon2d[near_idx])
    station_lat = float(fm.lat2d[near_idx])

    prior_pga_ln = float(np.log(fm.pga.mean[near_idx]))
    obs_pga = [mvn.StationObservation(lon=station_lon, lat=station_lat, value_ln=prior_pga_ln + 1.0, sigma_obs=0.05)]

    result = conditioned_forward.condition_forward_map_on_dyfi(
        fm, event_lat=EVENT_LAT, event_lon=EVENT_LON, event_depth_km=EVENT_DEPTH_KM, mag_mw=MAG_MW,
        observations_pga=obs_pga, observations_pgv=[],
        min_conditioning_observations=0,
    )
    cond_fm = result.forward_map
    assert cond_fm.pga.mean[near_idx] > fm.pga.mean[near_idx]
    assert cond_fm.data_used["conditioning_applied"]["PGA"] is True
