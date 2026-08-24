-- Bumelerze schema v0 — shakemap product contract
-- Implements D9 / spec-v1 §5.3: one product-shaped contract for both
-- producers (USGS-sourced products and bumelerze-shake-service output).

create table public.shakemap_products (
  product_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (event_id) on delete cascade,

  producer text not null check (producer in ('usgs', 'bumelerze')),
  version integer not null, -- USGS-style re-conditioning: every changed re-run is a new version, old versions retained (D9)
  product_type text not null check (product_type in ('contours', 'raster', 'metadata')),

  storage_path text not null, -- Supabase Storage path (or external URL for pass-through USGS products)

  -- D9 "every map cites its data sources": which catalog/faults/stations/
  -- felt-report inputs actually fed this version. Structure is producer-
  -- defined; kept as JSONB rather than typed columns since the shake-
  -- service's graded-conditioning inputs (D9/D20) will evolve faster than
  -- this table should need migrations.
  data_used jsonb not null,

  created_at timestamptz not null default now(),

  -- Idempotent worker re-runs (or a re-delivered ingestion message) never
  -- create a duplicate product row for the same (event, producer, version,
  -- type).
  constraint shakemap_products_uq unique (event_id, producer, version, product_type)
);

comment on table public.shakemap_products is
  'One ShakeMap product contract regardless of producer (USGS or bumelerze-shake-service). Versioned, never overwritten (D9).';

create index idx_shakemap_products_event on public.shakemap_products (event_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.shakemap_products enable row level security;

-- Public read, matching the citation-everywhere trust principle (spec-v1
-- §6). Writes come only from the shake-service via the service_role key,
-- which bypasses RLS — no insert/update/delete policy is defined here.
create policy shakemap_products_public_select
  on public.shakemap_products for select
  to anon, authenticated
  using (true);
