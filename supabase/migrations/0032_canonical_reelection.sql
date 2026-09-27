-- 0032: provider-ranked re-election of an event's canonical parameters.
--
-- Until now the first provider to register an event decided its canonical
-- origin time, hypocentre and magnitude forever: a later, better solution
-- only ATTACHED as a source record. The Atlas population registers ISC
-- bulletin rows first for events older than the live worker, and the
-- unreviewed bulletin carries IDC primes with ~100 km errors and stale
-- magnitudes — bml202602br displayed M3.1 (IDC) while USGS said mb 4.1, and
-- its map was computed for M3.1 (2026-09-27). This migration ranks
-- providers and re-elects whenever a new source record attaches.
--
-- Rank (highest authority first): manual, usgs, emsc, geofon, afad, irsc,
-- kur, isc, iscgem, other — the same order the engine worker's cross-
-- provider dedup and its registry catch-up lane use. All four fields
-- follow the winning record, so an event is described by ONE solution.

create or replace function public.provider_rank(p_provider text)
returns integer
language sql
immutable
as $$
  select case p_provider
    when 'manual' then 0
    when 'usgs' then 1
    when 'emsc' then 2
    when 'geofon' then 3
    when 'afad' then 4
    when 'irsc' then 5
    when 'kur' then 6
    when 'isc' then 7
    when 'iscgem' then 8
    else 9
  end
$$;

create or replace function public.reelect_event_canonical(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  select esr.* into r
  from public.event_source_records esr
  where esr.event_id = p_event_id
    and esr.review_status <> 'deleted'
    and esr.parsed_origin_time is not null
    and esr.parsed_lat is not null
    and esr.parsed_lon is not null
    and esr.parsed_magnitude is not null
  order by public.provider_rank(esr.provider) asc, esr.created_at asc
  limit 1;

  if r.source_record_id is null then
    return false;
  end if;

  update public.events e
  set origin_time = r.parsed_origin_time,
      lat = r.parsed_lat,
      lon = r.parsed_lon,
      depth_km = coalesce(r.parsed_depth_km, e.depth_km),
      magnitude = r.parsed_magnitude,
      mag_type = coalesce(r.parsed_mag_type, e.mag_type),
      place = coalesce(r.parsed_place, e.place),
      region_flag = (r.parsed_lat between 33.0 and 38.5 and r.parsed_lon between 41.0 and 48.5),
      origin_time_source_id = r.source_record_id,
      location_source_id = r.source_record_id,
      depth_source_id = r.source_record_id,
      magnitude_source_id = r.source_record_id,
      updated_at = now()
  where e.event_id = p_event_id
    and e.merged_into is null
    and (e.location_source_id is distinct from r.source_record_id
         or e.magnitude_source_id is distinct from r.source_record_id);

  return found;
end;
$$;

revoke all on function public.reelect_event_canonical(uuid) from public, anon, authenticated;

-- upsert_event_from_client: unchanged except that a new provider sighting
-- attached to an existing event now re-elects its canonical parameters.
create or replace function public.upsert_event_from_client(
  p_provider text, p_provider_event_id text, p_origin_time timestamp with time zone,
  p_lat double precision, p_lon double precision, p_depth_km numeric, p_magnitude numeric,
  p_mag_type text, p_place_name text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  perform pg_advisory_xact_lock(hashtext(p_provider || ':' || p_provider_event_id));

  -- 1) Already-known provider sighting -> return its event_id.
  select esr.event_id into v_event_id
  from public.event_source_records esr
  where esr.provider = p_provider
    and esr.provider_event_id = p_provider_event_id;

  if v_event_id is not null then
    return v_event_id;
  end if;

  -- 2) New provider sighting: cross-provider dedup match, same thresholds as
  --    src/features/events/config.ts DEDUP_* and the bumelerze-engine
  --    worker's feed_watcher.py (16 s / 50 km / |dM| 1.5; keep the three in sync).
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

    -- Migration 0032: a higher-ranked provider's solution now wins the
    -- canonical fields instead of merely attaching.
    perform public.reelect_event_canonical(v_match_event_id);

    return v_match_event_id;
  end if;

  -- 3) Genuinely new physical event: allocate its bml id first, then create
  --    the canonical row and its first source record together.
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
  -- event may CONFIRM a recent crowd-detected 'possible' event.
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
$function$;
