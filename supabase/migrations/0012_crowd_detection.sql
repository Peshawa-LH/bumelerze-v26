-- 0012: crowdsourced event detection ("possible events") + agency
-- reconciliation, D26 items 3-4.
--
-- Implements the crowdsourced-detection design (dated 2026-08-16)
-- on top of the event-registry + auto-assignment foundation from migration
-- 0011 (`upsert_event_from_client`, `assign_unassigned_felt_reports`, the
-- "unassigned pool" of `felt_reports` rows with `event_id is null`). All
-- thresholds below are the design doc's engineering defaults, individually
-- flagged `[engineering default — review batch item 8]` per that doc's own
-- §7 review list; they ship now (D14 delegation, R1/R6 precedent:
-- provisional-but-implemented) and are NOT open questions.
--
-- Three pieces:
--   1. `events.status` (new column) + a status-scoped relaxation of the
--      previously-mandatory `magnitude` column, so a crowd-detected event
--      can exist with no agency-reported magnitude.
--   2. `geohash_adjacent` / `geohash_neighbors` — small immutable helpers
--      implementing the standard geohash neighbor-cell algorithm (Niemeyer
--      base32 encoding; same lookup-table algorithm used by every major
--      geohash library), used to build detection clusters as "a p4 cell and
--      its 8 neighbors" (design doc §2's SPATIAL_CLUSTER, ~30 km).
--   3. `detect_possible_events()` (service-role/cron) and
--      `expire_stale_possible_events()` (service-role/cron), plus a
--      `CREATE OR REPLACE` of 0011's `upsert_event_from_client` that adds
--      the design doc §4 reconciliation step.
--
-- No RLS changes: `events_public_select` (0002) is `using (true)` — it
-- already grants anon+authenticated SELECT on every `events` row regardless
-- of `status`, so 'possible' rows are readable the instant this migration
-- lands with zero policy change. (Checked per the wave brief's "inspect
-- first, don't duplicate" instruction — a second, narrower `status =
-- 'possible'` policy would be redundant, not additive, under Postgres RLS's
-- OR-of-permissive-policies semantics.)

-- ---------------------------------------------------------------------------
-- 1a. events.status — the crowd-detection lifecycle axis. Distinct from the
-- existing `review_status` (automatic/reviewed/deleted, an agency-catalog
-- review concept) and from `merged_into` (the general cross-provider
-- dedup/merge audit pointer, 0002) — 'merged' here specifically means "this
-- crowd-detected event was reconciled onto an agency event" (§4 below);
-- `merged_into` is what actually points at the surviving row, exactly like
-- every other merge in this schema.
-- ---------------------------------------------------------------------------
alter table public.events
  add column status text not null default 'published'
    check (status in ('published', 'possible', 'merged', 'unconfirmed'));

comment on column public.events.status is
  'Crowd-detection lifecycle (D26, migration 0012): published = normal agency-catalog event (default, unchanged behavior); possible = crowd-detected, unconfirmed origin; merged = a possible event reconciled onto an agency event (see merged_into + event_merges); unconfirmed = a possible event that aged out (24h) with no agency confirmation. Orthogonal to review_status (agency review workflow) and merged_into (general merge-audit pointer, reused here for the possible->merged case too).';

-- 1b. magnitude: relax NOT NULL only for the crowd-lifecycle statuses — a
-- possible/merged/unconfirmed crowd row has no agency-reported magnitude by
-- definition (design doc §3: "magnitude NULL"); every 'published' row (the
-- only kind that existed before this migration, and the only kind any
-- provider-sourced upsert ever creates) keeps the not-null guarantee via
-- this CHECK instead of the column-level constraint.
alter table public.events alter column magnitude drop not null;
alter table public.events
  add constraint events_magnitude_required_when_published
    check (status <> 'published' or magnitude is not null);

-- 1c. event_source_records.provider — widen the allow-list for the crowd
-- pipeline's own provider tag. Crowd events get an event_source_records row
-- too (see detect_possible_events below), same (provider, provider_event_id)
-- shape as any agency ingest write, so a future worker/backfill never needs
-- a special case to tell a crowd sighting apart from an agency one — 0002's
-- own "'other' is a deliberate escape hatch... adding [providers] is
-- config, not redesign" comment applies exactly here.
-- NOTE: `event_source_records_provider_check` is the name Postgres
-- auto-assigns to an unnamed inline column CHECK (`<table>_<column>_check`,
-- the standard convention for this constraint shape) — this migration was
-- authored without a local Postgres to confirm it against; if this DROP
-- CONSTRAINT fails on apply, the orchestrator should run
-- `\d event_source_records` (or query `information_schema.check_constraints`)
-- to find the real name and patch this migration before re-applying.
alter table public.event_source_records
  drop constraint event_source_records_provider_check;
alter table public.event_source_records
  add constraint event_source_records_provider_check
    check (provider in ('usgs', 'emsc', 'geofon', 'afad', 'irsc', 'iscgem', 'manual', 'bumelerze-crowd', 'other'));

-- ---------------------------------------------------------------------------
-- 2. geohash_adjacent / geohash_neighbors — pure, IMMUTABLE geohash-cell
-- neighbor computation. Standard base32-geohash neighbor algorithm (the same
-- lookup-table approach used by e.g. python-geohash, geohash-js): each
-- direction has two lookup strings per hash-length parity (even/odd length
-- alternates which axis the trailing character encodes), recursing into the
-- parent hash only when the trailing character sits on that direction's
-- cell border. No table access, no side effects — safe to call from any
-- context, including per-row inside detect_possible_events' hot loop.
-- ---------------------------------------------------------------------------
create or replace function public.geohash_adjacent(p_hash text, p_dir text)
returns text
language plpgsql
immutable
strict
as $$
declare
  -- [dir] -> [even-length table, odd-length table] — verbatim from the
  -- reference algorithm (Niemeyer geohash, base32 alphabet
  -- "0123456789bcdefghjkmnpqrstuvwxyz").
  v_neighbor jsonb := '{
    "n": ["p0r21436x8zb9dcf5h7kjnmqesgutwvy", "bc01fg45238967deuvhjyznpkmstqrwx"],
    "s": ["14365h7k9dcfesgujnmqp0r2twvyx8zb", "238967debc01fg45kmstqrwxuvhjyznp"],
    "e": ["bc01fg45238967deuvhjyznpkmstqrwx", "p0r21436x8zb9dcf5h7kjnmqesgutwvy"],
    "w": ["238967debc01fg45kmstqrwxuvhjyznp", "14365h7k9dcfesgujnmqp0r2twvyx8zb"]
  }'::jsonb;
  v_border jsonb := '{
    "n": ["prxz", "bcfguvyz"],
    "s": ["028b", "0145hjnp"],
    "e": ["bcfguvyz", "prxz"],
    "w": ["0145hjnp", "028b"]
  }'::jsonb;
  v_base32 constant text := '0123456789bcdefghjkmnpqrstuvwxyz';
  v_hash text := lower(p_hash);
  v_len integer := length(v_hash);
  v_last_char text;
  v_parent text;
  v_type integer; -- 0 = even-length hash, 1 = odd-length hash
  v_neighbor_str text;
  v_border_str text;
  v_idx integer;
begin
  if v_len = 0 then
    -- Recursed past the top of a geohash prefix (only reachable at a real
    -- geohash grid edge/pole, never for any Kurdistan-region cell) — no
    -- further parent to adjust; return as-is.
    return v_hash;
  end if;
  if p_dir not in ('n', 's', 'e', 'w') then
    raise exception 'geohash_adjacent: unknown direction %', p_dir using errcode = '22023';
  end if;

  v_last_char := right(v_hash, 1);
  v_parent := left(v_hash, v_len - 1);
  v_type := v_len % 2;

  v_border_str := (v_border -> p_dir) ->> v_type;
  if position(v_last_char in v_border_str) > 0 and v_parent <> '' then
    v_parent := public.geohash_adjacent(v_parent, p_dir);
  end if;

  v_neighbor_str := (v_neighbor -> p_dir) ->> v_type;
  v_idx := position(v_last_char in v_neighbor_str); -- 1-based; equals the 0-based BASE32 index of the substituted char
  return v_parent || substr(v_base32, v_idx, 1);
end;
$$;

comment on function public.geohash_adjacent(text, text) is
  'Standard base32-geohash single-step neighbor (dir in n/s/e/w). Pure/IMMUTABLE. Migration 0012.';

create or replace function public.geohash_neighbors(p_hash text)
returns text[]
language sql
immutable
strict
as $$
  select array[
    public.geohash_adjacent(p_hash, 'n'),
    public.geohash_adjacent(p_hash, 's'),
    public.geohash_adjacent(p_hash, 'e'),
    public.geohash_adjacent(p_hash, 'w'),
    public.geohash_adjacent(public.geohash_adjacent(p_hash, 'n'), 'e'),
    public.geohash_adjacent(public.geohash_adjacent(p_hash, 'n'), 'w'),
    public.geohash_adjacent(public.geohash_adjacent(p_hash, 's'), 'e'),
    public.geohash_adjacent(public.geohash_adjacent(p_hash, 's'), 'w')
  ];
$$;

comment on function public.geohash_neighbors(text) is
  'The 8 neighbor cells (n/s/e/w/ne/nw/se/sw) of a geohash cell, same precision as the input. Pure/IMMUTABLE. Migration 0012.';

-- ---------------------------------------------------------------------------
-- 3. detect_possible_events() — design doc §2. NOT client-callable
-- (service-role/cron only, like 0011's assign_unassigned_felt_reports).
--
-- Cluster definition: for a seed p4 cell (the first 4 characters of a
-- report's own `geohash_p5` — a geohash prefix at precision N IS the
-- geohash at precision N, so no separate ST_GeoHash(...,4) call is needed),
-- the cluster is every unassigned, in-window, in-region report whose own p4
-- cell is the seed cell or one of its 8 neighbors (geohash_neighbors above)
-- — design doc's "geohash-p4 cell + 8 neighbors", ~30 km.
--
-- Processing order + overlap handling: candidate seed cells are visited
-- largest-occupancy-first. Each iteration re-queries the LIVE cluster
-- membership (`event_id is null` at the time of that iteration, not a
-- pre-materialized snapshot) — so once a bigger neighboring cluster claims
-- (assigns) its reports earlier in the same run, a smaller overlapping
-- candidate naturally sees fewer/no remaining unassigned reports and either
-- fails the threshold or clusters around whatever's left. This is what
-- keeps two adjacent qualifying cells from both firing for the same
-- physical report burst within one run.
--
-- Idempotency (belt + suspenders, two independent mechanisms):
--   1. Cooldown (design doc's COOLDOWN=30min): skip a candidate cluster
--      whose centroid is within v_cluster_radius_m of an existing 'possible'
--      event created in the last 30 minutes — the primary "don't spam one
--      area" guard, and what makes a normal repeat cron tick (2 min later,
--      same ongoing burst) a no-op once the first possible event exists.
--   2. Deterministic provider_event_id (`crowd-<p4>-<10min bucket>`) +
--      event_source_records' unique (provider, provider_event_id) index:
--      a hard guarantee against a genuine double-insert even in the
--      pathological case of two concurrent invocations racing past the
--      cooldown check for the same cluster in the same instant (same
--      pattern/rationale as 0011's advisory-lock comment on
--      upsert_event_from_client).
--
-- Report assignment is device-deduped before the UPDATE (one report per
-- device_id per cluster, earliest by created_at) for the same reason
-- assign_unassigned_felt_reports (0011) dedupes before its own bulk UPDATE:
-- felt_reports_device_event_uq (device_id, event_id) is enforced per-
-- statement, so two rows in the same cluster from the same device (e.g. a
-- device that double-tapped "I felt it" before either was assigned) would
-- abort the whole UPDATE if both were written in one statement. Any
-- resulting leftover unassigned duplicate is picked up (or correctly stays
-- unassigned, "one report counts") by assign_unassigned_felt_reports' own
-- next run — that function doesn't filter on events.status, so it matches
-- against 'possible' events exactly like any other event.
-- ---------------------------------------------------------------------------
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
      percentile_cont(0.5) within group (order by created_at),
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
create or replace function public.expire_stale_possible_events()
returns integer
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.events
    set status = 'unconfirmed'
    where status = 'possible'
      and created_at < now() - interval '24 hours' -- [engineering default — review batch item 8]
    returning event_id
  )
  select count(*)::integer from updated;
$$;

comment on function public.expire_stale_possible_events() is
  'Server-side (service-role/cron) sweep: possible events older than 24h with no agency confirmation -> unconfirmed. Never deletes. Not client-callable. D26 item 3, felt-detection-design.md §4. Migration 0012.';

revoke all on function public.expire_stale_possible_events() from public, anon, authenticated;
grant execute on function public.expire_stale_possible_events() to service_role;

-- ---------------------------------------------------------------------------
-- 5. upsert_event_from_client — CREATE OR REPLACE, same signature as 0011,
-- extended with the design doc §4 "Confirmation" reconciliation: when this
-- call creates a genuinely NEW agency event (step 3, unchanged above this
-- point), check for a recent 'possible' event within the widened
-- crowd-reconciliation thresholds (|Δt| <= 10 min, <= 100 km — looser than
-- the tight cross-provider match in step 2, since a crowd centroid/median
-- time is a rougher estimate than another agency catalog's own record) and,
-- if found, merge it onto the new agency event: move its felt_reports,
-- flip it to status = 'merged' with merged_into pointing at the agency
-- event (reusing the existing general-purpose merged_into column exactly
-- as any other merge in this schema uses it), and log the alias in
-- event_merges (0002) — no new table, that audit table already has exactly
-- this (source_event_id, target_event_id, reason) shape.
--
-- Also rejects p_provider = 'bumelerze-crowd' outright: that provider tag
-- is reserved for detect_possible_events' own internal inserts (which
-- bypass this client-callable function entirely); the check exists only so
-- widening event_source_records' provider CHECK constraint above never
-- accidentally opens a second, client-reachable path to create rows that
-- look like crowd events.
-- ---------------------------------------------------------------------------
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
  -- CHECK constraint (0002, widened by migration 0012) — deliberately not
  -- duplicated here so the allowed-provider list has exactly one place it
  -- can drift out of sync.

  perform pg_advisory_xact_lock(hashtext(p_provider || ':' || p_provider_event_id));

  -- 1) Already-known provider sighting -> return its event_id (idempotent
  --    retry path; also the common "second felt report on an event we
  --    already registered" path).
  select esr.event_id into v_event_id
  from public.event_source_records esr
  where esr.provider = p_provider
    and esr.provider_event_id = p_provider_event_id;

  if v_event_id is not null then
    return v_event_id;
  end if;

  -- 2) New provider sighting — cross-provider dedup match against recent
  --    canonical (non-merged-away) events, same thresholds as
  --    src/features/events/config.ts DEDUP_* (see 0011's header comment).
  select e.event_id into v_match_event_id
  from public.events e
  where e.merged_into is null
    and abs(extract(epoch from (e.origin_time - p_origin_time))) <= 16
    and abs(e.magnitude - p_magnitude) <= 1.5
    and ST_DWithin(
          geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
          geography(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)),
          100000 -- 100 km, meters
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

  -- 3) Genuinely new physical event: create the canonical row + its first
  --    source record together (status defaults to 'published' — this path
  --    only ever creates real agency-catalog events, never a crowd one).
  insert into public.events (
    origin_time, lat, lon, depth_km, magnitude, mag_type, place, region_flag
  ) values (
    p_origin_time, p_lat, p_lon, p_depth_km, p_magnitude, p_mag_type, p_place_name,
    (p_lat between v_region_min_lat and v_region_max_lat
       and p_lon between v_region_min_lon and v_region_max_lon)
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

  -- D26 §4 reconciliation (migration 0012): this new agency event may
  -- CONFIRM a recent crowd-detected 'possible' event. Widened thresholds
  -- vs step 2's tight cross-provider match — see the function-level
  -- comment above. Same accepted-race caveat as step 2's own match query:
  -- two agency events racing to confirm the SAME possible event in the
  -- same instant could theoretically both pass this SELECT before either
  -- commits; low-probability, undocumented-but-inherited from this
  -- function's existing race posture (0011's own header comment already
  -- accepts the equivalent two-new-events race one step up).
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
    -- Move reports, device-dedup safe: skip a report whose device_id
    -- already has a row on the target (felt_reports_device_event_uq's own
    -- "one report counts" guard — see 0011's assign_unassigned_felt_reports
    -- comment for the identical pattern). No within-statement collision
    -- risk on the SOURCE side: felt_reports_device_event_uq already
    -- guarantees at most one row per (device_id, v_possible_event_id).
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
  'Client-callable (RLS-bypassing SECURITY DEFINER) insert-or-resolve for the canonical events.event_id behind a (provider, provider_event_id) pair, so a felt report can attach to an event before any server ingestion pipeline exists. Cross-provider dedup mirrors src/features/events/config.ts DEDUP_* — keep in sync. Extended in migration 0012 with D26 §4 possible-event reconciliation.';

revoke all on function public.upsert_event_from_client(
  text, text, timestamptz, double precision, double precision, numeric, numeric, text, text
) from public;
grant execute on function public.upsert_event_from_client(
  text, text, timestamptz, double precision, double precision, numeric, numeric, text, text
) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------

-- detect_possible_events' primary discovery filter: unassigned + recent +
-- grouped by p4 cell prefix. Partial + functional, mirrors 0011's own
-- idx_felt_reports_unassigned_created_at.
create index idx_felt_reports_unassigned_geohash_p4
  on public.felt_reports (left(geohash_p5, 4))
  where event_id is null;

-- Both the cooldown check inside detect_possible_events and the client's
-- own possible-events read (src/features/events/possible.ts, last 24h)
-- filter on (status, created_at) — a partial index scoped to the one status
-- value both of those actually query keeps it small regardless of how many
-- 'published'-status rows accumulate.
create index idx_events_status_created_at
  on public.events (status, created_at desc)
  where status = 'possible';
