-- 0026: wire the migration-0025 allocator into the one place `events` rows
-- are actually created server-side today (`upsert_event_from_client`,
-- 0011/0012 — both the felt-report registration path and the multi-source
-- ingester's `createSourceRecordViaEventRegistry`, per that function's own
-- header comment, reuse this exact RPC rather than a raw `insert into
-- events`), backfills the 40 existing null rows, and adds the DB-level
-- invariant that a 'published' event can never be missing one.
--
-- ---------------------------------------------------------------------------
-- Scope note — crowd-detected ('possible') events are DELIBERATELY left
-- alone. `detect_possible_events` (0012) also inserts `events` rows, but
-- with `status = 'possible'`: an unconfirmed, crowd-only origin that either
-- (a) gets reconciled onto a real agency event within the function below
--     (the existing D26 §4 "possible -> merged" step, unchanged here) — at
--     which point the SURVIVING row is the new agency event created by
--     THIS function, which now always carries an id (see §2 below); the
--     'possible' row is retired (`status = 'merged'`, `merged_into` set)
--     without ever needing one of its own, or
-- (b) ages out to `status = 'unconfirmed'` after 24h with no agency
--     confirmation and simply never gets one.
-- This mirrors the archival catalog's own precedent for retired ids ("32
-- retired — each was one of two ids for a single earthquake that
-- reconciliation collapsed; retired ids stay in the ledger and are never
-- reissued", source-and-ingestion-plan.md §17): a bml id names a
-- CANONICAL, agency-attributable physical event, and a crowd cluster only
-- earns that status once an agency corroborates it. The wave brief scopes
-- this handover to "the ingester and upsert_event_from_client" specifically
-- — extending it to crowd detection is a real, separate product question
-- (should an unconfirmed felt-cluster earn a permanent citable id even if
-- no agency ever locates it?) that deserves its own owner confirm-review,
-- not a default folded in here. Flagging for Peshawa rather than deciding
-- silently.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. upsert_event_from_client — recreated from 0012's version with exactly
-- one behavioral change: the "genuinely new physical event" branch (step 3)
-- now allocates a bml id via allocate_bumelerze_id(<origin year, UTC>)
-- BEFORE the insert and writes it in the SAME statement, rather than the
-- previous always-NULL default. Every other branch (idempotent-retry
-- return, cross-provider dedup match, D26 possible-event reconciliation) is
-- untouched. The origin year is read from p_origin_time "at time zone
-- 'utc'" — timestamptz values carry no zone of their own, so without this
-- an id could pick up the SESSION's zone instead of UTC (event_id.py's own
-- rule: "the year in the id is the event's ORIGIN year (UTC), not the
-- detection year" — this is the one place that rule is operationalized in
-- SQL).
-- ---------------------------------------------------------------------------
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
  v_possible_event_id uuid;
  v_bml_id text;
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
  if p_provider = 'bumelerze-crowd' then
    raise exception 'upsert_event_from_client: provider bumelerze-crowd is reserved for detect_possible_events'
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
  -- CHECK constraint (0002, widened by migrations 0012/0023) — deliberately
  -- not duplicated here so the allowed-provider list has exactly one place
  -- it can drift out of sync.

  perform pg_advisory_xact_lock(hashtext(p_provider || ':' || p_provider_event_id));

  -- 1) Already-known provider sighting -> return its event_id (idempotent
  --    retry path; also the common "second felt report on an event we
  --    already registered" path). Never allocates — the id, if any, was
  --    already assigned the first time this (provider, provider_event_id)
  --    was seen.
  select esr.event_id into v_event_id
  from public.event_source_records esr
  where esr.provider = p_provider
    and esr.provider_event_id = p_provider_event_id;

  if v_event_id is not null then
    return v_event_id;
  end if;

  -- 2) New provider sighting — cross-provider dedup match against recent
  --    canonical (non-merged-away) events, same thresholds as
  --    src/features/events/config.ts DEDUP_* (see 0011's header comment).
  --    Never allocates either — attaches to an event that already has (or
  --    already lacks) an id from whenever IT was first created.
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

  -- 3) Genuinely new physical event: allocate its bml id FIRST (origin
  --    year, UTC — see this migration's header), then create the canonical
  --    row + its first source record together, in the SAME insert as the
  --    id — never a transient NULL-then-UPDATE, which would trip the
  --    events_bumelerze_id_required_when_published check added below (CHECK
  --    constraints are evaluated per-row at statement end, not deferrable,
  --    so a two-step insert-then-update-id would fail the INSERT outright).
  --    status defaults to 'published' — this path only ever creates real
  --    agency-catalog events, never a crowd one (this migration's own scope
  --    note above).
  v_bml_id := public.allocate_bumelerze_id(
    extract(year from (p_origin_time at time zone 'utc'))::integer
  );

  insert into public.events (
    origin_time, lat, lon, depth_km, magnitude, mag_type, place, region_flag, bumelerze_id
  ) values (
    p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place_name,
    (p_lat between v_region_min_lat and v_region_max_lat
       and p_lon between v_region_min_lon and v_region_max_lon),
    v_bml_id
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

  -- D26 §4 reconciliation (migration 0012, unchanged): this new agency
  -- event — which now always carries a bml id — may CONFIRM a recent
  -- crowd-detected 'possible' event. The possible row's own (permanently
  -- absent) id is not touched; it is simply superseded.
  select e.event_id into v_possible_event_id
  from public.events e
  where e.status = 'possible'
    and abs(extract(epoch from (e.origin_time - p_origin_time))) <= 600 -- 10 min
    and ST_DWithin(
          geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
          geography(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)),
          100000 -- 100 km
        )
  order by abs(extract(epoch from (e.origin_time - p_origin_time))) asc
  limit 1;

  if v_possible_event_id is not null then
    update public.felt_reports fr
    set event_id = v_event_id
    where fr.event_id = v_possible_event_id
      and not exists (
        select 1 from public.felt_reports fr2
        where fr2.device_id = fr.device_id and fr2.event_id = v_event_id
      );

    update public.events
    set status = 'merged', merged_into = v_event_id
    where event_id = v_possible_event_id;

    insert into public.event_merges (source_event_id, target_event_id, reason, merged_by)
    values (v_possible_event_id, v_event_id, 'crowd_reconciled', 'system');
  end if;

  return v_event_id;
end;
$$;

comment on function public.upsert_event_from_client is
  'Client-callable (RLS-bypassing SECURITY DEFINER) insert-or-resolve for the canonical events.event_id behind a (provider, provider_event_id) pair. Cross-provider dedup mirrors src/features/events/config.ts DEDUP_* — keep in sync. Extended in migration 0012 with D26 §4 possible-event reconciliation; migration 0026 makes step 3 (genuinely new physical event) allocate a real bumelerze_id via allocate_bumelerze_id() instead of leaving it NULL — see that migration''s header for scope (crowd/"possible" events are NOT allocated one here, by design).';

revoke all on function public.upsert_event_from_client(
  text, text, timestamptz, double precision, double precision, numeric, numeric, text, text
) from public;
grant execute on function public.upsert_event_from_client(
  text, text, timestamptz, double precision, double precision, numeric, numeric, text, text
) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Backfill: all 40 currently-live rows have `bumelerze_id is null`
-- (verified against production, migration 0025's header) — every one of
-- them was created by `upsert_event_from_client` before this migration
-- existed, so none of them can pre-date the Postgres allocator or collide
-- with anything the bumelerze-engine worker separately tracks (its ids live
-- in a completely different namespace — the reserved 1-999 band, migration
-- 0025 §2 — precisely so this backfill can safely draw from Postgres' OWN
-- counter, starting at 1000 for 2026, without any cross-system
-- reconciliation step).
--
-- Ordering: origin_time ascending (event_id as a stable tiebreaker for the
-- vanishingly-unlikely exact-timestamp collision) — "give them ids in
-- origin-time order" per the wave brief, and the same ordering
-- scripts/build_regional_catalog.py already uses for its own retroactive
-- assignment pass (bumelerze-id-scheme.md "Retroactive assignment"). Loops
-- one row at a time through the real allocator (not a bulk pre-computed
-- range) so a mixed-year backfill (none exist today, but a future replay
-- of this pattern against older test data might) buckets correctly per
-- origin year automatically.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select event_id, extract(year from (origin_time at time zone 'utc'))::integer as origin_year
    from public.events
    where bumelerze_id is null
    order by origin_time asc, event_id asc
  loop
    update public.events
    set bumelerze_id = public.allocate_bumelerze_id(r.origin_year)
    where event_id = r.event_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Invariant: a 'published' event can never be missing a bml id. Same
-- shape as 0012's own events_magnitude_required_when_published (status <>
-- 'published' or <column> is not null) — crowd-lifecycle statuses
-- ('possible', 'merged', 'unconfirmed') are exempt by design (see this
-- migration's scope note above); only 'published' (the only status any
-- provider-sourced upsert ever creates, and the only status that existed
-- before migration 0012) is constrained. Placed AFTER the backfill so it
-- can be added as a normal (immediately validated) CHECK rather than
-- `NOT VALID` + a separate VALIDATE step — by this point in the migration
-- every existing row already satisfies it.
-- ---------------------------------------------------------------------------
alter table public.events
  add constraint events_bumelerze_id_required_when_published
    check (status <> 'published' or bumelerze_id is not null);

comment on constraint events_bumelerze_id_required_when_published on public.events is
  'A published (agency-catalog) event must always carry a bumelerze_id — the DB-level form of "an event must never be published without one" (migration 0026). Crowd-lifecycle rows (status possible/merged/unconfirmed, migration 0012) are exempt by design; see migration 0026''s header for why extending allocation to those is a separate, not-yet-made product decision.';
