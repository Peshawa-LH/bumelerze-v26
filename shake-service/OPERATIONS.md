# OPERATIONS — manual-intervention runbook

For Peshawa. Every procedure the worker does NOT do on its own, with exact
commands. Assumes a shell at `shake-service/` with the venv built
(`./.venv/bin/python` exists). Nothing here needs the app toolchain.

The worker itself (feeds → trigger policy → pipeline → products) is
`scripts/run_worker.py --daemon`; this file is only about stepping in
around it.

---

## 0. Where everything lives

| Thing | Path |
|---|---|
| Worker state (single source of truth for tracked events, **and** the bml-id counters) | `worker_state.json` (default; `--state-path` to point elsewhere) |
| Live products | `products/<event-id>/v<N>/` → `info.json`, `cont_mi.json`, `grid.json` |
| USGS-comparison record (only when USGS also published a grid) | `products/<event-id>/v<N>/compatibility.json` — same folder as that version's `info.json`; the path is also recorded in state as `comparison_path` |
| Bumelerze Atlas (curated 11, committed) | `bumelerze-atlas/<event-id>/v<N>/` + `bumelerze-atlas/SUMMARY.md` |
| Live catalog (append-only, one JSON line per detected event) | `regional-catalog/live-catalog.jsonl` |
| Archival catalog build | `regional-catalog/bumelerze-catalog.sqlite` (+ `.csv`, `BUILD_REPORT.md`) |
| Validation reports | `validation/<event-id>/` + `validation/SUMMARY.md` |

Event ids: provider ids (`us2000bmcg`, EMSC `unid`s, GEOFON `gfz...`) key
the products/state; the canonical `bml...` id lives inside state and each
product's `data_used` (`docs/research/bumelerze-id-scheme.md`).

Quick state inspection (it is just JSON):

```bash
python3 -m json.tool worker_state.json | less
# one event:
python3 - <<'EOF'
import json
ws = json.load(open("worker_state.json"))
print(json.dumps(ws["events"]["us2000bmcg"], indent=2))
print("id counters:", ws["meta"].get("bumelerze_id_counters"))
EOF
```

---

## 1. Recompute an event (diagnostic re-run, nothing written to `products/`)

`run_validation.py` fetches the event's real USGS catalog params +
ShakeMap/DYFI products, runs our engine on them, and writes a full
comparison report under `validation/` — the right tool when the question
is "does our map for this event look right?":

```bash
./.venv/bin/python scripts/run_validation.py --event us2000bmcg
# outputs land in validation/us2000bmcg/ (cached downloads in .cache/)
```

This never touches worker state or the `products/` tree — safe to run any
time, repeatedly.

## 2. Bump a product version manually (force a real recompute)

The pipeline is idempotent by params-hash: same params → no new version.
To force a NEW version anyway (typical reason: the engine changed but the
event's params didn't):

**Atlas events** (the curated 11) — supported flag, use this first:

```bash
./.venv/bin/python scripts/seed_atlas.py --event us2000bmcg --force
# new v<N+1> under bumelerze-atlas/us2000bmcg/, old versions retained
```

**Any live-tracked event** — small driver around the same `force=True`:

```bash
./.venv/bin/python - <<'EOF'
from shake_service.worker import pipeline, usgs_products
from shake_service.worker.feed_watcher import FeedEvent, TriggerDecision
from shake_service.worker.state import WorkerState
from shake_service.worker.uploader import LocalOnlyUploader

STATE, PRODUCTS, EVENT_ID = "worker_state.json", "products", "us2000bmcg"

ws = WorkerState.load(STATE)
known = ws.events[EVENT_ID]  # KeyError = not tracked; see §3 instead
event = FeedEvent(
    external_id=known.external_id, source=known.source, mag=known.mag,
    lat=known.lat, lon=known.lon, depth_km=known.depth_km, place="",
    time_ms=known.origin_time_ms, updated_ms=known.last_feed_updated_ms,
)
result = pipeline.run_pipeline(
    TriggerDecision(kind="update", event=event, reason="manual recompute"),
    ws, products_root=PRODUCTS,
    uploader=LocalOnlyUploader(log_fn=print),
    usgs_products_fetcher=usgs_products.fetch_usgs_event_products,  # drop this line to skip USGS fetching
    force=True,
)
ws.save(STATE)
print("wrote version", result.version, "->", {k: str(v) for k, v in result.product_paths.items()})
EOF
```

Old versions are never deleted (D9 policy). The new version starts
`review_status: "automatic"` again — re-review it if you had reviewed the
old one (§3).

## 3. Flip review_status (mark a product scientist-reviewed)

```bash
./.venv/bin/python scripts/review_product.py \
    --products-root products --event-id us2000bmcg --version 2 \
    --reviewed-by peshawa --state-path worker_state.json
```

- Rewrites that version's `info.json` (`review_status: "reviewed"` +
  `reviewed_by`/`reviewed_at`) and records it in state's `reviews` index.
- Idempotent: re-running against an already-reviewed version is a no-op;
  add `--allow-re-review` only to deliberately overwrite reviewer/date.
- For Atlas products use `--products-root bumelerze-atlas` (and the atlas
  state file `bumelerze-atlas/worker_state.json` for `--state-path`).
- There is no "un-review" flag on purpose. If a reviewed product turns out
  wrong, recompute a new version (§2) — it starts `"automatic"` again.

## 4. Force a trigger for an event the feeds missed

When you know an earthquake happened (felt reports, local network, news)
but no product exists — take the best params you have and run the
pipeline directly. Use the LIVE state file so the event gets tracked and
a bml id allocated exactly as if the feeds had caught it:

```bash
./.venv/bin/python - <<'EOF'
import datetime as dt
from shake_service import event_id
from shake_service.worker import pipeline, usgs_products
from shake_service.worker.feed_watcher import FeedEvent, TriggerDecision
from shake_service.worker.state import WorkerState
from shake_service.worker.live_catalog import append_to_live_catalog
from shake_service.worker.uploader import LocalOnlyUploader

STATE, PRODUCTS = "worker_state.json", "products"

# ---- fill these in ------------------------------------------------------
EXTERNAL_ID = "manual-2026-08-14-halabja"   # any unique, stable "manual-..." id
ORIGIN_UTC  = dt.datetime(2026, 8, 14, 22, 28, 4, tzinfo=dt.timezone.utc)
MAG, LAT, LON, DEPTH_KM = 4.2, 35.1, 45.9, 10.0
# ------------------------------------------------------------------------

time_ms = int(ORIGIN_UTC.timestamp() * 1000)
event = FeedEvent(EXTERNAL_ID, "manual", MAG, LAT, LON, DEPTH_KM,
                  "manual trigger", time_ms, time_ms)

ws = WorkerState.load(STATE)
now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
bml = event_id.ensure_bumelerze_id(ws, event, now_iso=now_iso)
append_to_live_catalog("regional-catalog/live-catalog.jsonl", event,
                       bumelerze_id=bml, triggered=True, detected_at_iso=now_iso)
result = pipeline.run_pipeline(
    TriggerDecision(kind="new", event=event, reason="manual trigger (feeds missed it)"),
    ws, products_root=PRODUCTS, uploader=LocalOnlyUploader(log_fn=print),
)
ws.save(STATE)
print(bml, "-> version", result.version)
EOF
```

Notes:
- `source="manual"` keeps provenance honest (`data_used.trigger_source:
  "manual"`); no USGS products are fetched for a non-`usgs` source.
- If USGS later publishes the same quake, the worker's cross-provider
  dedup (16 s / 100 km / |ΔM| ≤ 1.5) will match it to this entry and
  record the USGS id as an alias rather than re-triggering — provided your
  origin time/location were inside those windows. If they weren't, you'll
  get a duplicate: see §5.

## 5. Edit canonical params for a significant event (state surgery)

The state file is plain JSON and the worker is its only writer. **Stop the
daemon first** (`Ctrl-C` / kill it), keep a backup, then edit:

```bash
cp worker_state.json worker_state.json.bak-$(date +%Y%m%d-%H%M%S)
python3 - <<'EOF'
import json
ws = json.load(open("worker_state.json"))
ev = ws["events"]["manual-2026-08-14-halabja"]
ev["mag"] = 4.6          # corrected params
ev["depth_km"] = 14.0
ev["params_hash"] = ""   # CRITICAL: blank hash = "current products don't
                         # match these params" -> next pipeline run
                         # recomputes instead of short-circuiting
json.dump(ws, open("worker_state.json", "w"), indent=2, sort_keys=True)
EOF
```

then recompute with the §2 "any live-tracked event" driver (it reads the
edited params back out of state; `force=True` is belt-and-braces on top of
the blanked hash), and restart the daemon.

Rules for surgery, in order of importance:
1. **Never edit `bumelerze_id` and never touch
   `meta.bumelerze_id_counters`.** Ids are immutable and counters only
   move forward; hand-editing either can mint duplicate ids later.
2. Don't rewrite `regional-catalog/live-catalog.jsonl` lines — it is an
   append-only first-detection log; your corrected params live in state
   and in the recomputed product.
3. `first_seen_at`, `reviews`, `provider_aliases` should survive your
   edit untouched.
4. If you must fix a WRONG association (two entries that are the same
   quake, or one entry mixing two quakes), prefer: delete the junk entry
   from `events`, keep the good one, note the dropped external id in
   `provider_aliases` of the survivor if it was a real provider id. The
   junk entry's products directory can stay on disk (harmless, versioned,
   honest history).

## 6. Where `compatibility.json` lives (and what it is)

`products/<event-id>/v<N>/compatibility.json` — written automatically at
compute time, but ONLY for versions where USGS also published a ShakeMap
grid for the same event (rare in-region; Zagros events are usually
DYFI-only at USGS). It contains our-grid-vs-USGS-grid stats + the D20
pass/fail verdict + engine/product versions. Per D21 it is EVIDENCE ONLY:
nothing in the pipeline acts on it — systematic corrections are your
decision, made from accumulated compatibility records, never auto-tuned.
Whether the latest version has one: `has_comparison`/`comparison_path` in
that event's state entry. Atlas events: same file, under
`bumelerze-atlas/<event-id>/v<N>/`.

## 7. Things that need no intervention (so you don't do it by accident)

- **Trigger policy** — any event in Iraq (`IRAQ_BBOX`) or whose
  magnitude-scaled footprint reaches the Kurdistan bbox triggers
  automatically, no magnitude floor (`shake_service/config.py` §6b,
  `feed_watcher.triggers_shakemap`). An event you expected a map for and
  didn't get one either fell outside that policy (check
  `regional-catalog/live-catalog.jsonl` — a `"triggered": false` line
  means it was detected but judged catalog-only) or was missed by all
  three feeds (then §4).
- **bml ids** — allocated automatically at first detection; products
  outside the live worker (Atlas seeds, validation runs) carrying
  `bumelerze_id: null` is expected, not a bug (`event_id.py`'s
  single-authority note).
- **Revisions** — magnitude/location/depth updates from any provider
  recompute automatically once they cross |ΔM| ≥ 0.1 / 5 km / 5 km.

## 8. Publishing products (SupabaseUploader: index + Atlas repo)

`SupabaseUploader` (`worker/uploader.py`) is TWO independent pieces, per an
owner architecture decision — Supabase never holds artifact bytes:

- **The Supabase INDEX** (`shakemap_products` rows — event reference,
  version, engine provenance, review status, bbox, a public URL). Needs
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set (`shake-service/
  .env.example`; NEVER the anon key — every write here bypasses RLS).
  Without both set, `build_uploader()` (what `scripts/run_worker.py` and
  `scripts/seed_atlas.py --upload-to-supabase` both call) silently falls
  back to the pre-existing `LocalOnlyUploader` — check the worker's own
  structured log for a `falling back to LocalOnlyUploader` line if an
  upload you expected didn't happen.
- **The Bumelerze Atlas artifact tree** (`AtlasRepoPublisher` — the actual
  `cont_mi.json`/`info.json`/opt-in `grid.json` files, written to a local
  directory: `BUMELERZE_ATLAS_PUBLISH_ROOT`, default `atlas-publish/` next
  to this package). This is a STAGING copy only — publishing it to the
  real, separately-hosted public Atlas repository/CDN is an operational
  step outside this worker (§8d).

### 8a. The live worker (going forward, no action needed once deployed)

Once the daemon (`scripts/run_worker.py --daemon`) runs with Supabase
credentials set, every future compute (`worker/pipeline.py`'s own upload
step) reaches both the index and the local Atlas staging tree
automatically — idempotent per `(event_id, producer, version,
product_type)` on the index side and per (event_key, version) on the
artifact side, so a daemon restart mid-cycle or a re-delivered feed poll
never creates a duplicate row or file. Nothing in this section is needed
for new events; it only applies to already-computed products.

### 8b. Backfilling the curated 11 (Bumelerze Atlas seed archive)

The Atlas SEED archive's own `bumelerze-atlas/worker_state.json` is a
SEPARATE state file from the live worker's — `seed_atlas.py` writes it,
`LocalOnlyUploader` by default. To also push the curated events through
the index + artifact publisher:

```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
# optional: export BUMELERZE_ATLAS_PUBLISH_ROOT=/path/to/atlas-publish
./.venv/bin/python scripts/seed_atlas.py --upload-to-supabase --force
# one event only:
./.venv/bin/python scripts/seed_atlas.py --event us2000bmcg --upload-to-supabase --force
```

`--force` is REQUIRED here, not optional: `pipeline.run_pipeline`'s
params-hash short circuit skips the uploader call entirely when an event's
catalog params are unchanged since the last local seed (§2's own note) —
without it, a plain re-run against the already-seeded 11 would report
`recomputed: false` for every event and upload nothing. `--force` produces
one new version per event (old local versions retained, D9 policy) with a
freshly-fetched USGS origin time/place (needed to resolve the event via
`upsert_event_from_client`, which the local-only path never needed) and
pushes it through the real uploader. This also means the FIRST backfill
publishes v(N+1), not the exact same version already sitting in
`bumelerze-atlas/` — expected, and harmless (both are the same computation
against the same USGS inputs; re-running is what proves this at all).

### 8c. Engine-fix → recompute → republish (the procedure the uploader exists for)

1. Ship the engine fix (a corrected GMPE/GMICE/conditioning constant, a new
   distance method, whatever the correction is) and bump whatever version
   string actually changed — `info.json`'s `"version"` block (`export.py`'s
   `build_info_product`) is what carries this into
   `shakemap_products.data_used["engine_version"]` on every future upload
   (`worker/uploader.py`'s provenance carry-through).
2. Identify affected products. Once live rows exist in `shakemap_products`,
   a plain query answers "which products came from the OLD engine build":
   ```sql
   select event_id, producer, version, product_type, storage_path
   from public.shakemap_products
   where data_used->'engine_version'->>'service_version' <> '<new version>'
      or data_used->'engine_version'->>'service_version' is null;
   ```
   (swap the JSON path for whichever field actually changed — `gsim_branches`/
   `ems_model`/`mmi_model`/`conditioning` are all in the same block.)
3. Recompute those events with `--force` (live-tracked events: §2's driver,
   with `uploader=build_uploader(log_fn=print)` instead of
   `LocalOnlyUploader`; Atlas events: §8b's command, `--event <id>` per
   event or omit `--event` for all 11) — every recompute is a NEW version,
   old ones retained, and the new version's index row AND artifact files
   carry the corrected `engine_version` stamp; the per-event and site-wide
   manifests in the Atlas staging tree are regenerated automatically
   (`AtlasRepoPublisher`'s own docstring).
4. Publish the refreshed Atlas staging tree (§8d) so the new artifact files
   are actually reachable at the URLs the index rows now point at. For the
   bundled Historical subset specifically, re-run
   `scripts/bundle_atlas_for_app.py` after step 3 so the shipped app bundle
   picks up the corrected version too. Live app reads from
   `shakemap_products` directly are a follow-up, app-side wave — this
   repo's own scope boundary for the uploader work.

### 8d. What the orchestrator still owns (not this worker's job)

This worker only ever writes `BUMELERZE_ATLAS_PUBLISH_ROOT` LOCALLY — it
never creates the external Bumelerze Atlas repository and never pushes to
it. Turning the local staging tree into the real, public, CDN-served
archive is an operational step: create the external repo/site once, then
sync `atlas-publish/`'s contents into it (a plain file copy/`rsync`/`git
add` — the tree is already exactly what the site should serve, including
its own `index.json`/`events/<key>/index.json` manifests) after each
publish run. Once that repository has a real public URL, set
`BUMELERZE_ATLAS_BASE_URL` so FUTURE uploads store real, resolvable URLs in
`shakemap_products.storage_path` — existing rows published before that
point keep their repo-relative paths until their event is recomputed (§8c)
or the index rows are backfilled with the new base URL prefix (a one-off
SQL `UPDATE`, not built as a script this wave since it is a single
operational action, not a repeated one).

## 9. The scheduled lane (GitHub Actions, non-urgent catch-up)

The worker "only runs when the owner's laptop is on" problem has a
two-lane fix. This section covers the NON-urgent lane, which exists today;
a dedicated always-on host for rapid response is future work that will
reuse the same entry points (`scripts/run_worker.py --once`,
`build_uploader()`) this lane already uses.

**What it is.** A GitHub Actions workflow — staged in this repo at
`shake-service/deploy/atlas-shake-worker.yml`, deployed by the orchestrator
to `.github/workflows/shake-worker.yml` **inside the separate
`Peshawa-LH/bumelerze-atlas` repository**, not this one (see
`shake-service/deploy/README.md` for exactly why and the deployment
command) — that runs `scripts/run_worker.py --once` on a schedule.

**What it does, in order:** checks the two required Supabase secrets are
present (fails loudly otherwise, see below) → checks out the Atlas repo
(itself) and a read-only, anonymous checkout of this app repo for
`shake-service/` → installs Python 3.11 + this package's pinned
dependencies (pip-cached; GDAL is the one line in the lockfile it
deliberately re-resolves against whatever system libgdal the runner
provides, not the exact pin — a genuine cross-machine ABI constraint, not
laziness; see the workflow file's own comment) → restores the previous
run's `worker_state.json`/`live-catalog.jsonl` from a GitHub Actions cache
→ optionally restores/fetches a cached Vs30 raster (see below) → runs ONE
full sweep (USGS `all_hour` poll + USGS/EMSC/GEOFON region sweeps,
identical decision logic to a locally-run `--once`/`--daemon`, unchanged)
→ saves the updated state back to the cache → commits and pushes any newly
published products straight into its own (the Atlas repo's) working tree,
using the automatic `GITHUB_TOKEN` (no configured push credential at all).

**What it covers:** periodic catch-up between manual/daemon runs, picking
up a missed feed update, and — its main real use — recomputation after an
engine fix or backfill (§8c/§8b's procedures work unchanged with this lane
as the runner). **What it explicitly does NOT cover:** rapid response.
GitHub's own documentation warns scheduled workflow runs can be delayed
under platform load and explicitly discourages very short cadences; this
workflow runs every **20 minutes** — double the worker's own existing
10-minute EMSC/GEOFON completeness-sweep cadence, chosen so that even one
skipped/delayed scheduled run still keeps the effective worst-case gap
close to the ~20-30 minute window this lane is meant to serve, without
being mistaken for (or competing with) the future always-on host's
rapid-response job.

**Triggering it manually:** the workflow also has a `workflow_dispatch`
trigger — from the Atlas repo's Actions tab, "Shake-service scheduled
worker" → "Run workflow", no inputs required. Useful right after an engine
fix, instead of waiting for the next scheduled tick.

**Secrets, and where they live.** `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
are created on the **`bumelerze-atlas`** repository's own Actions secrets
(not this repo's) — see `shake-service/deploy/README.md`'s table for exact
names/scopes. If either is absent, the workflow's own first step fails the
run immediately with `::error::...`, AND (defense in depth)
`scripts/run_worker.py --once --require-supabase` — the new CLI flag this
task added — would refuse to run even if that shell check were ever
bypassed: it exits 2 with a clear message instead of letting
`build_uploader()` silently fall back to `LocalOnlyUploader`, which would
otherwise compute real products on an ephemeral runner and then discard
them when the job ends — a scheduled job that silently no-ops is strictly
worse than one that fails and gets noticed. `--require-supabase` is
opt-in — manual/local runs (`OPERATIONS.md`'s whole normal use case) never
pass it, so `build_uploader()`'s existing graceful local-only fallback is
completely unchanged for a human running this by hand.

**Vs30: the honest-degradation decision.** The engine's real Vs30
site-amplification raster (`shake_service/vs30.py`'s `RasterVs30`, backed
by a ~610 MB file, `shake_service/config.py`'s `DEFAULT_VS30_RASTER_PATH` —
an absolute path that exists only on Peshawa's own machine today) will
never be present on a fresh GitHub Actions runner unless this lane fetches
its own copy. Three options were on the table: (a) fetch it from durable
storage if a URL is configured, caching it between runs; (b) refuse to
compute at all when it's unavailable; (c) compute anyway with the
already-honest rock-760 fallback, clearly labeled as degraded. **Chosen:
(a) with automatic, already-implemented (c) as the fallback — never (b).**
Reasoning: (b) would gut this lane's actual purpose — most triggering
events genuinely need a map, and refusing to compute would turn "periodic
catch-up / backfill" into "periodic no-op" for the common case. (a) is
supported as an opt-in: set the `VS30_RASTER_URL` secret (see
`shake-service/deploy/README.md`) to any HTTPS location the workflow can
`curl`, and it is fetched once and cached (`actions/cache`, keyed
`vs30-raster-v1`) for every run after. When that secret is unset — the
default, until the owner uploads the raster somewhere fetchable — the
engine's OWN existing, already-built graceful fallback
(`shake_service.vs30.default_sampler()`) takes over automatically: it logs
a loud, structured line and falls back to `UniformRockVs30` (rock-760
uniform site conditions). Critically, **this was never allowed to be
silent or indistinguishable from a full-quality product**: every product's
`info.json` already carried a top-level `vs30.vs30_source` field
(`"raster"` | `"rock-default"`) before this task started — but that field
lived ONLY inside the artifact file, invisible to anyone querying the fast
`shakemap_products` INDEX table without fetching and parsing every
artifact. This task closed that gap
(`shake_service/worker/uploader.py`'s new `_vs30_from_info`): the same
`vs30` block now also rides along in the INDEX row's `data_used` jsonb, so
"is this product full-quality or degraded" is answerable with a plain
Supabase query, not just by opening the artifact — a degraded product must
never be indistinguishable from a full one at ANY layer a consumer might
reasonably query.

**State persistence and the single-allocation-authority risk.** GitHub
Actions runners are ephemeral — the workflow persists `worker_state.json`
(and `live-catalog.jsonl`) between runs via `actions/cache`, keyed on
`github.run_id` with a prefix `restore-keys` fallback (the standard pattern
for a cache that must be updated every run, since `actions/cache` cannot
overwrite an existing key). As long as that cache stays warm — which a
20-minute cadence keeps true in practice, well under GitHub's ~7-day
unused-cache eviction window — this workflow's cache IS a single,
continuous counter space, safe under `event_id.py`'s "single allocation
authority" rule. **The risk is a SECOND writer, not this one alone:**
running `scripts/run_worker.py --daemon` locally against a *different*
`worker_state.json` at the same time as this workflow is enabled would
create exactly the "two independent counter files... collide" scenario
`event_id.py`'s own docstring warns about (a real event could get two
different bml ids from the two state files, or two different events could
get the same id). Until the documented FUTURE handover lands (allocation
moves to a Postgres sequence behind an edge function, `event_id.py`'s own
"FUTURE handover" note), **only one process should be minting live bml ids
at a time** — once this scheduled lane is enabled, treat it as that one
process for routine live triggering, and use the manual driver-script
procedures in §2/§4 (which operate on a specific, already-known state file
you control) rather than a concurrently-running local `--daemon`.

**Idempotency, proven, not assumed.** Re-running the exact same sweep input
twice must never duplicate a row or double-publish a file. This already
follows from properties this repo's own test suite pins independently, not
anything new: `pipeline.run_pipeline`'s params-hash short circuit (no
recompute, no re-upload, for an unchanged event); `SupabaseUploader`'s
`shakemap_products` upsert on its own `(event_id, producer, version,
product_type)` unique constraint (a replayed row merges, never
duplicates); and `AtlasRepoPublisher.publish` overwriting the same
`(event_key, version)` path with the same bytes on a retry. This task's own
`run_once` robustness fix (see the workflow file's own comment, and
`tests/test_run_worker.py`'s new feed-failure-tolerance tests) closes the
one gap that mattered for THIS lane specifically: `run_once` used to let a
single feed's network exception abort the whole cycle before its own final
state save, silently discarding whatever earlier feed legs in the same
cycle had already processed — harmless for a human re-running the script
by hand, but a real state-loss risk for an unattended job hitting the open
internet four times a cycle. It now saves state in a `finally`, tolerating
each feed leg's own `requests.RequestException` independently (mirroring
`run_daemon`'s pre-existing policy) while still letting a genuine
non-network bug fail the run loudly.

**What this lane never does:** trigger a compute for an event outside the
existing trigger policy (§7's bbox/magnitude gates are untouched — nothing
about running in CI changes `feed_watcher.triggers_shakemap`), or push
anything to `bumelerze-v26` (the app repo) — the workflow's read-only,
anonymous, `persist-credentials: false` checkout of that repo cannot push
to it even by accident.

