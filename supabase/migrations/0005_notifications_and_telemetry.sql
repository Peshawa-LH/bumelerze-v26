-- Bumelerze schema v0 — notification subscriptions + anonymous telemetry
-- Implements spec-v1 §5.4 (alert fanout) and §5.5 (app-launch telemetry).

-- ---------------------------------------------------------------------------
-- notification_subscriptions: one row per installed app, two independent
-- alert contexts (near-me, HomeBase) per D11/spec §5.4.
--
-- Row-scoped read/update ("users read/update only their own subscriptions")
-- needs *some* server-verifiable identity, which a bare client-supplied
-- device_id cannot provide under RLS. This table therefore keys on Supabase
-- Anonymous Auth (`supabase.auth.signInAnonymously()`) rather than the
-- app-generated device_id used elsewhere in this schema — it is still
-- "no signup" (D8/PROJECT.md requirement), just a different anonymous-
-- identity mechanism, chosen here because this is the one felt-report-
-- adjacent table where RLS ownership is a real security property, not a
-- convenience. See supabase/README.md for the full rationale.
-- ---------------------------------------------------------------------------
create table public.notification_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,

  expo_push_token text not null unique, -- idempotent upsert key for the fanout function

  near_me_tier text not null default 'off' check (near_me_tier in ('off', 'all', 'm3', 'm4', 'm5')),
  near_me_lat double precision check (near_me_lat between -90 and 90),
  near_me_lon double precision check (near_me_lon between -180 and 180),
  near_me_geohash text generated always as (
    case when near_me_lat is not null and near_me_lon is not null
      then st_geohash(st_setsrid(st_makepoint(near_me_lon, near_me_lat), 4326), 5)
      else null
    end
  ) stored, -- cheap prefix-filterable candidate set for the fanout function; exact radius math still belongs to that function, not this schema

  homebase_tier text not null default 'off' check (homebase_tier in ('off', 'all', 'm3', 'm4', 'm5')),
  homebase_lat double precision check (homebase_lat between -90 and 90),
  homebase_lon double precision check (homebase_lon between -180 and 180),
  homebase_geohash text generated always as (
    case when homebase_lat is not null and homebase_lon is not null
      then st_geohash(st_setsrid(st_makepoint(homebase_lon, homebase_lat), 4326), 5)
      else null
    end
  ) stored,

  language text not null default 'en' check (language in ('ckb', 'kmr', 'ar', 'en')), -- D12 locales; fanout localizes the push body per this field

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notification_subscriptions is
  'Push registration + two independent alert contexts (near-me, HomeBase) per device (spec-v1 §5.4). Keyed on Supabase Anonymous Auth, not the felt-report device_id — see table comment in migration.';

create trigger notification_subscriptions_set_updated_at
  before update on public.notification_subscriptions
  for each row execute function public.set_updated_at();

create index idx_notif_subs_near_me_geohash on public.notification_subscriptions (near_me_geohash text_pattern_ops);
create index idx_notif_subs_homebase_geohash on public.notification_subscriptions (homebase_geohash text_pattern_ops);
create index idx_notif_subs_near_me_tier on public.notification_subscriptions (near_me_tier) where near_me_tier <> 'off';
create index idx_notif_subs_homebase_tier on public.notification_subscriptions (homebase_tier) where homebase_tier <> 'off';

-- ---------------------------------------------------------------------------
-- telemetry_pings: anonymous app-launch pings (D11/D13 §5.5). Deliberately
-- has NO device linkage of any kind and NO public select — "anonymous means
-- anonymous".
-- ---------------------------------------------------------------------------
create table public.telemetry_pings (
  ping_id uuid primary key default gen_random_uuid(),
  geohash text not null check (char_length(geohash) between 1 and 4), -- coarse: precision 4 max, a privacy floor, not a display precision
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now()
);

comment on table public.telemetry_pings is
  'Anonymous, coarse-location app-launch pings (D11/D13 §5.5). No device_id column anywhere on this table — disclosed in Settings per the trust principle; consumed by no detection logic in v1.';

create index idx_telemetry_pings_created_at on public.telemetry_pings (created_at);
create index idx_telemetry_pings_geohash on public.telemetry_pings (geohash);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.notification_subscriptions enable row level security;
alter table public.telemetry_pings enable row level security;

-- notification_subscriptions: full CRUD scoped to auth.uid(), which requires
-- the client to hold a Supabase Anonymous Auth session (see table comment).
create policy notification_subscriptions_insert_own
  on public.notification_subscriptions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy notification_subscriptions_select_own
  on public.notification_subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

create policy notification_subscriptions_update_own
  on public.notification_subscriptions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No delete policy in v0: turning both tiers to 'off' is the supported way
-- to stop notifications; add a delete policy if/when account deletion needs it.

-- telemetry_pings: insert-only, no select policy for anon/authenticated at
-- all (explicit requirement). The service_role key (dashboard, future
-- aggregate jobs) bypasses RLS to read it.
create policy telemetry_pings_insert
  on public.telemetry_pings for insert
  to anon, authenticated
  with check (true);
