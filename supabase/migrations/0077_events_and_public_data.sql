-- 0077: events the app registers wait for their provider, and public
-- columns say no more than the app shows (security checklist A1.2 and
-- A1.5; audit findings DB-05, PIPE-07, LIVE-01, DB-13, PRIV-04, PRIV-08,
-- LIVE-13, DB-03 point 3, DB-08).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- A. Events registered by the app (A1.2).
-- Why. The app registers a USGS, EMSC or GEOFON earthquake when somebody
-- opens it or reports on it before the server has it (the server reads
-- USGS and EMSC every minute and GEOFON every 5 minutes, inside the
-- Kurdistan box and 72 hours back; the app also shows world events and
-- events up to a year old). Such a registration was published at once,
-- with any place text, so anybody with a session could put a made-up
-- "earthquake" behind a share link for the hours until the engine's
-- provider check rejected it.
-- 1. A new event registered by the app starts as 'unconfirmed' (an
--    existing status: 0012). It becomes 'published' the moment one of its
--    source records is verified by the provider: server ingestion of the
--    same record (the update stamps it, 0033), server ingestion of the same
--    earthquake from another provider (the record joins the event), the
--    engine's check (apply_source_verification) or the engine's uploader.
--    One trigger on event_source_records does it for every path
--    (source_records_publish_event). Only an event that waits for its
--    provider is published that way: it has a magnitude, is not merged and
--    is not rejected (an event the engine rejected keeps status
--    'unconfirmed' with review_status 'deleted', as before; a crowd event
--    that aged out has no magnitude).
-- 2. Nobody reads an unconfirmed event through the API: events_public_select
--    hides status 'unconfirmed' (also from events_with_sources, a security
--    invoker view). The app does not need to: it holds the event from the
--    provider's feed and uses only the registry id, which the registration
--    returns, and which the source record (still readable) gives too. Until
--    the provider confirms it, the event shows no Bumelerze id (share links
--    carry the provider id) and no source line; its felt map, hub and felt
--    reports work by the registry id as before. Lists never showed it: the
--    alert path wants a published event with a verified source, the crowd
--    pipeline and the engine catch-up only use published events. Also kept
--    out: sharing it to a profile (share_event_to_profile, from 0059), the
--    busy-time switch (surge_state, from 0064: a magnitude 5 event in the
--    region now has to be published) and the officials' hub list
--    (admin_hub_events, from 0066).
-- 3. felt_reports_server_times (0073) keeps a report's event link for an
--    event that waits for its provider (unconfirmed, not rejected, with a
--    magnitude: the test that later publishes it), so reports made in the
--    first minutes keep their earthquake. A rejected event or an aged-out
--    crowd event still loses the link, as before. It now runs as security
--    definer so it can see the unconfirmed event the caller cannot read;
--    every other line is 0073's.
-- 4. upsert_event_from_client (0033 body) needs a session: anon loses
--    EXECUTE (the app of this release asks only when it has a session).
--    Looking up a record the registry knows is never refused. When the app adds
--    something new: the place must be plain text (no link, per
--    text_has_link, no control or direction-override characters), else
--    22023; a NEW event must have begun within the last 400 days and at
--    most 5 minutes from now (the app's feeds reach 365 days back), else
--    22023. Server callers (service role, pg_cron, the SQL editor) are
--    unchanged: they create published events, any origin time since 1900.
-- 5. events_request_shake_worker (0072) starts the SHAKEmap worker only for
--    an event with a verified source record. A server caller's new event
--    counts at once (its record, verified, is written in the same call);
--    an update needs the verified record, so an event the app registered
--    starts the worker when the provider confirms it ("now mapped").
--
-- B. Public columns (A1.5). Column grants replace the table grant where a
-- column says more than the app shows; select=* on these tables now fails
-- for clients (the app never used it, it names its columns).
-- 1. event_comments. A moderator's removal (status 'removed') is no longer
--    readable by others: the read policy (0054) keeps the author's own
--    rows and the moderators' path, and others read 'visible' only. The
--    hub still shows a removed comment as a "Comment removed" row while
--    replies under it are visible: event_hub_removed(event) returns only
--    its id and time, never the author or the reason. The commenter's area
--    is served as the gazetteer town (new column area_town, the nearest of
--    felt_towns within 100 km of the cell centre, filled by a trigger,
--    the same rule the app used on the cell) instead of the ~5 km cell
--    (area_geohash). Readable columns: comment_id, event_id, parent_id,
--    user_id, body, area_town, status, helpful_count, reply_count,
--    created_at, pinned_at. Hidden: area_geohash, hidden_reason,
--    flag_count, updated_at, author_deleted_at, author_deleted_prev_status,
--    author_deleted_prev_reason, account_deleted_at.
-- 2. felt_comments: comment_id, report_id, body, moderation_status,
--    created_at (device_id, user_id, moderated_at, moderated_by hidden).
--    felt_photos: photo_id, report_id, moderation_status, created_at
--    (storage_path, moderated_at, moderated_by hidden). The app only
--    inserts into both.
-- 3. event_source_records: every column but raw_payload (the feed's raw
--    record, and for a developer's manual event the author and note,
--    PRIV-08). shakemap_products: every column but reviewed_by (the
--    reviewer's name; the app never showed it). storage_path stays: it is
--    the public Atlas address the app downloads the map from, so hiding it
--    would hide nothing (LIVE-13: no action needed beyond awareness).
-- 4. user_roles: no client reads the table any more (it gave every holder
--    with granted_at to anyone). Badges reach the app as before through
--    public_profile, post_comments_page, follow_list and, for the hub,
--    event_hub_roles(event): the role and organisation of the people whose
--    comments the caller can see in that hub, exactly the marks the hub
--    draws (moderator and Government official marks are public by design
--    next to a name). Policy user_roles_read is dropped.
--
-- The app of this release reads area_town, event_hub_removed and
-- event_hub_roles, falls back to the old reads on a server before 0077, and
-- never registers an event without a session; deploy it before this paste.
--
-- Needs 0033, 0054, 0059, 0064, 0065 (felt_towns), 0066 (area_town), 0072
-- and 0073 as applied live.

-- A1. A verified record publishes the event that waited for it ------------------------------------
create or replace function public.source_records_publish_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.events e
     set status = 'published',
         updated_at = now()
   where e.event_id = new.event_id
     and e.status = 'unconfirmed'
     and e.review_status <> 'deleted'
     and e.merged_into is null
     and e.magnitude is not null;
  return null;
end
$$;
revoke all on function public.source_records_publish_event() from public, anon, authenticated;
drop trigger if exists source_records_publish_event on public.event_source_records;
create trigger source_records_publish_event
  after insert or update on public.event_source_records
  for each row
  when (new.verified_at is not null and new.review_status <> 'deleted' and new.provider <> 'bumelerze-crowd')
  execute function public.source_records_publish_event();

-- A2. Unconfirmed events are not public ------------------------------------------------------------
drop policy if exists events_public_select on public.events;
create policy events_public_select
  on public.events for select
  to anon, authenticated
  using (status <> 'unconfirmed');

-- A2. Sharing to a profile needs a confirmed event (0059 body) ---------------------------------------
create or replace function public.share_event_to_profile(p_event text, p_body text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := btrim(coalesce(p_event, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_event uuid;
  v_post uuid;
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'share_event_to_profile: not_account' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p where p.user_id = v_uid and p.username is not null
  ) then
    raise exception 'share_event_to_profile: profile_required' using errcode = '42501';
  end if;
  if char_length(v_body) > 280 then
    raise exception 'share_event_to_profile: too_long' using errcode = '22023';
  end if;
  select coalesce(e0.merged_into, e0.event_id) into v_event
    from public.events e0
   where v_ref <> ''
     and (e0.bumelerze_id = v_ref or e0.event_id::text = lower(v_ref))
   limit 1;
  if v_event is null or not exists (
    select 1 from public.events e
     where e.event_id = v_event and e.review_status <> 'deleted' and e.status <> 'unconfirmed'
  ) then
    raise exception 'share_event_to_profile: event_not_found' using errcode = 'P0002';
  end if;
  select po.post_id into v_post
    from public.profile_posts po
   where po.user_id = v_uid
     and po.kind = 'event'
     and po.event_id = v_event
     and po.status in ('visible', 'pending')
     and po.body = v_body
     and po.created_at > now() - interval '10 minutes'
   order by po.created_at desc
   limit 1;
  if v_post is not null then
    return v_post;
  end if;
  insert into public.profile_posts (user_id, body, kind, event_id)
  values (v_uid, v_body, 'event', v_event)
  returning post_id into v_post;
  return v_post;
end
$$;
revoke all on function public.share_event_to_profile(text, text) from public, anon;
grant execute on function public.share_event_to_profile(text, text) to authenticated;

-- A2. Busy time starts on a published earthquake only (0064 body) ------------------------------------
create or replace function public.surge_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
  v_mode text;
  v_until timestamptz;
  v_ev record;
  v_felt record;
begin
  select s.value into v_value from public.moderation_settings s where s.key = 'surge';
  v_mode := coalesce(v_value ->> 'mode', 'auto');
  v_until := nullif(v_value ->> 'until', '')::timestamptz;
  if v_mode not in ('auto', 'on', 'off') or (v_until is not null and v_until <= now()) then
    v_mode := 'auto';
    v_until := null;
  end if;
  if v_mode = 'on' then
    return jsonb_build_object('active', true, 'mode', 'on', 'until', v_until, 'reason', 'manual');
  end if;
  if v_mode = 'off' then
    return jsonb_build_object('active', false, 'mode', 'off', 'until', v_until, 'reason', 'manual');
  end if;
  select e.bumelerze_id, e.magnitude, e.place, e.origin_time
    into v_ev
    from public.events e
   where e.region_flag
     and e.status = 'published'
     and e.magnitude >= 5.0
     and e.origin_time > now() - interval '24 hours'
     and e.origin_time <= now() + interval '10 minutes'
     and e.merged_into is null
     and e.review_status <> 'deleted'
   order by e.magnitude desc, e.origin_time desc
   limit 1;
  if found then
    return jsonb_build_object(
      'active', true, 'mode', 'auto', 'until', v_ev.origin_time + interval '24 hours',
      'reason', 'magnitude', 'event_ref', v_ev.bumelerze_id,
      'magnitude', v_ev.magnitude, 'place', v_ev.place, 'origin_time', v_ev.origin_time
    );
  end if;
  select e.bumelerze_id, e.place, e.origin_time, count(*)::integer as n
    into v_felt
    from public.events e
    join public.felt_reports fr on fr.event_id = e.event_id
   where e.origin_time > now() - interval '24 hours'
     and e.review_status <> 'deleted'
     and fr.withdrawn_at is null
     and fr.created_at >= e.origin_time
     and fr.created_at < e.origin_time + interval '1 hour'
   group by e.event_id, e.bumelerze_id, e.place, e.origin_time
  having count(*) >= 50
   order by count(*) desc
   limit 1;
  if found then
    return jsonb_build_object(
      'active', true, 'mode', 'auto', 'until', v_felt.origin_time + interval '24 hours',
      'reason', 'felt', 'event_ref', v_felt.bumelerze_id, 'place', v_felt.place,
      'origin_time', v_felt.origin_time, 'reports', v_felt.n
    );
  end if;
  return jsonb_build_object('active', false, 'mode', 'auto', 'until', null, 'reason', null);
end
$$;
revoke all on function public.surge_state() from public, anon, authenticated;

-- A2. The officials' hub list leaves out unconfirmed events (0066 body) -------------------------------
create or replace function public.admin_hub_events(p_query text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_id text;
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_open jsonb;
  v_found jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'hubs.open') then
    raise exception 'admin_hub_events: not_allowed' using errcode = '42501';
  end if;
  v_id := regexp_replace(v_q, '[^a-z0-9]', '', 'g');
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) into v_open
    from (
      select e.origin_time as t, jsonb_build_object(
               'event_id', e.event_id, 'bumelerze_id', e.bumelerze_id, 'place', e.place,
               'magnitude', e.magnitude, 'origin_time', e.origin_time, 'hub_featured', e.hub_featured,
               'note', (select jsonb_build_object('comment_id', c.comment_id, 'body', left(c.body, 140), 'pinned_at', c.pinned_at)
                          from public.event_comments c
                         where c.event_id = e.event_id and c.pinned_at is not null
                         limit 1)) as j
        from public.events e
       where e.hub_featured
    ) x;

  select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) into v_found
    from (
      select e.origin_time as t, jsonb_build_object(
               'event_id', e.event_id, 'bumelerze_id', e.bumelerze_id, 'place', e.place,
               'magnitude', e.magnitude, 'origin_time', e.origin_time, 'hub_featured', e.hub_featured,
               'note', (select jsonb_build_object('comment_id', c.comment_id, 'body', left(c.body, 140), 'pinned_at', c.pinned_at)
                          from public.event_comments c
                         where c.event_id = e.event_id and c.pinned_at is not null
                         limit 1)) as j
        from public.events e
       where e.merged_into is null
         and e.review_status <> 'deleted'
         and e.status <> 'unconfirmed'
         and not e.hub_featured
         and (
           (v_q = '' and e.region_flag and e.bumelerze_id is not null)
           or (v_q <> '' and v_id <> '' and lower(e.bumelerze_id) like v_id || '%')
           or (v_q <> '' and e.place ilike v_like)
         )
       order by e.origin_time desc
       limit v_limit
    ) x;

  return jsonb_build_object('open', v_open, 'events', v_found);
end
$$;
revoke all on function public.admin_hub_events(text, integer) from public, anon;
grant execute on function public.admin_hub_events(text, integer) to authenticated;

-- A3. Felt reports keep an unconfirmed event (0073 body) ----------------------------------------------
create or replace function public.felt_reports_server_times()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_status text;
  v_review text;
  v_magnitude numeric;
  v_merged_into uuid;
  v_origin timestamptz;
begin
  new.submitted_at := now();
  if new.created_at is null or new.created_at > now() then
    new.created_at := now();
  elsif new.created_at < now() - interval '2 days' then
    new.created_at := now() - interval '2 days';
  end if;
  if new.user_id is null and v_uid is not null then
    new.user_id := v_uid;
  end if;
  if new.event_id is not null then
    select e.event_id, e.status, e.review_status, e.magnitude, e.merged_into, e.origin_time
      into v_target, v_status, v_review, v_magnitude, v_merged_into, v_origin
      from public.events e
     where e.event_id = new.event_id;
    if v_target is not null and v_merged_into is not null then
      select e.event_id, e.status, e.review_status, e.magnitude, e.origin_time
        into v_target, v_status, v_review, v_magnitude, v_origin
        from public.events e
       where e.event_id = v_merged_into;
    end if;
    if v_target is null
       or coalesce(v_status, '') not in ('published', 'possible', 'unconfirmed')
       or (v_status = 'unconfirmed' and (v_review = 'deleted' or v_magnitude is null))
       or v_origin is null
       or new.created_at < v_origin - interval '10 minutes' then
      new.event_id := null;
    else
      new.event_id := v_target;
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.felt_reports_server_times() from public, anon, authenticated;
drop trigger if exists felt_reports_server_times on public.felt_reports;
create trigger felt_reports_server_times
  before insert on public.felt_reports
  for each row execute function public.felt_reports_server_times();

-- A4. The registration (0033 body) -----------------------------------------------------------------
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
    if not v_client then
      update public.event_source_records
      set verified_at = coalesce(verified_at, now())
      where provider = p_provider and provider_event_id = p_provider_event_id
        and review_status <> 'deleted';
    end if;
    return v_event_id;
  end if;

  if v_client and p_place_name is not null
     and (public.text_has_link(p_place_name)
          or p_place_name ~ '[[:cntrl:]]'
          or p_place_name ~ ('[' || chr(8234) || '-' || chr(8238) || chr(8294) || '-' || chr(8297) || ']')) then
    raise exception 'upsert_event_from_client: place must be plain text' using errcode = '22023';
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

  if v_client
     and (p_origin_time < now() - interval '400 days'
          or p_origin_time > now() + interval '5 minutes') then
    raise exception 'upsert_event_from_client: origin_time out of sane range: %', p_origin_time
      using errcode = '22023';
  end if;

  v_bml_id := public.allocate_bumelerze_id(
    extract(year from (p_origin_time at time zone 'utc'))::integer
  );

  insert into public.events (
    origin_time, lat, lon, depth_km, magnitude, mag_type, place, region_flag, bumelerze_id, status
  ) values (
    p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place_name,
    (p_lat between v_region_min_lat and v_region_max_lat
       and p_lon between v_region_min_lon and v_region_max_lon),
    v_bml_id,
    case when v_client then 'unconfirmed' else 'published' end
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
revoke all on function public.upsert_event_from_client(text, text, timestamp with time zone, double precision, double precision, numeric, numeric, text, text) from public, anon;
grant execute on function public.upsert_event_from_client(text, text, timestamp with time zone, double precision, double precision, numeric, numeric, text, text) to authenticated, service_role;

-- A5. The SHAKEmap worker needs a verified source (0072 body) -----------------------------------------
create or replace function public.events_request_shake_worker()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := coalesce(new.bumelerze_id, new.event_id::text);
  v_was boolean;
begin
  if new.status is distinct from 'published'
     or new.merged_into is not null
     or new.review_status = 'deleted'
     or new.origin_time < now() - interval '14 days'
     or not public.shake_worker_wanted(new.lat, new.lon, new.magnitude) then
    return new;
  end if;
  if (tg_op = 'UPDATE' or public.request_is_client())
     and not exists (
       select 1
         from public.event_source_records esr
        where esr.event_id = new.event_id
          and esr.review_status <> 'deleted'
          and esr.verified_at is not null
     ) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.request_shake_worker('new ' || v_key);
    return new;
  end if;
  v_was := old.status = 'published'
       and old.merged_into is null
       and old.review_status <> 'deleted'
       and public.shake_worker_wanted(old.lat, old.lon, old.magnitude);
  if not coalesce(v_was, false) then
    perform public.request_shake_worker('now mapped ' || v_key);
  elsif abs(coalesce(new.magnitude, 0) - coalesce(old.magnitude, 0)) >= 0.1
     or public.alert_distance_km(old.lat, old.lon, new.lat, new.lon) >= 5
     or abs(coalesce(new.depth_km, 0) - coalesce(old.depth_km, 0))
        >= greatest(5, 0.25 * abs(coalesce(old.depth_km, 0))) then
    perform public.request_shake_worker('revised ' || v_key);
  end if;
  return new;
end
$$;
revoke all on function public.events_request_shake_worker() from public, anon, authenticated;

-- B1. Hub comments: the town instead of the cell ------------------------------------------------------
alter table public.event_comments add column if not exists area_town text;

-- The gazetteer town (felt_towns, 0065) nearest the centre of a geohash
-- cell within 100 km (area_town, 0066), or null. Internal.
create or replace function public.geohash_area_town(p_geohash text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_point extensions.geometry;
begin
  if p_geohash is null or btrim(p_geohash) = '' then
    return null;
  end if;
  v_point := extensions.st_pointfromgeohash(p_geohash);
  return public.area_town(extensions.st_y(v_point), extensions.st_x(v_point));
exception when others then
  return null;
end
$$;
revoke all on function public.geohash_area_town(text) from public, anon, authenticated;

create or replace function public.event_comments_set_area_town()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.area_town := public.geohash_area_town(new.area_geohash);
  return new;
end
$$;
revoke all on function public.event_comments_set_area_town() from public, anon, authenticated;
drop trigger if exists event_comments_set_area_town on public.event_comments;
create trigger event_comments_set_area_town
  before insert or update of area_geohash on public.event_comments
  for each row execute function public.event_comments_set_area_town();

update public.event_comments c
   set area_town = public.geohash_area_town(c.area_geohash)
 where c.area_geohash is not null
   and c.area_town is distinct from public.geohash_area_town(c.area_geohash);
update public.event_comments c
   set area_town = null
 where c.area_geohash is null
   and c.area_town is not null;

-- B1. Removed comments are not read by others (0054 policy, 'removed' out) ----------------------------
drop policy if exists event_comments_read on public.event_comments;
create policy event_comments_read on public.event_comments
  for select to anon, authenticated
  using (
    user_id = auth.uid()
    or (public.my_has_permission('comments.moderate') and author_deleted_at is null)
    or (
      status = 'visible'
      and not exists (
        select 1 from public.blocks b
         where b.blocker_id = auth.uid()
           and b.blocked_id = event_comments.user_id
      )
      and not public.is_suspended(event_comments.user_id)
    )
  );

revoke select on public.event_comments from anon, authenticated;
grant select (comment_id, event_id, parent_id, user_id, body, area_town, status, helpful_count, reply_count, created_at, pinned_at) on public.event_comments to anon, authenticated;

-- The "Comment removed" rows the hub keeps: a removed top-level comment
-- that has a visible reply. Its id and time only.
create or replace function public.event_hub_removed(p_event_id uuid)
returns table (comment_id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.comment_id, c.created_at
    from public.event_comments c
   where c.event_id = p_event_id
     and c.parent_id is null
     and c.status = 'removed'
     and exists (
       select 1
         from public.event_comments r
        where r.parent_id = c.comment_id
          and r.status = 'visible'
          and not public.is_suspended(r.user_id)
     )
   order by c.created_at desc
   limit 200
$$;
revoke all on function public.event_hub_removed(uuid) from public;
grant execute on function public.event_hub_removed(uuid) to anon, authenticated;

-- B4. The hub's marks: roles of the people whose comments the caller sees there.
create or replace function public.event_hub_roles(p_event_id uuid)
returns table (user_id uuid, role text, org_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ur.user_id, ur.role, ur.org_name
    from public.user_roles ur
   where ur.user_id in (
     select c.user_id
       from public.event_comments c
      where c.event_id = p_event_id
        and c.user_id is not null
        and (
          (c.status = 'visible' and not public.is_suspended(c.user_id))
          or c.user_id = auth.uid()
          or (c.status = 'pending' and public.my_has_permission('comments.moderate'))
        )
   )
   order by ur.user_id, ur.role
$$;
revoke all on function public.event_hub_roles(uuid) from public;
grant execute on function public.event_hub_roles(uuid) to anon, authenticated;

-- B2. Felt comments and photos ------------------------------------------------------------------------
revoke select on public.felt_comments from anon, authenticated;
grant select (comment_id, report_id, body, moderation_status, created_at) on public.felt_comments to anon, authenticated;
revoke select on public.felt_photos from anon, authenticated;
grant select (photo_id, report_id, moderation_status, created_at) on public.felt_photos to anon, authenticated;

-- B3. Source records and map products -----------------------------------------------------------------
revoke select on public.event_source_records from anon, authenticated;
grant select (source_record_id, event_id, provider, provider_event_id, parsed_origin_time, parsed_lat, parsed_lon, parsed_depth_km, parsed_magnitude, parsed_mag_type, parsed_place, review_status, fetched_at, provider_updated_at, created_at, updated_at, author_agency, magnitude_author, verified_at) on public.event_source_records to anon, authenticated;
revoke select on public.shakemap_products from anon, authenticated;
grant select (product_id, event_id, producer, version, product_type, storage_path, data_used, created_at, review_status, reviewed_at, bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon) on public.shakemap_products to anon, authenticated;

-- B4. Ranks are not a public table --------------------------------------------------------------------
revoke select on public.user_roles from anon, authenticated;
drop policy if exists user_roles_read on public.user_roles;

-- Check: fail the whole paste if a part is missing ----------------------------------------------------
do $$
declare
  v_missing text[] := '{}'::text[];
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'events' and policyname = 'events_public_select'
       and qual like '%unconfirmed%'
  ) then
    v_missing := v_missing || 'events_public_select hides unconfirmed'::text;
  end if;
  if has_function_privilege('anon', 'public.upsert_event_from_client(text, text, timestamp with time zone, double precision, double precision, numeric, numeric, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.upsert_event_from_client(text, text, timestamp with time zone, double precision, double precision, numeric, numeric, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.upsert_event_from_client(text, text, timestamp with time zone, double precision, double precision, numeric, numeric, text, text)', 'execute') then
    v_missing := v_missing || 'upsert_event_from_client() grants'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'upsert_event_from_client'
       and p.prosrc like '%then ''unconfirmed'' else ''published''%'
       and p.prosrc like '%interval ''400 days''%'
       and p.prosrc like '%public.text_has_link(p_place_name)%'
  ) then
    v_missing := v_missing || 'upsert_event_from_client() rules'::text;
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.event_source_records'::regclass
       and t.tgname = 'source_records_publish_event' and not t.tgisinternal
  ) then
    v_missing := v_missing || 'source_records_publish_event trigger'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'felt_reports_server_times' and p.prosecdef
       and p.prosrc like '%''published'', ''possible'', ''unconfirmed''%'
  ) then
    v_missing := v_missing || 'felt_reports_server_times() keeps unconfirmed'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'events_request_shake_worker'
       and p.prosrc like '%esr.verified_at is not null%'
  ) then
    v_missing := v_missing || 'events_request_shake_worker() verified source'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'share_event_to_profile'
       and p.prosrc like '%e.status <> ''unconfirmed''%'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'surge_state'
       and p.prosrc like '%e.status = ''published''%'
  ) or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_hub_events'
       and p.prosrc like '%e.status <> ''unconfirmed''%'
  ) then
    v_missing := v_missing || 'share, surge or hub list leaves out unconfirmed'::text;
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'event_comments' and policyname = 'event_comments_read'
       and qual like '%removed%'
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'event_comments' and policyname = 'event_comments_read'
  ) then
    v_missing := v_missing || 'event_comments_read without removed'::text;
  end if;
  if has_column_privilege('anon', 'public.event_comments', 'area_geohash', 'select')
     or has_column_privilege('authenticated', 'public.event_comments', 'area_geohash', 'select')
     or has_column_privilege('anon', 'public.event_comments', 'hidden_reason', 'select')
     or has_column_privilege('anon', 'public.felt_comments', 'device_id', 'select')
     or has_column_privilege('authenticated', 'public.felt_comments', 'device_id', 'select')
     or has_column_privilege('anon', 'public.felt_photos', 'storage_path', 'select')
     or has_column_privilege('anon', 'public.felt_photos', 'moderated_by', 'select')
     or has_column_privilege('anon', 'public.event_source_records', 'raw_payload', 'select')
     or has_column_privilege('authenticated', 'public.event_source_records', 'raw_payload', 'select')
     or has_column_privilege('anon', 'public.shakemap_products', 'reviewed_by', 'select')
     or has_column_privilege('anon', 'public.user_roles', 'role', 'select')
     or has_column_privilege('authenticated', 'public.user_roles', 'role', 'select')
     or has_table_privilege('anon', 'public.user_roles', 'select') then
    v_missing := v_missing || 'hidden columns still readable'::text;
  end if;
  if not has_column_privilege('anon', 'public.event_comments', 'area_town', 'select')
     or not has_column_privilege('anon', 'public.event_comments', 'body', 'select')
     or not has_column_privilege('anon', 'public.event_source_records', 'provider_event_id', 'select')
     or not has_column_privilege('anon', 'public.shakemap_products', 'storage_path', 'select')
     or not has_column_privilege('service_role', 'public.event_source_records', 'raw_payload', 'select') then
    v_missing := v_missing || 'readable columns'::text;
  end if;
  if not has_function_privilege('anon', 'public.event_hub_removed(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.event_hub_roles(uuid)', 'execute')
     or has_function_privilege('anon', 'public.geohash_area_town(text)', 'execute')
     or has_function_privilege('authenticated', 'public.geohash_area_town(text)', 'execute') then
    v_missing := v_missing || 'hub functions grants'::text;
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'user_roles' and policyname = 'user_roles_read'
  ) then
    v_missing := v_missing || 'user_roles_read dropped'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '0077: not in place: %', array_to_string(v_missing, ', ');
  end if;
end
$$;
