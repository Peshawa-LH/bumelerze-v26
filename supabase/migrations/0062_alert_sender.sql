-- 0062: the earthquake alert sender, behind a rollout switch (D83).
--
-- Owner, 2026-10-09: build the mechanism with web push now, keep saying
-- "alerts are coming soon" in public, roll out later. So delivery is gated by
-- one setting, alert_settings.mode:
--   off      nothing is sent (an emergency stop; test alerts still work)
--   testers  only testers are sent alerts (the DEFAULT this migration sets)
--   public   everyone with alerts turned on
-- Testers = accounts holding the new permission alerts.test (official and the
-- private admin rank) plus the allowlist alert_testers. Changing the mode or
-- the allowlist needs alerts.manage (official and admin), audited.
--
--   1. notification_subscriptions (0005) keeps the alert PREFERENCES, one row
--      per account: near-me tier and point, the "another place" tier and point
--      (the homebase_* columns, D73), language. Its expo_push_token becomes
--      optional: devices now live in push_subscriptions. Every stored point is
--      snapped to a 0.05 degree grid (about 5 km, the geohash-5 privacy floor
--      of D18) by a trigger, whatever writes it. The app sends a main-town
--      centre (the "My location" place) or a chosen place, never a GPS fix.
--   2. push_subscriptions: one row per browser (web push: endpoint + keys) or
--      per phone (Expo token, for the native build). Owner-only, through RPCs;
--      endpoints must belong to a known push service (no arbitrary URLs).
--   3. alert_queue: a trigger on events queues every published regional event
--      of the last 6 hours when it is inserted or its magnitude, place, depth
--      or status changes. Test alerts are queued here too (caller only).
--   4. alert_plan_run() (service role, called by the send-alerts edge
--      function every minute through pg_cron) turns the queue into
--      alert_deliveries and hands back a batch to send:
--      - only CONFIRMED events: published, not merged, not deleted, magnitude
--        known, with a verified (server-ingested) source record; "possible"
--        crowd events never alert. An event still unverified waits up to 60
--        minutes.
--      - rollout gate first, then each context (near me, another place): the
--        tier's magnitude (all 0, M3, M4, M5) and "close enough": within
--        100 km (the D16/D74 radius) OR predicted to be felt, Allen, Wald and
--        Worden (2012) MMI >= 2.0 at hypocentral distance, depth default
--        10 km (the D74 rule, ipe_aww2012_mmi of 0034).
--      - one alert per event per device; a revision re-alerts only when the
--        magnitude crosses a tier threshold (3, 4, 5) above what the device
--        was told; events merged into this one count as the same event; an
--        event within 16 s and 100 km of one already alerted is a duplicate.
--      - D16 aftershock guard: after a regional M>=5.0 within 100 km and the
--        72 h before, an event alerts only if it reaches the mainshock
--        magnitude, or both mainshock - 0.5 and the tier + 1.0. Hard cap 3
--        alerts per device per hour, except a new mainshock (M>=5.0 and the
--        strongest around in 72 h), which always goes. Held-back events are
--        "suppressed" and become one quiet summary per 12 h.
--      - first alerts only within 60 minutes of origin, upgrades within 6 h;
--        anything not sent within 30 minutes is dropped as stale.
--   5. alert_record_results() (service role) stores what the push services
--      answered: sent, gone (404/410: the device is disabled), retry (later,
--      at most 3 attempts) or failed.
--   6. App RPCs: alerts_my_access(), alerts_register_web_push(),
--      alerts_register_expo_push(), alerts_unregister_push(),
--      alerts_my_devices(), alerts_save_preferences(), alerts_send_test().
--      Admin: admin_alerts_overview() (alerts.test), admin_alerts_set_mode(),
--      admin_alert_tester_add(), admin_alert_tester_remove() (alerts.manage).
--   7. pg_cron: send_alerts every minute (posts to the edge function only
--      when there is work), alert_purge nightly (90-day retention).
--
-- Account deletion: push_subscriptions, alert_testers and test queue rows go
-- with the account (foreign keys, cascade); deliveries go with the device.
-- No exact location is stored anywhere.
--
-- Needs 0002, 0005, 0012, 0033, 0034, 0043, 0052 and 0060.
-- Idempotent: safe to run twice. Written for the SQL editor as one line: no
-- transaction statements, only full-line comments, ASCII only.

-- 1. Preferences: token optional, points coarse ------------------------------------------------
alter table public.notification_subscriptions alter column expo_push_token drop not null;

create or replace function public.alert_coarse(p_value double precision)
returns double precision
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case when p_value is null then null else (round((p_value * 20)::numeric) / 20)::double precision end
$$;

-- Rounding inline (not alert_coarse): the trigger runs as whoever writes,
-- and owners may still write their own row directly (0005 policies).
create or replace function public.notification_subscriptions_coarse()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.near_me_lat := (round((new.near_me_lat * 20)::numeric) / 20)::double precision;
  new.near_me_lon := (round((new.near_me_lon * 20)::numeric) / 20)::double precision;
  new.homebase_lat := (round((new.homebase_lat * 20)::numeric) / 20)::double precision;
  new.homebase_lon := (round((new.homebase_lon * 20)::numeric) / 20)::double precision;
  return new;
end
$$;
drop trigger if exists notification_subscriptions_coarse on public.notification_subscriptions;
create trigger notification_subscriptions_coarse
  before insert or update on public.notification_subscriptions
  for each row execute function public.notification_subscriptions_coarse();

update public.notification_subscriptions
   set near_me_lat = near_me_lat
 where near_me_lat is distinct from public.alert_coarse(near_me_lat)
    or near_me_lon is distinct from public.alert_coarse(near_me_lon)
    or homebase_lat is distinct from public.alert_coarse(homebase_lat)
    or homebase_lon is distinct from public.alert_coarse(homebase_lon);

-- 2. Tables -------------------------------------------------------------------------------------
create table if not exists public.alert_settings (
  key text primary key check (key = 'rollout'),
  mode text not null default 'testers' check (mode in ('off', 'testers', 'public')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.alert_settings (key, mode) values ('rollout', 'testers') on conflict (key) do nothing;

create table if not exists public.alert_testers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  push_subscription_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('web', 'expo')),
  endpoint text unique check (endpoint is null or char_length(endpoint) <= 1024),
  p256dh text check (p256dh is null or char_length(p256dh) <= 200),
  auth text check (auth is null or char_length(auth) <= 100),
  expo_token text unique check (expo_token is null or char_length(expo_token) <= 200),
  locale text not null default 'en' check (locale in ('ckb', 'kmr', 'ar', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  fail_count integer not null default 0,
  disabled_at timestamptz,
  disabled_reason text check (disabled_reason is null or disabled_reason in ('gone', 'failing')),
  constraint push_subscriptions_shape check (
    (kind = 'web' and endpoint is not null and p256dh is not null and auth is not null and expo_token is null)
    or (kind = 'expo' and expo_token is not null and endpoint is null and p256dh is null and auth is null)
  )
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table if not exists public.alert_queue (
  queue_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('event', 'test')),
  event_id uuid references public.events (event_id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  queued_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text check (outcome is null or outcome in ('planned', 'off', 'not_eligible', 'stale', 'unconfirmed', 'tested')),
  constraint alert_queue_shape check (
    (kind = 'event' and event_id is not null and user_id is null)
    or (kind = 'test' and user_id is not null and event_id is null)
  )
);
create unique index if not exists alert_queue_waiting_event_idx
  on public.alert_queue (event_id) where processed_at is null and kind = 'event';
create index if not exists alert_queue_waiting_idx on public.alert_queue (queued_at) where processed_at is null;
create index if not exists alert_queue_test_user_idx on public.alert_queue (user_id, queued_at) where kind = 'test';

create table if not exists public.alert_runs (
  run_id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode text not null,
  events integer not null default 0,
  planned integer not null default 0,
  suppressed integer not null default 0,
  claimed integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  gone integer not null default 0,
  retried integer not null default 0
);
create index if not exists alert_runs_started_idx on public.alert_runs (started_at desc);

create table if not exists public.alert_deliveries (
  delivery_id uuid primary key default gen_random_uuid(),
  push_subscription_id uuid not null references public.push_subscriptions (push_subscription_id) on delete cascade,
  kind text not null check (kind in ('alert', 'upgrade', 'summary', 'test')),
  event_id uuid references public.events (event_id) on delete cascade,
  mag_band smallint,
  magnitude numeric,
  previous_magnitude numeric,
  summary_count integer,
  context text check (context is null or context in ('near_me', 'another_place')),
  status text not null check (status in ('pending', 'sending', 'sent', 'retry', 'failed', 'gone', 'suppressed', 'skipped')),
  suppressed_reason text check (suppressed_reason is null or suppressed_reason in ('aftershock', 'rate_cap')),
  summarized_by uuid references public.alert_deliveries (delivery_id) on delete set null,
  run_id uuid references public.alert_runs (run_id) on delete set null,
  attempts integer not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now()
);
create unique index if not exists alert_deliveries_once_idx
  on public.alert_deliveries (push_subscription_id, event_id, mag_band)
  where kind in ('alert', 'upgrade');
create index if not exists alert_deliveries_sub_created_idx on public.alert_deliveries (push_subscription_id, created_at desc);
create index if not exists alert_deliveries_event_idx on public.alert_deliveries (event_id);
create index if not exists alert_deliveries_open_idx on public.alert_deliveries (created_at)
  where status in ('pending', 'sending', 'retry');
create index if not exists alert_deliveries_suppressed_idx on public.alert_deliveries (push_subscription_id, created_at)
  where status = 'suppressed' and summarized_by is null;

alter table public.alert_settings enable row level security;
alter table public.alert_testers enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.alert_queue enable row level security;
alter table public.alert_runs enable row level security;
alter table public.alert_deliveries enable row level security;
revoke all on public.alert_settings from public, anon, authenticated;
revoke all on public.alert_testers from public, anon, authenticated;
revoke all on public.push_subscriptions from public, anon, authenticated;
revoke all on public.alert_queue from public, anon, authenticated;
revoke all on public.alert_runs from public, anon, authenticated;
revoke all on public.alert_deliveries from public, anon, authenticated;
-- No policies on purpose: the app reaches these tables only through the
-- security definer functions below; the edge function uses the service role.

-- 3. Permissions --------------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('official', 'alerts.test'),
  ('official', 'alerts.manage')
on conflict do nothing;
-- The private admin rank (0060) gets both, if the rank exists.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.role_permissions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%''admin''%'
  ) then
    insert into public.role_permissions (role, permission) values
      ('admin', 'alerts.test'),
      ('admin', 'alerts.manage')
    on conflict do nothing;
  end if;
end
$$;

-- Log actions: what is there now, plus the three new ones (union, as 0059/0060).
do $$
declare
  c record;
  v_found text[];
  v_list text;
  v_actions text[] := array[
    'comment_approve', 'comment_hide', 'comment_remove', 'comment_restore',
    'role_grant', 'role_revoke', 'role_restore',
    'profile_reports_resolve', 'report_reopen',
    'post_remove', 'post_restore', 'post_reports_dismiss',
    'password_reset', 'profile_reset', 'profile_restore',
    'restrict', 'suspend', 'lift',
    'person_view', 'email_reveal', 'purge',
    'feedback_status', 'report_photo_approve', 'report_photo_reject',
    'alerts_mode', 'alert_tester_add', 'alert_tester_remove'
  ];
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%comment_approve%'
  loop
    select coalesce(array_agg(r.m[1]), '{}'::text[]) into v_found
      from regexp_matches(c.def, '''([a-z_]+)''', 'g') as r(m);
    v_found := v_found || coalesce((
      select array_agg(x)
        from regexp_matches(c.def, '''[{]([a-z_,]+)[}]''', 'g') as r(m),
             unnest(string_to_array(r.m[1], ',')) as x), '{}'::text[]);
    v_actions := v_actions || v_found;
    execute format('alter table public.moderation_log drop constraint %I', c.conname);
  end loop;
  select string_agg(quote_literal(a), ', ' order by a) into v_list
    from (select distinct a from unnest(v_actions) as a where a <> 'text') d;
  execute format(
    'alter table public.moderation_log add constraint moderation_log_action_check check (action in (%s))',
    v_list);
end
$$;

-- 4. Rules and small helpers --------------------------------------------------------------------
-- Every tunable in one place; admin_alerts_overview() shows them.
create or replace function public.alert_rules()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'near_km', 100,
    'felt_mmi', 2.0,
    'default_depth_km', 10,
    'alert_max_age_minutes', 60,
    'upgrade_max_age_minutes', 360,
    'unconfirmed_wait_minutes', 60,
    'stale_delivery_minutes', 30,
    'rate_cap_per_hour', 3,
    'mainshock_min_magnitude', 5.0,
    'sequence_km', 100,
    'sequence_hours', 72,
    'mainshock_margin', 0.5,
    'tier_margin', 1.0,
    'summary_every_hours', 12,
    'duplicate_seconds', 16,
    'duplicate_km', 100,
    'max_attempts', 3,
    'tier_thresholds', jsonb_build_array(3, 4, 5)
  )
$$;

create or replace function public.alert_tier_min(p_tier text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_tier when 'all' then 0 when 'm3' then 3 when 'm4' then 4 when 'm5' then 5 else null end::numeric
$$;

-- How many tier thresholds (3, 4, 5) a magnitude reaches: 0 to 3.
create or replace function public.alert_band(p_magnitude numeric)
returns smallint
language sql
immutable
set search_path = public, pg_temp
as $$
  select ((p_magnitude >= 3)::int + (p_magnitude >= 4)::int + (p_magnitude >= 5)::int)::smallint
$$;

-- Great-circle distance in km (plain SQL, no PostGIS needed).
create or replace function public.alert_distance_km(
  p_lat1 double precision, p_lon1 double precision, p_lat2 double precision, p_lon2 double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select 2 * 6371.0088 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lon2 - p_lon1) / 2), 2)
  )))
$$;

-- The magnitude floor of one context (near me or another place) if the event
-- qualifies for it there, else null.
create or replace function public.alert_context_min(
  p_tier text, p_lat double precision, p_lon double precision,
  p_ev_lat double precision, p_ev_lon double precision, p_depth_km numeric, p_magnitude numeric
)
returns numeric
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_min numeric := public.alert_tier_min(p_tier);
  v_km double precision;
begin
  if v_min is null or p_lat is null or p_lon is null or p_magnitude is null or p_magnitude < v_min then
    return null;
  end if;
  v_km := public.alert_distance_km(p_lat, p_lon, p_ev_lat, p_ev_lon);
  if v_km <= 100 then
    return v_min;
  end if;
  if public.ipe_aww2012_mmi(
       p_magnitude::double precision,
       sqrt(power(v_km, 2) + power(coalesce(p_depth_km, 10)::double precision, 2))
     ) >= 2.0 then
    return v_min;
  end if;
  return null;
end
$$;

create or replace function public.alert_mode()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.mode from public.alert_settings s where s.key = 'rollout'), 'off')
$$;

create or replace function public.alert_is_tester(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and (exists (select 1 from public.alert_testers t where t.user_id = p_user)
          or public.has_permission(p_user, 'alerts.test'))
$$;

-- The rollout gate: may this person be sent earthquake alerts now?
create or replace function public.alert_user_eligible(p_user uuid, p_mode text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_mode
           when 'public' then p_user is not null
           when 'testers' then public.alert_is_tester(p_user)
           else false
         end
$$;

-- A confirmed registry event: published, not merged or deleted, magnitude
-- known, and seen by our own ingester (a verified source record).
create or replace function public.alert_event_confirmed(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.events e
     where e.event_id = p_event
       and e.status = 'published'
       and e.merged_into is null
       and e.review_status <> 'deleted'
       and e.magnitude is not null
       and exists (
         select 1 from public.event_source_records esr
          where esr.event_id = e.event_id
            and esr.review_status <> 'deleted'
            and esr.verified_at is not null
       )
  )
$$;

-- 5. Queue trigger on the registry --------------------------------------------------------------
create or replace function public.events_alert_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'published'
     and new.merged_into is null
     and new.review_status <> 'deleted'
     and new.magnitude is not null
     and new.region_flag
     and new.origin_time > now() - interval '6 hours'
     and (
       tg_op = 'INSERT'
       or new.magnitude is distinct from old.magnitude
       or new.lat is distinct from old.lat
       or new.lon is distinct from old.lon
       or new.depth_km is distinct from old.depth_km
       or new.status is distinct from old.status
       or new.review_status is distinct from old.review_status
       or new.region_flag is distinct from old.region_flag
     ) then
    begin
      insert into public.alert_queue (kind, event_id) values ('event', new.event_id)
      on conflict do nothing;
    exception when others then
      raise warning 'events_alert_enqueue: % (event %)', sqlerrm, new.event_id;
    end;
  end if;
  return null;
end
$$;
drop trigger if exists events_alert_enqueue on public.events;
create trigger events_alert_enqueue
  after insert or update on public.events
  for each row execute function public.events_alert_enqueue();

-- 6. Planning ----------------------------------------------------------------------------------
create or replace function public.alert_plan_event(p_event uuid, p_mode text, p_run uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ev record;
  s record;
  v_band smallint;
  v_age interval;
  v_main numeric;
  v_new_main boolean;
  v_prev smallint;
  v_prev_mag numeric;
  v_kind text;
  v_supp text;
  v_recent integer;
  v_floor numeric;
  v_n integer := 0;
begin
  select e.event_id, e.origin_time, e.lat, e.lon, e.depth_km, e.magnitude
    into ev
    from public.events e
   where e.event_id = p_event;
  if not found then
    return 0;
  end if;
  v_band := public.alert_band(ev.magnitude);
  v_age := now() - ev.origin_time;
  if v_age > interval '6 hours' then
    return 0;
  end if;

  select max(m.magnitude) into v_main
    from public.events m
   where m.event_id <> ev.event_id
     and m.status = 'published'
     and m.merged_into is null
     and m.review_status <> 'deleted'
     and m.region_flag
     and m.magnitude >= 5.0
     and m.origin_time < ev.origin_time
     and m.origin_time >= ev.origin_time - interval '72 hours'
     and public.alert_distance_km(m.lat, m.lon, ev.lat, ev.lon) <= 100;
  v_new_main := ev.magnitude >= 5.0 and (v_main is null or ev.magnitude >= v_main);

  for s in
    select q.push_subscription_id, q.near_min, q.other_min
      from (
        select ps.push_subscription_id,
               public.alert_context_min(ns.near_me_tier, ns.near_me_lat, ns.near_me_lon,
                                        ev.lat, ev.lon, ev.depth_km, ev.magnitude) as near_min,
               public.alert_context_min(ns.homebase_tier, ns.homebase_lat, ns.homebase_lon,
                                        ev.lat, ev.lon, ev.depth_km, ev.magnitude) as other_min
          from public.push_subscriptions ps
          join public.notification_subscriptions ns on ns.user_id = ps.user_id
         where ps.disabled_at is null
           and public.alert_user_eligible(ps.user_id, p_mode)
      ) q
     where q.near_min is not null or q.other_min is not null
     order by q.push_subscription_id
  loop
    select d.mag_band, d.magnitude into v_prev, v_prev_mag
      from public.alert_deliveries d
     where d.push_subscription_id = s.push_subscription_id
       and d.kind in ('alert', 'upgrade')
       and d.status not in ('suppressed', 'skipped')
       and (d.event_id = ev.event_id
            or d.event_id in (select x.event_id from public.events x where x.merged_into = ev.event_id))
     order by d.mag_band desc, d.created_at desc
     limit 1;
    if not found then
      v_prev := null;
      v_prev_mag := null;
    end if;
    if v_prev is not null and v_band <= v_prev then
      continue;
    end if;
    v_kind := case when v_prev is null then 'alert' else 'upgrade' end;
    if v_kind = 'alert' and v_age > interval '60 minutes' then
      continue;
    end if;

    if exists (
      select 1
        from public.alert_deliveries d
        join public.events e2 on e2.event_id = d.event_id
       where d.push_subscription_id = s.push_subscription_id
         and d.kind in ('alert', 'upgrade')
         and d.status not in ('suppressed', 'skipped')
         and e2.event_id <> ev.event_id
         and e2.merged_into is distinct from ev.event_id
         and abs(extract(epoch from (e2.origin_time - ev.origin_time))) <= 16
         and public.alert_distance_km(e2.lat, e2.lon, ev.lat, ev.lon) <= 100
    ) then
      continue;
    end if;

    v_supp := null;
    v_floor := least(coalesce(s.near_min, 99), coalesce(s.other_min, 99));
    if v_main is not null
       and ev.magnitude < v_main
       and ev.magnitude < greatest(v_main - 0.5, v_floor + 1.0) then
      v_supp := 'aftershock';
    elsif not v_new_main then
      select count(*) into v_recent
        from public.alert_deliveries d
       where d.push_subscription_id = s.push_subscription_id
         and d.kind in ('alert', 'upgrade', 'summary')
         and d.status in ('pending', 'sending', 'sent', 'retry')
         and d.created_at > now() - interval '1 hour';
      if v_recent >= 3 then
        v_supp := 'rate_cap';
      end if;
    end if;

    insert into public.alert_deliveries (
      push_subscription_id, kind, event_id, mag_band, magnitude, previous_magnitude,
      context, status, suppressed_reason, run_id
    )
    values (
      s.push_subscription_id, v_kind, ev.event_id, v_band, ev.magnitude, v_prev_mag,
      case when s.near_min is not null then 'near_me' else 'another_place' end,
      case when v_supp is null then 'pending' else 'suppressed' end,
      v_supp, p_run
    )
    on conflict do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;

-- One quiet summary per device once its oldest held-back event is 12 h old.
create or replace function public.alert_plan_summaries(p_mode text, p_run uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s record;
  v_id uuid;
  v_event uuid;
  v_n integer := 0;
begin
  for s in
    select d.push_subscription_id, count(*)::int as n, max(d.magnitude) as max_mag
      from public.alert_deliveries d
      join public.push_subscriptions ps on ps.push_subscription_id = d.push_subscription_id
     where d.status = 'suppressed'
       and d.summarized_by is null
       and d.created_at > now() - interval '72 hours'
       and ps.disabled_at is null
       and public.alert_user_eligible(ps.user_id, p_mode)
     group by d.push_subscription_id
    having min(d.created_at) <= now() - interval '12 hours'
  loop
    select d.event_id into v_event
      from public.alert_deliveries d
     where d.push_subscription_id = s.push_subscription_id
       and d.status = 'suppressed'
       and d.summarized_by is null
       and d.created_at > now() - interval '72 hours'
     order by d.magnitude desc nulls last, d.created_at
     limit 1;
    insert into public.alert_deliveries (
      push_subscription_id, kind, event_id, magnitude, summary_count, status, run_id
    )
    values (s.push_subscription_id, 'summary', v_event, s.max_mag, s.n, 'pending', p_run)
    returning delivery_id into v_id;
    update public.alert_deliveries d
       set summarized_by = v_id
     where d.push_subscription_id = s.push_subscription_id
       and d.status = 'suppressed'
       and d.summarized_by is null
       and d.created_at > now() - interval '72 hours';
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- Is there anything for the edge function to do? (pg_cron asks first.)
create or replace function public.alert_work_pending()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.alert_queue q where q.processed_at is null)
      or exists (
           select 1 from public.alert_deliveries d
            where d.status = 'pending'
               or (d.status = 'retry' and d.next_attempt_at <= now())
               or (d.status = 'sending' and d.claimed_at < now() - interval '5 minutes')
         )
      or exists (
           select 1 from public.alert_deliveries d
            where d.status = 'suppressed'
              and d.summarized_by is null
              and d.created_at > now() - interval '72 hours'
              and d.created_at <= now() - interval '12 hours'
         )
$$;

-- The edge function's one entry point: plan what is queued, then claim a
-- batch to send. Serialised by an advisory lock, so two overlapping calls
-- never plan or claim the same thing twice.
create or replace function public.alert_plan_run(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := public.alert_mode();
  v_run uuid := gen_random_uuid();
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  q record;
  v_events integer := 0;
  v_planned integer := 0;
  v_supp integer := 0;
  v_claimed integer := 0;
  v_n integer;
  v_items jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('bumelerze_alert_plan_run'));
  insert into public.alert_runs (run_id, mode) values (v_run, v_mode);

  for q in
    select aq.queue_id, aq.event_id, aq.queued_at
      from public.alert_queue aq
     where aq.processed_at is null and aq.kind = 'event'
     order by aq.queued_at
     limit 100
  loop
    if v_mode = 'off' then
      update public.alert_queue set processed_at = now(), outcome = 'off' where queue_id = q.queue_id;
      v_events := v_events + 1;
      continue;
    end if;
    if not exists (
      select 1 from public.events e
       where e.event_id = q.event_id
         and e.status = 'published' and e.merged_into is null
         and e.review_status <> 'deleted' and e.magnitude is not null and e.region_flag
    ) then
      update public.alert_queue set processed_at = now(), outcome = 'not_eligible' where queue_id = q.queue_id;
      v_events := v_events + 1;
      continue;
    end if;
    if exists (select 1 from public.events e where e.event_id = q.event_id and e.origin_time < now() - interval '6 hours') then
      update public.alert_queue set processed_at = now(), outcome = 'stale' where queue_id = q.queue_id;
      v_events := v_events + 1;
      continue;
    end if;
    if not public.alert_event_confirmed(q.event_id) then
      if q.queued_at < now() - interval '60 minutes' then
        update public.alert_queue set processed_at = now(), outcome = 'unconfirmed' where queue_id = q.queue_id;
        v_events := v_events + 1;
      end if;
      continue;
    end if;
    v_n := public.alert_plan_event(q.event_id, v_mode, v_run);
    v_planned := v_planned + v_n;
    update public.alert_queue set processed_at = now(), outcome = 'planned' where queue_id = q.queue_id;
    v_events := v_events + 1;
  end loop;

  for q in
    select aq.queue_id, aq.user_id
      from public.alert_queue aq
     where aq.processed_at is null and aq.kind = 'test'
     order by aq.queued_at
     limit 100
  loop
    insert into public.alert_deliveries (push_subscription_id, kind, status, run_id)
    select ps.push_subscription_id, 'test', 'pending', v_run
      from public.push_subscriptions ps
     where ps.user_id = q.user_id and ps.disabled_at is null;
    get diagnostics v_n = row_count;
    v_planned := v_planned + v_n;
    update public.alert_queue set processed_at = now(), outcome = 'tested' where queue_id = q.queue_id;
  end loop;

  if v_mode <> 'off' then
    v_planned := v_planned + public.alert_plan_summaries(v_mode, v_run);
  end if;

  select count(*) into v_supp from public.alert_deliveries d where d.run_id = v_run and d.status = 'suppressed';

  update public.alert_deliveries d
     set status = 'skipped'
   where d.status in ('pending', 'retry')
     and d.kind <> 'test'
     and exists (
       select 1 from public.push_subscriptions ps
        where ps.push_subscription_id = d.push_subscription_id
          and not public.alert_user_eligible(ps.user_id, v_mode)
     );
  update public.alert_deliveries d
     set status = 'skipped'
   where d.status in ('pending', 'retry', 'sending')
     and d.created_at < now() - interval '30 minutes';
  update public.alert_deliveries d
     set status = 'failed', last_error = coalesce(d.last_error, 'no answer from the sender')
   where d.status = 'sending'
     and d.claimed_at < now() - interval '5 minutes'
     and d.attempts >= 3;

  with c as (
    select d.delivery_id
      from public.alert_deliveries d
      join public.push_subscriptions ps on ps.push_subscription_id = d.push_subscription_id
     where ps.disabled_at is null
       and (d.status = 'pending'
            or (d.status = 'retry' and d.next_attempt_at <= now())
            or (d.status = 'sending' and d.claimed_at < now() - interval '5 minutes'))
     order by d.created_at
     limit v_limit
     for update of d skip locked
  )
  update public.alert_deliveries d
     set status = 'sending', claimed_at = now(), attempts = d.attempts + 1, run_id = v_run
    from c
   where d.delivery_id = c.delivery_id;
  get diagnostics v_claimed = row_count;

  if v_events = 0 and v_planned = 0 and v_claimed = 0 then
    delete from public.alert_runs where run_id = v_run;
    return jsonb_build_object('run_id', null, 'mode', v_mode, 'deliveries', '[]'::jsonb);
  end if;

  update public.alert_runs
     set events = v_events, planned = v_planned, suppressed = v_supp, claimed = v_claimed
   where run_id = v_run;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.delivery_id,
           'kind', d.kind,
           'locale', coalesce(ps.locale, ns.language, 'en'),
           'context', d.context,
           'target', case ps.kind
             when 'web' then jsonb_build_object('kind', 'web', 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)
             else jsonb_build_object('kind', 'expo', 'token', ps.expo_token)
           end,
           'event', case when e.event_id is null then null else jsonb_build_object(
             'id', e.bumelerze_id,
             'magnitude', d.magnitude,
             'origin_time', e.origin_time,
             'lat', e.lat,
             'lon', e.lon,
             'depth_km', e.depth_km
           ) end,
           'previous_magnitude', d.previous_magnitude,
           'summary_count', d.summary_count,
           'attempt', d.attempts
         ) order by d.created_at), '[]'::jsonb)
    into v_items
    from public.alert_deliveries d
    join public.push_subscriptions ps on ps.push_subscription_id = d.push_subscription_id
    left join public.notification_subscriptions ns on ns.user_id = ps.user_id
    left join public.events e on e.event_id = d.event_id
   where d.run_id = v_run and d.status = 'sending';

  return jsonb_build_object('run_id', v_run, 'mode', v_mode, 'deliveries', v_items);
end
$$;

-- What the push services answered. Only rows this run claimed and still
-- 'sending' change, so replaying the same results does nothing new.
create or replace function public.alert_record_results(p_run_id uuid, p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_status text;
  v_sub uuid;
  v_sent integer := 0;
  v_failed integer := 0;
  v_gone integer := 0;
  v_retried integer := 0;
begin
  if p_run_id is null or jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'alert_record_results: invalid' using errcode = '22023';
  end if;
  for r in
    select x.delivery_id, x.outcome, x.error
      from jsonb_to_recordset(p_results) as x(delivery_id uuid, outcome text, error text)
  loop
    if r.delivery_id is null or r.outcome is null or r.outcome not in ('sent', 'gone', 'retry', 'failed') then
      continue;
    end if;
    update public.alert_deliveries d
       set status = case
             when r.outcome = 'retry' and d.attempts >= 3 then 'failed'
             else r.outcome
           end,
           sent_at = case when r.outcome = 'sent' then now() else d.sent_at end,
           next_attempt_at = case when r.outcome = 'retry' then now() + d.attempts * interval '2 minutes' else null end,
           last_error = case when r.outcome = 'sent' then null else left(r.error, 300) end
     where d.delivery_id = r.delivery_id
       and d.run_id = p_run_id
       and d.status = 'sending'
    returning d.status, d.push_subscription_id into v_status, v_sub;
    if not found then
      continue;
    end if;
    if v_status = 'sent' then
      v_sent := v_sent + 1;
      update public.push_subscriptions
         set last_ok_at = now(), fail_count = 0
       where push_subscription_id = v_sub;
    elsif v_status = 'gone' then
      v_gone := v_gone + 1;
      update public.push_subscriptions
         set disabled_at = coalesce(disabled_at, now()), disabled_reason = 'gone',
             last_error_at = now(), last_error = left(r.error, 300)
       where push_subscription_id = v_sub;
    elsif v_status = 'retry' then
      v_retried := v_retried + 1;
      update public.push_subscriptions
         set last_error_at = now(), last_error = left(r.error, 300)
       where push_subscription_id = v_sub;
    else
      v_failed := v_failed + 1;
      update public.push_subscriptions
         set last_error_at = now(), last_error = left(r.error, 300), fail_count = fail_count + 1,
             disabled_at = case when fail_count + 1 >= 5 then coalesce(disabled_at, now()) else disabled_at end,
             disabled_reason = case when fail_count + 1 >= 5 then coalesce(disabled_reason, 'failing') else disabled_reason end
       where push_subscription_id = v_sub;
    end if;
  end loop;
  update public.alert_runs
     set sent = sent + v_sent, failed = failed + v_failed, gone = gone + v_gone,
         retried = retried + v_retried, finished_at = now()
   where run_id = p_run_id;
  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'gone', v_gone, 'retried', v_retried);
end
$$;

create or replace function public.alert_purge_old()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.alert_deliveries where created_at < now() - interval '90 days';
  delete from public.alert_runs where started_at < now() - interval '90 days';
  delete from public.alert_queue where processed_at < now() - interval '14 days';
$$;

-- 7. App RPCs ----------------------------------------------------------------------------------
-- What this account may see: the real alert settings (enabled) or the
-- "coming soon" screen. Never says who the other testers are.
create or replace function public.alerts_my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := public.alert_mode();
  v_tester boolean := public.alert_is_tester(v_uid);
begin
  return jsonb_build_object(
    'mode', v_mode,
    'tester', v_tester,
    'enabled', v_uid is not null and (v_tester or v_mode = 'public'),
    'can_manage', public.has_permission(v_uid, 'alerts.manage')
  );
end
$$;

create or replace function public.alerts_require_enabled(p_fn text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception '%: not_signed_in', p_fn using errcode = '42501';
  end if;
  if not (public.alert_is_tester(v_uid) or public.alert_mode() = 'public') then
    raise exception '%: not_enabled', p_fn using errcode = '42501';
  end if;
  return v_uid;
end
$$;

create or replace function public.alerts_check_locale(p_locale text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_locale in ('ckb', 'kmr', 'ar', 'en') then p_locale else 'en' end
$$;

-- Web push: endpoint of a known push service (no spaces, quotes or angle
-- brackets), base64url keys of the right size.
create or replace function public.alerts_register_web_push(
  p_endpoint text, p_p256dh text, p_auth text, p_locale text default 'en'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.alerts_require_enabled('alerts_register_web_push');
  v_id uuid;
begin
  if p_endpoint is null
     or char_length(p_endpoint) > 1024
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com)/'
     or p_endpoint ~ '[^[:graph:]]|["''<>\\]' then
    raise exception 'alerts_register_web_push: endpoint_invalid' using errcode = '22023';
  end if;
  if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{86,88}={0,2}$' then
    raise exception 'alerts_register_web_push: key_invalid' using errcode = '22023';
  end if;
  if p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{21,24}={0,2}$' then
    raise exception 'alerts_register_web_push: key_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.push_subscriptions ps
       where ps.user_id = v_uid and ps.disabled_at is null and ps.endpoint is distinct from p_endpoint) >= 10 then
    raise exception 'alerts_register_web_push: too_many_devices' using errcode = '54000';
  end if;
  insert into public.push_subscriptions (user_id, kind, endpoint, p256dh, auth, locale)
  values (v_uid, 'web', p_endpoint, p_p256dh, p_auth, public.alerts_check_locale(p_locale))
  on conflict (endpoint) do update
     set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         locale = excluded.locale, updated_at = now(), disabled_at = null, disabled_reason = null,
         fail_count = 0, last_error = null, last_error_at = null
  returning push_subscription_id into v_id;
  return v_id;
end
$$;

create or replace function public.alerts_register_expo_push(p_token text, p_locale text default 'en')
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.alerts_require_enabled('alerts_register_expo_push');
  v_id uuid;
begin
  if p_token is null or p_token !~ '^Expo(nent){0,1}PushToken\[[A-Za-z0-9_-]{10,100}\]$' then
    raise exception 'alerts_register_expo_push: token_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.push_subscriptions ps
       where ps.user_id = v_uid and ps.disabled_at is null and ps.expo_token is distinct from p_token) >= 10 then
    raise exception 'alerts_register_expo_push: too_many_devices' using errcode = '54000';
  end if;
  insert into public.push_subscriptions (user_id, kind, expo_token, locale)
  values (v_uid, 'expo', p_token, public.alerts_check_locale(p_locale))
  on conflict (expo_token) do update
     set user_id = excluded.user_id, locale = excluded.locale, updated_at = now(),
         disabled_at = null, disabled_reason = null, fail_count = 0, last_error = null, last_error_at = null
  returning push_subscription_id into v_id;
  return v_id;
end
$$;

-- Removes this device (own rows only). Allowed in every mode, so turning
-- alerts off always works.
create or replace function public.alerts_unregister_push(p_endpoint text default null, p_expo_token text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if v_uid is null then
    raise exception 'alerts_unregister_push: not_signed_in' using errcode = '42501';
  end if;
  delete from public.push_subscriptions ps
   where ps.user_id = v_uid
     and ((p_endpoint is not null and ps.endpoint = p_endpoint)
          or (p_expo_token is not null and ps.expo_token = p_expo_token));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

create or replace function public.alerts_my_devices()
returns table (
  push_subscription_id uuid,
  kind text,
  endpoint text,
  locale text,
  created_at timestamptz,
  last_ok_at timestamptz,
  disabled boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ps.push_subscription_id, ps.kind, ps.endpoint, ps.locale, ps.created_at, ps.last_ok_at,
         ps.disabled_at is not null
    from public.push_subscriptions ps
   where ps.user_id = auth.uid()
   order by ps.created_at desc
$$;

-- Tiers and the two points. The points are snapped to about 5 km by the
-- table trigger; the app sends a town centre or a chosen place anyway.
create or replace function public.alerts_save_preferences(
  p_near_me_tier text,
  p_near_me_lat double precision,
  p_near_me_lon double precision,
  p_another_tier text,
  p_another_lat double precision,
  p_another_lon double precision,
  p_language text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.alerts_require_enabled('alerts_save_preferences');
begin
  if coalesce(p_near_me_tier, '') not in ('off', 'all', 'm3', 'm4', 'm5')
     or coalesce(p_another_tier, '') not in ('off', 'all', 'm3', 'm4', 'm5') then
    raise exception 'alerts_save_preferences: tier_invalid' using errcode = '22023';
  end if;
  if (p_near_me_lat is null) <> (p_near_me_lon is null)
     or (p_another_lat is null) <> (p_another_lon is null)
     or p_near_me_lat not between -90 and 90 or p_near_me_lon not between -180 and 180
     or p_another_lat not between -90 and 90 or p_another_lon not between -180 and 180 then
    raise exception 'alerts_save_preferences: place_invalid' using errcode = '22023';
  end if;
  insert into public.notification_subscriptions (
    user_id, near_me_tier, near_me_lat, near_me_lon, homebase_tier, homebase_lat, homebase_lon, language
  )
  values (
    v_uid, p_near_me_tier, p_near_me_lat, p_near_me_lon,
    case when p_another_lat is null then 'off' else p_another_tier end,
    p_another_lat, p_another_lon, public.alerts_check_locale(p_language)
  )
  on conflict (user_id) do update
     set near_me_tier = excluded.near_me_tier,
         near_me_lat = excluded.near_me_lat,
         near_me_lon = excluded.near_me_lon,
         homebase_tier = excluded.homebase_tier,
         homebase_lat = excluded.homebase_lat,
         homebase_lon = excluded.homebase_lon,
         language = excluded.language;
end
$$;

-- "Send me a test alert": through the real pipeline, to the caller's own
-- devices only. Once a minute, 20 a day.
create or replace function public.alerts_send_test()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := public.alerts_require_enabled('alerts_send_test');
  v_devices integer;
begin
  select count(*) into v_devices from public.push_subscriptions ps
   where ps.user_id = v_uid and ps.disabled_at is null;
  if v_devices = 0 then
    raise exception 'alerts_send_test: no_device' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.alert_queue q
              where q.kind = 'test' and q.user_id = v_uid and q.queued_at > now() - interval '60 seconds') then
    raise exception 'alerts_send_test: too_soon' using errcode = '54000';
  end if;
  if (select count(*) from public.alert_queue q
       where q.kind = 'test' and q.user_id = v_uid and q.queued_at > now() - interval '24 hours') >= 20 then
    raise exception 'alerts_send_test: too_soon' using errcode = '54000';
  end if;
  insert into public.alert_queue (kind, user_id) values ('test', v_uid);
  return v_devices;
end
$$;

-- 8. Admin -------------------------------------------------------------------------------------
create or replace function public.admin_alerts_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.has_permission(v_uid, 'alerts.test') then
    raise exception 'admin_alerts_overview: not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'mode', public.alert_mode(),
    'can_manage', public.has_permission(v_uid, 'alerts.manage'),
    'rules', public.alert_rules(),
    'testers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', x.user_id,
               'username', p.username,
               'display_name', p.display_name,
               'via', x.via,
               'added_at', x.added_at,
               'devices', (select count(*) from public.push_subscriptions ps
                            where ps.user_id = x.user_id and ps.disabled_at is null)
             ) order by x.via desc, coalesce(p.username, p.display_name, x.user_id::text))
        from (
          select t.user_id, 'allowlist'::text as via, t.added_at from public.alert_testers t
          union
          select r.user_id, 'rank', null::timestamptz
            from public.user_roles r
            join public.role_permissions rp on rp.role = r.role and rp.permission = 'alerts.test'
           where not exists (select 1 from public.alert_testers t where t.user_id = r.user_id)
          union
          select k.user_id, 'rank', null::timestamptz
            from public.private_ranks k
            join public.role_permissions rp on rp.role = k.role and rp.permission = 'alerts.test'
           where not exists (select 1 from public.alert_testers t where t.user_id = k.user_id)
        ) x
        left join public.profiles p on p.user_id = x.user_id
    ), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.started_at desc)
        from (
          select ar.run_id, ar.started_at, ar.finished_at, ar.mode, ar.events, ar.planned,
                 ar.suppressed, ar.claimed, ar.sent, ar.failed, ar.gone, ar.retried
            from public.alert_runs ar
           order by ar.started_at desc
           limit 20
        ) r
    ), '[]'::jsonb),
    'devices', (select count(*) from public.push_subscriptions ps where ps.disabled_at is null),
    'waiting', (select count(*) from public.alert_queue q where q.processed_at is null)
  );
end
$$;

create or replace function public.admin_alerts_set_mode(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_before text := public.alert_mode();
begin
  if not public.has_permission(v_uid, 'alerts.manage') then
    raise exception 'admin_alerts_set_mode: not_allowed' using errcode = '42501';
  end if;
  if coalesce(p_mode, '') not in ('off', 'testers', 'public') then
    raise exception 'admin_alerts_set_mode: mode_invalid' using errcode = '22023';
  end if;
  insert into public.alert_settings (key, mode, updated_by, updated_at)
  values ('rollout', p_mode, v_uid, now())
  on conflict (key) do update set mode = excluded.mode, updated_by = excluded.updated_by, updated_at = now();
  if v_before is distinct from p_mode then
    perform public.write_audit(
      v_uid, 'alerts_mode', 'system', 'alerts',
      null, null, null, p_mode, null,
      jsonb_build_object('before', v_before, 'after', p_mode)
    );
  end if;
  return public.admin_alerts_overview();
end
$$;

create or replace function public.admin_alert_tester_add(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
begin
  if not public.has_permission(v_uid, 'alerts.manage') then
    raise exception 'admin_alert_tester_add: not_allowed' using errcode = '42501';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where p.username = lower(regexp_replace(trim(coalesce(p_username, '')), '^@', ''));
  if v_target is null then
    raise exception 'admin_alert_tester_add: not_found' using errcode = 'P0002';
  end if;
  insert into public.alert_testers (user_id, added_by) values (v_target, v_uid)
  on conflict (user_id) do nothing;
  if found then
    perform public.write_audit(v_uid, 'alert_tester_add', 'account', v_target::text, v_target);
  end if;
  return public.admin_alerts_overview();
end
$$;

create or replace function public.admin_alert_tester_remove(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.has_permission(v_uid, 'alerts.manage') then
    raise exception 'admin_alert_tester_remove: not_allowed' using errcode = '42501';
  end if;
  delete from public.alert_testers where user_id = p_user;
  if found then
    perform public.write_audit(v_uid, 'alert_tester_remove', 'account', p_user::text, p_user);
  end if;
  return public.admin_alerts_overview();
end
$$;

-- 9. Schedules ---------------------------------------------------------------------------------
-- Every minute, but the edge function is called only when there is work.
-- Until it is deployed the call fails quietly and the queue waits.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send_alerts') then
    perform cron.unschedule('send_alerts');
  end if;
  perform cron.schedule('send_alerts', '* * * * *', $cron$SELECT net.http_post(url := 'https://bcgyxepgruwardhozvfq.supabase.co/functions/v1/send-alerts', body := '{}'::jsonb, params := '{}'::jsonb, headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I', 'Authorization', 'Bearer sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I'), timeout_milliseconds := 60000) WHERE public.alert_work_pending();$cron$);
  if exists (select 1 from cron.job where jobname = 'alert_purge') then
    perform cron.unschedule('alert_purge');
  end if;
  perform cron.schedule('alert_purge', '40 4 * * *', $cron$SELECT public.alert_purge_old();$cron$);
exception
  when others then
    raise notice 'pg_cron scheduling skipped (%): schedule send_alerts and alert_purge by hand', sqlerrm;
end
$$;

-- 10. Who may call what -------------------------------------------------------------------------
revoke all on function public.alert_coarse(double precision) from public, anon, authenticated;
revoke all on function public.notification_subscriptions_coarse() from public, anon, authenticated;
revoke all on function public.alert_rules() from public, anon, authenticated;
revoke all on function public.alert_tier_min(text) from public, anon, authenticated;
revoke all on function public.alert_band(numeric) from public, anon, authenticated;
revoke all on function public.alert_distance_km(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.alert_context_min(text, double precision, double precision, double precision, double precision, numeric, numeric) from public, anon, authenticated;
revoke all on function public.alert_mode() from public, anon, authenticated;
revoke all on function public.alert_is_tester(uuid) from public, anon, authenticated;
revoke all on function public.alert_user_eligible(uuid, text) from public, anon, authenticated;
revoke all on function public.alert_event_confirmed(uuid) from public, anon, authenticated;
revoke all on function public.events_alert_enqueue() from public, anon, authenticated;
revoke all on function public.alert_plan_event(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.alert_plan_summaries(text, uuid) from public, anon, authenticated;
revoke all on function public.alert_work_pending() from public, anon, authenticated;
revoke all on function public.alert_plan_run(integer) from public, anon, authenticated;
revoke all on function public.alert_record_results(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.alert_purge_old() from public, anon, authenticated;
revoke all on function public.alerts_require_enabled(text) from public, anon, authenticated;
revoke all on function public.alerts_check_locale(text) from public, anon, authenticated;
revoke all on function public.alerts_my_access() from public, anon;
revoke all on function public.alerts_register_web_push(text, text, text, text) from public, anon;
revoke all on function public.alerts_register_expo_push(text, text) from public, anon;
revoke all on function public.alerts_unregister_push(text, text) from public, anon;
revoke all on function public.alerts_my_devices() from public, anon;
revoke all on function public.alerts_save_preferences(text, double precision, double precision, text, double precision, double precision, text) from public, anon;
revoke all on function public.alerts_send_test() from public, anon;
revoke all on function public.admin_alerts_overview() from public, anon;
revoke all on function public.admin_alerts_set_mode(text) from public, anon;
revoke all on function public.admin_alert_tester_add(text) from public, anon;
revoke all on function public.admin_alert_tester_remove(uuid) from public, anon;
grant execute on function public.alerts_my_access() to authenticated;
grant execute on function public.alerts_register_web_push(text, text, text, text) to authenticated;
grant execute on function public.alerts_register_expo_push(text, text) to authenticated;
grant execute on function public.alerts_unregister_push(text, text) to authenticated;
grant execute on function public.alerts_my_devices() to authenticated;
grant execute on function public.alerts_save_preferences(text, double precision, double precision, text, double precision, double precision, text) to authenticated;
grant execute on function public.alerts_send_test() to authenticated;
grant execute on function public.admin_alerts_overview() to authenticated;
grant execute on function public.admin_alerts_set_mode(text) to authenticated;
grant execute on function public.admin_alert_tester_add(text) to authenticated;
grant execute on function public.admin_alert_tester_remove(uuid) to authenticated;
grant execute on function public.alert_plan_run(integer) to service_role;
grant execute on function public.alert_record_results(uuid, jsonb) to service_role;
grant execute on function public.alert_work_pending() to service_role;
grant execute on function public.alert_purge_old() to service_role;
