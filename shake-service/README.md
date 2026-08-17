# bumelerze-shake-service

Regional SHAKEmap engine for **Bumelerze** (Kurdistan earthquake app). A
self-contained Python worker — no dependency on the Expo app or Supabase
project; it produces the same product-shaped contract
(`supabase/migrations/0006_shakemap_products.sql`) that USGS-sourced
ShakeMap products already fill for USGS-processed events.

## Licence: AGPL-3.0-or-later (different from the rest of the repo)

**This directory is licensed under the GNU Affero General Public License,
version 3 or later** (`shake-service/LICENSE`), Copyright 2026 Peshawa L.
Hasan. The rest of the Bumelerze repository (the Expo app, the website, the
Supabase migrations) is Apache-2.0. See `../LICENSING.md` for the full map.

**Why AGPL here.** This engine is built on the **OpenQuake Engine**
(`openquake.engine==3.26.2`, GEM Foundation), which is itself
AGPL-3.0-or-later. `shake_service/gmm.py` imports `openquake.hazardlib`
directly and calls its GSIM classes through `get_mean_stds`, and
`shake_service/config.py` names four hazardlib GSIM modules as the D20 logic
tree. That is a library-level dependency, not a data exchange, so this
component is a derivative work of OpenQuake and inherits its licence. Nothing
about that was a preference; it is what the AGPL requires.

**What it means in practice if you reuse this code:**

- You may run it, study it, modify it, and redistribute it, commercially
  included.
- If you distribute a modified version, the modified source must be offered
  under the AGPL too.
- The network clause (AGPL section 13) is the part people miss: if you run a
  **modified** version of this engine as a network service, and users interact
  with it over that network, you must offer those users the modified source.
  Running an **unmodified** copy as a service triggers no extra obligation
  beyond the ordinary AGPL terms.
- The AGPL is confined to this directory. Building an app that merely
  *consumes* the SHAKEmap products this worker publishes (JSON over HTTP, the
  way the Bumelerze app itself does) is data exchange, not linking, and does
  not make your app AGPL.

If none of that suits you, the alternative is to replace the OpenQuake
dependency with your own ground-motion models and write your own engine; the
non-OpenQuake parts of the science here (the GMICE tables, the MVN
conditioning, the export format) are documented well enough in each module's
docstring to be reimplemented independently.

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

**Wave F** (2026-08-07): `shake_service/worker/` — the daemon that turns
the validated engine into an automatic service (D9: "auto for regional
M>=3.5 ... versioned re-conditioning"). `feed_watcher.py` polls the USGS
`all_hour` feed (60 s) + an `fdsnws` region-bbox `updatedafter` sweep
(10 min) and decides `"new"`/`"update"`/`"skip"` per event (region bbox +
`config.TRIGGER_MIN_MAGNITUDE`, revision thresholds |ΔM|>=0.1 /
Δlocation>=5 km / Δdepth>=5 km — all tunable). `state.py` persists
per-event version/params-hash/product-paths/timestamps to a single JSON
file (sqlite would be overkill for one writer and a handful of tracked
events — rationale in the module docstring). `pipeline.py` runs the bare
`gmpe_forward` prior (conditioning deliberately SKIPPED — an explicit,
documented integration point for when a `felt_cells` source exists) ->
`export.write_products` into `products/<event-id>/v<N>/` -> state update,
idempotent by params hash. `uploader.py`'s `ProductUploader` interface has
a `LocalOnlyUploader` default (logs the would-be `shakemap_products` row,
migration `0006_shakemap_products.sql`) and a real `SupabaseUploader`
(SupabaseUploader integration wave, below). `scripts/run_worker.py
--once`/`--daemon` is the CLI; see its own docstring for the deployment
note (runs server-side next to Supabase, not on Peshawa's Mac — no
systemd/launchd unit yet).

**SupabaseUploader integration wave**: closes the gap where a computed
product never reached anything beyond the local filesystem. Owner
architecture decision, mid-wave: NOT "everything into Supabase" — a
three-way split instead. `uploader.py`'s `SupabaseUploader` composes two
independently-swappable collaborators:

- a `SupabaseIndexWriter` (real impl `_HttpSupabaseIndexWriter`) that
  resolves each product's `bml`/provider event id to the internal
  `events.event_id` UUID via the same `upsert_event_from_client` RPC
  (`supabase/migrations/0011_event_registry_and_assignment.sql`) the app
  itself calls, and upserts one SMALL, queryable `shakemap_products` INDEX
  row per published file — event reference, version, product type, engine
  provenance, review status, a coarse bounding box (`supabase/migrations/
  0019_shakemap_products_index_fields.sql`), and a public URL — never the
  artifact bytes. Idempotent on the table's own `(event_id, producer,
  version, product_type)` unique constraint.
- an `ArtifactPublisher` (real impl `AtlasRepoPublisher`) that writes the
  actual `cont_mi.json`/`info.json`/(opt-in) `grid.json` files into a
  clean, deterministic, versioned local directory tree (`events/<bml-or-
  provider-id>/v<N>/...` + machine-readable per-event and site-wide
  manifests) — the staging copy of the **Bumelerze Atlas**, a SEPARATE
  public data repository the orchestrator creates/publishes elsewhere
  (never Supabase Storage, never inline JSON bytes in Postgres — this is
  what keeps a versioned scientific-data archive from bloating the app's
  own operational database forever).

**Vector-first**: contours (`cont_mi.json`) and metadata (`info.json`) are
ALWAYS published; the raster grid (`grid.json`, ~7 MB/event vs. contours'
measured ~100-530 KB in this repo's own committed Atlas output) is
opt-in-only (`BUMELERZE_PUBLISH_RASTER`) — off by default, no file written,
no index row created for it at all.

Replaying the same product directory through either collaborator never
creates a duplicate row/file or a second physical event. The
previously-discarded engine-version block (`info.json`'s `"version"`:
service version, openquake pin, GSIM branches, GMICE models, conditioning
method) is carried verbatim into `shakemap_products.data_used` on every
published row of a version — no schema change needed, `data_used` is
already producer-defined JSONB. `build_uploader()` (called from
`scripts/run_worker.py`'s `main()`) reads `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` (index credentials) plus three optional,
safely-defaulted env vars (artifact publish root/base URL/raster policy)
and returns a real `SupabaseUploader` when Supabase credentials are set, or
falls back to the pre-existing `LocalOnlyUploader` (logged, not silent)
when they aren't — see `.env.example` in this directory for all five
variables and OPERATIONS.md for the operator runbook (uploading an
existing product, backfilling the curated Atlas events, and the engine-fix
-> recompute -> republish cycle). The index writer talks to Supabase over
plain HTTPS (PostgREST, via the `requests` dependency already pinned here)
— no new dependency; the artifact publisher is pure local filesystem I/O.

**Wave G / D21 "dual backend"**: `worker/pipeline.py` now fetches whatever
USGS station (`stationlist.json`)/DYFI (`dyfi_geo_10km.geojson`) product
content an event has and conditions the forward-map prior on it
(`station_observations.py` + `conditioned_forward.py`), and — if the event
ALSO has a USGS ShakeMap `grid.xml` — automatically compares our exported
product against it, writing a versioned `compatibility.json`
(`comparison.py`). The **Bumelerze Atlas** (`bumelerze-atlas/`,
`scripts/seed_atlas.py`) is the permanent, versioned archive of our own
computed maps for the Historical View's curated events, bundled app-side
by `scripts/bundle_atlas_for_app.py` — "Displayed maps are ALWAYS
bumelerze-shake-service products", never live USGS.

**D22 "use ALL available USGS data" / "IMS-25 as the app's public scale"**
(2026-08-08, `docs/decisions.md` D22): (a) `rupture_model.py` — when an
event ALSO publishes a `rupture.json` finite-fault model, its geometry
REPLACES ps2ff's point-source expected Rjb/Rrup (`gmm.py`'s
`distance_method` switches `"ps2ff"` -> `"finite-fault"`) and its
geometry-derived dip/ztor (+ metadata rake, when a real mechanism exists)
replace `rupture_params.py`'s coarse Zagros-polygon point-source defaults
— see `rupture_model.py`'s own module docstring for the full "planar
patches" approximation and its honest caveats. (b) **Scale identity**:
Peshawa's ruling is that **IMS-25 and EMS-98 are treated as the same
scale** for this service's purposes (IMS-25 extends EMS-98; the
Zanini-based `intensity.py`/`gmice.py` chain this package already runs was
never re-derived for this rename — only the PUBLIC LABEL changed). Every
`info.json` now carries a top-level `intensity_scale: "IMS-25 (EMS-98)"`
field (`export.py`) alongside the pre-existing internal `intensity.scale`
field (`"EMS-98"`/`"MMI"`, unchanged — D22: "internal code names stay
as-is; this is display language only"). The intensity legend's Roman-
numeral levels and `ems_colors` are untouched — they ARE the IMS/EMS
scale, D22 explicitly keeps them as-is.

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
- `shake_service/rupture_model.py` (D22 "use ALL available USGS data") —
  `rupture.json` (finite-fault) ingestion: quad extraction, planar-patch
  Rjb/Rrup (REPLACES ps2ff for an event that has one), geometry-derived
  dip/ztor + metadata-rake overrides. `worker/pipeline.py` fetches
  `rupture.json` as shakemap-product content (same fetch as `stationlist.json`)
  and every product's `data_used["distance_method"]` records
  `"finite-fault"` vs `"ps2ff"`, unconditionally.
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

- `shake_service/worker/` (wave F, uploader wired in the SupabaseUploader
  integration wave) — the auto-trigger daemon: `feed_watcher.py` (USGS poll
  parsing + trigger decisions), `state.py` (JSON-file-backed per-event
  state), `pipeline.py` (forward map -> export -> state -> upload,
  idempotent), `uploader.py` (`ProductUploader`, `LocalOnlyUploader`, the
  real `SupabaseUploader` — composing a `SupabaseIndexWriter` for the
  small Supabase INDEX row and an `ArtifactPublisher` for the actual
  product files, pluggable, real local-directory impl `AtlasRepoPublisher`
  — + `build_uploader()`'s credentials-present/absent fallback). CLI:
  `scripts/run_worker.py --once`/`--daemon`.

Internal numeric contract (documented once, here, and in `gmm.py`'s
docstring): **ln-space**, **g** for PGA/SA, **cm/s** for PGV — i.e.
`exp(mean)` is directly in those units. This matches what
`openquake.hazardlib.contexts.get_mean_stds` returns natively; the adapter
does not change units, only combines branches. `gmice.py`/`intensity.py`
convert explicitly at their own boundary (see those modules' docstrings)
since the toolkit's GMICE coefficients are calibrated in cm/s^2 (PGA/SA)
and cm/s (PGV), not g.
