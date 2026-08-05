-- Bumelerze schema v0 — felt-cell CDI/EMS aggregates
-- Implements felt-report-science-v1.md Part 3 (aggregation spec), storage
-- shape from §3.5, confirmed D18.

create table public.felt_cells (
  event_id uuid not null references public.events (event_id) on delete cascade,
  geohash text not null,

  -- D18 §3.1: 4 = rural rollup, 5 = base display/CDI precision, 6 = city
  -- refinement (computed additionally when a p5 cell holds >= 20 reports).
  precision smallint not null check (precision in (4, 5, 6)),

  n_reports integer not null default 0,
  n_tier2 integer not null default 0,

  cdi numeric(3, 1), -- felt-report-science-v1.md §3.2: floor 2.0, cap 9.0, rounded to 0.1
  cws numeric,       -- Community Weighted Sum feeding the CDI log formula (§3.2 steps 2-3)
  index_means jsonb, -- the 8 per-question consensus means — full audit trail (§3.2 step 1, §3.5)

  -- Parallel IMS-25 diagnostic path (§3.4, D7 amendment). Expert/beta-only in
  -- v1 (§3.4.5: "the public map shows CDI") — deliberately NOT exposed by
  -- felt_cells_public below.
  ems_int smallint,
  ems_range int4range,
  ems_method text check (ems_method in ('diagnostics', 'cartoon-mode')),

  damage_dist jsonb,    -- Q10 damage-grade answer distribution
  ground_effects jsonb, -- Q11 road/ground layer; excluded from CDI and EMS intensity (D18 R8)

  -- Bumped on every recompute (debounced >= 60s/event, §3.2 step 5); old
  -- versions retained — same versioning symmetry as shakemap_products (D9).
  version integer not null default 1,
  computed_at timestamptz not null default now(),

  constraint felt_cells_pk primary key (event_id, geohash, version)
);

comment on table public.felt_cells is
  'CDI + IMS-25 aggregates per (event, geohash cell), versioned per recompute. Raw per-report answers live in felt_reports/felt_report_details, never here.';
comment on column public.felt_cells.ems_int is
  'Expert/beta-only in v1 (felt-report-science-v1.md §3.4.5) — intentionally excluded from felt_cells_public.';

create index idx_felt_cells_event_precision on public.felt_cells (event_id, precision);

-- ---------------------------------------------------------------------------
-- public.felt_cells_public: the only felt-cell surface the app reads.
-- Enforces the D18 §3.2 step 4 display threshold (>= 3 reports) and returns
-- only the latest version per cell — "the threshold lives in the DB, not
-- the client". Also the mechanism that keeps ems_int/ems_range out of the
-- public surface (see felt_cells.ems_int comment above) without needing
-- column-level GRANTs.
-- ---------------------------------------------------------------------------
create view public.felt_cells_public as
select distinct on (fc.event_id, fc.geohash)
  fc.event_id,
  fc.geohash,
  fc.precision,
  fc.n_reports,
  fc.n_tier2,
  fc.cdi,
  fc.version,
  fc.computed_at
from public.felt_cells fc
where fc.n_reports >= 3
order by fc.event_id, fc.geohash, fc.version desc;

comment on view public.felt_cells_public is
  'Public read surface for felt cells: >=3 reports only, latest version per cell, CDI only (no EMS/IMS fields — expert/beta-only per felt-report-science-v1.md §3.4.5).';

-- Views run with the privileges of their owner (postgres) by default, so
-- this view can read all of felt_cells (RLS-blocked for anon/authenticated
-- below) while only ever emitting rows that pass the WHERE clause above.
grant select on public.felt_cells_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.felt_cells enable row level security;

-- No select/insert/update policy for anon/authenticated on the base table —
-- all public reads go through felt_cells_public above. The aggregation job
-- writes via the service_role key, which bypasses RLS.
