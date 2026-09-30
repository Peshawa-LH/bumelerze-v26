-- 0033: security hardening from the 2026-09-30 access audit.
--
-- The anon key is public by design, so row-level security and function
-- grants are the whole defence. The audit (live probes, rolled back) found:
--
--   * upsert_event_from_client (SECURITY DEFINER, callable by anyone)
--     accepted ANY provider, including 'manual' (rank 0). A forged record
--     could create a fake event, attach to a real one and win the canonical
--     re-election (0032), and the engine's registry catch-up would then
--     compute and publish a map for it.
--   * felt_comments / felt_photos inserts accepted moderation_status =
--     'approved' from the client: moderation could be skipped (proved).
--   * felt_reports / felt_comments / feedback accepted any user_id, so a
--     row could be attributed to someone else's anonymous identity.
--   * spatial_ref_sys (PostGIS, owned by supabase_admin, RLS off) was
--     writable by anon through the REST API (proved). PostGIS moves to the
--     `extensions` schema, which the API does not expose. Nothing in public
--     stores geometry, so the move drops no data.
--   * two SECURITY DEFINER views and seven functions without a fixed
--     search_path (advisor findings).
--
-- Trust model (owner, 2026-09-30):
--   * The app never creates earthquakes. It registers a USGS / EMSC /
--     GEOFON event only to link felt reports to it; such a record is
--     UNVERIFIED until the provider confirms it (server ingestion re-reading
--     it, or the engine's provider check via apply_source_verification).
--     Unverified records never outrank verified ones, never reconcile a
--     possible event, and never get a map.
--   * Crowd detections stay 'possible' until a provider source matches.
--   * Developers (service role: the engine, the manual-event workflow, the
--     SQL editor) have a MANUAL channel, register_manual_event, for an
--     emergency the feeds missed or a correction. A live manual record
--     outranks every provider and holds against later ingestion.

-- 1. PostGIS out of the API schema ---------------------------------------
-- Three generated geohash columns used ST_GeoHash, which pinned PostGIS
-- in public (and 0010's REVOKE never took effect: postgres is not the
-- grantor). They now use a plain-SQL encoder identical to ST_GeoHash
-- (checked on 40,158 points incl. every cell-edge case, precision 5 and 9).
create or replace function public.geohash_encode(
  p_lat double precision,
  p_lon double precision,
  p_precision integer
)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $$
declare
  base32 constant text := '0123456789bcdefghjkmnpqrstuvwxyz';
  lat_lo double precision := -90;
  lat_hi double precision := 90;
  lon_lo double precision := -180;
  lon_hi double precision := 180;
  mid double precision;
  is_even boolean := true;
  nbits integer := 0;
  ch integer := 0;
  v_hash text := '';
begin
  while length(v_hash) < p_precision loop
    if is_even then
      mid := (lon_lo + lon_hi) / 2;
      if p_lon >= mid then ch := ch * 2 + 1; lon_lo := mid; else ch := ch * 2; lon_hi := mid; end if;
    else
      mid := (lat_lo + lat_hi) / 2;
      if p_lat >= mid then ch := ch * 2 + 1; lat_lo := mid; else ch := ch * 2; lat_hi := mid; end if;
    end if;
    is_even := not is_even;
    nbits := nbits + 1;
    if nbits = 5 then
      v_hash := v_hash || substr(base32, ch + 1, 1);
      nbits := 0;
      ch := 0;
    end if;
  end loop;
  return v_hash;
end
$$;

alter table public.felt_reports drop column geohash_p5;
alter table public.notification_subscriptions
  drop column near_me_geohash,
  drop column homebase_geohash;

drop extension if exists postgis;
create extension postgis with schema extensions;

alter table public.felt_reports
  add column geohash_p5 text generated always as (public.geohash_encode(lat, lon, 5)) stored;
alter table public.notification_subscriptions
  add column near_me_geohash text generated always as (
    case when near_me_lat is not null and near_me_lon is not null
      then public.geohash_encode(near_me_lat, near_me_lon, 5) end
  ) stored,
  add column homebase_geohash text generated always as (
    case when homebase_lat is not null and homebase_lon is not null
      then public.geohash_encode(homebase_lat, homebase_lon, 5) end
  ) stored;

create index idx_felt_reports_event_geohash on public.felt_reports using btree (event_id, geohash_p5);
create index idx_felt_reports_unassigned_geohash_p4 on public.felt_reports
  using btree (left(geohash_p5, 4)) where event_id is null;
create index idx_notif_subs_near_me_geohash on public.notification_subscriptions
  using btree (near_me_geohash text_pattern_ops);
create index idx_notif_subs_homebase_geohash on public.notification_subscriptions
  using btree (homebase_geohash text_pattern_ops);

-- 2. Who is calling ------------------------------------------------------
-- True for requests that arrive with the public anon key or a user
-- session. The service role (engine worker), pg_cron and the SQL editor
-- are trusted.
create or replace function public.request_is_client()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) in ('anon', 'authenticated')
$$;

-- 3. Verification state on source records --------------------------------
alter table public.event_source_records add column if not exists verified_at timestamptz;
-- Everything already in the registry came from test traffic, the engine
-- or the Atlas population; it is grandfathered as verified.
update public.event_source_records set verified_at = created_at where verified_at is null;
create index if not exists event_source_records_unverified_idx
  on public.event_source_records (created_at)
  where verified_at is null and review_status <> 'deleted';

-- Any trusted write (server ingestion re-reading a record the app created
-- first, the engine, a developer) confirms the record. Clients cannot write
-- this table directly; their records arrive through the RPC unverified.
create or replace function public.source_records_stamp_verified()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.verified_at is null and new.review_status <> 'deleted' and not public.request_is_client() then
    new.verified_at := now();
  end if;
  return new;
end
$$;
drop trigger if exists source_records_stamp_verified on public.event_source_records;
create trigger source_records_stamp_verified
  before insert or update on public.event_source_records
  for each row execute function public.source_records_stamp_verified();

-- 4. Canonical re-election: verified records first --------------------------
create or replace function public.reelect_event_canonical(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $function$
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
  order by (esr.verified_at is null) asc, public.provider_rank(esr.provider) asc, esr.created_at asc
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
$function$;

-- 5. Possible-event reconciliation, split out of the RPC ------------------
-- Same rule as before (a crowd-detected "possible" event within 10 min and
-- 100 km of a newly confirmed event is merged into it, its felt reports
-- moved), now run only for trusted or verified events.
create or replace function public.reconcile_possible_event(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  e record;
  v_possible uuid;
begin
  select ev.origin_time, ev.lat, ev.lon into e
  from public.events ev
  where ev.event_id = p_event_id and ev.merged_into is null and ev.status = 'published';
  if not found then
    return null;
  end if;

  select ev.event_id into v_possible
  from public.events ev
  where ev.status = 'possible'
    and abs(extract(epoch from (ev.origin_time - e.origin_time))) <= 600
    and ST_DWithin(
          geography(ST_SetSRID(ST_MakePoint(ev.lon, ev.lat), 4326)),
          geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
          100000
        )
  order by abs(extract(epoch from (ev.origin_time - e.origin_time))) asc
  limit 1;

  if v_possible is null then
    return null;
  end if;

  update public.felt_reports fr
  set event_id = p_event_id
  where fr.event_id = v_possible
    and not exists (
      select 1 from public.felt_reports fr2
      where fr2.device_id = fr.device_id and fr2.event_id = p_event_id
    );

  update public.events
  set status = 'merged', merged_into = p_event_id
  where event_id = v_possible;

  insert into public.event_merges (source_event_id, target_event_id, reason, merged_by)
  values (v_possible, p_event_id, 'crowd_reconciled', 'system');

  return v_possible;
end;
$function$;

-- 6. Registration RPC: provider allow-list, unverified client records -----
create or replace function public.upsert_event_from_client(
  p_provider text,
  p_provider_event_id text,
  p_origin_time timestamp with time zone,
  p_lat double precision,
  p_lon double precision,
  p_depth_km numeric,
  p_magnitude numeric,
  p_mag_type text,
  p_place_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_client constant boolean := public.request_is_client();
  v_verified_at timestamptz := case when public.request_is_client() then null else now() end;
  v_event_id uuid;
  v_match_event_id uuid;
  v_source_record_id uuid;
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
  -- The app only ever registers events from its three live feeds.
  if v_client and p_provider not in ('usgs', 'emsc', 'geofon') then
    raise exception 'upsert_event_from_client: provider % is not accepted from clients', p_provider
      using errcode = '42501';
  end if;
  if length(p_provider_event_id) > 64 or coalesce(length(p_place_name), 0) > 200
     or coalesce(length(p_mag_type), 0) > 16 then
    raise exception 'upsert_event_from_client: field too long' using errcode = '22023';
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

  select esr.event_id into v_event_id
  from public.event_source_records esr
  where esr.provider = p_provider
    and esr.provider_event_id = p_provider_event_id;

  if v_event_id is not null then
    -- A trusted caller re-registering a record the app created first
    -- vouches for it.
    if not v_client then
      update public.event_source_records
      set verified_at = coalesce(verified_at, now())
      where provider = p_provider and provider_event_id = p_provider_event_id
        and review_status <> 'deleted';
    end if;
    return v_event_id;
  end if;

  select e.event_id into v_match_event_id
  from public.events e
  where e.merged_into is null
    and abs(extract(epoch from (e.origin_time - p_origin_time))) <= 16
    and abs(e.magnitude - p_magnitude) <= 1.5
    and ST_DWithin(
          geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
          geography(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)),
          50000
        )
  order by abs(extract(epoch from (e.origin_time - p_origin_time))) asc
  limit 1;

  if v_match_event_id is not null then
    insert into public.event_source_records (
      event_id, provider, provider_event_id, raw_payload,
      parsed_origin_time, parsed_lat, parsed_lon, parsed_depth_km,
      parsed_magnitude, parsed_mag_type, parsed_place, verified_at
    ) values (
      v_match_event_id, p_provider, p_provider_event_id, '{}'::jsonb,
      p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place_name, v_verified_at
    )
    on conflict (provider, provider_event_id) do nothing;

    perform public.reelect_event_canonical(v_match_event_id);

    return v_match_event_id;
  end if;

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
    parsed_magnitude, parsed_mag_type, parsed_place, verified_at
  ) values (
    v_event_id, p_provider, p_provider_event_id, '{}'::jsonb,
    p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place_name, v_verified_at
  )
  returning source_record_id into v_source_record_id;

  update public.events
  set origin_time_source_id = v_source_record_id,
      location_source_id = v_source_record_id,
      depth_source_id = v_source_record_id,
      magnitude_source_id = v_source_record_id
  where event_id = v_event_id;

  if not v_client then
    perform public.reconcile_possible_event(v_event_id);
  end if;

  return v_event_id;
end;
$function$;

-- 6b. A live manual record holds the canonical values --------------------
-- Server ingestion re-derives canonical fields from agency ranks and would
-- otherwise undo a developer correction on its next pass.
create or replace function public.events_pin_manual()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  m record;
begin
  select esr.* into m
  from public.event_source_records esr
  where esr.event_id = new.event_id
    and esr.provider = 'manual'
    and esr.review_status <> 'deleted'
    and esr.parsed_origin_time is not null
    and esr.parsed_lat is not null
    and esr.parsed_lon is not null
    and esr.parsed_magnitude is not null
  order by esr.created_at desc
  limit 1;
  if m.source_record_id is null then
    return new;
  end if;
  new.origin_time := m.parsed_origin_time;
  new.lat := m.parsed_lat;
  new.lon := m.parsed_lon;
  new.depth_km := coalesce(m.parsed_depth_km, new.depth_km);
  new.magnitude := m.parsed_magnitude;
  new.mag_type := coalesce(m.parsed_mag_type, new.mag_type);
  new.place := coalesce(m.parsed_place, new.place);
  new.region_flag := (m.parsed_lat between 33.0 and 38.5 and m.parsed_lon between 41.0 and 48.5);
  new.origin_time_source_id := m.source_record_id;
  new.location_source_id := m.source_record_id;
  new.depth_source_id := m.source_record_id;
  new.magnitude_source_id := m.source_record_id;
  return new;
end
$$;
drop trigger if exists events_pin_manual on public.events;
create trigger events_pin_manual
  before update on public.events
  for each row execute function public.events_pin_manual();

-- 6c. The developer channel -----------------------------------------------
-- A new event the feeds missed (it matches an existing event within
-- 16 s / 50 km / 1.5 mag and then overrides it instead), or, with
-- p_attach_to, an explicit correction of a known event. Author and note are
-- required and kept on the record. Retract with
-- apply_source_verification(source_record_id, false).
create or replace function public.register_manual_event(
  p_origin_time timestamptz,
  p_lat double precision,
  p_lon double precision,
  p_depth_km numeric,
  p_magnitude numeric,
  p_mag_type text,
  p_place text,
  p_author text,
  p_note text,
  p_attach_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_pid constant text := 'manual-' || to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS')
    || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
  v_payload jsonb;
  v_event uuid;
  v_record uuid;
begin
  if public.request_is_client() then
    raise exception 'register_manual_event: developer channel only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_author), '') = '' or coalesce(btrim(p_note), '') = '' then
    raise exception 'register_manual_event: author and note are required' using errcode = '22023';
  end if;
  if p_origin_time is null or p_origin_time > now() + interval '1 hour'
     or p_lat is null or p_lat < -90 or p_lat > 90
     or p_lon is null or p_lon < -180 or p_lon > 180
     or p_magnitude is null or p_magnitude < -2 or p_magnitude > 10 then
    raise exception 'register_manual_event: origin time, location or magnitude out of range'
      using errcode = '22023';
  end if;
  v_payload := jsonb_build_object(
    'channel', 'developer', 'author', btrim(p_author), 'note', btrim(p_note), 'registered_at', now()
  );

  if p_attach_to is not null then
    if not exists (select 1 from public.events e where e.event_id = p_attach_to and e.merged_into is null) then
      raise exception 'register_manual_event: no live event %', p_attach_to using errcode = '22023';
    end if;
    insert into public.event_source_records (
      event_id, provider, provider_event_id, raw_payload,
      parsed_origin_time, parsed_lat, parsed_lon, parsed_depth_km,
      parsed_magnitude, parsed_mag_type, parsed_place, verified_at
    ) values (
      p_attach_to, 'manual', v_pid, v_payload,
      p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place, now()
    )
    returning source_record_id into v_record;
    v_event := p_attach_to;
  else
    v_event := public.upsert_event_from_client(
      'manual', v_pid, p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place
    );
    update public.event_source_records
    set raw_payload = v_payload
    where provider = 'manual' and provider_event_id = v_pid
    returning source_record_id into v_record;
  end if;

  -- Re-publish if it had been hidden, and let the pin trigger apply.
  update public.events
  set status = case when status in ('unconfirmed', 'possible') then 'published' else status end,
      review_status = case when review_status = 'deleted' then 'reviewed' else review_status end,
      updated_at = now()
  where event_id = v_event;

  return (
    select jsonb_build_object(
      'event_id', e.event_id, 'bumelerze_id', e.bumelerze_id,
      'source_record_id', v_record, 'provider_event_id', v_pid,
      'magnitude', e.magnitude, 'origin_time', e.origin_time, 'lat', e.lat, 'lon', e.lon
    )
    from public.events e where e.event_id = v_event
  );
end;
$function$;

-- 7. The engine's verdict on a client record --------------------------------
-- verified: the provider confirms the event -> the record counts, the
-- canonical is re-elected, a nearby possible event is reconciled.
-- rejected: the provider does not know it (or disagrees beyond tolerance)
-- -> the record is soft-deleted; an event left with no live record is
-- hidden (status 'unconfirmed', review_status 'deleted').
create or replace function public.apply_source_verification(
  p_source_record_id uuid,
  p_verified boolean
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_event uuid;
  v_remaining integer;
begin
  select event_id into v_event
  from public.event_source_records
  where source_record_id = p_source_record_id;
  if v_event is null then
    return 'missing';
  end if;

  if p_verified then
    update public.event_source_records
    set verified_at = coalesce(verified_at, now())
    where source_record_id = p_source_record_id;
    perform public.reelect_event_canonical(v_event);
    perform public.reconcile_possible_event(v_event);
    return 'verified';
  end if;

  update public.event_source_records
  set review_status = 'deleted', verified_at = null
  where source_record_id = p_source_record_id;

  select count(*) into v_remaining
  from public.event_source_records
  where event_id = v_event and review_status <> 'deleted';

  if v_remaining = 0 then
    update public.events
    set status = 'unconfirmed', review_status = 'deleted', updated_at = now()
    where event_id = v_event and merged_into is null;
    return 'rejected_event';
  end if;

  perform public.reelect_event_canonical(v_event);
  return 'rejected_record';
end;
$function$;

revoke all on function public.request_is_client() from public, anon, authenticated;
revoke all on function public.reconcile_possible_event(uuid) from public, anon, authenticated;
revoke all on function public.apply_source_verification(uuid, boolean) from public, anon, authenticated;
grant execute on function public.apply_source_verification(uuid, boolean) to service_role;
grant execute on function public.reconcile_possible_event(uuid) to service_role;
revoke all on function public.register_manual_event(timestamptz, double precision, double precision, numeric, numeric, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.register_manual_event(timestamptz, double precision, double precision, numeric, numeric, text, text, text, text, uuid) to service_role;
revoke all on function public.source_records_stamp_verified() from public, anon, authenticated;
revoke all on function public.events_pin_manual() from public, anon, authenticated;

-- 8. Functions that call PostGIS find it in `extensions` ------------------
alter function public.assign_unassigned_felt_reports() set search_path = public, extensions;
alter function public.detect_possible_events() set search_path = public, extensions;

-- 9. Fixed search_path for the remaining plain functions ------------------
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.set_feedback_updated_at() set search_path = public, pg_temp;
alter function public.geohash_adjacent(text, text) set search_path = public, pg_temp;
alter function public.geohash_neighbors(text) set search_path = public, pg_temp;
alter function public.bumelerze_base36(bigint) set search_path = public, pg_temp;
alter function public.format_bumelerze_id(integer, bigint) set search_path = public, pg_temp;
alter function public.provider_rank(text) set search_path = public, pg_temp;

-- 10. Client inserts cannot pre-approve or impersonate ---------------------
drop policy if exists felt_comments_insert on public.felt_comments;
create policy felt_comments_insert on public.felt_comments
  for insert to anon, authenticated
  with check (
    moderation_status = 'pending'
    and moderated_at is null
    and moderated_by is null
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists felt_photos_insert on public.felt_photos;
create policy felt_photos_insert on public.felt_photos
  for insert to anon, authenticated
  with check (
    moderation_status = 'pending'
    and moderated_at is null
    and moderated_by is null
  );

drop policy if exists felt_reports_insert on public.felt_reports;
create policy felt_reports_insert on public.felt_reports
  for insert to anon, authenticated
  with check (
    device_id is not null
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert to anon, authenticated
  with check (
    device_id is not null
    and status = 'unseen'
    and triage_note is null
    and (user_id is null or user_id = auth.uid())
  );

-- 11. Views run with the caller's rights ----------------------------------
-- events_with_sources shows exactly what the events / source-record
-- policies already allow. felt_cells_public keeps its privacy threshold
-- (a cell is public only with >= 3 reports), now as a policy on the table.
alter view public.events_with_sources set (security_invoker = on);

drop policy if exists felt_cells_public_select on public.felt_cells;
create policy felt_cells_public_select on public.felt_cells
  for select to anon, authenticated
  using (n_reports >= 3);
alter view public.felt_cells_public set (security_invoker = on);
