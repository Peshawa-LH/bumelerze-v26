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
