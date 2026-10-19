# ingest-events

Supabase Edge Function (Deno) that polls the four source channels (USGS,
EMSC, GEOFON, ISC) server-side, dedups across them, and writes one
`event_source_records` row per agency that saw an event — the corroboration
model `events`/`event_source_records` (migration 0002) was designed for.
`pg_cron` calls it per channel (migration 0024), and every run writes a
`feed_heartbeats` row.

## Why this shape

- **One poller, not one-per-phone.** Today every client polls USGS, EMSC and
  GEOFON directly every 60s (`src/features/events/config.ts`,
  `EVENTS_REFETCH_INTERVAL_MS`) — ~180,000 requests/hour to public agencies
  at 1,000 users. This function does the same work with three
  requests/minute plus one daily bulletin sweep, from one server. **The
  app's feed still fetches the agencies directly**, by design: it is the
  path that keeps working when this backend is unreachable (a Supabase outage
  must not leave people without earthquake data during an earthquake). The
  app reads `public.events_with_sources` (migration 0023) for the agencies
  that saw each event on screen (`src/features/events/source-corroboration.ts`)
  and to open an event by its `bml` id (`src/features/events/supabase-event.ts`).
- **Corroboration is written, not discarded.** The client's own
  `src/features/events/merge.ts` keeps only the highest-authority record per
  physical event and throws the rest away. This function writes one row per
  agency instead, so the app can show which agencies saw an event ("ISN,
  EMSC, USGS") from `public.events_with_sources`.
- **Field-level derivation, not per-source.** D4/D23's USGS > EMSC > GEOFON
  order is backwards for this region (USGS authors ~3% of regional events,
  measured). `derivation.ts` is the ONE place the new preference order lives
  (PROVISIONAL, pending owner sign-off): location/depth/time prefer the
  nearest authoritative network
  (ISN/ISK/TEH/THR/AFAD), then ISC, then IDC, then NEIC; magnitude prefers a
  reviewed Mw where one exists, else the local ML, never silently converting
  between types.
- **Business logic in TypeScript, reuse in Postgres.** Matching
  (`matching.ts`) and derivation (`derivation.ts`) are plain, dependency-free
  pure functions — directly `require`-able by this repo's Jest suite despite
  the rest of this folder running on Deno (same split
  `aggregate-felt-cells` already established: `db.ts`/adapters do I/O,
  everything else is pure). The actual "find-or-create the canonical event"
  step reuses the EXISTING `upsert_event_from_client` RPC (migrations
  0011/0012) rather than a new SQL function — see `db.ts`'s header comment
  for why, and for the accepted, documented race that split implies.

## Channel registry

`channels.ts` — a plain TypeScript config module (`CHANNELS: Record<ChannelId,
ChannelDefinition>`), not a database table. See that file's header comment
for the full "why a table wasn't chosen" reasoning; in short, every other
engineering-owned tunable in this codebase already lives in a well-commented
code constant, migration-reviewed and git-blamed, and adding a channel always
needs a new adapter file regardless of where the cadence config lives, so a
DB table would save no real effort while adding an RLS decision for zero
client benefit.

| Channel | Provider tag | Cadence | Adapter |
| ------- | ------------ | ------- | ------- |
| EMSC | `emsc` | 60s | `emsc-adapter.ts` |
| USGS / NEIC | `usgs` | 60s | `usgs-adapter.ts` |
| GEOFON / GFZ | `geofon` | 5 min | `geofon-adapter.ts` (shares `fdsn-text-adapter.ts`) |
| ISC bulletin | `isc` | daily | `isc-adapter.ts` (shares `fdsn-text-adapter.ts`) |

Two RESERVED provider values already exist in `event_source_records`'s
CHECK constraint without needing a further migration (migration 0023): `kur`
(a future direct Kurdistan/Iraq national feed) and `bumelerze-crowd` (written
directly by `detect_possible_events`, migration 0012 — never by this
function). Adding channel 5 means: one adapter file, one `CHANNELS` entry,
one `cron.schedule(...)` call in a migration — this file's callers
(`index.ts`) never change.

## Dedup: ported, not imported

`matching.ts`'s `isSameEarthquake`/`findMatchingEvent` are a PORT of
`src/features/events/merge.ts`'s `isSameEarthquake` and
`config.ts`'s `DEDUP_MAX_TIME_DELTA_MS` / `DEDUP_MAX_DISTANCE_KM` /
`DEDUP_MAX_MAG_DELTA` — not a shared import. The live rule is **16 s / 50 km /
1.5 magnitude** (50 km since migration 0029, in the client and in SQL).
`matching.ts` still declares 100 km: its matching functions
(`isSameEarthquake`, `findMatchingEvent`) run only in the tests, and the
deployed function imports only `sourceRecordChanged` from that file, which
does not use the radius.
Deno's module resolution requires explicit file extensions on relative
imports; the client's own import graph doesn't carry them (Metro fills them
in). This is the SAME choice the existing `upsert_event_from_client`/
`detect_possible_events` SQL functions (migrations 0011/0012) already made
for the identical thresholds, each re-declared as literal SQL constants with
a "keep in sync" comment — this module is a third copy of the same rule, not
new debt. The actual PRODUCTION dedup decision is made by `PostgreSQL`
(`upsert_event_from_client`); `matching.ts`'s copy
exists to (a) build the in-memory test fixtures that prove the *intended*
dedup behavior (`__tests__/ingest-channel.test.ts`'s three-source test), and
(b) drive the "did this record's fields actually change since last poll"
check (`sourceRecordChanged`) used on every re-fetch, which the SQL RPC has
no equivalent of (it only ever handles first-sight).

## What the app reads

`public.events_with_sources` (migration 0023) — one row per event, its
canonical per-field values, `corroboration_count`, and a `sources` jsonb
array of `{ provider, authorAgency, reviewStatus }`. No `raw_payload` (kept
cheap for a list screen); the full per-record payload is a direct,
now-public read against `event_source_records` (migration 0023 also opens
anonymous SELECT there, `review_status <> 'deleted'`) for an event-detail
drill-down. RLS on both allows anonymous read only — no client write path
exists.

## Idempotency

Three independent layers:

1. **`event_source_records`'s own unique index** on `(provider,
   provider_event_id)` — a true duplicate INSERT for the same provider
   sighting is structurally impossible.
2. **`sourceRecordChanged` skip-if-unchanged** (`matching.ts`) — a re-fetch
   of an unrevised record writes nothing. Deliberately compares parsed
   fields directly rather than trusting `provider_updated_at` alone: GEOFON
   and ISC (FDSN text) carry no real revision timestamp, so a
   timestamp-only compare would miss a genuine revision to either.
3. **`upsert_event_from_client`'s own existing idempotent retry
   short-circuit** (migrations 0011/0012) — already proven by that
   function's own tests/usage in the felt-report flow.

Replaying the exact same channel fetch twice produces the exact same
database state: no duplicate event, no duplicate source record.
`__tests__/ingest-channel.test.ts` proves this directly against an in-memory
`Db` fake.

## `raw_payload` growth — measured, not solved

Verified live 2026-08-27 (byte length of one real feature/row, JSON-encoded):
USGS ~750-1000 bytes, EMSC ~500-600 bytes, GEOFON/ISC (reformatted from the
pipe-delimited text row into a JSON object) ~300-400 bytes.

Row-count growth is dominated by the ISC channel, since it alone reaches
down to ML 0.4 (488 ISN-authored events alone since 2024, plus
SLUB/ISK/TEH/AFAD/IDC over the same window) — roughly
1,500-2,500 NEW `event_source_records` rows/year across all four channels
combined is a reasonable estimate from that data, at ~0.3-1KB `raw_payload`
each. **That's on the order of 1.5-2.5 MB/year** — comfortably inside
Supabase's free-tier 500MB for years, even before any cleanup. The
idempotent skip-if-unchanged write path (above) means re-polling an
unchanged record never inflates this further; growth is purely a function of
genuinely NEW provider sightings.

**Not built yet:** once real volume is measured on the live project, apply
the age-out planned for `events` generally (move rows older than ~24 months
to the Atlas archive tier) — specifically, null out `raw_payload` (keep the
tiny `parsed_*` columns, which carry all the provenance that actually
matters) for source records belonging to events that have aged out, rather
than inventing a separate retention policy for this one column.

## Request / response

```
POST /functions/v1/ingest-events
{ "channel": "emsc" | "usgs" | "geofon" | "isc" }
```

Success: `{ "data": { "requestId", "summary": ChannelIngestSummary } }`.
Failure: `{ "error": { "code", "message", "requestId", "details"? } }` — same
standardized envelope as `aggregate-felt-cells`. A whole-channel failure
(feed unreachable after `http.ts`'s one bounded retry, malformed top-level
payload) returns `502 channel_fetch_failed` and touches no database state;
the next scheduled cron tick for that channel is the retry (see `http.ts`'s
own header comment for why this function does not itself build a longer
backoff loop — "be polite to the agencies").

## Politeness / retry policy

One HTTP request per channel per invocation (never more than one outbound
request per tick); `http.ts`'s `fetchTextWithRetry`/`fetchJsonWithRetry` add
exactly ONE bounded retry after a short delay, then give up — deliberately
not an exponential-backoff state machine, since each channel's own cron
cadence (60s/5min/1 day) already IS the backoff for a channel that's down.

## `bumelerze_id`

Events this function creates get their `bml` id from
`upsert_event_from_client`, which allocates one for every new agency event
(migrations 0025 and 0026); this function does not allocate ids itself.

## What's not here

- **Channel 5 (direct Kurdistan/Iraq feed) and IDC-direct** — both open
  questions; `kur` is schema-ready (migration 0023) but has no adapter.
- **A per-channel fetch cursor / `updatedafter` optimization** for the ISC
  channel's wide, largely-unchanging daily re-fetch window — see
  `channels.ts`'s `ISC_LOOKBACK_DAYS` comment for the concrete TODO.
