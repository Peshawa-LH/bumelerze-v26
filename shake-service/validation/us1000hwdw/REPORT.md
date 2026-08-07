# D20 validation — `us1000hwdw` (Mw 6.3, 15 km SW of Sarpol-e Z?ah?b, Iran), moderate band

Generated 2026-08-07T07:50:04.257775+00:00. `docs/decisions.md` "D20 smoke-test checkpoint outcome" condition 3; generalized runner: `scripts/run_validation.py`.

Event: lat 34.3609, lon 45.7443, depth 18.0 km, time 1543163852830. Mechanism: us moment tensor (nodal plane 2): strike 300.3, dip 89.9, rake -12.7 (predominantly strike-slip); fetched from the event detail's moment-tensor product, not independently re-verified.
Grid: moderate band, half-extent 200 km (`config.grid_extent_km`, magnitude-scaled, auto-selected from Mw 6.3).

## Product availability

- ShakeMap (Atlas grid.xml + stationlist.json): available (product id `urn:usgs-product:atlas:shakemap:us1000hwdw:1594396870428`)
- DYFI (`dyfi_geo_10km.geojson`): available (product id `urn:usgs-product:us:dyfi:us1000hwdw:1697791019937`)

## Bare-prior vs. USGS Atlas (wave-C-style)

This compares our UNCONDITIONED point-source prior against USGS's Atlas grid, which is itself typically conditioned on station/DYFI observations and a finite-fault rupture, not a bare point source — perfect agreement is neither expected nor the pass criterion; the D20 numeric thresholds are. No weights were changed in response to these results.

| Criterion | Threshold | Result | Verdict |
|---|---|---|---|
| \|bias\| PGA (ln) | <= 0.3 | -0.091 | **PASS** |
| \|bias\| PGV (ln) | <= 0.3 | -0.271 | **PASS** |
| Coverage PGA (±1σ) | >= 60.0% | 99.9% | **PASS** |
| Coverage PGV (±1σ) | >= 60.0% | 78.4% | **PASS** |

**Overall bare-prior gate: bias PASS, coverage PASS**

RMSE/MAE (ln): PGA 0.261/0.214, PGV 0.445/0.356. MMI bias 0.250, RMSE 0.367. Compared over 224982 of 397089 USGS grid cells.

### Distance-binned PGA/PGV ln-bias (bare)

| km bin | PGA ln bias | PGV ln bias | n |
|---|---|---|---|
| 0-15 | 0.523 | 0.476 | 997 |
| 15-35 | 0.106 | 0.074 | 4433 |
| 35-70 | -0.144 | -0.170 | 16287 |
| 70-130 | -0.216 | -0.299 | 53186 |
| 130-200 | -0.100 | -0.299 | 102378 |

## Instrumental station spot check

No real instrumental (non-DYFI) stations found in `stationlist.json` for this event — every entry is DYFI-derived macroseismic, same finding as the Halabja smoke test (`us2000bmcg`'s `seismic_stations="0"`). Expected for this region, not a bug; no spot check possible.

## Conditioned comparison (wave-D-style)

Our own fetched `dyfi_geo_10km.geojson` totals 71 10km boxes worldwide before filtering; USGS's own Atlas grid declares `intensity_observations="15.0"` in its own `<event/>` tag (not expected to match exactly — different filtering pipelines, noted not reconciled). This wave conditions our prior on the SAME underlying DYFI product via our own `mvn.py` (unmodified, weights untouched) and re-judges the same D20 thresholds — conditioned vs. conditioned this time.

| Criterion | Threshold | Bare | Conditioned (primary) |
|---|---|---|---|
| \|bias\| PGA (ln) | <= 0.3 | -0.091 (PASS) | 0.339 (FAIL) |
| \|bias\| PGV (ln) | <= 0.3 | -0.271 (PASS) | -0.008 (PASS) |
| Coverage PGA (±1σ) | >= 60.0% | 99.9% (PASS) | 91.8% (PASS) |
| Coverage PGV (±1σ) | >= 60.0% | 78.4% (PASS) | 99.4% (PASS) |

**Overall D20 gate (primary conditioned run): bias FAIL, coverage PASS**

Primary run used 5 DYFI boxes (nresp>=3, within our grid's own magnitude-scaled domain) — PGA conditioned on 5 points (0 co-located merges), PGV on 5 points (0 co-located merges). RMSE/MAE (ln): PGA 0.418/0.351, PGV 0.352/0.310. Compared over 224982 of 397089 USGS grid cells.

### Distance-binned PGA/PGV ln-bias (conditioned, primary)

| km bin | PGA ln bias | PGV ln bias | n |
|---|---|---|---|
| 0-15 | 0.952 | 0.739 | 997 |
| 15-35 | 0.535 | 0.337 | 4433 |
| 35-70 | 0.285 | 0.093 | 16287 |
| 70-130 | 0.213 | -0.037 | 53186 |
| 130-200 | 0.331 | -0.035 | 102378 |

## Sensitivity grid (every variant computed this run, not cherry-picked)

| Variant | model | min nresp | domain | n obs | PGA bias | PGV bias | PGA cov | PGV cov | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| PRIMARY: Worden/MMI, nresp>=3, domain-restricted | WordenEtAl12 | 3 | <=grid extent | 5 | 0.339 | -0.008 | 91.8% | 99.4% | bias FAIL, cov PASS |
| sensitivity: Zanini/EMS model (else primary settings) | Zaniniandhofer19 | 3 | <=grid extent | 5 | -0.171 | -0.290 | 99.7% | 75.4% | bias PASS, cov PASS |
| sensitivity: nresp>=2 (else primary settings) | WordenEtAl12 | 2 | <=grid extent | 8 | 0.359 | -0.089 | 89.6% | 98.3% | bias FAIL, cov PASS |
| sensitivity: unrestricted domain -- global DYFI (else primary settings) | WordenEtAl12 | 3 | unrestricted (global) | 11 | 0.630 | 0.038 | 51.1% | 99.3% | bias FAIL, cov FAIL |

## Circularity caveat

As with the Halabja wave-D re-judgment: if this event's Atlas grid was itself conditioned on (some of) these same DYFI observations, moving our conditioned map closer to it is partly true validation and partly true by construction — both maps pulled toward overlapping data. The underlying GMPE-set prior, correlation model, and conditioning math remain independently testable (especially wherever our own DYFI coverage does not reach), but this comparison is not an independent skill score.
