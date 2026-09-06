-- 0029: tighten the cross-provider duplicate radius from 100 km to 50 km
-- (engine review H1.c, owner ruling 2026-09-06).
--
-- Two agencies locating the same earthquake in this region disagree by a
-- few km to a few tens of km, never by a hundred: at 100 km, and with the
-- 16 s time window, a mainshock and an early aftershock of a large event
-- could be folded into one row. 50 km keeps every genuine cross-agency
-- pair (USGS/EMSC/GEOFON solutions for the 2017 Sarpol-e Zahab and the
-- 2023 Pazarcik/Elbistan events all sit well inside it) while separating
-- distinct events. The three copies of the rule move together:
--
--   src/features/events/config.ts          DEDUP_MAX_DISTANCE_KM = 50
--   bumelerze-engine feed_watcher.py        DEDUP_MAX_DISTANCE_KM = 50.0
--   this function                           ST_DWithin(..., 50000)
--
-- The crowd 'possible' event match (10 min / 100 km, section 4 of the
-- function) is deliberately left at 100 km: a felt-report cluster locates
-- an earthquake far more coarsely than a seismic network does.
--
-- Same ruling, same date: the bumelerze-engine worker now allocates its
-- ids through this function (register, then read events.bumelerze_id)
-- instead of a local counter, so this database is the single allocator.
-- No schema change; the function body below is 0026's with the one
-- threshold edited.

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
  --    src/features/events/config.ts DEDUP_* and the bumelerze-engine
  --    worker's feed_watcher.py (16 s / 50 km / |dM| 1.5; keep the three in sync).
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
          50000 -- 50 km, meters (review H1.c, 2026-09-06; was 100 km)
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

