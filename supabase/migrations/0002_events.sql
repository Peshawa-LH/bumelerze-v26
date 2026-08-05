-- Bumelerze schema v0 — canonical events + per-provider source records
-- Implements event-pipeline-design.md §1 (identity model) + §2 (dedup/merge).

-- ---------------------------------------------------------------------------
-- events: one row per physical earthquake. Canonical parameters are derived
-- (never hand-edited) from event_source_records on every ingest change.
-- ---------------------------------------------------------------------------
create table public.events (
  event_id uuid primary key default gen_random_uuid(),

  origin_time timestamptz not null,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  depth_km numeric,
  magnitude numeric not null,
  mag_type text, -- e.g. 'Mww','mb','ML' — prefer Mw-family over mb/ML at equal source tier (pipeline §2)

  place text, -- human-readable place string, e.g. "32 km SW of Erbil"

  -- USGS-style lifecycle status of the canonical record itself (distinct
  -- from each source record's own review_status below).
  review_status text not null default 'automatic'
    check (review_status in ('automatic', 'reviewed', 'deleted')),

  -- event-pipeline-design.md §3: provider-independent significance score.
  -- Recomputed server-side (ingestion + felt-cell recompute both touch it),
  -- never hand-edited by a client.
  sig integer not null default 0,

  -- event-pipeline-design.md §4: inside the Kurdistan-region bbox. Plain
  -- boolean set by the ingestion worker against its own config value — the
  -- bbox is "tunable... stored in config, not code", so this is deliberately
  -- NOT a generated column: changing the bbox is a worker config change, not
  -- a schema migration.
  region_flag boolean not null default false,

  -- Per-field provenance: which event_source_records row supplied each
  -- canonical value (spec-v1 §5.1 "never displayed or computed without a
  -- citable source"). FK constraints are added below, after
  -- event_source_records exists, to avoid a circular CREATE TABLE order.
  origin_time_source_id uuid,
  location_source_id uuid,  -- covers the lat/lon pair, which always come from the same source record
  depth_source_id uuid,
  magnitude_source_id uuid, -- also covers mag_type

  -- event-pipeline-design.md §2 merge/split repair: when set, this event was
  -- absorbed into merged_into and should be treated as superseded. Rows are
  -- never deleted on merge — this preserves any felt_reports/
  -- shakemap_products rows that still point at the old event_id. See
  -- supabase/README.md "merge model".
  merged_into uuid references public.events (event_id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.events is
  'Canonical internal earthquake events (spec-v1 §5.1). One row per physical event, derived from event_source_records — never hand-edited.';
comment on column public.events.merged_into is
  'Set by the dedup/merge job (event-pipeline-design.md §2) when this event was found to duplicate another; points at the surviving event_id. Row is kept, not deleted.';

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- event_source_records: one row per (provider, provider_event_id), raw +
-- parsed. Never deleted — updated in place on re-fetch (event-pipeline-
-- design.md §1/§2 step 1: "same (provider, provider_event_id) -> update that
-- source record").
-- ---------------------------------------------------------------------------
create table public.event_source_records (
  source_record_id uuid primary key default gen_random_uuid(),

  event_id uuid not null references public.events (event_id) on delete cascade,

  -- 'other' is a deliberate escape hatch so a brand-new provider config
  -- (event-pipeline-design.md ingest-cadence note: "adding them is config,
  -- not redesign") never forces a same-day migration to widen this check.
  provider text not null
    check (provider in ('usgs', 'emsc', 'geofon', 'afad', 'irsc', 'iscgem', 'manual', 'other')),
  provider_event_id text not null,

  raw_payload jsonb not null, -- verbatim provider payload, kept forever (D13 provenance)

  parsed_origin_time timestamptz not null,
  parsed_lat double precision not null check (parsed_lat between -90 and 90),
  parsed_lon double precision not null check (parsed_lon between -180 and 180),
  parsed_depth_km numeric,
  parsed_magnitude numeric,
  parsed_mag_type text,
  parsed_place text,

  review_status text not null default 'automatic'
    check (review_status in ('automatic', 'reviewed', 'deleted')),

  fetched_at timestamptz not null default now(), -- when our worker pulled it
  provider_updated_at timestamptz,               -- provider's own updated timestamp; drives the `updatedafter` delta-sync sweep (pipeline §2)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_source_records_provider_ext_id_uq unique (provider, provider_event_id)
);

comment on table public.event_source_records is
  'One row per provider record (USGS/EMSC/...), keyed by (provider, provider_event_id). Updated in place on re-fetch; source of all events.* provenance.';

create trigger event_source_records_set_updated_at
  before update on public.event_source_records
  for each row execute function public.set_updated_at();

-- Now that event_source_records exists, wire up events' per-field provenance FKs.
alter table public.events
  add constraint events_origin_time_source_fk foreign key (origin_time_source_id) references public.event_source_records (source_record_id),
  add constraint events_location_source_fk foreign key (location_source_id) references public.event_source_records (source_record_id),
  add constraint events_depth_source_fk foreign key (depth_source_id) references public.event_source_records (source_record_id),
  add constraint events_magnitude_source_fk foreign key (magnitude_source_id) references public.event_source_records (source_record_id);

-- ---------------------------------------------------------------------------
-- event_merges: audit log for the merge path of event-pipeline-design.md §2.
-- Splits are manual-review-only and are not modeled here (logged elsewhere as
-- an operational alert, not a schema row, until a real split occurs).
-- ---------------------------------------------------------------------------
create table public.event_merges (
  merge_id uuid primary key default gen_random_uuid(),

  source_event_id uuid not null references public.events (event_id), -- the event absorbed (its merged_into now points at target_event_id)
  target_event_id uuid not null references public.events (event_id), -- the surviving event

  reason text, -- e.g. 'cross_reference_match', 'spatial_temporal_match', 'manual'
  merged_at timestamptz not null default now(),
  merged_by text not null default 'system', -- 'system' | 'manual:<name>'

  constraint event_merges_distinct_events check (source_event_id <> target_event_id)
);

comment on table public.event_merges is
  'Audit trail for event_id merges (event-pipeline-design.md §2). Never used to repair splits — those are manual-review only.';

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index idx_events_origin_time on public.events (origin_time desc);
create index idx_events_region_flag on public.events (region_flag);
create index idx_events_sig on public.events (sig desc);

-- The actual "main read" shape (spec-v1 §4.1 region-first feed, low-
-- bandwidth priority): recent, non-merged-away events in the region, newest
-- first.
create index idx_events_region_feed on public.events (region_flag, origin_time desc)
  where merged_into is null;

create index idx_esr_event_id on public.event_source_records (event_id);
create index idx_esr_provider_updated_at on public.event_source_records (provider_updated_at);

create index idx_event_merges_source on public.event_merges (source_event_id);
create index idx_event_merges_target on public.event_merges (target_event_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.event_source_records enable row level security;
alter table public.event_merges enable row level security;

-- events: public catalog data, no per-row secrecy — anonymous read is the
-- whole point of the app (spec-v1 §4.1). Writes only ever come from the
-- ingestion edge function via the service_role key, which bypasses RLS
-- entirely (Supabase built-in behavior) — no insert/update/delete policy is
-- defined here on purpose.
create policy events_public_select
  on public.events for select
  to anon, authenticated
  using (true);

-- event_source_records and event_merges are internal ingestion machinery,
-- never read or written by the app directly. RLS is enabled with zero
-- policies for anon/authenticated, which denies all client access by
-- default; the ingestion worker's service_role key bypasses RLS to read/
-- write both tables.
