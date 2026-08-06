# D20 Halabja smoke test — `us2000bmcg` (2017 M7.3 Halabja/Sarpol-e Zahab)

Generated 2026-08-06T23:36:11.387863+00:00. `docs/decisions.md` D20;
`docs/research/gmpe-set-proposal-v2.md` §7.

## Framing (read this before the numbers)

This compares our **UNCONDITIONED point-source prior** (`gmpe_forward`
only — major band, point-source + ps2ff, no `mvn` conditioning) against
USGS's **Atlas grid**, which IS conditioned on 125 DYFI intensity
observations (`grid.xml`'s own `<event .../>` tag:
`intensity_observations="125" seismic_stations="0"`) and — per the Atlas
product line — typically a finite-fault rupture model, not a point
source. Residuals below therefore mix genuine GMPE-set model difference
with this conditioning/finite-fault-vs-bare-prior asymmetry. **Perfect
agreement is neither expected nor the pass criterion — the D20 numeric
thresholds are the criterion.** No weights were changed in response to
these results (`docs/decisions.md` D20, task instruction).

Event mechanism: US moment tensor (nodal plane 2): strike 122.5, dip 79, rake 77.8 (near-pure reverse/thrust) — confirms the Zagros-polygon reverse-rake default (config.py); fetched from the event detail's moment-tensor product, not re-verified beyond this script's own read.

## Verdict

| Criterion | Threshold | Result | Verdict |
|---|---|---|---|
| \|bias\| PGA (ln) | <= 0.3 | -0.549 | **FAIL** |
| \|bias\| PGV (ln) | <= 0.3 | -0.750 | **FAIL** |
| Coverage PGA (±1σ) | >= 60.0% | 74.1% | **PASS** |
| Coverage PGV (±1σ) | >= 60.0% | 50.5% | **FAIL** |

**Overall D20 gate: bias FAIL, coverage FAIL**
(both PGA and PGV must individually pass for the corresponding row above).

RMSE/MAE (ln): PGA 0.601/0.551,
PGV 0.818/0.751. MMI (intensity
units, Worden validation channel): bias -0.370, RMSE
0.586. Compared over 127656 of
465972 USGS grid cells (the rest fall outside our
magnitude-scaled 7.3-band grid extent).

## SPZ station spot check

- Source: task-brief fallback (not in stationlist.json — see find_spz_station docstring)
- Site: 34.7700N, 45.8600E
- Computed epicentral distance: 18.1 km
  (task brief claimed ~40 km — computed epicentral distance to the fallback coordinates does not match the ~40 km claimed in the task brief (see REPORT.md) — flagged, not silently reconciled)
- Observed PGA: 0.700 g
- Our predicted PGA (rock-760 prior, direct GMPE evaluation at this site,
  not grid-interpolated): 0.396 g
- Our total ln-sigma at this site: 0.639
- Observation sits **0.89σ** from our prior mean

## Distance-binned PGA/PGV ln-bias

| km bin | PGA ln bias | PGV ln bias | n |
|---|---|---|---|
| 0-25 | -0.115 | -0.112 | 695 |
| 25-50 | -0.474 | -0.468 | 2098 |
| 50-100 | -0.641 | -0.615 | 8372 |
| 100-200 | -0.674 | -0.756 | 33470 |
| 200-300 | -0.567 | -0.815 | 55761 |

## Interpretation

-0.549 ln-units PGA bias and -0.750
ln-units PGV bias (both negative: our unconditioned prior systematically
UNDER-predicts relative to USGS's conditioned Atlas map) are consistent
with the expected asymmetry — the Atlas map's 125 DYFI observations pull
its grid toward what people actually reported feeling, which for a major
reverse-mechanism Zagros event with real (if poorly resolved) site
amplification and finite-fault directivity is typically higher than a
bare point-source rock-760 prior predicts. The bias grows with distance
(see table) rather than shrinking, which is the DYFI-conditioning
signature, not obviously a GMPE-set defect: near-field cells (0-25 km) are
close to unconditioned already (few/no DYFI reports right at the
epicenter, mostly in inhabited areas further out), while far-field cells
sit inside the conditioning's spatial-correlation footprint. Coverage
(fraction of USGS cells inside our own ±1σ) tells the complementary story:
even with a nontrivial mean bias, our sigma budget is wide enough to
capture the PGA majority (74.1%) but not
enough of PGV, which is not surprising since the bias itself is larger
there. Per `docs/research/gmpe-set-proposal-v2.md` §7's own caveat, this
is a sanity-anchor comparison, not a fit target — a "fail" here is
information for a future Peshawa review of whether/how to add DYFI-informed
conditioning earlier in the pipeline (`mvn.py` already exists for exactly
that), not evidence the D20 GMPE set itself is wrong.
