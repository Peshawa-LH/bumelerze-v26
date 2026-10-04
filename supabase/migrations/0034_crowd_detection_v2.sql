-- 0034: crowd detection v2 — learned from EMSC's LastQuake routine
-- (research/emsc-crowd-detection-2026-10-04.md in the project brain; owner
-- 2026-10-04: "a scientific way of detecting events from multiple felt
-- reports, to improve later once accounts exist").
--
-- What a "possible event" is stays the same (D65): a headline from
-- people's felt reports, never a registered earthquake, until a provider
-- event matches it. What changes:
--
--  1. Identity: detection counts distinct signed-in identities (the
--     anonymous-auth user_id), not the client-chosen device_id, and only
--     live reports (received within the window, server clock). The receipt
--     time is forced server-side and a device clock running ahead is
--     clamped.
--  2. Plausibility: N = 8 people (EMSC's "incomplete event" count), at
--     least half at cartoon level >= 2, at least half GPS-located, spread
--     over >= 3 geohash-5 cells (~5 km) — one building, one blast site or
--     one script at one coordinate cannot trigger. Location is the median
--     of the GPS reports, time the median report time; the earliest report
--     time is kept for matching.
--  3. Cooldown 100 km (was 30 km, smaller than the ~95 x 59 km cluster
--     block, so one widely felt quake could raise several cards).
--  4. Confirmation (merge into a provider event) is physical: the event
--     must be published, not deleted and backed by a verified source; its
--     origin must precede the earliest report (60 s clock tolerance) by no
--     more than 10 min; it must lie within 100 km; and Allen, Wald & Worden
--     (2012) must predict MMI >= 2.0 at the cluster from its magnitude and
--     hypocentral distance (a felt event, allowing ~1 sigma below the III
--     the reports imply). ALL matching possible events merge, not one.
--  5. One sequential job every 2 min: assign reports to known events first
--     (so a cluster a known event explains never becomes "possible"), then
--     reconcile every open possible event, then detect.
--  6. Assignment attaches reports only to published or possible events
--     that are not deleted, and to published ones only when a verified
--     source backs them.
--
-- Science values for the owner to confirm (D14): N = 8, the spread rule
-- (3 cells, 50 % GPS), the 100 km radii, the MMI >= 2.0 threshold and the
-- AWW2012 coefficients (c0 2.085, c1 1.428, c2 -1.402, c4 0.078,
-- m1 -0.209, m2 2.042; as in USGS shakelib's AllenEtAl2012).

-- 1. Crowd bookkeeping on the possible event (public, like every events column)
alter table public.events
  add column if not exists crowd_first_report_at timestamptz,
  add column if not exists crowd_user_count integer,
  add column if not exists crowd_report_count integer;

-- 2. Server-side times on felt reports
create or replace function public.felt_reports_server_times()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.submitted_at := now();
  if new.created_at is null or new.created_at > now() + interval '2 minutes' then
    new.created_at := now();
  end if;
  return new;
end
$$;
drop trigger if exists felt_reports_server_times on public.felt_reports;
create trigger felt_reports_server_times
  before insert on public.felt_reports
  for each row execute function public.felt_reports_server_times();

-- 3. Allen, Wald & Worden (2012) intensity prediction, hypocentral distance
create or replace function public.ipe_aww2012_mmi(p_mag double precision, p_rhyp_km double precision)
returns double precision
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select 2.085 + 1.428 * p_mag
       - 1.402 * ln(sqrt(greatest(p_rhyp_km, 0.1) ^ 2 + (-0.209 + 2.042 * exp(p_mag - 5)) ^ 2))
       + case when p_rhyp_km > 50 then 0.078 * ln(p_rhyp_km / 50) else 0 end
$$;

-- 4. Does provider event p_target physically explain possible event p_possible?
create or replace function public.crowd_match_ok(p_possible uuid, p_target uuid)
returns boolean
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  p record;
  t record;
  v_first timestamptz;
  v_epi_km double precision;
  v_rhyp_km double precision;
begin
  select * into p from public.events where event_id = p_possible and status = 'possible' and merged_into is null;
  if not found then return false; end if;
  select * into t from public.events
  where event_id = p_target and status = 'published' and merged_into is null
    and review_status <> 'deleted' and magnitude is not null;
  if not found then return false; end if;
  if not exists (
    select 1 from public.event_source_records esr
    where esr.event_id = p_target and esr.review_status <> 'deleted' and esr.verified_at is not null
  ) then
    return false;
  end if;
  v_first := coalesce(p.crowd_first_report_at, p.origin_time);
  if t.origin_time > v_first + interval '60 seconds' or t.origin_time < v_first - interval '10 minutes' then
    return false;
  end if;
  v_epi_km := ST_Distance(
    geography(ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)),
    geography(ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))
  ) / 1000.0;
  if v_epi_km > 100 then return false; end if;
  v_rhyp_km := sqrt(v_epi_km ^ 2 + coalesce(t.depth_km, 10)::double precision ^ 2);
  return public.ipe_aww2012_mmi(t.magnitude::double precision, v_rhyp_km) >= 2.0;
end
$$;

-- 5. Merge one possible event into its confirming event
create or replace function public.merge_possible_event(p_possible uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.felt_reports fr
  set event_id = p_target
  where fr.event_id = p_possible
    and not exists (
      select 1 from public.felt_reports fr2
      where fr2.event_id = p_target
        and (fr2.device_id = fr.device_id or (fr.user_id is not null and fr2.user_id = fr.user_id))
    );
  update public.events
  set status = 'merged', merged_into = p_target, updated_at = now()
  where event_id = p_possible and status = 'possible';
  insert into public.event_merges (source_event_id, target_event_id, reason, merged_by)
  values (p_possible, p_target, 'crowd_reconciled', 'system');
end
$$;

-- 6. Reconciliation: every possible event a given provider event explains
drop function if exists public.reconcile_possible_event(uuid);
create function public.reconcile_possible_event(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.event_id from public.events p
    where p.status = 'possible' and p.merged_into is null
      and p.created_at >= now() - interval '48 hours'
  loop
    if public.crowd_match_ok(r.event_id, p_event_id) then
      perform public.merge_possible_event(r.event_id, p_event_id);
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

-- ... and the sweep: every open possible event, merged into its best match
create or replace function public.reconcile_possible_events()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  p record;
  v_target uuid;
  n integer := 0;
begin
  for p in
    select e.event_id, coalesce(e.crowd_first_report_at, e.origin_time) as first_at, e.lat, e.lon
    from public.events e
    where e.status = 'possible' and e.merged_into is null
      and e.created_at >= now() - interval '48 hours'
  loop
    select t.event_id into v_target
    from public.events t
    where t.status = 'published' and t.merged_into is null
      and t.origin_time between p.first_at - interval '10 minutes' and p.first_at + interval '60 seconds'
      and ST_DWithin(
            geography(ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)),
            geography(ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)),
            100000
          )
      and public.crowd_match_ok(p.event_id, t.event_id)
    order by abs(extract(epoch from (t.origin_time - p.first_at))) asc
    limit 1;
    if v_target is not null then
      perform public.merge_possible_event(p.event_id, v_target);
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

-- 7. Assignment only to events that can carry reports
create or replace function public.assign_unassigned_felt_reports()
returns integer
language sql
security definer
set search_path = public, extensions
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
     and e.status in ('published', 'possible')
     and e.review_status <> 'deleted'
     and (
       e.status = 'possible'
       or exists (
         select 1 from public.event_source_records esr
         where esr.event_id = e.event_id and esr.review_status <> 'deleted' and esr.verified_at is not null
       )
     )
     and fr.created_at >= e.origin_time
     and fr.created_at <= e.origin_time + interval '30 minutes'
     and ST_DWithin(
           geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
           geography(ST_SetSRID(ST_MakePoint(fr.lon, fr.lat), 4326)),
           300000
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
    select report_id, event_id
    from (
      select report_id, event_id,
        row_number() over (partition by device_id, event_id order by report_id) as device_event_rn
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

-- 8. Detection
create or replace function public.detect_possible_events()
returns setof uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_time_window constant interval := interval '10 minutes';
  v_live_window constant interval := interval '12 minutes';
  v_n_min_users constant integer := 8;
  v_min_cartoon_level constant smallint := 2;
  v_min_gps_share constant double precision := 0.5;
  v_min_cells constant integer := 3;
  v_cooldown constant interval := interval '30 minutes';
  v_cooldown_radius_m constant double precision := 100000;
  v_provider constant text := 'bumelerze-crowd';
  v_region_min_lat constant double precision := 33.0;
  v_region_max_lat constant double precision := 38.5;
  v_region_min_lon constant double precision := 41.0;
  v_region_max_lon constant double precision := 48.5;
  v_bucket bigint := floor(extract(epoch from now()) / 600);
  v_cell record;
  s record;
  v_provider_event_id text;
  v_existing uuid;
  v_new_event_id uuid;
  v_source_record_id uuid;
begin
  for v_cell in
    select left(fr.geohash_p5, 4) as p4, count(distinct fr.user_id) as n
    from public.felt_reports fr
    where fr.event_id is null
      and fr.user_id is not null
      and fr.created_at >= now() - v_time_window
      and fr.submitted_at >= now() - v_live_window
      and fr.lat between v_region_min_lat and v_region_max_lat
      and fr.lon between v_region_min_lon and v_region_max_lon
    group by left(fr.geohash_p5, 4)
    order by n desc, p4 asc
  loop
    with cluster as (
      select fr.*,
        row_number() over (partition by fr.user_id order by fr.created_at asc) as user_rn
      from public.felt_reports fr
      where fr.event_id is null
        and fr.user_id is not null
        and fr.created_at >= now() - v_time_window
        and fr.submitted_at >= now() - v_live_window
        and fr.lat between v_region_min_lat and v_region_max_lat
        and fr.lon between v_region_min_lon and v_region_max_lon
        and left(fr.geohash_p5, 4) = any (array[v_cell.p4] || public.geohash_neighbors(v_cell.p4))
    ),
    people as (select * from cluster where user_rn = 1)
    select
      (select count(*) from cluster) as reports,
      count(*) as users,
      count(*) filter (where cartoon_level >= v_min_cartoon_level) as felt,
      count(*) filter (where location_quality = 'gps') as gps,
      count(distinct geohash_p5) filter (where location_quality = 'gps') as cells,
      percentile_cont(0.5) within group (order by lat) filter (where location_quality = 'gps') as lat,
      percentile_cont(0.5) within group (order by lon) filter (where location_quality = 'gps') as lon,
      to_timestamp(percentile_cont(0.5) within group (order by extract(epoch from created_at)::double precision)) as origin_time,
      min(created_at) as first_at,
      array_agg(report_id) as report_ids
    into s
    from people;

    if s.users < v_n_min_users then continue; end if;
    if s.felt * 2 < s.users then continue; end if;
    if s.gps < v_min_gps_share * s.users then continue; end if;
    if s.cells < v_min_cells then continue; end if;

    select e.event_id into v_existing
    from public.events e
    where e.status = 'possible'
      and e.created_at >= now() - v_cooldown
      and ST_DWithin(
            geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
            geography(ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326)),
            v_cooldown_radius_m
          )
    limit 1;
    if v_existing is not null then continue; end if;

    v_provider_event_id := 'crowd-' || v_cell.p4 || '-' || v_bucket::text;
    perform pg_advisory_xact_lock(hashtext(v_provider || ':' || v_provider_event_id));
    select esr.event_id into v_existing
    from public.event_source_records esr
    where esr.provider = v_provider and esr.provider_event_id = v_provider_event_id;
    if v_existing is not null then continue; end if;

    insert into public.events (
      origin_time, lat, lon, depth_km, magnitude, mag_type, place, status, region_flag,
      crowd_first_report_at, crowd_user_count, crowd_report_count
    ) values (
      s.origin_time, s.lat, s.lon, null, null, null, null, 'possible',
      (s.lat between v_region_min_lat and v_region_max_lat and s.lon between v_region_min_lon and v_region_max_lon),
      s.first_at, s.users, s.reports
    )
    returning event_id into v_new_event_id;

    insert into public.event_source_records (
      event_id, provider, provider_event_id, raw_payload,
      parsed_origin_time, parsed_lat, parsed_lon, parsed_depth_km,
      parsed_magnitude, parsed_mag_type, parsed_place
    ) values (
      v_new_event_id, v_provider, v_provider_event_id,
      jsonb_build_object(
        'rule', 'crowd-v2', 'report_count', s.reports, 'user_count', s.users,
        'felt_count', s.felt, 'gps_count', s.gps, 'p5_cells', s.cells,
        'first_report_at', s.first_at, 'seed_cell', v_cell.p4
      ),
      s.origin_time, s.lat, s.lon, null, null, null, null
    )
    returning source_record_id into v_source_record_id;

    update public.events
    set origin_time_source_id = v_source_record_id, location_source_id = v_source_record_id
    where event_id = v_new_event_id;

    update public.felt_reports fr
    set event_id = v_new_event_id
    where fr.report_id = any (s.report_ids);

    return next v_new_event_id;
  end loop;
  return;
end
$$;

-- 9. One sequential job: assign, reconcile, detect
create or replace function public.run_crowd_pipeline()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_assigned integer;
  v_merged integer;
  v_detected integer;
begin
  v_assigned := public.assign_unassigned_felt_reports();
  v_merged := public.reconcile_possible_events();
  select count(*) into v_detected from public.detect_possible_events();
  return jsonb_build_object('assigned', v_assigned, 'merged', v_merged, 'detected', v_detected);
end
$$;

revoke all on function public.felt_reports_server_times() from public, anon, authenticated;
revoke all on function public.ipe_aww2012_mmi(double precision, double precision) from public, anon, authenticated;
revoke all on function public.crowd_match_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function public.merge_possible_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reconcile_possible_event(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_possible_events() from public, anon, authenticated;
revoke all on function public.assign_unassigned_felt_reports() from public, anon, authenticated;
revoke all on function public.detect_possible_events() from public, anon, authenticated;
revoke all on function public.run_crowd_pipeline() from public, anon, authenticated;
grant execute on function public.reconcile_possible_event(uuid) to service_role;
grant execute on function public.run_crowd_pipeline() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'assign_unassigned_felt_reports') then
    perform cron.unschedule('assign_unassigned_felt_reports');
  end if;
  if exists (select 1 from cron.job where jobname = 'detect_possible_events') then
    perform cron.unschedule('detect_possible_events');
  end if;
  if exists (select 1 from cron.job where jobname = 'crowd_pipeline') then
    perform cron.unschedule('crowd_pipeline');
  end if;
  perform cron.schedule('crowd_pipeline', '*/2 * * * *', $cron$select public.run_crowd_pipeline();$cron$);
end
$$;
