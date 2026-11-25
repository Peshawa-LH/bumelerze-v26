-- 0084: Admin > Home screen (pre-launch checklist B2.6, stage 1; owner
-- approval of the wording and the five choices 2026-11-25).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- 1. home_notices: the message at the top of Home. Up to four texts (en,
--    ckb, kmr, ar), each at most 200 characters, at least one. Kind
--    'info' or 'important'. It shows from posting until ends_at (6 hours,
--    1, 3 or 7 days) or until it is removed. One message at a time: posting
--    removes the one shown now. Old rows stay as history.
-- 2. home_pins: earthquakes chosen to show at the top of Home, one row per
--    earthquake, until ends_at (1, 3, 7 or 30 days) or until removed. At
--    most 3 shown at a time. Only a published earthquake that is not merged
--    into another or deleted.
-- 3. Both tables: RLS on, no client privileges. Phones read them only
--    through home_extras(); admins write them only through the functions
--    below.
-- 4. home_extras(), for everyone (anon and authenticated): the message
--    shown now and the chosen earthquakes shown now, each earthquake with
--    the fields the app needs to draw its card and every provider id the
--    registry knows for it (so the app can find it in its own feed).
-- 5. New permission home.manage, for the admin rank only (choice 1). It
--    needs a two-step session like every permission (0076).
-- 6. Admin functions, each refusing a caller without home.manage (42501):
--    admin_home_screen() (what is shown now), admin_home_find_events
--    (search by Bumelerze id or place; with no search, the latest regional
--    earthquakes), admin_post_home_notice, admin_remove_home_notice,
--    admin_pin_home_event, admin_unpin_home_event. Text is cleaned
--    (direction-override and control characters out, spaces collapsed).
--    Errors (22023): home_notice_empty, home_notice_too_long, bad_kind,
--    bad_duration, event_not_found, too_many.
-- 7. Every change is written to the activity log: home_notice_post,
--    home_notice_remove, home_pin, home_unpin.
-- 8. A last block checks the result and fails the whole paste if a part is
--    missing.
--
-- Needs 0052 (write_audit), 0066 (action list), 0076 (has_permission with
-- two-step) and 0080 (strip_bidi_controls) as applied live.

-- 1. The message -----------------------------------------------------------------------------------
create table if not exists public.home_notices (
  notice_id uuid primary key default gen_random_uuid(),
  kind text not null default 'info',
  text_en text,
  text_ckb text,
  text_kmr text,
  text_ar text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  posted_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  constraint home_notices_kind check (kind in ('info', 'important')),
  constraint home_notices_length check (
    coalesce(char_length(text_en), 0) <= 200
    and coalesce(char_length(text_ckb), 0) <= 200
    and coalesce(char_length(text_kmr), 0) <= 200
    and coalesce(char_length(text_ar), 0) <= 200
  ),
  constraint home_notices_some_text check (
    coalesce(text_en, text_ckb, text_kmr, text_ar) is not null
  ),
  constraint home_notices_period check (ends_at > starts_at)
);
create index if not exists home_notices_shown_idx on public.home_notices (ends_at desc) where removed_at is null;
alter table public.home_notices enable row level security;
revoke all on public.home_notices from public, anon, authenticated;

-- 2. The chosen earthquakes ------------------------------------------------------------------------
create table if not exists public.home_pins (
  event_id uuid primary key references public.events (event_id) on delete cascade,
  pinned_at timestamptz not null default now(),
  ends_at timestamptz not null,
  pinned_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  constraint home_pins_period check (ends_at > pinned_at)
);
alter table public.home_pins enable row level security;
revoke all on public.home_pins from public, anon, authenticated;

-- 3. The permission --------------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('admin', 'home.manage')
on conflict do nothing;

-- 4. The activity log accepts the new actions (union with the live list, as in 0066) ---------------
do $$
declare
  c record;
  v_found text[];
  v_list text;
  v_actions text[] := array['home_notice_post', 'home_notice_remove', 'home_pin', 'home_unpin'];
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%comment_approve%'
  loop
    select coalesce(array_agg(r.m[1]), '{}'::text[]) into v_found
      from regexp_matches(c.def, '''([a-z_]+)''', 'g') as r(m);
    v_found := v_found || coalesce((
      select array_agg(x)
        from regexp_matches(c.def, '''[{]([a-z_,]+)[}]''', 'g') as r(m),
             unnest(string_to_array(r.m[1], ',')) as x), '{}'::text[]);
    v_actions := v_actions || v_found;
    execute format('alter table public.moderation_log drop constraint %I', c.conname);
  end loop;
  select string_agg(quote_literal(a), ', ' order by a) into v_list
    from (select distinct a from unnest(v_actions) as a where a <> 'text') d;
  execute format(
    'alter table public.moderation_log add constraint moderation_log_action_check check (action in (%s))',
    v_list);
end
$$;

-- 5. Text cleaning: no direction overrides or control characters, one paragraph, empty is null -----
create or replace function public.home_notice_clean(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(public.strip_bidi_controls(coalesce(p_text, '')), '[[:cntrl:]]', ' ', 'g'),
      '\s+', ' ', 'g')),
    '')
$$;

-- One earthquake as the app draws it (the events_with_sources row shape plus every provider id).
create or replace function public.home_event_json(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'event_id', e.event_id,
           'bumelerze_id', e.bumelerze_id,
           'origin_time', e.origin_time,
           'lat', e.lat,
           'lon', e.lon,
           'depth_km', e.depth_km,
           'magnitude', e.magnitude,
           'mag_type', e.mag_type,
           'place', e.place,
           'updated_at', e.updated_at,
           'sources', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'provider', s.provider,
                      'provider_event_id', s.provider_event_id,
                      'fetched_at', s.fetched_at)
                    order by s.fetched_at)
               from public.event_source_records s
              where s.event_id = e.event_id), '[]'::jsonb))
    from public.events e
   where e.event_id = p_event_id
$$;

-- 6. What phones read ------------------------------------------------------------------------------
create or replace function public.home_extras()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'notice', (
      select jsonb_build_object(
               'notice_id', n.notice_id,
               'kind', n.kind,
               'texts', jsonb_strip_nulls(jsonb_build_object(
                 'en', n.text_en, 'ckb', n.text_ckb, 'kmr', n.text_kmr, 'ar', n.text_ar)),
               'starts_at', n.starts_at,
               'ends_at', n.ends_at)
        from public.home_notices n
       where n.removed_at is null
         and n.starts_at <= now()
         and n.ends_at > now()
       order by n.starts_at desc
       limit 1),
    'pins', coalesce((
      select jsonb_agg(public.home_event_json(x.event_id) || jsonb_build_object('pinned_at', x.pinned_at, 'ends_at', x.ends_at)
                       order by x.origin_time desc)
        from (
          select p.event_id, p.pinned_at, p.ends_at, e.origin_time
            from public.home_pins p
            join public.events e on e.event_id = p.event_id
           where p.removed_at is null
             and p.ends_at > now()
             and e.merged_into is null
             and e.review_status <> 'deleted'
             and e.status = 'published'
           order by p.pinned_at desc
           limit 3
        ) x), '[]'::jsonb)
  )
$$;

-- 7. Admin: what is shown now ----------------------------------------------------------------------
create or replace function public.admin_home_screen()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_notice jsonb;
  v_pins jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'home.manage') then
    raise exception 'admin_home_screen: not_allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'notice_id', n.notice_id,
           'kind', n.kind,
           'texts', jsonb_strip_nulls(jsonb_build_object(
             'en', n.text_en, 'ckb', n.text_ckb, 'kmr', n.text_kmr, 'ar', n.text_ar)),
           'starts_at', n.starts_at,
           'ends_at', n.ends_at)
    into v_notice
    from public.home_notices n
   where n.removed_at is null
     and n.starts_at <= now()
     and n.ends_at > now()
   order by n.starts_at desc
   limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id', e.event_id, 'bumelerze_id', e.bumelerze_id, 'place', e.place,
           'magnitude', e.magnitude, 'origin_time', e.origin_time,
           'pinned_at', p.pinned_at, 'ends_at', p.ends_at)
           order by e.origin_time desc), '[]'::jsonb)
    into v_pins
    from public.home_pins p
    join public.events e on e.event_id = p.event_id
   where p.removed_at is null
     and p.ends_at > now()
     and e.merged_into is null
     and e.review_status <> 'deleted'
     and e.status = 'published';
  return jsonb_build_object('notice', v_notice, 'pins', v_pins);
end
$$;

-- Admin: find an earthquake (same search as Open a hub, 0077 body: by Bumelerze id or place;
-- with no search the latest regional earthquakes). Only published ones can be chosen.
create or replace function public.admin_home_find_events(p_query text default null, p_limit integer default 20)
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
  v_found jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'home.manage') then
    raise exception 'admin_home_find_events: not_allowed' using errcode = '42501';
  end if;
  v_id := regexp_replace(v_q, '[^a-z0-9]', '', 'g');
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) into v_found
    from (
      select e.origin_time as t, jsonb_build_object(
               'event_id', e.event_id, 'bumelerze_id', e.bumelerze_id, 'place', e.place,
               'magnitude', e.magnitude, 'origin_time', e.origin_time,
               'pinned_until', (select p.ends_at from public.home_pins p
                                 where p.event_id = e.event_id and p.removed_at is null and p.ends_at > now())) as j
        from public.events e
       where e.merged_into is null
         and e.review_status <> 'deleted'
         and e.status = 'published'
         and (
           (v_q = '' and e.region_flag and e.bumelerze_id is not null)
           or (v_q <> '' and v_id <> '' and lower(e.bumelerze_id) like v_id || '%')
           or (v_q <> '' and e.place ilike v_like)
         )
       order by e.origin_time desc
       limit v_limit
    ) x;
  return v_found;
end
$$;

-- Admin: post the message (replaces the one shown now) ---------------------------------------------
create or replace function public.admin_post_home_notice(
  p_kind text,
  p_text_en text,
  p_text_ckb text,
  p_text_kmr text,
  p_text_ar text,
  p_hours integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_en text := public.home_notice_clean(p_text_en);
  v_ckb text := public.home_notice_clean(p_text_ckb);
  v_kmr text := public.home_notice_clean(p_text_kmr);
  v_ar text := public.home_notice_clean(p_text_ar);
  v_id uuid;
  v_ends timestamptz;
begin
  if v_uid is null or not public.has_permission(v_uid, 'home.manage') then
    raise exception 'admin_post_home_notice: not_allowed' using errcode = '42501';
  end if;
  if coalesce(p_kind, '') not in ('info', 'important') then
    raise exception 'admin_post_home_notice: bad_kind' using errcode = '22023';
  end if;
  if coalesce(p_hours, 0) not in (6, 24, 72, 168) then
    raise exception 'admin_post_home_notice: bad_duration' using errcode = '22023';
  end if;
  if coalesce(v_en, v_ckb, v_kmr, v_ar) is null then
    raise exception 'admin_post_home_notice: home_notice_empty' using errcode = '22023';
  end if;
  if greatest(coalesce(char_length(v_en), 0), coalesce(char_length(v_ckb), 0),
              coalesce(char_length(v_kmr), 0), coalesce(char_length(v_ar), 0)) > 200 then
    raise exception 'admin_post_home_notice: home_notice_too_long' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('home_notices'));
  update public.home_notices
     set removed_at = now(), removed_by = v_uid
   where removed_at is null
     and ends_at > now();
  v_ends := now() + make_interval(hours => p_hours);
  insert into public.home_notices (kind, text_en, text_ckb, text_kmr, text_ar, starts_at, ends_at, posted_by)
  values (p_kind, v_en, v_ckb, v_kmr, v_ar, now(), v_ends, v_uid)
  returning notice_id into v_id;
  perform public.write_audit(
    v_uid, 'home_notice_post', 'system', v_id::text,
    null, null, null, null, left(coalesce(v_en, v_ckb, v_kmr, v_ar), 500),
    jsonb_build_object('kind', p_kind, 'hours', p_hours, 'ends_at', v_ends,
                       'texts', jsonb_strip_nulls(jsonb_build_object('en', v_en, 'ckb', v_ckb, 'kmr', v_kmr, 'ar', v_ar))));
  return v_id;
end
$$;

-- Admin: remove the message shown now. True when one was removed.
create or replace function public.admin_remove_home_notice()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or not public.has_permission(v_uid, 'home.manage') then
    raise exception 'admin_remove_home_notice: not_allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('home_notices'));
  v_id := null;
  for v_id in
    update public.home_notices
       set removed_at = now(), removed_by = v_uid
     where removed_at is null
       and ends_at > now()
    returning notice_id
  loop
    perform public.write_audit(v_uid, 'home_notice_remove', 'system', v_id::text);
  end loop;
  return v_id is not null;
end
$$;

-- Admin: show an earthquake on Home (again: a new end time) ----------------------------------------
create or replace function public.admin_pin_home_event(p_event_id uuid, p_days integer)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ends timestamptz;
  v_bml text;
  v_shown integer;
begin
  if v_uid is null or not public.has_permission(v_uid, 'home.manage') then
    raise exception 'admin_pin_home_event: not_allowed' using errcode = '42501';
  end if;
  if coalesce(p_days, 0) not in (1, 3, 7, 30) then
    raise exception 'admin_pin_home_event: bad_duration' using errcode = '22023';
  end if;
  select e.bumelerze_id into v_bml
    from public.events e
   where e.event_id = p_event_id
     and e.merged_into is null
     and e.review_status <> 'deleted'
     and e.status = 'published';
  if not found then
    raise exception 'admin_pin_home_event: event_not_found' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('home_pins'));
  select count(*) into v_shown
    from public.home_pins p
    join public.events e on e.event_id = p.event_id
   where p.removed_at is null
     and p.ends_at > now()
     and p.event_id <> p_event_id
     and e.merged_into is null
     and e.review_status <> 'deleted'
     and e.status = 'published';
  if v_shown >= 3 then
    raise exception 'admin_pin_home_event: too_many' using errcode = '22023';
  end if;
  v_ends := now() + make_interval(days => p_days);
  insert into public.home_pins (event_id, pinned_at, ends_at, pinned_by, removed_at, removed_by)
  values (p_event_id, now(), v_ends, v_uid, null, null)
  on conflict (event_id) do update
    set pinned_at = excluded.pinned_at,
        ends_at = excluded.ends_at,
        pinned_by = excluded.pinned_by,
        removed_at = null,
        removed_by = null;
  perform public.write_audit(
    v_uid, 'home_pin', 'event', p_event_id::text,
    null, null, null, null, v_bml,
    jsonb_build_object('days', p_days, 'ends_at', v_ends, 'bumelerze_id', v_bml));
  return v_ends;
end
$$;

-- Admin: take an earthquake off Home. True when it was shown.
create or replace function public.admin_unpin_home_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_bml text;
begin
  if v_uid is null or not public.has_permission(v_uid, 'home.manage') then
    raise exception 'admin_unpin_home_event: not_allowed' using errcode = '42501';
  end if;
  update public.home_pins
     set removed_at = now(), removed_by = v_uid
   where event_id = p_event_id
     and removed_at is null
     and ends_at > now();
  if not found then
    return false;
  end if;
  select e.bumelerze_id into v_bml from public.events e where e.event_id = p_event_id;
  perform public.write_audit(
    v_uid, 'home_unpin', 'event', p_event_id::text,
    null, null, null, null, v_bml, jsonb_build_object('bumelerze_id', v_bml));
  return true;
end
$$;

-- Who may call what --------------------------------------------------------------------------------
revoke all on function public.home_notice_clean(text) from public, anon, authenticated;
revoke all on function public.home_event_json(uuid) from public, anon, authenticated;
revoke all on function public.home_extras() from public;
grant execute on function public.home_extras() to anon, authenticated;
revoke all on function public.admin_home_screen() from public, anon;
grant execute on function public.admin_home_screen() to authenticated;
revoke all on function public.admin_home_find_events(text, integer) from public, anon;
grant execute on function public.admin_home_find_events(text, integer) to authenticated;
revoke all on function public.admin_post_home_notice(text, text, text, text, text, integer) from public, anon;
grant execute on function public.admin_post_home_notice(text, text, text, text, text, integer) to authenticated;
revoke all on function public.admin_remove_home_notice() from public, anon;
grant execute on function public.admin_remove_home_notice() to authenticated;
revoke all on function public.admin_pin_home_event(uuid, integer) from public, anon;
grant execute on function public.admin_pin_home_event(uuid, integer) to authenticated;
revoke all on function public.admin_unpin_home_event(uuid) from public, anon;
grant execute on function public.admin_unpin_home_event(uuid) to authenticated;

-- Check ------------------------------------------------------------------------------------------
do $$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.home_notices') is null
     or to_regclass('public.home_pins') is null
     or has_table_privilege('anon', 'public.home_notices', 'select')
     or has_table_privilege('authenticated', 'public.home_notices', 'select')
     or has_table_privilege('anon', 'public.home_pins', 'select')
     or has_table_privilege('authenticated', 'public.home_pins', 'select')
     or has_table_privilege('authenticated', 'public.home_pins', 'insert')
     or has_table_privilege('authenticated', 'public.home_notices', 'insert') then
    v_missing := v_missing || 'tables closed to clients'::text;
  end if;
  if not exists (select 1 from pg_class where oid = 'public.home_notices'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.home_pins'::regclass and relrowsecurity) then
    v_missing := v_missing || 'row level security'::text;
  end if;
  if not exists (select 1 from public.role_permissions where role = 'admin' and permission = 'home.manage')
     or exists (select 1 from public.role_permissions where role <> 'admin' and permission = 'home.manage') then
    v_missing := v_missing || 'home.manage for admin only'::text;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and conname = 'moderation_log_action_check'
       and pg_get_constraintdef(oid) like '%home_notice_post%'
       and pg_get_constraintdef(oid) like '%home_unpin%'
       and pg_get_constraintdef(oid) like '%hub_note%'
  ) then
    v_missing := v_missing || 'activity log actions'::text;
  end if;
  if not has_function_privilege('anon', 'public.home_extras()', 'execute')
     or not has_function_privilege('authenticated', 'public.home_extras()', 'execute')
     or has_function_privilege('anon', 'public.home_event_json(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.home_event_json(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.home_notice_clean(text)', 'execute') then
    v_missing := v_missing || 'home_extras grants'::text;
  end if;
  if has_function_privilege('anon', 'public.admin_home_screen()', 'execute')
     or has_function_privilege('anon', 'public.admin_home_find_events(text, integer)', 'execute')
     or has_function_privilege('anon', 'public.admin_post_home_notice(text, text, text, text, text, integer)', 'execute')
     or has_function_privilege('anon', 'public.admin_remove_home_notice()', 'execute')
     or has_function_privilege('anon', 'public.admin_pin_home_event(uuid, integer)', 'execute')
     or has_function_privilege('anon', 'public.admin_unpin_home_event(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_post_home_notice(text, text, text, text, text, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_pin_home_event(uuid, integer)', 'execute') then
    v_missing := v_missing || 'admin function grants'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '0084: not in place: %', array_to_string(v_missing, ', ');
  end if;
end
$$;
