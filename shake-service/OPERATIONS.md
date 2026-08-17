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
