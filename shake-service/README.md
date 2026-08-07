# bumelerze-shake-service

Regional ShakeMap engine for **Bumelerze** (Kurdistan earthquake app). A
self-contained Python worker — no dependency on the Expo app or Supabase
project; it produces the same product-shaped contract
(`supabase/migrations/0006_shakemap_products.sql`) that USGS-sourced
ShakeMap products already fill for USGS-processed events.

## Lineage (D9 -> D19 -> D20)

- **D9** (2026-07-28): shake-service = a Python worker extracted from
  `SHAKEmaps-Toolkit-v26`, chaining a `gmpe_forward` prior with `mvn`
  conditioning as data arrives (catalog -> faults -> stations -> felt
  reports). Originally scoped as "pure-Python GMPE path, no OpenQuake".
- **D19** (2026-08-04, amends D9): the GMPE set is instead built from
  **`openquake.hazardlib` GSIMs used as a Python library** — the same
  consumption pattern USGS ShakeMap itself uses — selected against the
  published Iraq/Zagros GMPE-selection literature, not the toolkit's five
  hand-transcribed models. This dissolved the toolkit's PGV/sigma-split
  blockers: every hazardlib GSIM exposes inter-event (tau) and intra-event
  (phi) sigma natively, so `mvn` conditioning works with any subset.
- **D20** (2026-08-05, CONFIRMED): the concrete 4-branch logic tree —
  `ChiouYoungs2014` + `AkkarEtAlRjb2014` + `BooreEtAl2014` +
  `KaleEtAl2015Iran` — with magnitude-banded weights, Option-C
  (law-of-total-variance) mixture, and the point-source/rake/grid-extent
  policies this package implements. See `docs/decisions.md` D9/D19/D20
  and `docs/research/gmpe-set-proposal-v2.md` for the full literature
  survey and reasoning.

**Wave B** (2026-08-07): the intensity/conditioning layer — GMICE (Zanini &
Hofer 2019 EMS display + Worden et al. 2012 MMI validation, `gmice.py`),
the VirtualIPE-equivalent chain-rule engine (`intensity.py`), the
`gmpe_forward` grid engine (`forward.py`, `ForwardMap`), the `mvn`
conditioning engine (Engler et al. 2022, `mvn.py`), and the real Vs30
raster sampler (`vs30.RasterVs30`). See `docs/decisions.md` D9 and each
module's own docstring for full provenance/adaptation notes.

**Wave C** (2026-08-07): product export (`export.py`, `ForwardMap` ->
USGS-compatible `cont_mi.json`/`info.json`/`grid.json`) + the D20 Halabja
smoke test (`comparison.py`'s `grid.xml` parser and residual/bias/coverage
statistics, originally `scripts/run_halabja.py`/`run_halabja_conditioned.py`
event-hardcoded scripts, results frozen under `validation/halabja/`).

**Wave E** (2026-08-07, D20 checkpoint-outcome condition 3): the two
Halabja scripts were generalized into one parameterized tool,
`scripts/run_validation.py --event <usgs-id>` — event params/products
(shakemap, dyfi) discovered from the USGS detail JSON, band auto-selected
from magnitude, bare-prior comparison + `mvn`-conditioned re-judgment +
the full GMICE/nresp/domain sensitivity grid computed for any event in one
run. Used to validate the 2018 Kermanshah pair (`us1000hwdw` M6.3,
`us1000ghda` M6.0 — the *moderate* weights band, vs. Halabja's *major*
band) alongside Halabja itself; see `validation/SUMMARY.md` for the
cross-event table. The two original Halabja-only scripts are retired
(git history preserves them) — their committed `validation/halabja/`
output is left untouched (re-running the generalized tool against the same
cached inputs reproduces the same bias/coverage numbers bit-for-bit,
verified this wave, so nothing was lost by not regenerating it in place).

What still survives from the toolkit for a later wave: the toolkit's M4b+
multi-channel/cross-IMT `mvn` conditioning (DYFI/CDI felt-report
observations — this package's `mvn.py` is single-IMT, stations-only, by
task scope).

## Environment setup

Requires Python >= 3.11 (openquake's floor; this project targets the
battle-tested 3.11 rather than chasing newer interpreters — see "Python
version" below).

```bash
cd shake-service
/opt/homebrew/bin/python3.11 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt
# or, for the top-level intent only (pulls the same transitive closure):
# ./.venv/bin/pip install -e ".[dev]"
```

Verify the install (this is the exact check that gates "the environment is
usable" — run it after any reinstall):

```bash
./.venv/bin/python -c "
from openquake.hazardlib.contexts import ContextMaker
from openquake.hazardlib.gsim.chiou_youngs_2014 import ChiouYoungs2014
from openquake.hazardlib.gsim.akkar_2014 import AkkarEtAlRjb2014
from openquake.hazardlib.gsim.boore_2014 import BooreEtAl2014
from openquake.hazardlib.gsim.kale_2015 import KaleEtAl2015Iran
print('ok')
"
```

Run tests:

```bash
./.venv/bin/pytest -q
```

### Python version

Homebrew's `python3.11` is used deliberately — it is the documented floor
for `openquake.engine` (`requires_python >=3.11`) and is the version every
ShakeMap-adjacent operator battle-tests against. A newer interpreter (3.13+)
may work — verify by actually importing before trusting it; this repo does
not chase interpreter versions for their own sake.

### Dependency footprint

`openquake.engine` pulls a heavy transitive closure (Django, GDAL, Fiona,
GeoPandas, Numba — none of which the plain `openquake.hazardlib` import
path actually touches; numpy/scipy/pandas/h5py do the real work) — roughly
0.5 GB installed, matching what every ShakeMap 4 operator runs. This is
acceptable for a **server-side worker**, not the mobile app.

One system dependency: `openquake.engine`'s GDAL Python bindings require a
matching system `libgdal` (installed here via `brew install gdal` /
`brew upgrade gdal`, currently 3.13.2 to match the `GDAL==3.13.2` Python
wheel). If a future pin needs a different GDAL version, upgrade the system
package first (`brew upgrade gdal`) or the wheel build will fail with a
version-mismatch error at install time.

## Upgrade policy (D20 §6.3 — revalidate-on-upgrade)

`openquake.engine` (and therefore `openquake.hazardlib`) is pinned to an
**exact version** (`shake_service.config.OPENQUAKE_PIN`, currently
`openquake.engine==3.26.2`) in `pyproject.toml` and `requirements.txt`.
Upgrades are deliberate, gated events — never a silent `pip install -U`:

1. Install the candidate version in a scratch venv.
2. Re-run the full test suite (`pytest`).
3. Re-run the Halabja smoke/validation grid (wave C; not yet built —
   until it exists, at minimum re-run the wave-A GMM mixture tests and
   sanity-check the smoke-grid ln-PGA range in `tests/test_gmm.py` is
   unchanged within tolerance).
4. Only then commit the new pin (`config.py`, `pyproject.toml`,
   `requirements.txt` together, one commit).

GSIM coefficient tables do occasionally get corrected upstream between
releases — inheriting those fixes is a feature, but only through this gate,
never automatically.

## Package layout

- `shake_service/config.py` — the D20 logic tree (GSIM classes + per-band
  weights), magnitude bands, grid-extent policy, region bbox, the Zagros
  mechanism polygon (coarse, `[REVIEW]`), depth-tag threshold, the
  openquake pin string.
- `shake_service/magnitude.py` — Scordilis (2006) mb->Mw (and ML->Mw proxy)
  conversion.
- `shake_service/rupture_params.py` — point-source rake/dip/ztor/rx/z1pt0
  derivation, keyed off the Zagros polygon.
- `shake_service/distances.py` — geodetic Repi/Rhyp + ps2ff-based
  Rjb/Rrup expected values and variances.
- `shake_service/vs30.py` — site-grid builder: `UniformRockVs30` (wave A
  default, rock-760 everywhere) + `RasterVs30` (wave B, samples the
  toolkit's real global Vs30 grid via `h5py`, falls back safely if the
  file is unreachable) + `default_sampler()` (env-var-gated auto-pick,
  `BUMELERZE_VS30_RASTER_PATH` — unset by default; see `vs30.py`'s
  `[REVIEW]` note for the OneDrive hydration ask).
- `shake_service/gmm.py` — the core adapter: builds the hazardlib context,
  calls `get_mean_stds` for the 4-branch tree across a site grid, applies
  the D20 banded-weight Option-C mixture, converts units at the boundary.
- `shake_service/gmice.py` (wave B) — Zanini & Hofer (2019) EMS-98 +
  Worden et al. (2012) MMI ground-motion-to-intensity conversion
  equations, both directions, with sigma tables + honesty flags carried
  forward from the toolkit verbatim.
- `shake_service/intensity.py` (wave B) — VirtualIPE-equivalent: a
  `gmm.GMResult` -> an EMS or MMI `IntensityChannel`, full tau/phi/
  sigma_model chain-rule propagation through the GMICE derivative,
  PGV-driven with a per-site PGA fallback.
- `shake_service/forward.py` (wave B) — the forward-map engine: event
  params -> site grid (magnitude-scaled extent + spacing policy,
  `config.forward_grid_spacing_km`) -> `gmm` -> `intensity` -> a single
  `ForwardMap` (PGA/PGV/EMS/MMI grids + provenance).
- `shake_service/mvn.py` (wave B) — Engler et al. (2022) MVN conditioning
  of a forward field on point observations (single IMT, stations-only this
  wave); `condition_field` (pure math) + `condition_forward_map`
  (end-to-end, evaluates the prior exactly at station coordinates).
- `shake_service/export.py` (wave C) — `ForwardMap` -> the USGS-compatible
  product bundle: `cont_mi.json`-shaped MMI-contour GeoJSON (marching
  squares via `skimage.measure.find_contours` on the EMS-98 grid, half-
  intensity levels), `info.json` metadata (event/engine/data-used/
  version), and a compact `grid.json` raster.
- `shake_service/comparison.py` (wave C) — `grid.xml` parser + bilinear
  resampling + residual/bias/RMSE/MAE/±1σ-coverage/distance-binned
  statistics, the tooling behind the D20 validation suite.
  `scripts/run_validation.py --event <usgs-id>` (wave E, generalized from
  the original event-hardcoded Halabja scripts) runs the full bare +
  `mvn`-conditioned comparison for any USGS event; per-event outputs
  (`REPORT.md`, `results.json`, figures) live in `validation/<event-id>/`
  (Halabja's own frozen legacy-format output stays at `validation/halabja/`
  — see that folder's own `README.md`). Cross-event synthesis:
  `validation/SUMMARY.md`.

Internal numeric contract (documented once, here, and in `gmm.py`'s
docstring): **ln-space**, **g** for PGA/SA, **cm/s** for PGV — i.e.
`exp(mean)` is directly in those units. This matches what
`openquake.hazardlib.contexts.get_mean_stds` returns natively; the adapter
does not change units, only combines branches. `gmice.py`/`intensity.py`
convert explicitly at their own boundary (see those modules' docstrings)
since the toolkit's GMICE coefficients are calibrated in cm/s^2 (PGA/SA)
and cm/s (PGV), not g.
