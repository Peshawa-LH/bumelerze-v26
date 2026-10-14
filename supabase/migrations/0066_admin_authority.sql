-- 0066: admin tools and the Government official role (Stage 6, owner
-- decisions 2026-10-13 and answer 7 of the rebuild review).
--
--   1. A new public rank "authority", shown in the app as "Government
--      official". It is NOT an admin rank: it holds one permission,
--      authority.view, which opens the Officials page and nothing else.
--      holds_admin_permission() ignores authority.* permissions, so an
--      official is not protected from limits the way staff are. Admins give
--      and take it like any other badge (admin_grant_role and
--      admin_revoke_role learn the rank). NOBODY is given it here.
--   2. Two new staff permissions for the official rank and the private admin
--      rank: stats.read (Admin > Statistics) and hubs.open (Admin > Open a
--      hub for an earthquake, which also posts the pinned note as the
--      official account, owner answer 7).
--   3. authority_sharing: each account holder's own switch "Let government
--      officials see my building's safety estimate and my I'm safe status".
--      Default OFF (no row means off). Set through set_authority_sharing(),
--      read through my_authority_sharing(); no client reads or writes the
--      table. The row goes with the account (foreign key on delete cascade)
--      and is part of Download my data.
--   4. Officials see AGGREGATES first:
--        authority_overview()          tagged homes by vulnerability class
--                                      per area (the app's gazetteer towns,
--                                      within 100 km, else "other"), and the
--                                      recent earthquakes with check-ins
--        authority_event_safety(event) members of tagged homes per area and
--                                      how many checked in safe
--      Small numbers are protected ON THE SERVER: an area with fewer than 5
--      homes or people is pooled into "other"; any cell under 5 is sent as
--      null ("fewer than 5"); no total is sent that could be subtracted to
--      recover a hidden cell (class totals are sums of the shown cells).
--      Individual data only for people who switched sharing on:
--        authority_people()            name, area (town id, never a
--                                      coordinate or address), most likely
--                                      class and range of each of their
--                                      homes, and their latest I'm safe
--      Every call writes a row to the activity log (moderation_log).
--   5. admin_stats(days): counts only for Admin > Statistics (no names,
--      locations or device ids). admin_tool_counts(): the status line of
--      each tile on the admin launcher, only for tools the caller may open.
--   6. Open a hub: admin_hub_events(query), admin_set_hub_open(event, on),
--      admin_post_hub_note(event, text). The note is written as the
--      official account (username bumelerze, the official rank), visible
--      and pinned; the activity log names the real person who did it.
--   7. Download my data wraps the 0065 export once and adds the sharing
--      switch.
--   8. Security audit 10.2 of SECURITY DEFINER functions callable by anon:
--      can_view_posts_of() is a helper no policy and no app code calls, so
--      nobody may call it directly; is_home_member() and is_home_owner()
--      are used only by policies for signed-in sessions, so anon loses them.
--      Every other anon-callable definer function is meant to be public and
--      checks for itself (list in the review report).
--
-- Needs 0035-0065. Idempotent: safe to run twice. Written for the SQL editor
-- as one line: no transaction statements, only full-line comments, ASCII
-- only, no question marks.

-- 1. The authority rank ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.user_roles'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%seismologist%'
  loop
    execute format('alter table public.user_roles drop constraint %I', c.conname);
  end loop;
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.role_permissions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%seismologist%'
  loop
    execute format('alter table public.role_permissions drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in (
    'official', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner',
    'authority'
  ));
alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions
  add constraint role_permissions_role_check
  check (role in (
    'official', 'admin', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner',
    'authority'
  ));

insert into public.role_permissions (role, permission) values
  ('authority', 'authority.view'),
  ('official', 'stats.read'),
  ('admin', 'stats.read'),
  ('official', 'hubs.open'),
  ('admin', 'hubs.open')
on conflict do nothing;

-- Staff test: any permission EXCEPT authority.* (0060 definition plus that
-- filter). A government official is not staff.
create or replace function public.holds_admin_permission(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and (
       exists (
         select 1
           from public.user_roles r
           join public.role_permissions rp on rp.role = r.role
          where r.user_id = p_user
            and rp.permission not like 'authority.%'
       )
       or exists (
         select 1
           from public.private_ranks k
           join public.role_permissions rp on rp.role = k.role
          where k.user_id = p_user
            and rp.permission not like 'authority.%'
       )
     )
$$;

-- The rank the activity log records (0060 definition plus authority).
create or replace function public.audit_actor_rank(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select x.role
    from (
      select r.role from public.user_roles r where r.user_id = p_user
      union
      select k.role from public.private_ranks k where k.user_id = p_user
    ) x
   order by array_position(
              array['official', 'admin', 'moderator', 'authority', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'],
              x.role)
   limit 1
$$;

-- "You received a badge" in the person's own activity (0061 plus authority).
create or replace function public.activity_on_roles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.role in ('official', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner', 'authority') then
      perform public.activity_add(new.user_id, 'badge_granted', null, 'badge:' || new.role,
        p_meta => jsonb_build_object('role', new.role, 'org_name', new.org_name));
    end if;
    return new;
  end if;
  delete from public.activity_items
   where user_id = old.user_id and dedupe_key = 'badge:' || old.role;
  return old;
end
$$;

-- Grant (0052 definition; the authority rank may now be given).
create or replace function public.admin_grant_role(
  p_username text,
  p_role text,
  p_org_name text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_org text;
  v_note text;
  v_previous jsonb;
begin
  if not public.has_permission(v_uid, 'badges.grant') then
    raise exception 'admin_grant_role: not allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner', 'authority') then
    raise exception 'admin_grant_role: this rank cannot be granted here' using errcode = '22023';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    raise exception 'admin_grant_role: user not found' using errcode = 'P0002';
  end if;
  v_org := case when p_role = 'partner' then nullif(left(btrim(coalesce(p_org_name, '')), 80), '') else null end;
  v_note := nullif(left(btrim(coalesce(p_note, '')), 200), '');
  select jsonb_build_object(
           'org_name', r.org_name, 'note', r.note,
           'granted_by', r.granted_by, 'granted_at', r.granted_at)
    into v_previous
    from public.user_roles r
   where r.user_id = v_target and r.role = p_role;
  insert into public.user_roles (user_id, role, org_name, granted_by, granted_at, note)
  values (v_target, p_role, v_org, v_uid, now(), v_note)
  on conflict (user_id, role) do update
    set org_name = excluded.org_name,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        note = excluded.note;
  perform public.write_audit(
    v_uid, 'role_grant', 'rank', v_target::text,
    v_target, null, null, p_role, null,
    jsonb_build_object('role', p_role, 'org_name', v_org, 'note', v_note, 'previous', v_previous)
  );
end
$$;

-- Revoke (0052 definition; the authority rank may now be taken away).
create or replace function public.admin_revoke_role(p_username text, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_snapshot jsonb;
begin
  if not public.has_permission(v_uid, 'badges.grant') then
    raise exception 'admin_revoke_role: not allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner', 'authority') then
    raise exception 'admin_revoke_role: this rank cannot be revoked here' using errcode = '22023';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    raise exception 'admin_revoke_role: user not found' using errcode = 'P0002';
  end if;
  delete from public.user_roles r
   where r.user_id = v_target and r.role = p_role
  returning jsonb_build_object(
              'role', r.role, 'org_name', r.org_name, 'note', r.note,
              'granted_by', r.granted_by, 'granted_at', r.granted_at)
       into v_snapshot;
  if not found then
    raise exception 'admin_revoke_role: rank not held' using errcode = 'P0002';
  end if;
  perform public.write_audit(
    v_uid, 'role_revoke', 'rank', v_target::text,
    v_target, null, null, p_role, null, v_snapshot
  );
end
$$;

-- 2. Log actions and target types: what is there now, plus the new ones -----------------------------
do $$
declare
  c record;
  v_found text[];
  v_list text;
  v_actions text[] := array[
    'comment_approve', 'comment_hide', 'comment_remove', 'comment_restore',
    'role_grant', 'role_revoke', 'role_restore',
    'profile_reports_resolve', 'report_reopen',
    'post_remove', 'post_restore', 'post_reports_dismiss',
    'password_reset', 'profile_reset', 'profile_restore',
    'restrict', 'suspend', 'lift',
    'person_view', 'email_reveal', 'purge',
    'feedback_status', 'report_photo_approve', 'report_photo_reject',
    'hub_open', 'hub_close', 'hub_note',
    'authority_view', 'authority_people_view'
  ];
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

do $$
declare
  c record;
  v_found text[];
  v_list text;
  v_types text[] := array[
    'comment', 'post', 'profile', 'account', 'rank', 'report', 'home', 'feedback', 'person', 'system',
    'felt_photo', 'event'
  ];
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%target_type%'
  loop
    select coalesce(array_agg(r.m[1]), '{}'::text[]) into v_found
      from regexp_matches(c.def, '''([a-z_]+)''', 'g') as r(m);
    v_found := v_found || coalesce((
      select array_agg(x)
        from regexp_matches(c.def, '''[{]([a-z_,]+)[}]''', 'g') as r(m),
             unnest(string_to_array(r.m[1], ',')) as x), '{}'::text[]);
    v_types := v_types || v_found;
    execute format('alter table public.moderation_log drop constraint %I', c.conname);
  end loop;
  select string_agg(quote_literal(a), ', ' order by a) into v_list
    from (select distinct a from unnest(v_types) as a where a <> 'text') d;
  execute format(
    'alter table public.moderation_log add constraint moderation_log_target_type_check check (target_type is null or target_type in (%s))',
    v_list);
end
$$;

-- 3. The sharing switch ---------------------------------------------------------------------------
create table if not exists public.authority_sharing (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  changed_at timestamptz not null default now()
);
alter table public.authority_sharing enable row level security;
revoke all on public.authority_sharing from public, anon, authenticated;
-- No policies on purpose: reads and writes go through the functions below.

create or replace function public.my_authority_sharing()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.authority_sharing%rowtype;
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'my_authority_sharing: not_account' using errcode = '42501';
  end if;
  select * into v_row from public.authority_sharing s where s.user_id = v_uid;
  if not found then
    return jsonb_build_object('enabled', false, 'changed_at', null);
  end if;
  return jsonb_build_object('enabled', v_row.enabled, 'changed_at', v_row.changed_at);
end
$$;

create or replace function public.set_authority_sharing(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'set_authority_sharing: not_account' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'set_authority_sharing: invalid' using errcode = '22023';
  end if;
  insert into public.authority_sharing (user_id, enabled, changed_at)
  values (v_uid, p_enabled, now())
  on conflict (user_id) do update
    set enabled = excluded.enabled,
        changed_at = excluded.changed_at
  where public.authority_sharing.enabled is distinct from excluded.enabled;
  return public.my_authority_sharing();
end
$$;

-- 4. Areas and the official's aggregates ------------------------------------------------------------
-- The area of a point: the nearest gazetteer town (felt_towns, 0065) within
-- 100 km, else null. Internal, never callable by clients.
create or replace function public.area_town(p_lat double precision, p_lon double precision)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select n.town_id
    from (
      select t.town_id,
             111.195 * sqrt(
               power(p_lat - t.lat, 2)
               + power((p_lon - t.lon) * cos(radians((p_lat + t.lat) / 2)), 2)
             ) as km
        from public.felt_towns t
       order by km, t.town_id
       limit 1
    ) n
   where p_lat is not null and p_lon is not null and n.km <= 100
$$;

-- Tagged homes by class per area, and the recent earthquakes with check-ins.
-- Areas with fewer than 5 assessed homes are pooled into "other"; a cell
-- under 5 is null. Class totals are sums of the cells that are shown.
create or replace function public.authority_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_areas jsonb;
  v_classes jsonb;
  v_events jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'authority.view') then
    raise exception 'authority_overview: not_allowed' using errcode = '42501';
  end if;

  with latest as (
    select distinct on (a.tag_id) a.tag_id, a.vc_most_likely as vc
      from public.home_assessments a
     order by a.tag_id, a.created_at desc
  ),
  homes as (
    select coalesce(public.area_town(h.lat, h.lon), 'other') as area, l.vc
      from public.home_tags h
      join latest l on l.tag_id = h.tag_id
     where h.status = 'active'
  ),
  sized as (
    select homes.area, count(*) as n from homes group by homes.area
  ),
  pooled as (
    select case when s.n >= 5 and homes.area <> 'other' then homes.area else 'other' end as area, homes.vc
      from homes join sized s on s.area = homes.area
  ),
  area_sizes as (
    select pooled.area, count(*) as total from pooled group by pooled.area
  ),
  grid as (
    select a.area, v.vc,
           (select count(*) from pooled p where p.area = a.area and p.vc = v.vc) as n
      from area_sizes a
      cross join (values ('A'), ('B'), ('C'), ('D'), ('E'), ('F')) as v(vc)
     where a.total >= 5
  ),
  shown as (
    select g.area, g.vc, case when g.n >= 5 then g.n end as n from grid g
  ),
  per_area as (
    select s.area,
           jsonb_object_agg(s.vc, s.n) as classes,
           coalesce(sum(s.n), 0) as shown_total
      from shown s
     group by s.area
  )
  select coalesce(jsonb_agg(jsonb_build_object('area', pa.area, 'classes', pa.classes)
                            order by (pa.area = 'other'), pa.shown_total desc, pa.area), '[]'::jsonb),
         (select jsonb_object_agg(v.vc, coalesce((select sum(s.n) from shown s where s.vc = v.vc), 0))
            from (values ('A'), ('B'), ('C'), ('D'), ('E'), ('F')) as v(vc))
    into v_areas, v_classes
    from per_area pa;

  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id', x.event_id, 'bumelerze_id', x.bumelerze_id, 'magnitude', x.magnitude,
           'place', x.place, 'origin_time', x.origin_time, 'checkins', x.n)
           order by x.origin_time desc), '[]'::jsonb)
    into v_events
    from (
      select e.event_id, e.bumelerze_id, e.magnitude, e.place, e.origin_time,
             count(distinct c.user_id) as n
        from public.safety_checkins c
        join public.events e on e.event_id = c.event_id
       where c.status = 'safe'
         and c.created_at > now() - interval '30 days'
       group by e.event_id, e.bumelerze_id, e.magnitude, e.place, e.origin_time
      having count(distinct c.user_id) >= 5
       order by e.origin_time desc
       limit 20
    ) x;

  perform public.write_audit(
    v_uid, 'authority_view', 'system', null, null, null, null, null, null,
    jsonb_build_object('view', 'overview')
  );
  return jsonb_build_object(
    'min_count', 5,
    'areas', coalesce(v_areas, '[]'::jsonb),
    'classes', v_classes,
    'events', v_events
  );
end
$$;

-- After one earthquake: approved members of active tagged homes per area
-- (each person once per area) and how many of them checked in safe for it.
-- Fewer than 5 people: pooled into "other"; fewer than 5 safe: null.
create or replace function public.authority_event_safety(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ev record;
  v_areas jsonb;
  v_total integer;
begin
  if v_uid is null or not public.has_permission(v_uid, 'authority.view') then
    raise exception 'authority_event_safety: not_allowed' using errcode = '42501';
  end if;
  select e.event_id, e.bumelerze_id, e.magnitude, e.place, e.origin_time
    into v_ev
    from public.events e
   where e.event_id = p_event_id;
  if not found then
    raise exception 'authority_event_safety: not_found' using errcode = 'P0002';
  end if;

  with people as (
    select distinct coalesce(public.area_town(h.lat, h.lon), 'other') as area, m.user_id
      from public.home_members m
      join public.home_tags h on h.tag_id = m.tag_id
     where m.status = 'approved'
       and h.status = 'active'
  ),
  marked as (
    select p.area, p.user_id,
           exists (
             select 1 from public.safety_checkins c
              where c.user_id = p.user_id
                and c.event_id = p_event_id
                and c.status = 'safe'
           ) as safe
      from people p
  ),
  sized as (
    select marked.area, count(*) as n from marked group by marked.area
  ),
  pooled as (
    select distinct case when s.n >= 5 and m.area <> 'other' then m.area else 'other' end as area,
           m.user_id, m.safe
      from marked m join sized s on s.area = m.area
  ),
  rows as (
    select p.area, count(distinct p.user_id) as people,
           count(distinct p.user_id) filter (where p.safe) as safe
      from pooled p
     group by p.area
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'area', r.area,
           'people', r.people,
           'safe', case when r.safe >= 5 then r.safe end)
           order by (r.area = 'other'), r.people desc, r.area), '[]'::jsonb)
    into v_areas
    from rows r
   where r.people >= 5;

  select count(distinct c.user_id)::integer into v_total
    from public.safety_checkins c
   where c.event_id = p_event_id and c.status = 'safe';

  perform public.write_audit(
    v_uid, 'authority_view', 'system', p_event_id::text, null, null, null, null, null,
    jsonb_build_object('view', 'event_safety', 'event_id', p_event_id)
  );
  return jsonb_build_object(
    'min_count', 5,
    'event', jsonb_build_object(
      'event_id', v_ev.event_id, 'bumelerze_id', v_ev.bumelerze_id, 'magnitude', v_ev.magnitude,
      'place', v_ev.place, 'origin_time', v_ev.origin_time),
    'checkins', case when v_total >= 5 then v_total end,
    'areas', v_areas
  );
end
$$;

-- People who switched sharing on: their name, the area and class of each of
-- their homes, their latest I'm safe. Never a coordinate, an address, a
-- device or an email. The log row lists who was shown.
create or replace function public.authority_people(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_ids jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'authority.view') then
    raise exception 'authority_people: not_allowed' using errcode = '42501';
  end if;

  with chosen as (
    select s.user_id, p.username, p.display_name,
           lower(coalesce(p.display_name, p.username, '')) as sort_key
      from public.authority_sharing s
      join auth.users u on u.id = s.user_id and coalesce(u.is_anonymous, false) = false
      left join public.profiles p on p.user_id = s.user_id
     where s.enabled
     order by sort_key, s.user_id
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', ch.user_id,
           'username', ch.username,
           'display_name', ch.display_name,
           'homes', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'area', public.area_town(h.lat, h.lon),
                      'kind', h.kind,
                      'vc', l.vc_most_likely,
                      'vc_range', l.vc_range)
                    order by h.created_at)
               from public.home_members m
               join public.home_tags h on h.tag_id = m.tag_id and h.status = 'active'
               left join lateral (
                 select a.vc_most_likely, a.vc_range
                   from public.home_assessments a
                  where a.tag_id = h.tag_id
                  order by a.created_at desc
                  limit 1
               ) l on true
              where m.user_id = ch.user_id and m.status = 'approved'
           ), '[]'::jsonb),
           'safe', (
             select jsonb_build_object(
                      'checked_in_at', c.checked_in_at,
                      'event_id', e.event_id,
                      'bumelerze_id', e.bumelerze_id,
                      'magnitude', e.magnitude,
                      'place', e.place,
                      'origin_time', e.origin_time)
               from public.safety_checkins c
               join public.events e on e.event_id = c.event_id
              where c.user_id = ch.user_id and c.status = 'safe'
              order by c.checked_in_at desc
              limit 1
           )) order by ch.sort_key, ch.user_id), '[]'::jsonb),
         coalesce(jsonb_agg(ch.user_id order by ch.sort_key, ch.user_id), '[]'::jsonb)
    into v_rows, v_ids
    from chosen ch;

  perform public.write_audit(
    v_uid, 'authority_people_view', 'system', null, null, null, null, null, null,
    jsonb_build_object('count', jsonb_array_length(v_rows), 'user_ids', v_ids)
  );
  return jsonb_build_object('people', v_rows);
end
$$;

-- 5. Statistics and the launcher's status lines ---------------------------------------------------
-- Counts only. p_days: 7, 30 or 90; anything else means all time (at most
-- two years back). Days are Kurdistan days (Asia/Baghdad). Longer than 120
-- days: one point per week.
create or replace function public.admin_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text := 'Asia/Baghdad';
  v_to date := (now() at time zone 'Asia/Baghdad')::date;
  v_from date;
  v_step text;
  v_series jsonb;
  v_totals jsonb;
  v_buildings jsonb;
  v_since timestamptz;
begin
  if v_uid is null or not public.has_permission(v_uid, 'stats.read') then
    raise exception 'admin_stats: not_allowed' using errcode = '42501';
  end if;
  if p_days in (7, 30, 90) then
    v_from := v_to - (p_days - 1);
  else
    select least(
             coalesce((select min(u.created_at) from auth.users u where coalesce(u.is_anonymous, false) = false), now()),
             coalesce((select min(r.created_at) from public.felt_reports r), now())
           )
      into v_since;
    v_from := greatest((v_since at time zone v_tz)::date, v_to - 730);
  end if;
  v_step := case when v_to - v_from > 120 then 'week' else 'day' end;
  v_since := (v_from::timestamp at time zone v_tz);

  with buckets as (
    select b::date as d,
           (b::timestamp at time zone v_tz) as t0,
           ((b + case when v_step = 'week' then interval '7 days' else interval '1 day' end)::timestamp at time zone v_tz) as t1
      from generate_series(
             case when v_step = 'week' then date_trunc('week', v_from::timestamp) else v_from::timestamp end,
             v_to::timestamp,
             case when v_step = 'week' then interval '7 days' else interval '1 day' end) as b
  )
  select jsonb_agg(jsonb_build_object(
           'date', bk.d,
           'accounts', (select count(*) from auth.users u
                         where coalesce(u.is_anonymous, false) = false
                           and u.created_at >= bk.t0 and u.created_at < bk.t1),
           'felt', (select count(*) from public.felt_reports r
                     where r.withdrawn_at is null and r.created_at >= bk.t0 and r.created_at < bk.t1),
           'checkins', (select count(*) from public.safety_checkins c
                         where c.status = 'safe' and c.created_at >= bk.t0 and c.created_at < bk.t1),
           'comments', (select count(*) from public.event_comments c
                         where c.created_at >= bk.t0 and c.created_at < bk.t1)
                     + (select count(*) from public.post_comments c
                         where c.created_at >= bk.t0 and c.created_at < bk.t1),
           'waiting', (select count(*) from public.event_comments c
                        where c.status = 'pending' and c.created_at >= bk.t0 and c.created_at < bk.t1)
                    + (select count(*) from public.post_comments c
                        where c.status = 'pending' and c.created_at >= bk.t0 and c.created_at < bk.t1),
           'devices', jsonb_build_object(
             'web', (select count(*) from public.push_subscriptions s
                      where s.kind = 'web' and s.created_at < bk.t1
                        and (s.disabled_at is null or s.disabled_at >= bk.t1)),
             'ios', (select count(*) from public.push_subscriptions s
                      join public.app_presence ap on ap.user_id = s.user_id and ap.platform = 'ios'
                      where s.kind = 'expo' and s.created_at < bk.t1
                        and (s.disabled_at is null or s.disabled_at >= bk.t1)),
             'android', (select count(*) from public.push_subscriptions s
                          join public.app_presence ap on ap.user_id = s.user_id and ap.platform = 'android'
                          where s.kind = 'expo' and s.created_at < bk.t1
                            and (s.disabled_at is null or s.disabled_at >= bk.t1)),
             'other', (select count(*) from public.push_subscriptions s
                        left join public.app_presence ap on ap.user_id = s.user_id
                        where s.kind = 'expo' and s.created_at < bk.t1
                          and (s.disabled_at is null or s.disabled_at >= bk.t1)
                          and (ap.platform is null or ap.platform not in ('ios', 'android'))))
         ) order by bk.d)
    into v_series
    from buckets bk;

  select jsonb_build_object(
           'accounts', (select count(*) from auth.users u where coalesce(u.is_anonymous, false) = false),
           'accounts_new', (select count(*) from auth.users u
                             where coalesce(u.is_anonymous, false) = false and u.created_at >= v_since),
           'felt', (select count(*) from public.felt_reports r
                     where r.withdrawn_at is null and r.created_at >= v_since),
           'checkins', (select count(*) from public.safety_checkins c
                         where c.status = 'safe' and c.created_at >= v_since),
           'waiting', (select count(*) from public.event_comments c where c.status = 'pending')
                    + (select count(*) from public.post_comments c where c.status = 'pending')
                    + (select count(*) from public.profile_posts p where p.status = 'pending')
                    + (select count(*) from public.felt_photos f where f.moderation_status = 'pending'))
    into v_totals;

  with latest as (
    select distinct on (a.tag_id) a.tag_id, a.vc_most_likely as vc
      from public.home_assessments a
     order by a.tag_id, a.created_at desc
  ),
  homes as (
    select h.tag_id, coalesce(public.area_town(h.lat, h.lon), 'other') as area, l.vc
      from public.home_tags h
      left join latest l on l.tag_id = h.tag_id
     where h.status = 'active'
  )
  select jsonb_build_object(
           'homes', (select count(*) from homes),
           'classes', (select jsonb_object_agg(v.vc, (select count(*) from homes where homes.vc = v.vc))
                         from (values ('A'), ('B'), ('C'), ('D'), ('E'), ('F')) as v(vc)),
           'areas', coalesce((select jsonb_agg(jsonb_build_object('area', x.area, 'homes', x.n)
                                              order by (x.area = 'other'), x.n desc, x.area)
                                from (select homes.area, count(*) as n from homes group by homes.area) x), '[]'::jsonb))
    into v_buildings;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'step', v_step,
    'days', case when p_days in (7, 30, 90) then p_days end,
    'totals', v_totals,
    'series', coalesce(v_series, '[]'::jsonb),
    'buildings', v_buildings
  );
end
$$;

-- One small answer for the admin launcher: a status line per tool, and only
-- for the tools the caller may open (a key is missing otherwise).
create or replace function public.admin_tool_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := '{}'::jsonb;
  v_waiting integer;
begin
  if v_uid is null or not public.holds_admin_permission(v_uid) then
    raise exception 'admin_tool_counts: not_allowed' using errcode = '42501';
  end if;
  if public.has_permission(v_uid, 'people.view') then
    v_out := v_out || jsonb_build_object('accounts',
      (select count(*) from auth.users u where coalesce(u.is_anonymous, false) = false));
  end if;
  if public.has_permission(v_uid, 'comments.moderate') then
    v_waiting := (select count(*) from public.moderation_queue(200))
               + (select count(*) from public.post_queue(200))
               + (select count(*) from public.moderation_profile_reports())
               + (select count(*) from public.post_comment_queue(200));
    if public.has_permission(v_uid, 'photos.moderate') then
      v_waiting := v_waiting
        + (select count(*) from public.felt_photos f where f.moderation_status = 'pending');
    end if;
    v_out := v_out || jsonb_build_object('waiting', v_waiting);
  end if;
  if public.has_permission(v_uid, 'filter.manage') then
    v_out := v_out || jsonb_build_object('busy', public.surge_state() -> 'active');
  end if;
  if public.has_permission(v_uid, 'alerts.test') then
    v_out := v_out || jsonb_build_object(
      'alerts_mode', public.alert_mode(),
      'alert_devices', (select count(*) from public.push_subscriptions s where s.disabled_at is null));
  end if;
  if public.has_permission(v_uid, 'hubs.open') then
    v_out := v_out || jsonb_build_object('hubs_open',
      (select count(*) from public.events e where e.hub_featured));
  end if;
  if public.has_permission(v_uid, 'feedback.manage') then
    v_out := v_out || jsonb_build_object('feedback_new',
      (select count(*) from public.feedback f where f.status = 'unseen'));
  end if;
  return v_out;
end
$$;

-- 6. Open a hub for an earthquake ------------------------------------------------------------------
-- The official account: username bumelerze, holding the official rank (0045
-- reserves the name for that rank).
create or replace function public.official_account_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.user_id
    from public.profiles p
    join public.user_roles r on r.user_id = p.user_id and r.role = 'official'
   where p.username = 'bumelerze'
   limit 1
$$;

-- Open hubs first, then the search result (a Bumelerze id or a place) or the
-- latest regional earthquakes. Each with its pinned note, if any.
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

create or replace function public.admin_set_hub_open(p_event_id uuid, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_was boolean;
begin
  if v_uid is null or not public.has_permission(v_uid, 'hubs.open') then
    raise exception 'admin_set_hub_open: not_allowed' using errcode = '42501';
  end if;
  if p_open is null then
    raise exception 'admin_set_hub_open: invalid' using errcode = '22023';
  end if;
  select e.hub_featured into v_was from public.events e where e.event_id = p_event_id for update;
  if not found then
    raise exception 'admin_set_hub_open: not_found' using errcode = 'P0002';
  end if;
  if v_was is distinct from p_open then
    update public.events set hub_featured = p_open where event_id = p_event_id;
    perform public.write_audit(
      v_uid, case when p_open then 'hub_open' else 'hub_close' end, 'event', p_event_id::text,
      null, null, null, null, null, jsonb_build_object('event_id', p_event_id, 'previous', v_was)
    );
  end if;
  return jsonb_build_object('event_id', p_event_id, 'hub_featured', p_open);
end
$$;

-- The official pinned note: a top-level comment by the official account,
-- visible at once and pinned (any earlier pin of that hub is lifted).
create or replace function public.admin_post_hub_note(p_event_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_official uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_prev uuid;
  v_id uuid;
begin
  if v_uid is null or not public.has_permission(v_uid, 'hubs.open') then
    raise exception 'admin_post_hub_note: not_allowed' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'admin_post_hub_note: invalid_body' using errcode = '22023';
  end if;
  if not exists (select 1 from public.events e where e.event_id = p_event_id) then
    raise exception 'admin_post_hub_note: not_found' using errcode = 'P0002';
  end if;
  v_official := public.official_account_id();
  if v_official is null then
    raise exception 'admin_post_hub_note: official_account_missing' using errcode = 'P0002';
  end if;
  if not public.guidelines_accepted(v_official) then
    raise exception 'admin_post_hub_note: official_account_not_ready' using errcode = '42501';
  end if;
  select c.comment_id into v_prev
    from public.event_comments c
   where c.event_id = p_event_id and c.pinned_at is not null
   for update;
  insert into public.event_comments (event_id, user_id, body)
  values (p_event_id, v_official, v_body)
  returning comment_id into v_id;
  update public.event_comments
     set pinned_at = null
   where event_id = p_event_id and pinned_at is not null and comment_id <> v_id;
  update public.event_comments
     set status = 'visible', pinned_at = now()
   where comment_id = v_id;
  perform public.write_audit(
    v_uid, 'hub_note', 'event', p_event_id::text,
    null, null, null, null, null,
    jsonb_build_object('event_id', p_event_id, 'comment_id', v_id, 'previous_pin', v_prev, 'as', v_official)
  );
  return v_id;
end
$$;

-- 7. Download my data: wrap the 0065 export once ---------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'export_my_data'
       and p.pronargs = 0
       and p.prosrc like '%export_my_data_0065%'
  ) then
    drop function if exists public.export_my_data_0065();
    alter function public.export_my_data() rename to export_my_data_0065;
  end if;
end
$$;
revoke all on function public.export_my_data_0065() from public, anon, authenticated;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  return public.export_my_data_0065()
    || jsonb_build_object(
      'authority_sharing', coalesce((
        select jsonb_build_object('enabled', s.enabled, 'changed_at', s.changed_at)
          from public.authority_sharing s where s.user_id = v_uid
      ), jsonb_build_object('enabled', false, 'changed_at', null))
    );
end
$$;

-- 8. Who may call what -----------------------------------------------------------------------------
-- Audit 10.2: helpers nobody should call directly.
revoke all on function public.can_view_posts_of(uuid) from public, anon, authenticated;
revoke all on function public.is_home_member(uuid) from public, anon;
revoke all on function public.is_home_owner(uuid) from public, anon;
grant execute on function public.is_home_member(uuid) to authenticated;
grant execute on function public.is_home_owner(uuid) to authenticated;

revoke all on function public.holds_admin_permission(uuid) from public, anon, authenticated;
revoke all on function public.audit_actor_rank(uuid) from public, anon, authenticated;
revoke all on function public.activity_on_roles() from public, anon, authenticated;
revoke all on function public.area_town(double precision, double precision) from public, anon, authenticated;
revoke all on function public.official_account_id() from public, anon, authenticated;
revoke all on function public.admin_grant_role(text, text, text, text) from public, anon;
revoke all on function public.admin_revoke_role(text, text) from public, anon;
revoke all on function public.my_authority_sharing() from public, anon;
revoke all on function public.set_authority_sharing(boolean) from public, anon;
revoke all on function public.authority_overview() from public, anon;
revoke all on function public.authority_event_safety(uuid) from public, anon;
revoke all on function public.authority_people(integer) from public, anon;
revoke all on function public.admin_stats(integer) from public, anon;
revoke all on function public.admin_tool_counts() from public, anon;
revoke all on function public.admin_hub_events(text, integer) from public, anon;
revoke all on function public.admin_set_hub_open(uuid, boolean) from public, anon;
revoke all on function public.admin_post_hub_note(uuid, text) from public, anon;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.admin_grant_role(text, text, text, text) to authenticated;
grant execute on function public.admin_revoke_role(text, text) to authenticated;
grant execute on function public.my_authority_sharing() to authenticated;
grant execute on function public.set_authority_sharing(boolean) to authenticated;
grant execute on function public.authority_overview() to authenticated;
grant execute on function public.authority_event_safety(uuid) to authenticated;
grant execute on function public.authority_people(integer) to authenticated;
grant execute on function public.admin_stats(integer) to authenticated;
grant execute on function public.admin_tool_counts() to authenticated;
grant execute on function public.admin_hub_events(text, integer) to authenticated;
grant execute on function public.admin_set_hub_open(uuid, boolean) to authenticated;
grant execute on function public.admin_post_hub_note(uuid, text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
