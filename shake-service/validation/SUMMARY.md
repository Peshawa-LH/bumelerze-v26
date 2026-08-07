# D20 validation — cross-event summary

Generated 2026-08-07. `docs/decisions.md` "D20 smoke-test checkpoint
outcome" condition 3 ("The 2018 Kermanshah pair ... joins the validation
suite (same bare+conditioned protocol) before public launch"). Runner:
`scripts/run_validation.py --event <usgs-id>`. Thresholds (unchanged across
bands, `docs/decisions.md` D20 / `gmpe-set-proposal-v2.md` §7): |bias|
<= 0.3 ln-units (PGA and PGV, independently), >= 60% of USGS Atlas grid cells
inside our own +/-1sigma (PGA and PGV, independently). "Conditioned" below is
always the PRIMARY variant (Worden/MMI GMICE, DYFI nresp>=3, observations
restricted to our own grid's magnitude-scaled domain) -- every event's own
`REPORT.md`/`REPORT-CONDITIONED.md` carries the full GMICE/nresp/domain
sensitivity grid, not reproduced here.

## Cross-event table

| Event | Mag (band) | Bare PGA bias | Bare PGV bias | Bare cov PGA/PGV | Bare gate | Cond. PGA bias | Cond. PGV bias | Cond. cov PGA/PGV | n obs | Cond. gate |
|---|---|---|---|---|---|---|---|---|---|---|
| Halabja/Sarpol-e Zahab 2017 (`us2000bmcg`) | Mw 7.3 (**major**) | -0.549 | -0.750 | 74.1% / 50.5% | bias **FAIL**, cov **FAIL** | 0.285 | -0.274 | 95.0% / 86.9% | 36 | bias **PASS**, cov **PASS** |
| Sarpol-e Zahab 2018 (`us1000hwdw`) | Mw 6.3 (**moderate**) | -0.091 | -0.271 | 99.9% / 78.4% | bias **PASS**, cov **PASS** | 0.339 | -0.008 | 91.8% / 99.4% | 5 | bias **FAIL**, cov **PASS** |
| Javanrud/Kermanshah 2018 (`us1000ghda`) | Mw 6.0 (**moderate**) | -0.338 | -0.427 | 97.8% / 79.1% | bias **FAIL**, cov **PASS** | 0.002 | -0.208 | 100.0% / 88.0% | 6 | bias **PASS**, cov **PASS** |

Per-event detail: `halabja/REPORT.md` + `halabja/REPORT-CONDITIONED.md`
(legacy two-report format, generator retired -- see `halabja/README.md`),
`us1000hwdw/REPORT.md`, `us1000ghda/REPORT.md` (current unified format).
Both 2018 events resolved cleanly with a full ShakeMap Atlas grid AND a
DYFI product -- no degraded "bare-prior-only" fallback was needed for either
(unlike the task's contingency, both products existed for both events; see
each `REPORT.md`'s "Product availability" section). `us1000ghda` additionally
carries one real (non-DYFI) instrumental station in `stationlist.json`
(`TU.GEVA`, Gevas/Van, Turkey, ~500 km away) -- a direct GMPE spot check
there lands at -0.97 sigma from our bare prior's mean (0.0004 g predicted vs.
0.0001 g observed), a genuine non-DYFI-derived corroboration point Halabja's
zero-instrumental-station stationlist never offered. `us1000hwdw` has no
instrumental stations (DYFI-macroseismic-only stationlist, same finding as
Halabja).

## Synthesis

**Does the moderate band behave consistently with the major band? Only
partly -- and the disagreement is itself the validation value the task
anticipated.** Halabja (major, N=1) told a clean, single-direction story:
our bare prior under-predicts a real, DYFI-conditioned Atlas map almost
everywhere (both IMTs, growing with distance -- the DYFI-conditioning
signature), and conditioning our own prior on the same observations fixes
it convincingly. Generalizing that story to "our bare prior always
under-predicts" would have been wrong: `us1000hwdw`'s bare prior is
essentially **unbiased** against its own Atlas grid (-0.091 ln PGA, well
inside the +/-0.3 gate with no conditioning at all), while `us1000ghda`'s
bare prior under-predicts similarly to Halabja (-0.338/-0.427) but far less
severely. Three events, three different bare-prior outcomes (FAIL/FAIL,
PASS/PASS, FAIL/PASS on bias/coverage respectively) -- the moderate band's
own `BAND_WEIGHTS` row (CY14 .30/ASB14 .25/BSSA14 .20/KALE15 .25, vs.
major's .35/.25/.25/.15) is at least consistent with these two moderate
events both landing closer to zero bias than Halabja's major-band bare
run, but two events is not enough to attribute that to the weights row
specifically rather than event-specific factors (mechanism, DYFI density,
depth) -- a caveat stated plainly, not glossed over.

**The more actionable finding is a small-N conditioning risk the major-band
single-event smoke test could never have surfaced.** Halabja conditioned on
36 DYFI observations and ghda on 6 -- both produced clean PASSES, with
directionally sensible corrections (both pulled bias toward zero without
overshooting badly on the aggregate statistic). `us1000hwdw` conditioned on
only **5** observations, the smallest sample of the three, and conditioning
there made things *worse*: a bare prior that already PASSED (PGA bias
-0.091) was pulled to **+0.339**, just over the 0.3 threshold, a bias-sign
flip driven by a handful of observations whose CDI-implied ground motion
(via the Worden GMICE reversal) evidently runs high relative to the
already-adequate bare prior at this event. This is exactly the sort of
failure mode `REPORT-CONDITIONED.md`'s own "doughnut"/circularity language
warned about in the abstract (a handful of mid-field observations pulling
the whole grid via the correlated tau term) -- here it is concretely
observed on a second event, with a small enough N (5) that a single
unusual box has outsized leverage. **Practical implication for the
service (not a code change made this wave, per task scope -- "do NOT touch
weights"): conditioning on very few DYFI observations (single digits)
should not be treated as unconditionally safer than the bare prior** -- the
existing in-domain-restriction policy (D20 checkpoint condition 1) already
guards against the worse global-domain failure mode seen in every event's
`sensitivity_unrestricted` row, but does not by itself guard against a
small in-domain sample being unrepresentative. This is recorded as a
finding for a future review, not acted on here.

**What stayed consistent across all three events regardless of band:**
+/-1sigma coverage on PGA passed in every single case (bare AND conditioned,
all three events) -- our sigma budget is comfortably wide for PGA across
the whole validated range (Mw 6.0-7.3). PGV coverage was the one weak spot
(Halabja bare PGV coverage FAILED at 50.5%, the only coverage failure in
the whole suite) and improved to a PASS everywhere once conditioned. And
in every event where the bare prior already passed, conditioning kept PGV
bias improving toward zero (all three conditioned PGV biases are smaller
in magnitude than their bare counterparts) -- PGA is where the small-sample
overshoot risk concentrates, not PGV.

## D20 gate status after this wave

3/3 events pass the CONDITIONED-primary D20 gate on coverage; 2/3
(Halabja, `us1000ghda`) pass cleanly on bias; `us1000hwdw` fails PGA bias
by a small margin (0.339 vs. 0.3) driven by its N=5 conditioning sample,
as discussed above. The gate itself (`docs/decisions.md` D20
checkpoint-outcome, closed 2026-08-06 with three conditions) is not
reopened by this result -- condition 3 asked that the pair "join the
validation suite," which it now has, with an honest report of a new
small-N finding for a future review, not a silent pass/fail rewrite of the
existing gate.

## Post-hoc note (2026-08-07, GMICE option-A wave): small-N conditioning
## floor postdates every run in this file

The small-N conditioning floor this document's own finding motivated
(`config.MIN_CONDITIONING_OBSERVATIONS = 10`, `conditioned_forward.py`,
PROPOSED default, Peshawa to confirm/tune) was implemented in a LATER wave
and is **not** reflected in any committed report or table above — every
`REPORT.md`/`REPORT-CONDITIONED.md` and the cross-event table were
generated before the floor existed, and none of these committed outputs
have been (or should be, per this wave's task scope) re-run to reflect it.
Read them as: "what conditioning did before the floor existed."

Concretely, if `us1000hwdw`'s conditioned run (N=5, the one that flipped a
passing bare-prior PGA bias to a narrow FAIL, the finding this note is
attached to) were re-run today, the floor would engage — 5 < 10 — and the
service would publish the BARE prior for that event's PGA/PGV channels
instead of the conditioned posterior. That bare prior already PASSES both
bias and coverage on its own (table above: `-0.091` bias, `99.9%/78.4%`
coverage) — i.e. the floor would have prevented the exact failure mode
this document documents, for this exact event, had it existed at the time
of the run. This is a consistency check on the floor's own rationale, not
a re-validation: the floor's threshold (10) is still PROPOSED, not
confirmed, and this note does not stand in for actually re-running the
validation suite once Peshawa confirms/tunes it.
