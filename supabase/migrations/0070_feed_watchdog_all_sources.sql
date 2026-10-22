-- 0070: the feed watchdog watches every source and tells someone (26.4.4).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- Found by the ops health check of 2026-10-22: ops_check_feeds() (0067)
-- watched only usgs and emsc, and nothing ever read ops_alerts. GEOFON was
-- silent for 2 h 40 min on 2026-10-21 and the ISC daily run had fetched
-- nothing since 2026-09-27; nobody knew.
--
-- 1. ops_feed_threshold(provider): how long a channel may go without a
--    successful run. usgs and emsc (polled every minute) and geofon (every
--    5 minutes): 60 minutes. isc (once a day, 03:17 UTC): 49 hours, so one
--    missed daily run raises nothing (the next run reads the same 450 days
--    again) and two in a row do.
-- 2. ops_check_feeds() (cron every 15 minutes, unchanged schedule) watches
--    all four channels of ingest-events with those thresholds. It opens one
--    alert per channel and closes it when the channel is back, as before.
-- 3. Telling someone, with no new secret: opening an alert also queues a
--    push to the admins through the earthquake alert sender (0062), which
--    already has its keys. A new delivery kind 'ops' goes to every active
--    device of an account holding stats.read (official and admin ranks), at
--    most once per device per hour, with a fixed localized text ("a data
--    source needs attention, open Admin") written by send-alerts; it opens
--    the admin home. It follows the rollout gate like an earthquake alert
--    (mode off sends nothing). DEPLOY send-alerts BEFORE applying this file:
--    an older sender does not know the kind and records the delivery as
--    failed. Closing an alert sends nothing; the admin card shows it.
-- 4. admin_source_status() (stats.read): every channel's last successful
--    fetch, last error, threshold, whether it is late now, the open alert of
--    each, and every open operations alert. The admin home shows it as the
--    "Source status" card. admin_ops_alerts() (0067) stays as it is.
--
-- Needs 0062 (alert sender) and 0067 (feed_heartbeats, ops_alerts).

-- 1. Thresholds ---------------------------------------------------------------------------------
create or replace function public.ops_feed_threshold(p_provider text)
returns interval
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_provider
           when 'isc' then interval '49 hours'
           else interval '60 minutes'
         end
$$;
revoke all on function public.ops_feed_threshold(text) from public, anon, authenticated;

-- 2. The 'ops' delivery kind ----------------------------------------------------------------------
-- The kind check of alert_deliveries (0062, an inline column check) is
-- replaced by a named one that also allows 'ops'. Found by its definition,
-- so a second run replaces the named one the same way.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.alert_deliveries'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%''summary''%'
  loop
    execute format('alter table public.alert_deliveries drop constraint %I', c.conname);
  end loop;
  alter table public.alert_deliveries
    add constraint alert_deliveries_kind_check
    check (kind in ('alert', 'upgrade', 'summary', 'test', 'ops'));
end
$$;

-- One pending 'ops' delivery per active device of every account that reads
-- statistics, unless that device was sent one in the last hour. The sender
-- (alert_plan_run, every minute while there is work) claims them like any
-- other delivery. Returns how many were queued.
create or replace function public.ops_notify_admins()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  insert into public.alert_deliveries (push_subscription_id, kind, status)
  select ps.push_subscription_id, 'ops', 'pending'
    from public.push_subscriptions ps
   where ps.disabled_at is null
     and public.has_permission(ps.user_id, 'stats.read')
     and not exists (
       select 1
         from public.alert_deliveries d
        where d.push_subscription_id = ps.push_subscription_id
          and d.kind = 'ops'
          and d.created_at > now() - interval '60 minutes'
     );
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function public.ops_notify_admins() from public, anon, authenticated;

-- 3. The watchdog: all four channels ---------------------------------------------------------------
-- Returns what it saw, for a manual run in the editor. A failure to queue
-- the push never stops the alert from being recorded.
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
  v_threshold interval;
  v_stale boolean;
  v_open uuid;
  v_alert_open boolean;
  v_opened integer := 0;
  v_closed integer := 0;
  v_pushed integer := 0;
  v_feeds jsonb := '{}'::jsonb;
begin
  foreach v_provider in array array['usgs', 'emsc', 'geofon', 'isc'] loop
    v_threshold := public.ops_feed_threshold(v_provider);
    v_last := null;
    v_error := null;
    v_error_at := null;
    select h.last_ok_at, h.last_error, h.last_error_at
      into v_last, v_error, v_error_at
      from public.feed_heartbeats h
     where h.provider = v_provider;
    v_stale := v_last is null or v_last < now() - v_threshold;
    v_open := null;
    select a.alert_id into v_open
      from public.ops_alerts a
     where a.kind = 'feed_stale'
       and a.details ->> 'provider' = v_provider
       and a.closed_at is null;
    v_alert_open := v_open is not null;
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
          'last_error', left(v_error, 200),
          'threshold_minutes', (extract(epoch from v_threshold) / 60)::integer)
      );
      v_opened := v_opened + 1;
      v_alert_open := true;
    elsif not v_stale and v_open is not null then
      update public.ops_alerts
         set closed_at = now(),
             details = details || jsonb_build_object('recovered_last_ok_at', v_last)
       where alert_id = v_open;
      v_closed := v_closed + 1;
      v_alert_open := false;
    end if;
    v_feeds := v_feeds || jsonb_build_object(v_provider, jsonb_build_object(
      'last_ok_at', v_last, 'stale', v_stale, 'alert_open', v_alert_open,
      'threshold_minutes', (extract(epoch from v_threshold) / 60)::integer));
  end loop;
  if v_opened > 0 then
    begin
      v_pushed := public.ops_notify_admins();
    exception when others then
      v_pushed := -1;
    end;
  end if;
  return jsonb_build_object(
    'checked_at', now(), 'opened', v_opened, 'closed', v_closed,
    'pushed', v_pushed, 'feeds', v_feeds);
end
$$;
revoke all on function public.ops_check_feeds() from public, anon, authenticated;

-- 4. What the admin home shows ----------------------------------------------------------------------
-- "late" is computed now, not at the last watchdog run, so the card is
-- right between two runs. Errors are cut to 200 characters (agency URLs,
-- never anything personal).
create or replace function public.admin_source_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_permission(v_uid, 'stats.read') then
    raise exception 'admin_source_status: not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'checked_at', now(),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'provider', p.provider,
               'last_ok_at', h.last_ok_at,
               'last_error_at', h.last_error_at,
               'last_error', left(h.last_error, 200),
               'threshold_minutes', (extract(epoch from public.ops_feed_threshold(p.provider)) / 60)::integer,
               'late', h.last_ok_at is null or h.last_ok_at < now() - public.ops_feed_threshold(p.provider),
               'alert_opened_at', (
                 select a.opened_at
                   from public.ops_alerts a
                  where a.kind = 'feed_stale'
                    and a.details ->> 'provider' = p.provider
                    and a.closed_at is null
                  limit 1))
             order by p.ord)
        from (values ('usgs', 1), ('emsc', 2), ('geofon', 3), ('isc', 4)) as p(provider, ord)
        left join public.feed_heartbeats h on h.provider = p.provider), '[]'::jsonb),
    'open_alerts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', a.kind,
               'provider', a.details ->> 'provider',
               'message', a.message,
               'opened_at', a.opened_at)
             order by a.opened_at desc)
        from public.ops_alerts a
       where a.closed_at is null), '[]'::jsonb)
  );
end
$$;
revoke all on function public.admin_source_status() from public, anon;
grant execute on function public.admin_source_status() to authenticated;
