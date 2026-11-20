-- 0073: felt writes need a session (security audit DB-01 / PIPE-01).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- Why. The insert policies of felt_reports, felt_report_details,
-- felt_comments and felt_photos were granted to anon as well as
-- authenticated, and the 0071 rate limit counts a caller without a session
-- by the device id the caller chooses. A script holding the public key
-- could therefore post any number of reports, each under a fresh device id,
-- and they reached aggregate-felt-cells, the public felt cells and, through
-- the trust gate n_reports >= 3, the SHAKEmap worker. The trigger
-- felt_reports_server_times (0034) also accepted any back-dated created_at
-- and any event_id the client sent.
--
-- 1. Writes need a session. The app always signs in anonymously before it
--    writes (src/features/felt/supabase-transport.ts, ensureAnonymousUserId),
--    so every install has one; anon loses INSERT on the four tables and the
--    four insert policies are for authenticated only. felt_reports and
--    felt_comments must carry the caller's own user_id (the user_id is null
--    alternative is gone). When the sign-in failed the app still sends the
--    row; the refusal (42501) is retried by the felt queue like any error
--    except a duplicate (src/features/felt/queue.ts, capped backoff), so a
--    report waits for a session and is never lost.
--    felt_comments also loses the update, delete, truncate, references and
--    trigger privileges no policy ever allowed (the 0067 D-12 clean-up
--    missed this table); only security definer functions change its rows.
-- 2. The server owns the times, the owner and the event link
--    (felt_reports_server_times, before insert; before-insert triggers run
--    before the policy check, so the app's null user_id passes once filled):
--      * submitted_at is now();
--      * created_at is clamped into [now() - 2 days, now()]: no future
--        time, no back-dating beyond an offline queue's two days;
--      * user_id is the session's auth.uid() when the row has none;
--      * event_id, when given, follows merged_into once (a merged event
--        becomes its canonical event) and is cleared when the event does not
--        exist, is neither published nor possible, or began more than 10
--        minutes after the report was made (nobody feels an earthquake before
--        it happens). There is NO upper bound: reports on past earthquakes,
--        even years old, are a feature. A cleared report is unassigned and
--        assign_unassigned_felt_reports may place it, as before.
--    felt_comments gets the same user_id fill (felt_comments_fill_user).
-- 3. Hub numbers count people, not rows. A person may hold several device
--    ids (web and phone, a reinstall) but one session per install, so a
--    reporter is coalesce(user_id::text, device_id), the key the hub's
--    people count already used. event_hub_summary (0064), event_felt_towns
--    and event_felt_timeline (0065) count distinct reporters; the level
--    statistics (the summary's levels, the town's typical level) use one
--    report per reporter, that reporter's latest live report. The earliest
--    report time (first_report_at, minutes_to_first) still reads every live
--    report: a minimum is not weighted by how many reports one person sent.
--    Signatures, return shapes, security, grants and every other line are
--    those of 0064 and 0065.
--
-- The edge function aggregate-felt-cells is changed with this (one report
-- per reporter per event before the cells are built) and must be redeployed
-- after it.

-- 1. Writes need a session --------------------------------------------------------------------------
revoke insert on public.felt_reports, public.felt_report_details, public.felt_comments, public.felt_photos from anon;
revoke update, delete, truncate, references, trigger on public.felt_comments from anon, authenticated;

drop policy if exists felt_reports_insert on public.felt_reports;
create policy felt_reports_insert on public.felt_reports
  for insert to authenticated
  with check (
    device_id is not null
    and user_id = auth.uid()
  );

drop policy if exists felt_report_details_insert on public.felt_report_details;
create policy felt_report_details_insert on public.felt_report_details
  for insert to authenticated
  with check (true);

drop policy if exists felt_comments_insert on public.felt_comments;
create policy felt_comments_insert on public.felt_comments
  for insert to authenticated
  with check (
    moderation_status = 'pending'
    and moderated_at is null
    and moderated_by is null
    and user_id = auth.uid()
  );

drop policy if exists felt_photos_insert on public.felt_photos;
create policy felt_photos_insert on public.felt_photos
  for insert to authenticated
  with check (
    moderation_status = 'pending'
    and moderated_at is null
    and moderated_by is null
  );

-- 2. The server owns the times, the owner and the event link ----------------------------------------
-- Same name, trigger and search_path as 0034; runs with the caller's rights
-- (events are public to read, policy events_public_select).
create or replace function public.felt_reports_server_times()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_status text;
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
    select e.event_id, e.status, e.merged_into, e.origin_time
      into v_target, v_status, v_merged_into, v_origin
      from public.events e
     where e.event_id = new.event_id;
    if v_target is not null and v_merged_into is not null then
      select e.event_id, e.status, e.origin_time
        into v_target, v_status, v_origin
        from public.events e
       where e.event_id = v_merged_into;
    end if;
    if v_target is null
       or coalesce(v_status, '') not in ('published', 'possible')
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

-- A comment carries the session's account when the app sent none.
create or replace function public.felt_comments_fill_user()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.user_id is null and v_uid is not null then
    new.user_id := v_uid;
  end if;
  return new;
end
$$;
revoke all on function public.felt_comments_fill_user() from public, anon, authenticated;
drop trigger if exists felt_comments_fill_user on public.felt_comments;
create trigger felt_comments_fill_user
  before insert on public.felt_comments
  for each row execute function public.felt_comments_fill_user();

-- 3. Hub numbers count people, not rows -------------------------------------------------------------
-- 0064: "N people felt it", levels and the first report. reports and people
-- are both distinct reporters now; levels use each reporter's latest report.
create or replace function public.event_hub_summary(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with live as (
    select coalesce(r.user_id::text, r.device_id) as reporter,
           r.cartoon_level,
           r.created_at,
           r.report_id
      from public.felt_reports r
     where r.event_id = p_event_id and r.withdrawn_at is null
  ),
  latest as (
    select distinct on (live.reporter) live.reporter, live.cartoon_level
      from live
     order by live.reporter, live.created_at desc, live.report_id desc
  )
  select jsonb_build_object(
    'reports', (select count(distinct live.reporter) from live),
    'people', (select count(distinct live.reporter) from live),
    'levels', coalesce((
      select jsonb_object_agg(cartoon_level::text, n) from (
        select latest.cartoon_level, count(*) as n from latest group by latest.cartoon_level
      ) l
    ), '{}'::jsonb),
    'first_report_at', (select min(live.created_at) from live),
    'comments', (select count(*) from public.event_comments c
                  where c.event_id = p_event_id and c.status = 'visible'
                    and c.account_deleted_at is null
                    and not public.is_suspended(c.user_id)),
    'featured', coalesce((select hub_featured from public.events where event_id = p_event_id), false)
  )
$$;

-- 0065: live felt reports by town, the nearest gazetteer town within 100 km.
-- One report per reporter (the latest), so a town counts people and the
-- typical level (median, only with 3 people or more) weighs each once.
-- Nothing about a person or a place leaves: town id, count, level.
create or replace function public.event_felt_towns(p_event_id uuid)
returns table (town_id text, reports integer, level smallint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with live as (
    select distinct on (coalesce(r.user_id::text, r.device_id))
           coalesce(r.user_id::text, r.device_id) as reporter,
           r.lat, r.lon, r.cartoon_level
      from public.felt_reports r
     where r.event_id = p_event_id
       and r.withdrawn_at is null
     order by coalesce(r.user_id::text, r.device_id), r.created_at desc, r.report_id desc
  ),
  placed as (
    select n.town_id as town, live.reporter, live.cartoon_level as lvl
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
           count(distinct p.reporter)::integer as n,
           case when count(distinct p.reporter) >= 3
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

-- 0065: live felt reports over the first 24 hours after the origin time. A
-- report stamped up to 10 minutes before the origin (a phone clock) counts
-- in the first hour. Null when the event is unknown. Every count is of
-- distinct reporters; minutes_to_first is the earliest live report.
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
    select coalesce(r.user_id::text, r.device_id) as reporter, r.created_at
      from public.felt_reports r
     where r.event_id = p_event_id
       and r.withdrawn_at is null
  ),
  early as (
    select greatest(0, floor(extract(epoch from (live.created_at - ev.t0)) / 3600))::integer as h,
           live.reporter,
           live.created_at
      from live
      cross join ev
     where live.created_at >= ev.t0 - interval '10 minutes'
       and live.created_at < ev.t0 + interval '24 hours'
  )
  select case when not exists (select 1 from ev) then null else jsonb_build_object(
    'origin_time', (select ev.t0 from ev),
    'total', (select count(distinct live.reporter) from live),
    'first_day', (select count(distinct early.reporter) from early),
    'first_hour', (select count(distinct early.reporter) from early where early.h = 0),
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
          select early.h, count(distinct early.reporter)::integer as n from early group by early.h
        ) c on c.h = g.h
    )
  ) end
$$;

revoke all on function public.event_hub_summary(uuid) from public;
revoke all on function public.event_felt_towns(uuid) from public;
revoke all on function public.event_felt_timeline(uuid) from public;
grant execute on function public.event_hub_summary(uuid) to anon, authenticated;
grant execute on function public.event_felt_towns(uuid) to anon, authenticated;
grant execute on function public.event_felt_timeline(uuid) to anon, authenticated;
