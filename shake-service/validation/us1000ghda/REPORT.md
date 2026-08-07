# D20 validation — `us1000ghda` (Mw 6.0, 32 km SW of Jav?nr?d, Iran), moderate band

Generated 2026-08-07T07:50:08.122055+00:00. `docs/decisions.md` "D20 smoke-test checkpoint outcome" condition 3; generalized runner: `scripts/run_validation.py`.

Event: lat 34.6111, lon 46.2422, depth 10.0 km, time 1535235205620. Mechanism: us moment tensor (nodal plane 2): strike 264.8, dip 82.1, rake -31.5 (oblique); fetched from the event detail's moment-tensor product, not independently re-verified.
Grid: moderate band, half-extent 200 km (`config.grid_extent_km`, magnitude-scaled, auto-selected from Mw 6.0).

## Product availability

- ShakeMap (Atlas grid.xml + stationlist.json): available (product id `urn:usgs-product:atlas:shakemap:us1000ghda:1594396484647`)
- DYFI (`dyfi_geo_10km.geojson`): available (product id `urn:usgs-product:us:dyfi:us1000ghda:1697791172454`)

## Bare-prior vs. USGS Atlas (wave-C-style)

This compares our UNCONDITIONED point-source prior against USGS's Atlas grid, which is itself typically conditioned on station/DYFI observations and a finite-fault rupture, not a bare point source — perfect agreement is neither expected nor the pass criterion; the D20 numeric thresholds are. No weights were changed in response to these results.

| Criterion | Threshold | Result | Verdict |
|---|---|---|---|
| \|bias\| PGA (ln) | <= 0.3 | -0.338 | **FAIL** |
| \|bias\| PGV (ln) | <= 0.3 | -0.427 | **FAIL** |
| Coverage PGA (±1σ) | >= 60.0% | 97.8% | **PASS** |
| Coverage PGV (±1σ) | >= 60.0% | 79.1% | **PASS** |

**Overall bare-prior gate: bias FAIL, coverage PASS**

RMSE/MAE (ln): PGA 0.391/0.341, PGV 0.523/0.430. MMI bias -0.090, RMSE 0.234. Compared over 150731 of 150731 USGS grid cells.

### Distance-binned PGA/PGV ln-bias (bare)

| km bin | PGA ln bias | PGV ln bias | n |
|---|---|---|---|
| 0-15 | -0.093 | -0.193 | 999 |
| 15-35 | -0.328 | -0.360 | 4441 |
| 35-70 | -0.410 | -0.401 | 16343 |
| 70-130 | -0.376 | -0.394 | 53345 |
| 130-200 | -0.308 | -0.463 | 69879 |

## Instrumental station spot check(s)

Real (non-DYFI) instrumental stations found in `stationlist.json` — direct GMPE evaluation (rock-760 prior) at each site vs. its own reported PGA:

| network/code | name | dist (km) | observed PGA (g) | predicted PGA (g) | z (σ) |
|---|---|---|---|---|---|
| TU.GEVA | Gevas, Van | 500.3 | 0.0001 | 0.0004 | -0.97 |

## Conditioned comparison (wave-D-style)

Our own fetched `dyfi_geo_10km.geojson` totals 38 10km boxes worldwide before filtering; USGS's own Atlas grid declares `intensity_observations="9.0"` in its own `<event/>` tag (not expected to match exactly — different filtering pipelines, noted not reconciled). This wave conditions our prior on the SAME underlying DYFI product via our own `mvn.py` (unmodified, weights untouched) and re-judges the same D20 thresholds — conditioned vs. conditioned this time.

| Criterion | Threshold | Bare | Conditioned (primary) |
|---|---|---|---|
| \|bias\| PGA (ln) | <= 0.3 | -0.338 (FAIL) | 0.002 (PASS) |
| \|bias\| PGV (ln) | <= 0.3 | -0.427 (FAIL) | -0.208 (PASS) |
| Coverage PGA (±1σ) | >= 60.0% | 97.8% (PASS) | 100.0% (PASS) |
| Coverage PGV (±1σ) | >= 60.0% | 79.1% (PASS) | 88.0% (PASS) |

**Overall D20 gate (primary conditioned run): bias PASS, coverage PASS**

Primary run used 6 DYFI boxes (nresp>=3, within our grid's own magnitude-scaled domain) — PGA conditioned on 6 points (0 co-located merges), PGV on 6 points (0 co-located merges). RMSE/MAE (ln): PGA 0.198/0.162, PGV 0.367/0.282. Compared over 150731 of 150731 USGS grid cells.

### Distance-binned PGA/PGV ln-bias (conditioned, primary)

| km bin | PGA ln bias | PGV ln bias | n |
|---|---|---|---|
| 0-15 | 0.246 | 0.025 | 999 |
| 15-35 | 0.011 | -0.142 | 4441 |
| 35-70 | -0.071 | -0.183 | 16343 |
| 70-130 | -0.036 | -0.175 | 53345 |
| 130-200 | 0.032 | -0.244 | 69879 |

## Sensitivity grid (every variant computed this run, not cherry-picked)

| Variant | model | min nresp | domain | n obs | PGA bias | PGV bias | PGA cov | PGV cov | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| PRIMARY: Worden/MMI, nresp>=3, domain-restricted | WordenEtAl12 | 3 | <=grid extent | 6 | 0.002 | -0.208 | 100.0% | 88.0% | bias PASS, cov PASS |
| sensitivity: Zanini/EMS model (else primary settings) | Zaniniandhofer19 | 3 | <=grid extent | 6 | -0.409 | -0.395 | 91.5% | 79.8% | bias FAIL, cov PASS |
| sensitivity: nresp>=2 (else primary settings) | WordenEtAl12 | 2 | <=grid extent | 7 | -0.006 | -0.231 | 100.0% | 86.6% | bias PASS, cov PASS |
| sensitivity: unrestricted domain -- global DYFI (else primary settings) | WordenEtAl12 | 3 | unrestricted (global) | 7 | 0.052 | -0.183 | 100.0% | 90.0% | bias PASS, cov PASS |

## Circularity caveat

As with the Halabja wave-D re-judgment: if this event's Atlas grid was itself conditioned on (some of) these same DYFI observations, moving our conditioned map closer to it is partly true validation and partly true by construction — both maps pulled toward overlapping data. The underlying GMPE-set prior, correlation model, and conditioning math remain independently testable (especially wherever our own DYFI coverage does not reach), but this comparison is not an independent skill score.
