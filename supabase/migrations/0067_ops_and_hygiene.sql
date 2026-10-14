-- 0067: operations and hygiene (review batch 2026-10-14, findings D-2, D-7,
-- D-10, D-12, D-13 and the People filter rank).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, idempotent (safe to run twice).
--
-- 1. Feed watchdog (D-2). pg_cron reported 100 percent success while
--    ingest-events answered 502 for hours, because cron only sees that the
--    HTTP call was queued. The function now writes a heartbeat per channel
--    (feed_heartbeats, service role only) after every run; every 15 minutes
--    ops_check_feeds() opens an alert in ops_alerts when usgs or emsc has had
--    no successful run for 60 minutes and closes it when the feed is back.
--    One open alert per feed at most (partial unique index). Admins with
--    stats.read read them through admin_ops_alerts().
-- 2. cron.job_run_details purge (D-7): 254,885 rows and growing 4,300 a day;
--    a daily job keeps 7 days, the pattern Supabase documents.
-- 3. RPC error codes (D-10): alerts_send_test raised no_device with P0002
--    (HTTP 500) and too_soon with 54000 (HTTP 413); restore_felt_report
--    raised not_found with P0002. All three are 400-class now. The client
--    reads the message token, not the status, for these. withdraw_felt_report
--    keeps P0002 on purpose: the app checks that very code to say
--    "nothing to withdraw" (src/features/felt/supabase-transport.ts); it
--    changes together with the app in a later migration.
-- 4. Grants hygiene (D-12): anon and authenticated lose the write privileges
--    no policy ever allowed on the legacy tables (including TRUNCATE,
--    REFERENCES and TRIGGER, which RLS does not cover). Kept: the inserts
--    the felt flow makes through its policies, the UPDATE the two client
--    upserts need (felt_photos, profiles). Future tables no longer receive
--    write privileges by default.
-- 5. Tier-2 answers through an owner-checked RPC (D-13):
--    submit_felt_report_details(). The open insert policy stays for the
--    current app; a later migration drops it once the client calls the RPC.
-- 6. The People filter accepts the Government official rank (0066) in
--    admin_people_search (0055 body otherwise unchanged).

-- 1. Feed heartbeats -----------------------------------------------------------------------------
-- One row per ingest channel, written by supabase/functions/ingest-events
-- (service role) after every run: last_ok_at on success, last_error_at and
-- last_error on a failed channel. Seeded at now() so the watchdog starts
-- counting from the moment this is applied; the function must be deployed
-- within the hour or the first alert is a true one.
create table if not exists public.feed_heartbeats (
  provider text primary key check (provider in ('usgs', 'emsc', 'geofon', 'isc')),
  last_ok_at timestamptz,
  last_summary jsonb not null default '{}'::jsonb,
  last_error_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.feed_heartbeats enable row level security;
revoke all on public.feed_heartbeats from public, anon, authenticated;
grant select, insert, update on public.feed_heartbeats to service_role;
insert into public.feed_heartbeats (provider, last_ok_at)
values ('usgs', now()), ('emsc', now()), ('geofon', now()), ('isc', now())
on conflict do nothing;

-- 2. Operations alerts ---------------------------------------------------------------------------
-- Opened and closed by the server only; no client has any grant. One open
-- alert per (kind, provider): the partial unique index makes a duplicate
-- impossible even if two checks ever overlapped.
create table if not exists public.ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z][a-z0-9_]*$'),
  message text not null check (char_length(message) between 1 and 500),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  details jsonb not null default '{}'::jsonb
);
create unique index if not exists ops_alerts_open_uq
  on public.ops_alerts (kind, (details ->> 'provider')) where closed_at is null;
create index if not exists ops_alerts_opened_at_idx on public.ops_alerts (opened_at desc);
alter table public.ops_alerts enable row level security;
revoke all on public.ops_alerts from public, anon, authenticated;

-- 3. The watchdog --------------------------------------------------------------------------------
-- usgs and emsc are polled every minute, so an hour without a successful
-- run is a real outage (the function's own retry is one attempt; the cron
-- tick is the backoff). Returns what it saw, for a manual run in the editor.
create or replace function public.ops_check_feeds()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider text;
  v_last timestamptz;
  v_error text;
  v_error_at timestamptz;
  v_stale boolean;
  v_open uuid;
  v_opened integer := 0;
  v_closed integer := 0;
  v_feeds jsonb := '{}'::jsonb;
  v_threshold interval := interval '60 minutes';
begin
  foreach v_provider in array array['usgs', 'emsc'] loop
    select h.last_ok_at, h.last_error, h.last_error_at
      into v_last, v_error, v_error_at
      from public.feed_heartbeats h
     where h.provider = v_provider;
    v_stale := v_last is null or v_last < now() - v_threshold;
    select a.alert_id into v_open
      from public.ops_alerts a
     where a.kind = 'feed_stale'
       and a.details ->> 'provider' = v_provider
       and a.closed_at is null;
    if v_stale and v_open is null then
      insert into public.ops_alerts (kind, message, details)
      values (
        'feed_stale',
        'No successful ' || v_provider || ' fetch since '
          || coalesce(to_char(v_last at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', 'the heartbeat row was created')
          || coalesce('. Last error: ' || left(v_error, 200), ''),
        jsonb_build_object(
          'provider', v_provider,
          'last_ok_at', v_last,
          'last_error_at', v_error_at,
          'last_error', v_error,
          'threshold_minutes', 60)
      );
      v_opened := v_opened + 1;
    elsif not v_stale and v_open is not null then
      update public.ops_alerts
         set closed_at = now(),
             details = details || jsonb_build_object('recovered_last_ok_at', v_last)
       where alert_id = v_open;
      v_closed := v_closed + 1;
    end if;
    v_feeds := v_feeds || jsonb_build_object(v_provider, jsonb_build_object(
      'last_ok_at', v_last, 'stale', v_stale, 'alert_open', (v_stale and (v_open is not null or v_opened > 0))));
  end loop;
  return jsonb_build_object('checked_at', now(), 'opened', v_opened, 'closed', v_closed, 'feeds', v_feeds);
end
$$;
revoke all on function public.ops_check_feeds() from public, anon, authenticated;

-- 4. Admin view of the alerts --------------------------------------------------------------------
-- Open alerts first, the last 20 closed ones, and every feed's heartbeat.
-- Reading infrastructure state is for the ranks that read statistics
-- (official and admin, 0066), not every moderator.
create or replace function public.admin_ops_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_permission(v_uid, 'stats.read') then
    raise exception 'admin_ops_alerts: not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
               'alert_id', a.alert_id, 'kind', a.kind, 'message', a.message,
               'opened_at', a.opened_at, 'details', a.details)
             order by a.opened_at desc)
        from public.ops_alerts a
       where a.closed_at is null), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'alert_id', r.alert_id, 'kind', r.kind, 'message', r.message,
               'opened_at', r.opened_at, 'closed_at', r.closed_at, 'details', r.details)
             order by r.closed_at desc)
        from (
          select a.* from public.ops_alerts a
           where a.closed_at is not null
           order by a.closed_at desc
           limit 20
        ) r), '[]'::jsonb),
    'feeds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider', h.provider, 'last_ok_at', h.last_ok_at,
               'last_error_at', h.last_error_at, 'last_error', h.last_error,
               'last_summary', h.last_summary)
             order by h.provider)
        from public.feed_heartbeats h), '[]'::jsonb),
    'checked_at', now()
  );
end
$$;
revoke all on function public.admin_ops_alerts() from public, anon;
grant execute on function public.admin_ops_alerts() to authenticated;

-- 5. Cron: the watchdog every 15 minutes, the history purge daily (D-7) -------------------------
-- The purge is the statement Supabase documents for pg_cron history.
do $$
begin
  if exists (select 1 from cron.job where cron.job.jobname = 'ops_check_feeds') then
    perform cron.unschedule('ops_check_feeds');
  end if;
  perform cron.schedule('ops_check_feeds', '*/15 * * * *', $cron$select public.ops_check_feeds();$cron$);
  if exists (select 1 from cron.job where cron.job.jobname = 'purge_cron_history') then
    perform cron.unschedule('purge_cron_history');
  end if;
  perform cron.schedule('purge_cron_history', '50 4 * * *', $cron$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days';$cron$);
exception when others then
  raise notice 'pg_cron scheduling skipped (%): schedule ops_check_feeds (*/15 * * * *, select public.ops_check_feeds();) and purge_cron_history (50 4 * * *, delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval 7 days) by hand.', sqlerrm;
end
$$;
