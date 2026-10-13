-- 0065: the Event hub as a post, and the profile redesign (review notes 4.3,
-- 4.4 and 5.1, mockups approved by the owner 2026-10-14).
--
--   1. A heart on the Event hub itself (hub_likes): one row per account per
--      earthquake. set_hub_like() for accounts only (guests and anonymous
--      sessions read the count but cannot like, exactly as Helpful on posts,
--      0058), refused for a limited account. event_hub_likes() gives the
--      count and whether the caller liked it. The count leaves out people in
--      a block with the caller and suspended accounts.
--   2. A heart on comments under profile posts (post_comment_likes), so the
--      hub and profile posts share one comment component: the same rules as
--      Helpful on posts (accounts only, not on my own comment, only on a
--      comment I may read, not when limited). post_comment_likes_of() gives
--      the counts and my own marks for one post; set_post_comment_like()
--      changes mine. Hub comments keep their Helpful marks (0036): the heart
--      there is the same mark, so counts and badges do not change.
--   3. Two aggregates for the hub carousel. Nothing about a person or a
--      place leaves the server: no coordinates, no report ids, no user ids.
--        * event_felt_towns(): live felt reports (not withdrawn, 0064) by
--          town. A report belongs to the nearest town of the app's own
--          gazetteer (felt_towns, the same 38 places and ids as
--          src/features/geo/gazetteer.ts) within 100 km, the distance the hub
--          already uses for "felt it near" (AREA_CITY_MAX_KM). A town shows a
--          typical level (the median shaking level of its reports) only with
--          at least 3 reports; below that only its count.
--        * event_felt_timeline(): live reports per hour in the first 24
--          hours after the origin time, the total, the first hour and the
--          minutes from the origin to the first report.
--   4. profile_header(): the counts of a profile (posts, followers,
--      following), also for a private profile the caller does not follow
--      (counts only; bio, city and posts stay for followers), and "Followed
--      by": up to two people the caller follows who follow this person, with
--      the total, only where the caller may see the followers list (0054's
--      follow_list rules).
--   5. Download my data adds the hearts the person gave (the 0064 wrapper
--      becomes export_my_data_0064 and is called unchanged).
--   6. Delete my account: both new tables go with the account (foreign keys
--      on delete cascade; delete_my_account() deletes the auth user).
--
-- Needs 0035 to 0064 (0062 not required). Idempotent: safe to run twice.
-- Written for the SQL editor as one line: no transaction statements, only
-- full-line comments, ASCII only, no question marks.

-- 1. Tables ------------------------------------------------------------------------------------------
create table if not exists public.hub_likes (
  event_id uuid not null references public.events (event_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists hub_likes_user_idx on public.hub_likes (user_id);
alter table public.hub_likes enable row level security;
revoke all on public.hub_likes from public, anon, authenticated;

create table if not exists public.post_comment_likes (
  comment_id uuid not null references public.post_comments (comment_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists post_comment_likes_user_idx on public.post_comment_likes (user_id);
alter table public.post_comment_likes enable row level security;
revoke all on public.post_comment_likes from public, anon, authenticated;

-- The app's gazetteer towns, by id, with their approximate centres. Names
-- stay in the app (four languages); the server only ever answers with ids.
create table if not exists public.felt_towns (
  town_id text primary key,
  lat double precision not null,
  lon double precision not null,
  constraint felt_towns_lat_check check (lat between -90 and 90),
  constraint felt_towns_lon_check check (lon between -180 and 180)
);
alter table public.felt_towns enable row level security;
revoke all on public.felt_towns from public, anon, authenticated;

insert into public.felt_towns (town_id, lat, lon) values
  ('erbil', 36.19, 44.01),
  ('slemani', 35.56, 45.43),
  ('duhok', 36.87, 42.99),
  ('halabja', 35.18, 45.98),
  ('zakho', 37.14, 42.68),
  ('soran', 36.65, 44.54),
  ('ranya', 36.25, 44.89),
  ('koya', 36.08, 44.63),
  ('kalar', 34.62, 45.32),
  ('chamchamal', 35.53, 44.83),
  ('akre', 36.75, 43.89),
  ('bardarash', 36.5, 43.55),
  ('dukan', 35.95, 44.95),
  ('darbandikhan', 35.13, 45.72),
  ('penjwen', 35.62, 46.2),
  ('qaladze', 36.18, 45.13),
  ('rawanduz', 36.61, 44.52),
  ('amedi', 37.09, 43.49),
  ('kirkuk', 35.47, 44.39),
  ('khanaqin', 34.36, 45.39),
  ('kifri', 34.7, 44.97),
  ('sinjar', 36.32, 41.88),
  ('mosul', 36.34, 43.13),
  ('baghdad', 33.31, 44.36),
  ('javanrud', 34.8, 46.49),
  ('kermanshah', 34.31, 47.06),
  ('sarpol-e-zahab', 34.46, 45.86),
  ('qasr-e-shirin', 34.51, 45.58),
  ('paveh', 35.05, 46.36),
  ('marivan', 35.52, 46.17),
  ('baneh', 35.99, 45.89),
  ('saqqez', 36.25, 46.28),
  ('sanandaj', 35.31, 47.0),
  ('urmia', 37.55, 45.08),
  ('piranshahr', 36.7, 45.14),
  ('hakkari', 37.57, 43.74),
  ('sirnak', 37.52, 42.46),
  ('cizre', 37.32, 42.19)
on conflict (town_id) do update set lat = excluded.lat, lon = excluded.lon;

-- 2. Hearts on the hub --------------------------------------------------------------------------------
-- Hearts the caller may count: not from someone in a block with the caller,
-- not from a suspended account. Internal.
create or replace function public.hub_like_count(p_event uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.hub_likes h
   where h.event_id = p_event
     and not public.blocked_between(auth.uid(), h.user_id)
     and not public.is_suspended(h.user_id)
$$;

-- The count and whether the caller liked it. Everyone may read it.
create or replace function public.event_hub_likes(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'count', public.hub_like_count(p_event_id),
    'liked', auth.uid() is not null and exists (
      select 1 from public.hub_likes h
       where h.event_id = p_event_id and h.user_id = auth.uid()
    )
  )
$$;

-- Like or unlike the hub of an earthquake. Accounts only, as Helpful on
-- posts. Repeating either is harmless. Tokens: not_account, not_found,
-- account_restricted.
create or replace function public.set_hub_like(p_event_id uuid, p_like boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'set_hub_like: not_account' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events e where e.event_id = p_event_id) then
    raise exception 'set_hub_like: not_found' using errcode = 'P0002';
  end if;
  if coalesce(p_like, false) then
    perform public.assert_not_restricted(v_uid, 'hub_like');
    insert into public.hub_likes (event_id, user_id)
    values (p_event_id, v_uid)
    on conflict (event_id, user_id) do nothing;
  else
    delete from public.hub_likes where event_id = p_event_id and user_id = v_uid;
  end if;
  return jsonb_build_object(
    'liked', coalesce(p_like, false),
    'count', public.hub_like_count(p_event_id)
  );
end
$$;

-- 3. Hearts on comments under profile posts -----------------------------------------------------------
-- Hearts the caller may count: not from someone in a block with the
-- comment's author or with the caller. Internal.
create or replace function public.post_comment_like_count(p_comment uuid, p_author uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.post_comment_likes l
   where l.comment_id = p_comment
     and not public.blocked_between(l.user_id, p_author)
     and not public.blocked_between(l.user_id, auth.uid())
$$;

-- The hearts of the comments of one post the caller may read: one row per
-- comment that has any, with whether the caller gave one.
create or replace function public.post_comment_likes_of(p_post_id uuid)
returns table (comment_id uuid, likes integer, liked boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.comment_id,
         public.post_comment_like_count(c.comment_id, c.user_id),
         auth.uid() is not null and exists (
           select 1 from public.post_comment_likes m
            where m.comment_id = c.comment_id and m.user_id = auth.uid()
         )
    from public.post_comments c
   where c.post_id = p_post_id
     and exists (select 1 from public.post_comment_likes l where l.comment_id = c.comment_id)
     and public.can_read_post_comment(auth.uid(), c.comment_id)
$$;

-- Like or unlike a comment under a post. Tokens: not_account, not_found,
-- own_comment, account_restricted.
create or replace function public.set_post_comment_like(p_comment_id uuid, p_like boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'set_post_comment_like: not_account' using errcode = '42501';
  end if;
  select c.user_id into v_author
    from public.post_comments c
   where c.comment_id = p_comment_id;
  if not found or not public.can_read_post_comment(v_uid, p_comment_id) then
    raise exception 'set_post_comment_like: not_found' using errcode = 'P0002';
  end if;
  if v_author = v_uid then
    raise exception 'set_post_comment_like: own_comment' using errcode = '42501';
  end if;
  if coalesce(p_like, false) then
    perform public.assert_not_restricted(v_uid, 'post_comment_like');
    insert into public.post_comment_likes (comment_id, user_id)
    values (p_comment_id, v_uid)
    on conflict (comment_id, user_id) do nothing;
  else
    delete from public.post_comment_likes where comment_id = p_comment_id and user_id = v_uid;
  end if;
  return jsonb_build_object(
    'liked', coalesce(p_like, false),
    'count', public.post_comment_like_count(p_comment_id, v_author)
  );
end
$$;

-- 4. Carousel aggregates -----------------------------------------------------------------------------
-- Live felt reports by town: the nearest gazetteer town within 100 km. At
-- most 12 towns, the strongest typical level first, then the most reports.
-- The level is the median shaking level, and only with 3 reports or more.
create or replace function public.event_felt_towns(p_event_id uuid)
returns table (town_id text, reports integer, level smallint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with live as (
    select r.lat, r.lon, r.cartoon_level
      from public.felt_reports r
     where r.event_id = p_event_id
       and r.withdrawn_at is null
  ),
  placed as (
    select n.town_id as town, live.cartoon_level as lvl
      from live
      cross join lateral (
        select t.town_id,
               111.195 * sqrt(
                 power(live.lat - t.lat, 2)
                 + power((live.lon - t.lon) * cos(radians((live.lat + t.lat) / 2)), 2)
               ) as km
          from public.felt_towns t
         order by km, t.town_id
         limit 1
      ) n
     where n.km <= 100
  ),
  towns as (
    select p.town,
           count(*)::integer as n,
           case when count(*) >= 3
                then (percentile_disc(0.5) within group (order by p.lvl))::smallint
           end as typical
      from placed p
     group by p.town
  )
  select towns.town, towns.n, towns.typical
    from towns
   order by towns.typical desc nulls last, towns.n desc, towns.town
   limit 12
$$;

-- Live felt reports over the first 24 hours after the origin time. A report
-- stamped up to 10 minutes before the origin (a phone clock) counts in the
-- first hour. Null when the event is unknown.
create or replace function public.event_felt_timeline(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ev as (
    select e.origin_time as t0 from public.events e where e.event_id = p_event_id
  ),
  live as (
    select r.created_at
      from public.felt_reports r
     where r.event_id = p_event_id
       and r.withdrawn_at is null
  ),
  early as (
    select greatest(0, floor(extract(epoch from (live.created_at - ev.t0)) / 3600))::integer as h,
           live.created_at
      from live
      cross join ev
     where live.created_at >= ev.t0 - interval '10 minutes'
       and live.created_at < ev.t0 + interval '24 hours'
  )
  select case when not exists (select 1 from ev) then null else jsonb_build_object(
    'origin_time', (select ev.t0 from ev),
    'total', (select count(*) from live),
    'first_day', (select count(*) from early),
    'first_hour', (select count(*) from early where early.h = 0),
    'minutes_to_first', (
      select case when count(*) = 0 then null
                  else greatest(0, round(extract(epoch from (min(early.created_at) - (select ev.t0 from ev))) / 60))::integer
             end
        from early
    ),
    'hours', (
      select jsonb_agg(coalesce(c.n, 0) order by g.h)
        from generate_series(0, 23) as g(h)
        left join (
          select early.h, count(*)::integer as n from early group by early.h
        ) c on c.h = g.h
    )
  ) end
$$;

-- 5. The profile header ------------------------------------------------------------------------------
-- Counts for every profile the caller may open (also a private one: counts
-- only), and "Followed by" where the caller may see the followers list.
-- Null when there is no such profile, a block either way, or the account
-- is suspended (to anybody but the person).
create or replace function public.profile_header(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_viewer uuid := auth.uid();
  v_id uuid;
  v_private boolean;
  v_self boolean;
  v_may_list boolean;
begin
  select p.user_id, p.is_private into v_id, v_private
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    return null;
  end if;
  if public.blocked_between(v_viewer, v_id) then
    return null;
  end if;
  v_self := v_viewer is not null and v_viewer = v_id;
  if public.is_suspended(v_id) and not v_self then
    return null;
  end if;
  v_may_list := v_self or not coalesce(v_private, false) or exists (
    select 1 from public.follows f
     where f.follower_id = v_viewer and f.followee_id = v_id and f.status = 'accepted'
  );
  return jsonb_build_object(
    'posts', (select count(*) from public.profile_posts po where po.user_id = v_id and po.status = 'visible'),
    'followers', (select count(*) from public.follows f where f.followee_id = v_id and f.status = 'accepted'),
    'following', (select count(*) from public.follows f where f.follower_id = v_id and f.status = 'accepted'),
    'followed_by', case when v_may_list and not v_self and v_viewer is not null then coalesce((
      select jsonb_agg(jsonb_build_object('username', k.username, 'display_name', k.display_name)
                       order by k.since desc)
        from (
          select p.username, p.display_name, theirs.created_at as since
            from public.follows mine
            join public.follows theirs
              on theirs.follower_id = mine.followee_id
             and theirs.followee_id = v_id
             and theirs.status = 'accepted'
            join public.profiles p on p.user_id = mine.followee_id
           where mine.follower_id = v_viewer
             and mine.status = 'accepted'
             and p.username is not null
             and not public.blocked_between(v_viewer, p.user_id)
             and not public.is_suspended(p.user_id)
           order by theirs.created_at desc
           limit 2
        ) k
    ), '[]'::jsonb) else '[]'::jsonb end,
    'followed_by_total', case when v_may_list and not v_self and v_viewer is not null then (
      select count(*)
        from public.follows mine
        join public.follows theirs
          on theirs.follower_id = mine.followee_id
         and theirs.followee_id = v_id
         and theirs.status = 'accepted'
        join public.profiles p on p.user_id = mine.followee_id
       where mine.follower_id = v_viewer
         and mine.status = 'accepted'
         and p.username is not null
         and not public.blocked_between(v_viewer, p.user_id)
         and not public.is_suspended(p.user_id)
    ) else 0 end
  );
end
$$;

-- 6. Download my data: the hearts I gave ---------------------------------------------------------------
-- The export live before this migration (0064's wrapper) becomes
-- export_my_data_0064 and is called unchanged.
do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'export_my_data'
       and p.pronargs = 0
       and p.prosrc like '%export_my_data_0064%'
  ) then
    drop function if exists public.export_my_data_0064();
    alter function public.export_my_data() rename to export_my_data_0064;
  end if;
end
$$;
revoke all on function public.export_my_data_0064() from public, anon, authenticated;

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
  return public.export_my_data_0064()
    || jsonb_build_object(
      'hub_likes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'event_id', h.event_id, 'bumelerze_id', e.bumelerze_id, 'created_at', h.created_at)
               order by h.created_at)
          from public.hub_likes h
          left join public.events e on e.event_id = h.event_id
         where h.user_id = v_uid
      ), '[]'::jsonb),
      'post_comment_likes', coalesce((
        select jsonb_agg(jsonb_build_object('comment_id', l.comment_id, 'created_at', l.created_at)
               order by l.created_at)
          from public.post_comment_likes l where l.user_id = v_uid
      ), '[]'::jsonb)
    );
end
$$;

-- 7. Who may call what -------------------------------------------------------------------------------
revoke all on function public.hub_like_count(uuid) from public, anon, authenticated;
revoke all on function public.post_comment_like_count(uuid, uuid) from public, anon, authenticated;
revoke all on function public.event_hub_likes(uuid) from public;
revoke all on function public.set_hub_like(uuid, boolean) from public, anon;
revoke all on function public.post_comment_likes_of(uuid) from public;
revoke all on function public.set_post_comment_like(uuid, boolean) from public, anon;
revoke all on function public.event_felt_towns(uuid) from public;
revoke all on function public.event_felt_timeline(uuid) from public;
revoke all on function public.profile_header(text) from public;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.event_hub_likes(uuid) to anon, authenticated;
grant execute on function public.set_hub_like(uuid, boolean) to authenticated;
grant execute on function public.post_comment_likes_of(uuid) to anon, authenticated;
grant execute on function public.set_post_comment_like(uuid, boolean) to authenticated;
grant execute on function public.event_felt_towns(uuid) to anon, authenticated;
grant execute on function public.event_felt_timeline(uuid) to anon, authenticated;
grant execute on function public.profile_header(text) to anon, authenticated;
grant execute on function public.export_my_data() to authenticated;
