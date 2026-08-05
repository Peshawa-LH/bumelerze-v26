# Bumelerze — Supabase schema v0

Phase 1 skeleton schema. Pure SQL migrations, no Supabase project has been
created or linked yet — see "Local dev / project linking" below.

**Sources this maps to** (read these before changing anything here):
`docs/research/spec-v1.md` §5, `docs/research/felt-report-science-v1.md`
Parts 3 + 5, `docs/research/event-pipeline-design.md`,
`docs/decisions.md` D7, D8, D9, D11, D13, D15, D18, D20.

## Migration files

| File | Contents |
|---|---|
| `0001_extensions_and_helpers.sql` | `pgcrypto`, `postgis` (for `ST_GeoHash` only — no geometry columns in v0), shared `set_updated_at()` trigger function. |
| `0002_events.sql` | `events`, `event_source_records`, `event_merges` — the dedup/merge identity model (event-pipeline-design.md §1–2). |
| `0003_felt_reports.sql` | `felt_reports` (tier 1), `felt_report_details` (tier 2), `felt_photos`, `felt_comments`. |
| `0004_felt_cells.sql` | `felt_cells` (CDI + IMS-25 aggregates) + the `felt_cells_public` view. |
| `0005_notifications_and_telemetry.sql` | `notification_subscriptions`, `telemetry_pings`. |
| `0006_shakemap_products.sql` | `shakemap_products` (D9 product contract). |

**Naming caveat:** these use plain `NNNN_name.sql` numbering as requested.
The Supabase CLI conventionally expects timestamp-prefixed filenames
(`YYYYMMDDHHMMSS_name.sql`) to track migration history. Before the first
`supabase migration up` / `supabase db push`, rename these six files with
real timestamps (keep their relative order) — a five-minute mechanical
step, not a schema change.

## Table list (columns per table)

| Table | Columns | Purpose |
|---|---|---|
| `events` | 18 | Canonical internal earthquake events. |
| `event_source_records` | 17 | One row per provider record; raw + parsed; provenance source of truth. |
| `event_merges` | 6 | Audit log for dedup merges. |
| `felt_reports` | 11 | Tier-1 felt reports (one cartoon pick each). |
| `felt_report_details` | 15 | Tier-2 optional follow-up (CDI/EMS question set + damage). |
| `felt_photos` | 7 | Moderated photo attachments. |
| `felt_comments` | 9 | Moderated comment stream. |
| `felt_cells` | 15 | CDI + IMS-25 aggregates per (event, geohash, version). |
| `notification_subscriptions` | 14 | Push token + near-me/HomeBase alert config. |
| `telemetry_pings` | 4 | Anonymous app-launch pings. |
| `shakemap_products` | 8 | ShakeMap product contract (USGS or bumelerze-shake-service). |
| `felt_cells_public` (view) | 8 | Public-safe read surface over `felt_cells`. |

## Design choices (brief)

- **Supabase-only, no extra infra.** Everything here is plain Postgres DDL +
  RLS; ingestion/fanout will be Edge Functions + `pg_cron` (not built in this
  pass — this PR is schema/RLS only, matching what was asked). No Redis,
  no separate queue: `felt_reports.created_at`/`submitted_at` and
  `event_source_records.fetched_at`/`provider_updated_at` do the job that a
  message queue would elsewhere.
- **RLS on every table, in the same migration as its schema.** No table is
  ever created RLS-off, even transiently, per the checklist.
- **Two different "anonymous" identity mechanisms, used deliberately:**
  - `felt_reports`/`felt_report_details`/`felt_photos`/`felt_comments`/
    `telemetry_pings` use a **client-generated `device_id` string**, checked
    for presence only. This needs zero network round-trip to write (works
    fully offline, per PROJECT.md), matching D8's "must not require signup."
    **What this can't do:** RLS cannot prove a given `device_id` value
    actually belongs to the calling client — anyone with the anon key could
    write a row claiming any `device_id`. That's an accepted v0 limitation;
    real abuse mitigation (rate limiting, spam scoring) belongs in the
    ingestion/moderation Edge Functions, not in RLS, and is explicitly
    deferred (see below).
  - `notification_subscriptions` instead keys on **Supabase Anonymous Auth**
    (`supabase.auth.signInAnonymously()`), because "users read/update only
    their own subscriptions" is a real per-row security property (not just a
    write-once event log), and only a JWT-backed `auth.uid()` lets Postgres
    RLS actually enforce that. This is still zero-signup — anonymous auth
    issues a session with no email/password — but it does require one
    network call before push registration, unlike felt reports. **The Expo
    app needs to call `signInAnonymously()` once per install before writing
    to this table** — flagging for whoever wires up the client, since this
    schema pass doesn't touch app code.
- **`events.merged_into` instead of deleting merged-away rows.** Deleting an
  event on merge would orphan or cascade-delete any `felt_reports`/
  `shakemap_products` still pointing at it. Keeping the row and flagging it
  `merged_into = <survivor>` preserves every foreign key and gives the app a
  cheap way to redirect ("this event was merged into X") if a stale link is
  ever followed. Feed queries filter `where merged_into is null`
  (`idx_events_region_feed`).
- **`felt_cells_public` view, not a public policy on `felt_cells` itself.**
  The raw table holds sub-threshold cells (< 3 reports) and the IMS-25/EMS
  fields, which felt-report-science-v1.md §3.4.5 says must stay expert/beta-
  only in v1. Gating through a view (which reads under the table-owner role,
  bypassing the base table's RLS block) keeps "the threshold lives in the
  DB, not the client" literally true, and is also what quietly keeps
  `ems_int`/`ems_range` out of the public surface without needing column-
  level `GRANT`s.
- **`ST_GeoHash` via PostGIS, no geometry columns.** The only spatial need in
  v0 is deriving a geohash string from lat/lon at write time
  (`felt_reports.geohash_p5`, `notification_subscriptions.*_geohash`) as a
  `GENERATED ALWAYS AS ... STORED` column, so the client never computes or
  sends it and the aggregation/fanout jobs never recompute it. No GiST
  indexes or `geography` columns are introduced — `events` bbox filtering
  uses plain `lat`/`lon` comparisons, which is enough at the region's scale
  (event-pipeline-design.md §4 bbox is ~500km × 600km, not global).
- **Text-enum answers on `felt_report_details`, not pre-computed CDI/EMS
  values.** Storing `motion_answer = 'strong'` rather than `motion_answer =
  4` means the DYFI-form verification pass and the Phase-2 tier-1/tier-2
  correction fit (D18 R1/R2/R4/R9) can re-derive index values from raw
  answers without touching stored data or re-surveying anyone — the whole
  point of D13 "collect, store, use."
- **`service_role` bypass is implicit, not policy-based.** Supabase's
  `service_role` Postgres role has `BYPASSRLS`; every ingestion/fanout/
  moderation write path uses it. No table has an explicit "service role can
  do X" policy — that would be redundant and easy to get subtly wrong.

## What v0 deliberately defers

- **Real accounts.** `felt_reports.user_id` / `felt_comments.user_id` are
  present and FK'd to `auth.users` (D8: "present so future optional
  accounts... attach without a migration"), but nothing in v0 populates or
  reads them. Citizen-seismologist profiles are explicitly future (D11).
- **House vulnerability reports.** Not in this schema at all — recorded as
  future scope in spec-v1 §8, no columns reserved for it (resisting
  schema bloat until the feature is actually built).
- **Rate limiting on anonymous inserts.** RLS only checks presence/shape of
  `device_id`, not frequency. Real throttling (per-device, per-IP, or
  per-geohash burst detection) belongs in an ingestion Edge Function with
  its own state, not in table RLS — out of scope for this schema pass.
- **Storage buckets/policies for `felt_photos.storage_path`.** This
  migration set only stores the *path string*; creating the Supabase
  Storage bucket and its own access policies (separate from Postgres RLS)
  is follow-up work once the upload flow is built.
- **`pg_cron` schedules and the Edge Functions themselves** (ingestion,
  fanout, felt-cell recompute, moderation pre-screen). This pass is schema
  + RLS only, as scoped.
- **DELETE policies** on every anon-writable table (felt_reports and
  friends, notification_subscriptions). Nothing in v1 needs a client-
  initiated delete; add if/when account deletion or a "retract my report"
  feature is built.

## Local dev / project linking

No Supabase project has been created or linked — that's Peshawa's Supabase
account, needed only when someone actually runs `supabase start` /
`supabase link` / `supabase db push`, not to author or review these
migrations. To try them locally once the CLI is installed:

```
supabase start                # spins up local Postgres + auth + storage
supabase migration up         # applies these files in order (after the timestamp rename above)
supabase gen types typescript --local > src/types/supabase.ts   # regenerate app types — do this after every migration
```

Test RLS locally as both `anon` and `authenticated` (and an anonymous-auth
session for `notification_subscriptions`) before trusting any policy above —
per the project's own quality checklist, this has not been run yet; these
files are unexecuted SQL, reviewed by inspection only.

## Ambiguities hit while authoring this (flagging for review, not resolving silently)

1. **`event_source_records` "never deleted, only superseded" vs. the dedup
   algorithm's "update that source record."** event-pipeline-design.md §1
   says records are never deleted; §2 step 1 says a re-fetch of the same
   `(provider, provider_event_id)` **updates** the existing row. I
   implemented the latter literally (`UNIQUE (provider, provider_event_id)`,
   updated in place via `updated_at` trigger) — no row-versioning/history
   table for source records themselves. If "superseded" was meant to imply
   keeping every historical raw payload as its own row (not just the
   current `raw_payload` JSONB), that's a different design (an append-only
   `event_source_record_revisions` table) and wasn't built — flagging
   rather than guessing further.
2. **`felt_cells` "public SELECT" vs. the `felt_cells_public` view
   requirement.** The RLS deliverable groups `felt_cells` with
   `events`/`shakemap_products` under "public SELECT," but also asks for a
   `felt_cells_public` view enforcing the ≥3-report threshold — and
   felt-report-science-v1.md §3.4.5 says EMS/IMS fields must stay
   expert/beta-only. Direct public SELECT on the raw table would leak both
   sub-threshold cells and EMS values, defeating the view's purpose. I
   resolved this in favor of the more specific, more recent science-pack
   requirement: `felt_cells` itself has **no** direct anon/authenticated
   SELECT policy; all public reads go through `felt_cells_public`. Worth a
   second look if "public SELECT on felt_cells" was meant literally.
3. **`event_merges` column set** wasn't specified beyond "audit log per §2."
   Kept minimal (which two events, why, when, by whom) rather than adding
   derived counts (records/reports moved) that can be queried on demand —
   consistent with the schema-minimalism instruction, but a judgment call.
4. **`notification_subscriptions` identity column** wasn't named in the
   deliverable list (only "device push token" + the two contexts), but the
   RLS deliverable requires per-row ownership. I added `user_id uuid
   references auth.users` backed by Supabase Anonymous Auth (see Design
   choices above) rather than reusing `felt_reports.device_id`, since only
   an authenticated identity can be enforced by RLS. This is a real design
   decision, not a stub — worth confirming it's the intended shape before
   the Expo app's notification-settings screen is wired to it.
