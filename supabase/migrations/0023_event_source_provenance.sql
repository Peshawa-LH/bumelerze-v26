-- 0023: per-agency source provenance for the server-side multi-source
-- ingester (source-and-ingestion-plan.md PART I, "the channel register").
--
-- Context: `events` / `event_source_records` (migration 0002) already model
-- exactly the corroboration shape the design calls for — per-field source
-- attribution on `events` (`origin_time_source_id`/`location_source_id`/
-- `depth_source_id`/`magnitude_source_id`), one row per provider sighting on
-- `event_source_records` — but nothing has ever fed it systematically: on
-- the live project, `event_source_records` carries exactly one row per
-- event, never two, because only the felt-report registration RPC
-- (`upsert_event_from_client`, 0011/0012) has ever written it. This
-- migration widens the schema by the SMALLEST amount that lets a real
-- multi-channel ingester (supabase/functions/ingest-events/) start writing
-- one row per agency that actually saw an event, and lets the app read the
-- result cheaply. It does NOT add a new table — `events`/
-- `event_source_records`/`event_merges` already have the shape; this is
-- additive columns + a check-constraint widening + RLS + one read view.
--
-- Verified live against real feeds while designing this migration
-- (2026-08-27, see PR description / ingest-events README for the full
-- transcripts): a single ISC bulletin row can carry TWO DIFFERENT
-- attributions for the SAME row — `Author=AFAD` (who located it) vs.
-- `MagAuthor=ISK` (who magnitude-reviewed it), e.g. ISC event 643726562,
-- 2024-01-01, Turkey-Iran border. That is exactly the "field-level
-- derivation, not per-source" case source-and-ingestion-plan.md §5.1 calls
-- out — hence TWO new columns below, not one.

-- ---------------------------------------------------------------------------
-- 1. New columns on event_source_records: WHO actually authored the
-- location/time/depth vs. WHO authored the magnitude, independent of which
-- catalog (provider) we polled to get the record. USGS/EMSC only ever
-- expose a single attribution field (USGS `properties.net`, EMSC
-- `properties.auth`) — the ingester's adapters set both columns to that one
-- value for those two providers. GEOFON/ISC (FDSN WS-EVENT text) expose
-- `Author` and `MagAuthor` as genuinely separate columns; the shared
-- `fdsn-text-adapter.ts` reads them into these two columns as-is (falling
-- back to `Contributor` when `Author` is blank, GEOFON's own convention for
-- its self-catalogued automatic solutions).
-- ---------------------------------------------------------------------------
alter table public.event_source_records
  add column author_agency text,
  add column magnitude_author text;

comment on column public.event_source_records.author_agency is
  'Agency that authored this record''s ORIGIN (location/time/depth) — e.g. "ISN", "AFAD", "NEIC" — independent of `provider` (the catalog polled to get this row). NULL when the source feed does not expose one. Populated by supabase/functions/ingest-events; drives public.location_authority_rank in the ingester''s derivation.ts (see that module''s header for the single, science-reviewable preference order — NOT duplicated in SQL, migration 0023).';
comment on column public.event_source_records.magnitude_author is
  'Agency that authored this record''s MAGNITUDE value — usually equal to author_agency, but genuinely differs on ISC bulletin rows (verified live, see this migration''s header comment). NULL when the source feed does not expose one, or the record carries no magnitude at all. Drives public.magnitude_authority_rank''s preference order in ingest-events/derivation.ts.';

-- ---------------------------------------------------------------------------
-- 2. Widen the provider allow-list: 'isc' is a genuinely new channel (the
-- daily ISC bulletin sweep, source-and-ingestion-plan.md §5 channel 4);
-- 'kur' is added NOW, UNUSED, so channel 5 (a direct Kurdistan/Iraq
-- national feed, "reserved" per §5) is representable the day it exists
-- without a second migration — exactly the wave brief's "two reserved
-- slots... representable without schema change" requirement. Not a new
-- table, not a new enum type: this CHECK is the provider allow-list's one
-- place, same escape-hatch philosophy as 0002's own 'other' and 0012's
-- 'bumelerze-crowd' addition (NOTE: the live schema already spells the crowd
-- detector's provider tag with a HYPHEN, 'bumelerze-crowd' — 0012's own SQL,
-- not the underscore form some later docs use; this migration keeps the
-- hyphen since changing it would orphan every already-ingested crowd-sourced
-- event's provider tag).
--
-- Constraint name per 0012's own note: Postgres auto-names an unnamed inline
-- CHECK `<table>_<column>_check`, and 0012 already re-created it under the
-- EXPLICIT name `event_source_records_provider_check` — so that is the name
-- being dropped here, not a guess. If this DROP fails on apply, the
-- orchestrator should check `information_schema.check_constraints` for the
-- live name before re-running (identical caveat to 0012's own).
-- ---------------------------------------------------------------------------
alter table public.event_source_records
  drop constraint event_source_records_provider_check;
alter table public.event_source_records
  add constraint event_source_records_provider_check
    check (provider in (
      'usgs', 'emsc', 'geofon', 'afad', 'irsc', 'iscgem', 'manual',
      'bumelerze-crowd', 'other',
      'isc', -- new: daily ISC bulletin sweep (channel 4)
      'kur'  -- reserved: direct Kurdistan/Iraq national feed (channel 5), not yet built
    ));

-- ---------------------------------------------------------------------------
-- 3. RLS: event_source_records becomes a genuine public read surface, not
-- just internal ingestion machinery (0002's original framing) — the wave
-- brief is explicit: "RLS must allow anonymous read of events and their
-- source records (they are public agency data)". `review_status <>
-- 'deleted'` mirrors every other "hide superseded rows" filter in this
-- schema (e.g. felt_cells_public's own display threshold) — a source
-- record an operator has manually flagged 'deleted' (bad parse, agency
-- retraction) stops being visible to the app the moment it's flagged,
-- without needing a DELETE (this table's rows are otherwise permanent
-- provenance, matching 0002's own "never deleted" comment).
--
-- Still no INSERT/UPDATE/DELETE policy for anon/authenticated — writes stay
-- service_role-only (the ingester's own client, `createServiceRoleClient()`
-- pattern, and `upsert_event_from_client`'s SECURITY DEFINER path).
-- ---------------------------------------------------------------------------
create policy event_source_records_public_select
  on public.event_source_records for select
  to anon, authenticated
  using (review_status <> 'deleted');

-- ---------------------------------------------------------------------------
-- 4. public.events_with_sources — the app's one read shape for "located by
-- ISN, EMSC and USGS" + a corroboration count, kept cheap for a list screen:
-- no raw_payload (that stays a per-event drill-down query straight against
-- event_source_records, now readable per #3 above), one small `sources`
-- jsonb array, one integer count. Same "view runs as owner, base-table RLS
-- still fully enforced by the view's own WHERE clause" idiom as
-- felt_cells_public (0004) — the correctness property that matters here is
-- IDENTICAL: `review_status <> 'deleted'` is applied inside the view, not
-- left to the caller, and matches the same guard freshly re-added to
-- event_source_records' OWN policy in #3, so the same rows stay hidden
-- whether a client queries the view or the base table directly.
--
-- `corroboration_count` counts DISTINCT (author_agency, falling back to the
-- upper-cased provider tag when a source has no author_agency) — an event
-- seen only via 'geofon' with no author_agency contributes 1 ("GEOFON"),
-- not 0; an event seen by both an EMSC-relayed AFAD record (author_agency
-- 'AFAD') and a direct 'afad'-provider record (author_agency 'AFAD') still
-- counts as ONE corroborating agency, which is the honest reading of
-- "how many independent agencies located this" rather than "how many
-- catalogs mention it". This exact counting rule is mirrored (and unit
-- tested, since SQL views can't run under Jest) by
-- `supabase/functions/ingest-events/corroboration.ts`'s `corroborationCount`
-- — keep the two in sync.
-- ---------------------------------------------------------------------------
create view public.events_with_sources as
select
  e.event_id,
  e.bumelerze_id,
  e.origin_time,
  e.lat,
  e.lon,
  e.depth_km,
  e.magnitude,
  e.mag_type,
  e.place,
  e.review_status,
  e.status,
  e.sig,
  e.region_flag,
  e.merged_into,
  e.updated_at,
  coalesce(sc.corroboration_count, 0) as corroboration_count,
  coalesce(sc.sources, '[]'::jsonb) as sources
from public.events e
left join lateral (
  select
    count(distinct coalesce(esr.author_agency, upper(esr.provider))) as corroboration_count,
    jsonb_agg(
      jsonb_build_object(
        'provider', esr.provider,
        'authorAgency', esr.author_agency,
        'reviewStatus', esr.review_status
      )
      order by esr.fetched_at asc
    ) as sources
  from public.event_source_records esr
  where esr.event_id = e.event_id
    and esr.review_status <> 'deleted'
) sc on true;

comment on view public.events_with_sources is
  'Public read surface: one row per event plus its corroborating source list and a distinct-agency count ("located by ISN, EMSC and USGS"). No raw_payload (bandwidth-cheap for a list screen) — drill into event_source_records directly (public read since migration 0023) for the full per-record payload. Views run as owner (postgres) like felt_cells_public (0004); the lateral subquery''s own review_status filter is what keeps deleted source records out, mirrored by event_source_records_public_select on the base table.';

grant select on public.events_with_sources to anon, authenticated;
