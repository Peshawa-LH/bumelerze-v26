-- 0014_fix_detect_possible_events_median.sql
--
-- FIX (found live 2026-08-16, first detection drill): Postgres has no
-- `percentile_cont(double precision) within group (order by timestamptz)`
-- overload — 0012's median-origin-time aggregate threw at parse time as
-- soon as ANY unassigned in-region report entered the 10-minute window,
-- so `detect_possible_events()` (and its 2-minute cron) failed on every
-- run with live traffic and crowd detection never succeeded. Same
-- statistic, computed over epoch seconds instead. 0012 is left intact as
-- history; this re-issues the function verbatim apart from that line.

create or replace function public.detect_possible_events()
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  -- [engineering default — review batch item 8] design doc §2/§7.
  v_time_window constant interval := interval '10 minutes';
  v_n_min_devices constant integer := 8;
  v_min_cartoon_level constant smallint := 2;
  v_cooldown constant interval := interval '30 minutes';
  v_cluster_radius_m constant double precision := 30000; -- ~30 km; also the cooldown "same cluster area" test radius (design doc gives no separate cooldown-area shape, so this reuses SPATIAL_CLUSTER's own radius)
  v_provider constant text := 'bumelerze-crowd';

  -- MONITORED_BBOX mirror (src/features/events/config.ts REGION_BBOX, same
  -- literal values as 0011's upsert_event_from_client) — design doc §5:
  -- detection clustering is Kurdistan-only; reports from far outside are
  -- accepted into the pool but never feed clustering.
  v_region_min_lat constant double precision := 33.0;
  v_region_max_lat constant double precision := 38.5;
  v_region_min_lon constant double precision := 41.0;
  v_region_max_lon constant double precision := 48.5;

  v_bucket bigint := floor(extract(epoch from now()) / 600);
  v_cell record;
  v_report_count integer;
  v_device_count integer;
  v_felt_count integer;
  v_centroid_lat double precision;
  v_centroid_lon double precision;
  v_origin_time timestamptz;
  v_chosen_report_ids uuid[];
  v_provider_event_id text;
  v_existing_event_id uuid;
  v_new_event_id uuid;
  v_source_record_id uuid;
begin
  for v_cell in
    select left(fr.geohash_p5, 4) as p4, count(*) as n
    from public.felt_reports fr
    where fr.event_id is null
      and fr.created_at >= now() - v_time_window
      and fr.lat between v_region_min_lat and v_region_max_lat
      and fr.lon between v_region_min_lon and v_region_max_lon
    group by left(fr.geohash_p5, 4)
    order by n desc, p4 asc
  loop
    -- Single combined query: the cluster's aggregate stats AND the
    -- device-deduped report-id list to assign, computed together so there
    -- is exactly one place this cluster's filter is written (no risk of a
    -- second, hand-copied WHERE drifting out of sync). Re-run fresh every
    -- iteration — see the function-level comment on overlap handling.
    with cluster as (
      select
        fr.report_id,
        fr.device_id,
        fr.cartoon_level,
        fr.lat,
        fr.lon,
        fr.created_at,
        row_number() over (partition by fr.device_id order by fr.created_at asc) as device_rn
      from public.felt_reports fr
      where fr.event_id is null
        and fr.created_at >= now() - v_time_window
        and fr.lat between v_region_min_lat and v_region_max_lat
        and fr.lon between v_region_min_lon and v_region_max_lon
        and left(fr.geohash_p5, 4) = any (array[v_cell.p4] || public.geohash_neighbors(v_cell.p4))
    )
    select
      count(*),
      count(*) filter (where device_rn = 1), -- one row per distinct device_id
      count(*) filter (where cartoon_level >= v_min_cartoon_level),
      avg(lat),
      avg(lon),
      to_timestamp(percentile_cont(0.5) within group (order by extract(epoch from created_at)::double precision)),
      array_agg(report_id) filter (where device_rn = 1)
    into
      v_report_count, v_device_count, v_felt_count,
      v_centroid_lat, v_centroid_lon, v_origin_time, v_chosen_report_ids
    from cluster;

    if v_report_count = 0 or v_device_count < v_n_min_devices then
      continue;
    end if;

    -- MIN_LEVELS: >= half the cluster's reports at cartoon_level >= 2.
    if v_felt_count * 2 < v_report_count then
      continue;
    end if;

    -- Cooldown: an existing 'possible' event already covers this area.
    select e.event_id into v_existing_event_id
    from public.events e
    where e.status = 'possible'
      and e.created_at >= now() - v_cooldown
      and ST_DWithin(
            geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
            geography(ST_SetSRID(ST_MakePoint(v_centroid_lon, v_centroid_lat), 4326)),
            v_cluster_radius_m
          )
    limit 1;

    if v_existing_event_id is not null then
      continue;
    end if;

    v_provider_event_id := 'crowd-' || v_cell.p4 || '-' || v_bucket::text;

    -- Concurrency guard, same idiom as 0011's upsert_event_from_client.
    perform pg_advisory_xact_lock(hashtext(v_provider || ':' || v_provider_event_id));

    -- Idempotent re-run guard (mechanism 2 in the function-level comment).
    select esr.event_id into v_existing_event_id
    from public.event_source_records esr
    where esr.provider = v_provider and esr.provider_event_id = v_provider_event_id;

    if v_existing_event_id is not null then
      continue;
    end if;

    insert into public.events (
      origin_time, lat, lon, depth_km, magnitude, mag_type, place, status, region_flag
    ) values (
      v_origin_time, v_centroid_lat, v_centroid_lon, null, null, null, null, 'possible',
      (v_centroid_lat between v_region_min_lat and v_region_max_lat
         and v_centroid_lon between v_region_min_lon and v_region_max_lon)
    )
    returning event_id into v_new_event_id;

    -- provider_event_id fits the exact same (provider, provider_event_id)
    -- shape every agency ingest write uses (0002/0011) — a crowd event is
    -- OURS, but it is still "a provider sighting of a physical event" in
    -- this model, just one whose provider happens to be us. raw_payload
    -- carries observability, not a verbatim feed payload (there is none).
    insert into public.event_source_records (
      event_id, provider, provider_event_id, raw_payload,
      parsed_origin_time, parsed_lat, parsed_lon, parsed_depth_km,
      parsed_magnitude, parsed_mag_type, parsed_place
    ) values (
      v_new_event_id, v_provider, v_provider_event_id,
      jsonb_build_object(
        'report_count', v_report_count,
        'device_count', v_device_count,
        'seed_cell', v_cell.p4
      ),
      v_origin_time, v_centroid_lat, v_centroid_lon, null, null, null, null
    )
    returning source_record_id into v_source_record_id;

    -- Only origin_time/location have a real source here — magnitude/depth
    -- are NULL (no value to attribute a source to), so those provenance
    -- columns are deliberately left null rather than pointed at a source
    -- record with nothing in it.
    update public.events
    set origin_time_source_id = v_source_record_id,
        location_source_id = v_source_record_id
    where event_id = v_new_event_id;

    update public.felt_reports fr
    set event_id = v_new_event_id
    where fr.report_id = any (v_chosen_report_ids);

    return next v_new_event_id;
  end loop;

  return;
end;
$$;

comment on function public.detect_possible_events() is
  'Server-side (service-role/cron) sweep: clusters unassigned, in-region, last-10-min felt_reports by geohash-p4 cell + 8 neighbors; creates a status=possible events row (provider bumelerze-crowd) when a cluster clears N_MIN_DEVICES/MIN_LEVELS, cooldown-gated per area. Not client-callable. D26 item 3, felt-detection-design.md §2. Migration 0012.';

revoke all on function public.detect_possible_events() from public, anon, authenticated;
grant execute on function public.detect_possible_events() to service_role;

-- ---------------------------------------------------------------------------
-- 4. expire_stale_possible_events() — design doc §4 "Expiry". NOT
-- client-callable. Never deletes (owner: self-recorded catalog value, D23) —
-- flips status only; the row (and its felt_reports) stay forever, still
-- reachable via its own deep link, just dropped from any feed that filters
-- on status = 'possible'.
-- ---------------------------------------------------------------------------
