# D20 Halabja CONDITIONED re-judgment — `us2000bmcg` (2017 M7.3 Halabja/Sarpol-e Zahab)

Generated 2026-08-07T00:37:43.268451+00:00. `docs/decisions.md` "D20 smoke-test
checkpoint outcome" (2026-08-06, Peshawa's fair-comparison-rerun ruling);
wave C baseline: `validation/halabja/REPORT.md` + `results.json`.

## Framing

Wave C compared our BARE, unconditioned prior against USGS's Atlas grid,
which is itself conditioned on DYFI observations — declared
`intensity_observations="125"`
in `grid.xml`'s own `<event/>` tag. Our own fetched `dyfi_geo_10km.geojson`
product for this event totals 397 10km UTM
boxes worldwide before any filtering; this does not equal 125 (a
discrepancy noted, not silently reconciled: USGS's own DYFI-to-ShakeMap
ingestion presumably applies its own filtering/weighting pipeline we don't
have visibility into — our own independently-chosen nresp>=3 filter yields
103 boxes worldwide, in the same order of magnitude but not identical).
This wave conditions our
prior on the SAME underlying Atlas DYFI product via our own `mvn.py`
(unmodified) and re-runs the identical `comparison.py` statistics — a
like-for-like comparison this time: conditioned vs. conditioned. **Weights
untouched** (`config.BAND_WEIGHTS`/GSIM set unchanged from D20; see this
script's own module docstring for the two documented, non-weight
engineering choices — GMICE model choice, observation-domain restriction —
made for the PRIMARY run, with every alternative reported as a sensitivity
variant below, not hidden).

## D20 re-judgment: bare prior (wave C) vs. conditioned (wave D, primary)

| Criterion | Threshold | Bare prior (wave C) | Conditioned (wave D, primary) |
|---|---|---|---|
| \|bias\| PGA (ln) | <= 0.3 | -0.549 (FAIL) | 0.285 (PASS) |
| \|bias\| PGV (ln) | <= 0.3 | -0.750 (FAIL) | -0.274 (PASS) |
| Coverage PGA (±1σ) | >= 60.0% | 74.1% (PASS) | 95.0% (PASS) |
| Coverage PGV (±1σ) | >= 60.0% | 50.5% (FAIL) | 86.9% (PASS) |

**Overall D20 gate (primary conditioned run): bias PASS, coverage PASS**

Primary run used 36 DYFI boxes (nresp>=3,
within our grid's own magnitude-scaled domain) — PGA
conditioned on 36 points (0 co-located
merges), PGV on 36 points (0 co-located
merges). RMSE/MAE (ln): PGA 0.375/0.306,
PGV 0.426/0.348. MMI (Worden validation
channel, recomputed from conditioned PGA/PGV): bias 0.055, RMSE
0.427. Compared over 127656 of 465972 USGS grid cells.

## Distance-binned nuance (the overall PASS conceals a near-field overshoot)

| km bin | PGA ln bias | PGV ln bias | n |
|---|---|---|---|
| 0-25 | 0.717 | 0.364 | 695 |
| 25-50 | 0.355 | 0.011 | 2098 |
| 50-100 | 0.191 | -0.139 | 8372 |
| 100-200 | 0.160 | -0.280 | 33470 |
| 200-300 | 0.268 | -0.339 | 55761 |

`distance_binned_bias_before_after.png` shows it visually: the AGGREGATE
PGA/PGV bias passes the ±0.3 threshold, but the closest bin (0-25 km) does
NOT — it OVERSHOOTS (PGA +0.717, PGV +0.364), the
opposite direction from wave C's bare-prior UNDERSHOOT everywhere. This is
the doughnut again (next section): the nearest usable DYFI box sits ~36 km
out, so there is no LOCAL (phi-block) conditioning information inside 25
km at all — the only thing pulling the 0-25 km cells up is the
fully-correlated (tau) shared event term, which is set by the mid-field
majority of observations. Those mid-field boxes' CDI-implied ground motion
happens to run a bit high relative to what a point-source rock-760 prior
would predict there too, so the shared shift overshoots when applied to
the true near-field, where the (unconditioned) prior itself does the best
job on its own (wave C's 0-25 km bin was closest to correct of any distance
bin, ln bias only -0.115). Net effect on the AGGREGATE statistic: still a
PASS, because the 0-25 km bin is a small fraction of the 127656
compared cells (695 of them in wave C's own count) — but a reader zooming
into the epicentral area specifically should not read "PASS" as "accurate
right at the epicentre".

## Sensitivity grid (every variant computed this run, not cherry-picked)

| Variant | model | min nresp | domain | n obs | PGA bias | PGV bias | PGA cov | PGV cov | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| PRIMARY: Worden/MMI, nresp>=3, domain-restricted | WordenEtAl12 | 3 | <=grid extent | 36 | 0.285 | -0.274 | 95.0% | 86.9% | bias PASS, cov PASS |
| sensitivity: Zanini/EMS model (else primary settings) | Zaniniandhofer19 | 3 | <=grid extent | 36 | -0.569 | -0.517 | 64.7% | 68.5% | bias FAIL, cov PASS |
| sensitivity: nresp>=2 (else primary settings) | WordenEtAl12 | 2 | <=grid extent | 58 | 0.210 | -0.366 | 98.4% | 79.3% | bias FAIL, cov PASS |
| sensitivity: unrestricted domain -- global DYFI (else primary settings) | WordenEtAl12 | 3 | unrestricted (global) | 103 | 0.910 | -0.486 | 19.1% | 70.0% | bias FAIL, cov FAIL |

## The observation set: count, spatial distribution, the "doughnut"

The real `dyfi_geo_10km.geojson` product for this event carries
397 10km UTM boxes worldwide (widely-felt M7.3).
After the primary filter (nresp>=3, within our own magnitude-scaled domain),
36 boxes remain. Their spatial distribution is
the classic DYFI "doughnut": the CLOSEST usable box sits ~36 km from the
epicentre (no boxes at all inside that radius — the immediate epicentral
area is sparsely populated / mountainous, so nobody felt-reported from
right on top of the rupture), the highest-nresp boxes (23, 49 responses)
sit in Sulaymaniyah city (~85-90 km, a real population center, not a
uniform ring), and coverage thins with distance beyond ~150-200 km even
before the domain cutoff. The conditioning therefore densifies the
mid-field urban corridor far better than the true near-field, which the
`mvn` correlation model only partially compensates for (the spatially
decaying phi block has essentially no reach at 36+ km separation from a
sparse network; only the fully-correlated tau — shared event term — block
reaches the true near-field cells, and only as a shared shift, not a
locally-resolved one).

## The circularity caveat (stated plainly, per task instruction)

USGS's own Atlas `grid.xml` for this event was ITSELF built by conditioning
on these same DYFI observations (that is what
`intensity_observations="125"`
in its own `<event/>` tag means). Our conditioned map moving closer to the
Atlas map is therefore **partly true validation and partly true by
construction** — both maps were pulled toward an overlapping subset of the
same felt-report data, so SOME of any improvement in bias/coverage is not
independent evidence our GMPE-set-plus-conditioning pipeline is "right",
it is evidence that conditioning on shared data makes two different priors
converge, which is close to definitionally true regardless of how good
either prior was to start with. This does NOT make the comparison
worthless (the underlying GMPE-set prior, correlation model, and
conditioning math are all still genuinely independent of USGS's own
finite-fault/ShakeMap-internal pipeline, and a badly wrong prior +
correlation model could still fail to converge even when conditioned on
identical points — the near-field cells our own DYFI coverage never
reaches, per the doughnut above, are the most circularity-free test of the
underlying prior that this comparison offers) — but it is why this
re-judgment is reported as "conditioned vs. conditioned, both pulled by
overlapping data", not as an independent skill score, and why the
UNRESTRICTED / alternate-GMICE sensitivity variants above matter: they
show the result is not a knife-edge artefact of one specific observation
selection, but they also show it visibly DEGRADES under different (still
reasonable) choices (sensitivity: Zanini/EMS model (else primary settings)
fails bias; sensitivity: unrestricted domain -- global DYFI (else primary settings)
fails badly) — the primary result is a real, but fragile, pass.
