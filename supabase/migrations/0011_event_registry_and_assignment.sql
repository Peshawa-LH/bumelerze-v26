-- 0011: client-callable event registry + felt-report auto-assignment
-- foundation (D23 data architecture, D26 reporting-mechanism-v2 directive).
--
-- Context: no server-side ingestion worker runs yet (`events` /
-- `event_source_records`, migration 0002, are both empty on the live
-- project) — but the app already needs to attach a felt report to the
-- canonical `events.event_id` uuid it's reporting against, submitted from
-- Event Detail's "I felt this earthquake" pill. This migration adds the
-- narrow slice that makes that possible WITHOUT a running ingestion
-- pipeline: a client-callable upsert that registers the event the app
-- already has in its own feed cache (USGS/EMSC/GEOFON, normalized
-- client-side by `src/features/events/normalize.ts`), keyed on
-- (provider, provider_event_id) exactly like the future ingestion worker
-- will key its own writes — so the worker takes over as primary writer to
-- the SAME rows later with no reconciliation step needed.
--
-- Deliberately reuses migration 0002's existing shape rather than adding a
-- new companion table:
--   - `public.events` already has one row per physical event (uuid PK).
--   - `public.event_source_records` already exists as exactly the "which
--     provider ids point at this canonical event" alias table the task
--     brief asked for (unique (provider, provider_event_id), FK to
--     events.event_id) — so client-registered provider sightings live in
--     the SAME table a real ingest write would use, not a parallel one.
-- `events.bumelerze_id` (migration 0008) is left NULL by this path on
-- purpose — allocating a real bml id is the future single-writer
-- allocator's job (0008's own comment); a client-registered event simply
-- doesn't have one yet until the worker (or a backfill) assigns it.

-- ---------------------------------------------------------------------------
-- Tunable constants used below — kept as plain literals with comments
-- (Postgres has no first-class named-constant story for SQL function bodies
-- without a config table, which would be more machinery than this wave
-- needs). Two independent constant sets:
--
-- 1. Cross-provider dedup thresholds (upsert_event_from_client): MUST mirror
--    `src/features/events/config.ts` DEDUP_MAX_TIME_DELTA_MS (16_000),
--    DEDUP_MAX_DISTANCE_KM (100), DEDUP_MAX_MAG_DELTA (1.5) — and the
--    shake-service worker's own feed_watcher.py dedup helper, per that
--    module's own "keep the two in sync" comment. Update all three places
--    together when tuning.
-- 2. Auto-assignment window (assign_unassigned_felt_reports): 48h lookback,
--    30 min post-origin window, 300 km radius — [engineering defaults,
--    tunable], deliberately generous ("felt radius", not "located near
--    epicenter") per the wave brief.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- upsert_event_from_client: client-callable (anon + authenticated), inserts
-- or resolves the canonical event uuid for a (provider, provider_event_id)
-- pair the app already has in its own normalized feed cache. SECURITY
-- DEFINER so an anon/authenticated caller (who has no RLS write access to
-- `events`/`event_source_records` at all — see 0002's own "no insert policy
-- is defined here on purpose") can still register the event it's about to
-- attach a felt report to, without opening those tables to arbitrary writes.
--
-- Parameters are `p_`-prefixed specifically to avoid any ambiguity between
-- a PL/pgSQL variable/parameter name and an identically-named SQL column
-- (`events.magnitude`, `event_source_records.provider`, etc.) inside the
-- queries below — the standard, unambiguous idiom, rather than relying on
-- ${function_name}.${param} block-qualification.
--
-- Idempotent by construction: repeat calls with the SAME (provider,
-- provider_event_id) — a queue retry, or the client re-resolving the same
-- event for a second felt report — always return the same event_id, never
-- create a second row (proven by the unique index this relies on:
-- event_source_records_provider_ext_id_uq, 0002).
--
-- Concurrency: `pg_advisory_xact_lock` on a hash of (provider,
-- provider_event_id) serializes concurrent calls for the SAME provider
-- sighting for the lifetime of this function's implicit transaction, which
-- is what makes the "insert if truly new" branch below race-free for repeat
-- callers. Two DIFFERENT provider sightings of the same physical event
-- arriving in the same instant (e.g. a USGS and an EMSC record for one
-- quake, both new to us, both resolved by two different users' apps at
-- once) are NOT covered by this lock and could each independently pass the
-- dedup-match SELECT and create two `events` rows for one physical quake —
-- an accepted, documented, low-probability race for this client-only wave;
-- the future ingestion worker's own merge job (event_merges, 0002) already
-- exists to reconcile exactly this case, same as it would for any two
-- providers' feeds racing each other.
create or replace function public.upsert_event_from_client(
  p_provider text,
  p_provider_event_id text,
  p_origin_time timestamptz,
  p_lat double precision,
  p_lon double precision,
  p_depth_km numeric,
  p_magnitude numeric,
  p_mag_type text,
  p_place_name text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_match_event_id uuid;
  v_source_record_id uuid;
  -- D23 §1 region bbox mirror (src/features/events/config.ts REGION_BBOX) —
  -- kept here only to stamp region_flag on client-created rows consistently
  -- with how the future ingestion worker would; tunable, keep in sync.
  v_region_min_lat constant double precision := 33.0;
  v_region_max_lat constant double precision := 38.5;
  v_region_min_lon constant double precision := 41.0;
  v_region_max_lon constant double precision := 48.5;
begin
  -- ---- guard rails (range/sanity validation, not just NOT NULL) ----------
  if p_provider is null or p_provider_event_id is null or length(p_provider_event_id) = 0 then
    raise exception 'upsert_event_from_client: provider and provider_event_id are required'
      using errcode = '22023';
  end if;
  if p_origin_time is null
     or p_origin_time < timestamptz '1900-01-01'
     or p_origin_time > now() + interval '1 day' then
    raise exception 'upsert_event_from_client: origin_time out of sane range: %', p_origin_time
      using errcode = '22023';
  end if;
  if p_lat is null or p_lat < -90 or p_lat > 90 then
    raise exception 'upsert_event_from_client: invalid lat: %', p_lat using errcode = '22023';
  end if;
  if p_lon is null or p_lon < -180 or p_lon > 180 then
    raise exception 'upsert_event_from_client: invalid lon: %', p_lon using errcode = '22023';
  end if;
  if p_magnitude is null or p_magnitude < -2 or p_magnitude > 10 then
    raise exception 'upsert_event_from_client: invalid magnitude: %', p_magnitude
      using errcode = '22023';
  end if;
  -- provider's own value set is enforced by event_source_records' existing
  -- CHECK constraint (0002) — deliberately not duplicated here so the
  -- allowed-provider list has exactly one place it can drift out of sync.

  -- Serialize concurrent callers for this exact (provider, provider_event_id)
  -- for the rest of this transaction — see the function-level comment above.
  perform pg_advisory_xact_lock(hashtext(p_provider || ':' || p_provider_event_id));

  -- 1) Already-known provider sighting -> return its event_id (idempotent
  --    retry path; also the common "second felt report on an event we
  --    already registered" path).
  select esr.event_id into v_event_id
  from public.event_source_records esr
  where esr.provider = p_provider
    and esr.provider_event_id = p_provider_event_id;

  if v_event_id is not null then
    return v_event_id;
  end if;

  -- 2) New provider sighting — cross-provider dedup match against recent
  --    canonical (non-merged-away) events, same thresholds as
  --    src/features/events/config.ts DEDUP_* (see header comment).
  select e.event_id into v_match_event_id
  from public.events e
  where e.merged_into is null
    and abs(extract(epoch from (e.origin_time - p_origin_time))) <= 16
    and abs(e.magnitude - p_magnitude) <= 1.5
    and ST_DWithin(
          geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
          geography(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)),
          100000 -- 100 km, meters
        )
  order by abs(extract(epoch from (e.origin_time - p_origin_time))) asc
  limit 1;

  if v_match_event_id is not null then
    insert into public.event_source_records (
      event_id, provider, provider_event_id, raw_payload,
      parsed_origin_time, parsed_lat, parsed_lon, parsed_depth_km,
      parsed_magnitude, parsed_mag_type, parsed_place
    ) values (
      v_match_event_id, p_provider, p_provider_event_id, '{}'::jsonb,
      p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place_name
    )
    on conflict (provider, provider_event_id) do nothing;

    return v_match_event_id;
  end if;

  -- 3) Genuinely new physical event: create the canonical row + its first
  --    source record together.
  insert into public.events (
    origin_time, lat, lon, depth_km, magnitude, mag_type, place, region_flag
  ) values (
    p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place_name,
    (p_lat between v_region_min_lat and v_region_max_lat
       and p_lon between v_region_min_lon and v_region_max_lon)
  )
  returning event_id into v_event_id;

  insert into public.event_source_records (
    event_id, provider, provider_event_id, raw_payload,
    parsed_origin_time, parsed_lat, parsed_lon, parsed_depth_km,
    parsed_magnitude, parsed_mag_type, parsed_place
  ) values (
    v_event_id, p_provider, p_provider_event_id, '{}'::jsonb,
    p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place_name
  )
  returning source_record_id into v_source_record_id;

  update public.events
  set origin_time_source_id = v_source_record_id,
      location_source_id = v_source_record_id,
      depth_source_id = v_source_record_id,
      magnitude_source_id = v_source_record_id
  where event_id = v_event_id;

  return v_event_id;
end;
$$;

comment on function public.upsert_event_from_client is
  'Client-callable (RLS-bypassing SECURITY DEFINER) insert-or-resolve for the canonical events.event_id behind a (provider, provider_event_id) pair, so a felt report can attach to an event before any server ingestion pipeline exists. Cross-provider dedup mirrors src/features/events/config.ts DEDUP_* — keep in sync. Migration 0011.';

revoke all on function public.upsert_event_from_client(
  text, text, timestamptz, double precision, double precision, numeric, numeric, text, text
) from public;
grant execute on function public.upsert_event_from_client(
  text, text, timestamptz, double precision, double precision, numeric, numeric, text, text
) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- assign_unassigned_felt_reports: NOT client-callable. Server-side (cron /
-- service-role) sweep that matches felt_reports with event_id is null
-- against known events by space+time proximity — the D26 point-4
-- auto-assignment mechanism. Returns the number of reports assigned.
--
-- Matching rule (both must hold):
--   - report.created_at (client capture time) within
--     [event.origin_time, event.origin_time + 30 minutes]
--   - report location within 300 km of the epicenter (generous felt
--     radius, not "near the epicenter" — [engineering default, tunable])
-- Only considers reports from the last 48h (lookback window,
-- [engineering default, tunable]) and events not merged away.
-- Single candidate -> assign; multiple candidates -> nearest-in-time
-- (row_number() ... order by abs(time delta) picks this per report).
-- No candidate -> left NULL (the D26 "unassigned pool" a future
-- crowdsourced-detection pass reads from — not built this wave).
--
-- Race notes — both protect the SAME invariant (felt_reports_device_event_uq,
-- 0003: "one report per device per event"), against two different windows:
--   1. Cross-run: a device already has an ASSIGNED report for the candidate
--      event from a PRIOR run/direct submission (e.g. it separately filed a
--      direct Event-Detail report for the same quake) — the `not exists`
--      below excludes that candidate; the unassigned row is left NULL.
--   2. Within-run: a device filed TWO unassigned reports that both match
--      the SAME event in THIS run (e.g. two rapid taps before ever visiting
--      Event Detail) — nothing in step 1 catches this, since neither row is
--      "already assigned" yet at query time. Without a second dedup pass,
--      the single batch UPDATE below would try to write the same
--      (device_id, event_id) pair twice in one statement, which the unique
--      index would reject and abort the ENTIRE sweep (not just those two
--      rows). The `device_event_rn` dedup in `chosen` picks only the
--      earliest such report per (device_id, event_id) per run; the other
--      stays NULL permanently once the first is assigned (step 1 then
--      excludes it on every future run too) — an accepted outcome, matching
--      felt_reports_device_event_uq's own "one report counts" intent for
--      duplicate taps from the same device.
create or replace function public.assign_unassigned_felt_reports()
returns integer
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select
      fr.report_id,
      fr.device_id,
      e.event_id,
      row_number() over (
        partition by fr.report_id
        order by abs(extract(epoch from (fr.created_at - e.origin_time)))
      ) as rn
    from public.felt_reports fr
    join public.events e
      on e.merged_into is null
     and fr.created_at >= e.origin_time
     and fr.created_at <= e.origin_time + interval '30 minutes'
     and ST_DWithin(
           geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
           geography(ST_SetSRID(ST_MakePoint(fr.lon, fr.lat), 4326)),
           300000 -- 300 km, meters
         )
    where fr.event_id is null
      and fr.created_at >= now() - interval '48 hours'
      and not exists (
        select 1
        from public.felt_reports fr2
        where fr2.device_id = fr.device_id
          and fr2.event_id = e.event_id
      )
  ),
  nearest as (
    select report_id, device_id, event_id from candidates where rn = 1
  ),
  chosen as (
    -- Race note 2 (see above): dedup within this run so at most one report
    -- per (device_id, event_id) is ever assigned by a single sweep.
    select report_id, event_id
    from (
      select
        report_id,
        event_id,
        row_number() over (
          partition by device_id, event_id
          order by report_id
        ) as device_event_rn
      from nearest
    ) deduped
    where device_event_rn = 1
  ),
  updated as (
    update public.felt_reports fr
    set event_id = chosen.event_id
    from chosen
    where fr.report_id = chosen.report_id
    returning fr.report_id
  )
  select count(*)::integer from updated;
$$;

comment on function public.assign_unassigned_felt_reports is
  'Server-side (service-role/cron) sweep: attaches event_id is null felt_reports (last 48h) to the nearest-in-time event within 30 min of origin and 300 km of epicenter, when one or more candidates exist. Not client-callable. D26 point 4. Migration 0011.';

revoke all on function public.assign_unassigned_felt_reports() from public, anon, authenticated;
grant execute on function public.assign_unassigned_felt_reports() to service_role;

-- ---------------------------------------------------------------------------
-- Supporting index: the assignment sweep's primary filter is
-- "event_id is null and created_at recent" — a partial index keeps that
-- filter cheap without scanning every historical (already-assigned) report.
-- ---------------------------------------------------------------------------
create index idx_felt_reports_unassigned_created_at
  on public.felt_reports (created_at)
  where event_id is null;
