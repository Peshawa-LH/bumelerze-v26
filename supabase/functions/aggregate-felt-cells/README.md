# aggregate-felt-cells

Supabase Edge Function (Deno) that recomputes `felt_cells` rows — the CDI
aggregates the felt-map (`src/features/feltmap/`, reading
`felt_cells_public`) displays — from `felt_reports`/`felt_report_details`.

## Why this shape

- **The CDI math is not reimplemented here.** `felt-aggregation/` in this
  folder is a verbatim, hand-synced copy of `src/lib/felt-aggregation/`
  (the RN app's own pure-TS CDI library) — Deno can't resolve the app's
  `@/features/felt/types` path alias, so the source lib can't be imported
  unchanged; see `felt-aggregation/answer-types.ts`'s doc comment for the
  full vendoring story. `src/lib/felt-aggregation/__tests__/
  vendored-sync.test.ts` feeds golden fixtures through BOTH copies and
  asserts identical output, so a drift between them fails a jest test
  rather than silently shipping a different number on the map than the
  science pack specifies.
- **This function's own code (`db.ts`, `aggregate-event.ts`,
  `cell-extras.ts`, `index.ts`) is the "caller" layer the source lib's
  README describes**: resolving reports to (event, geohash) cells,
  triggering the p6 city-refinement pass, computing the two JSONB columns
  the CDI module deliberately doesn't own (`damage_dist`, `ground_effects`
  — plain frequency counts, no CDI/EMS weighting), and the idempotent
  version-write path.
- **Minimal-ops, HTTP-invoked.** No queue, no dedicated scheduler process —
  just a POST endpoint. Wiring an actual trigger (a Database Webhook on
  `felt_reports`/`felt_report_details` INSERT, or a `pg_cron` schedule
  calling sweep mode) is one line of Supabase config once a project exists
  to point it at; left to whoever operates the live project (see
  `index.ts`'s top comment).

## Request / response

```
POST /functions/v1/aggregate-felt-cells
{ "eventId": "<uuid>" }              -- recompute one event now
{ "sinceHours": 48 }                 -- sweep events w/ reports in 48h (default 24)
{}                                    -- sweep, default 24h lookback
```

Success: `{ "data": { "requestId", "results": [{ eventId, debounced, cellsComputed, cellsWritten, cellsUnchanged }] } }`.
Failure: `{ "error": { "code", "message", "requestId", "details"? } }` (zod
validation errors land here with `code: "invalid_request"`).

## Idempotency

Two independent mechanisms, both required by the wave brief ("idempotent
per event"):

1. **>=60s debounce** (felt-report-science-v1.md §3.2 step 5) —
   `aggregate-event.ts`'s `isDebounced`: an event whose latest stored cell
   is younger than 60s is skipped entirely for this invocation.
2. **Skip-if-unchanged write** — `cellRowUnchanged` compares a freshly
   computed cell against the latest stored version (ignoring `version`/
   `computed_at`) and only inserts a new version row when the content
   actually differs. Replaying the exact same underlying report data —
   whether a retried request or a sweep re-selecting an event nothing new
   happened to — writes nothing, so `felt_cells`'s version history only
   grows when a recompute genuinely changed something.

## What's NOT here

Same boundary as `src/lib/felt-aggregation/README.md`'s "What is
deliberately NOT here": the EMS-98/IMS-25 diagnostic path (`ems_int`,
`ems_range`, `ems_method` — always written `null`/omitted by this
function), the Bumelerze-specific cartoon-correction table, and the
report-to-event association job (this function only touches reports that
already have `event_id` set).
