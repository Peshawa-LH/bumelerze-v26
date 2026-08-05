-- Bumelerze schema v0 — extensions and shared helpers
-- Supabase-first, minimal-ops: everything below runs inside the standard
-- Supabase Postgres stack (local `supabase start` or a hosted project).

-- pgcrypto: gen_random_uuid() for all primary keys. Supabase projects usually
-- ship with this enabled already; declared explicitly so this migration set
-- is self-contained and reproducible from a bare Postgres+Supabase image.
create extension if not exists pgcrypto;

-- postgis: used only for ST_GeoHash() to derive coarse geohash cells from
-- lat/lon at write time (felt_reports, notification_subscriptions). No
-- geometry columns or GiST indexes are introduced in v0 — bbox queries on
-- `events` use plain lat/lon comparisons, which is enough for the region
-- bbox size in event-pipeline-design.md §4. Revisit if/when Map View
-- (spec-v1 §4.4) needs true spatial indexing.
create extension if not exists postgis;

-- Shared BEFORE UPDATE trigger, reused by events, event_source_records, and
-- notification_subscriptions (see later migrations).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared BEFORE UPDATE trigger: stamps updated_at = now() on every row update.';
