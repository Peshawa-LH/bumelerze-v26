-- 0071: per-caller limits on anonymous writes (26.4.4).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- Found by the ops health check of 2026-10-22: anyone holding the public
-- key could insert felt reports (the policy only needs a device id the
-- client chooses) and register events through upsert_event_from_client,
-- with no limit at all. Nothing abusive was seen; this caps an accident (a
-- client stuck in a loop) or a script, and never a real person, even after
-- a big earthquake.
--
-- 1. write_rate_counters + write_rate_take(bucket, per minute, per hour):
--    fixed one-minute and one-hour windows, counted inside the writing
--    transaction, so a refused or failed write counts nothing. Server
--    only: RLS on, no client grant, nothing callable by the app. Buckets
--    hold an md5 of the session id or device id, never the id itself, and
--    are deleted after two days (minute windows after two hours).
-- 2. The felt flow (felt_reports, felt_report_details, felt_comments,
--    felt_photos; the details insert policy is still the open one the app
--    uses, and submit_felt_report_details writes the same table): per table
--    and per caller, at most 20 rows a minute and 60 an hour. The caller is
--    the session (auth.uid(): every install signs in anonymously before it
--    writes), or, without a session, the report's device id. No global cap
--    here on purpose: in a strong earthquake real reports come in thousands,
--    and many phones in Kurdistan share one carrier address, so neither a
--    total nor a per-address limit would be safe. One device needs one
--    report per earthquake (a second one only after withdrawing the first).
-- 3. Event registration by the app (upsert_event_from_client, through the
--    insert of its source record, so a lookup of a known event is never
--    counted): at most 20 a minute and 120 an hour per session, and 30 a
--    minute and 300 an hour for all app callers together (in the 30 days to
--    2026-10-22 the app registered 4 events; the server registers its own
--    feeds and is never limited). Callers without a session count only
--    toward the total.
-- 4. A refusal is error P0001 (HTTP 400) with the message
--    '<table>: rate_limited' or 'upsert_event_from_client: rate_limited'
--    and a hint naming the limit. The app 26.4.3 needs no change: its felt
--    queue retries any error except a duplicate with a growing pause (at
--    most 10 minutes), so a refused report is sent once the window has
--    passed, never lost and never retried forever; a refused registration
--    leaves the report unassigned (the D26 pool) or the event page asks
--    again later, as for any failed lookup.
-- 5. pg_cron purge_write_rate_counters, hourly.
--
-- Only app callers are limited (request_is_client(), 0033: the anon and
-- authenticated roles). The service role (ingest-events, the Atlas worker,
-- the SQL editor) and pg_cron are never counted.

-- 1. Counters -----------------------------------------------------------------------------------
create table if not exists public.write_rate_counters (
  bucket text not null check (char_length(bucket) between 1 and 120),
  window_kind text not null check (window_kind in ('minute', 'hour')),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_kind, window_start)
);
create index if not exists write_rate_counters_window_idx
  on public.write_rate_counters (window_start);
alter table public.write_rate_counters enable row level security;
revoke all on public.write_rate_counters from public, anon, authenticated;

-- Counts one write in both windows and says whether it is within both
-- limits. Called inside the writing transaction: when the write is refused
-- or fails, the count goes back with it.
create or replace function public.write_rate_take(p_bucket text, p_per_minute integer, p_per_hour integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_minute integer;
  v_hour integer;
begin
  insert into public.write_rate_counters as c (bucket, window_kind, window_start, hits)
  values (p_bucket, 'minute', date_trunc('minute', now()), 1)
  on conflict (bucket, window_kind, window_start) do update set hits = c.hits + 1
  returning c.hits into v_minute;
  insert into public.write_rate_counters as c (bucket, window_kind, window_start, hits)
  values (p_bucket, 'hour', date_trunc('hour', now()), 1)
  on conflict (bucket, window_kind, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hour;
  return v_minute <= p_per_minute and v_hour <= p_per_hour;
end
$$;
revoke all on function public.write_rate_take(text, integer, integer) from public, anon, authenticated;

-- 2. The felt flow --------------------------------------------------------------------------------
-- One trigger function for the four tables. The row is read as jsonb, so
-- the same code serves tables with and without a device_id column; details
-- and photos take the device of their report.
create or replace function public.felt_writes_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_row jsonb;
  v_device text;
  v_report text;
  v_caller text;
begin
  if not public.request_is_client() then
    return new;
  end if;
  v_uid := auth.uid();
  if v_uid is not null then
    v_caller := 'u:' || md5(v_uid::text);
  else
    v_row := to_jsonb(new);
    v_device := v_row ->> 'device_id';
    if v_device is null then
      v_report := coalesce(v_row ->> 'felt_report_id', v_row ->> 'report_id');
      if v_report is not null then
        select r.device_id into v_device
          from public.felt_reports r
         where r.report_id = v_report::uuid;
      end if;
    end if;
    v_caller := case when v_device is null then 'nosession' else 'd:' || md5(v_device) end;
  end if;
  if not public.write_rate_take(tg_table_name || ':' || v_caller, 20, 60) then
    raise exception '%: rate_limited', tg_table_name using errcode = 'P0001',
      hint = 'At most 20 a minute and 60 an hour from one device.';
  end if;
  return new;
end
$$;
revoke all on function public.felt_writes_rate_limit() from public, anon, authenticated;

drop trigger if exists felt_reports_rate_limit on public.felt_reports;
create trigger felt_reports_rate_limit
  before insert on public.felt_reports
  for each row execute function public.felt_writes_rate_limit();
drop trigger if exists felt_report_details_rate_limit on public.felt_report_details;
create trigger felt_report_details_rate_limit
  before insert on public.felt_report_details
  for each row execute function public.felt_writes_rate_limit();
drop trigger if exists felt_comments_rate_limit on public.felt_comments;
create trigger felt_comments_rate_limit
  before insert on public.felt_comments
  for each row execute function public.felt_writes_rate_limit();
drop trigger if exists felt_photos_rate_limit on public.felt_photos;
create trigger felt_photos_rate_limit
  before insert on public.felt_photos
  for each row execute function public.felt_writes_rate_limit();

-- 3. Event registration by the app ------------------------------------------------------------------
-- upsert_event_from_client writes a source record only for an event the
-- registry does not know yet (a new event, or a new provider record joined
-- to one); a known record returns before any insert. The per-session check
-- runs first, then the total.
create or replace function public.event_registration_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
begin
  if not public.request_is_client() then
    return new;
  end if;
  v_uid := auth.uid();
  if v_uid is not null
     and not public.write_rate_take('event_registration:u:' || md5(v_uid::text), 20, 120) then
    raise exception 'upsert_event_from_client: rate_limited' using errcode = 'P0001',
      hint = 'At most 20 new events a minute and 120 an hour from one device.';
  end if;
  if not public.write_rate_take('event_registration:all', 30, 300) then
    raise exception 'upsert_event_from_client: rate_limited' using errcode = 'P0001',
      hint = 'The app may register at most 30 new events a minute and 300 an hour in total.';
  end if;
  return new;
end
$$;
revoke all on function public.event_registration_rate_limit() from public, anon, authenticated;

drop trigger if exists source_records_client_rate_limit on public.event_source_records;
create trigger source_records_client_rate_limit
  before insert on public.event_source_records
  for each row execute function public.event_registration_rate_limit();

-- 4. Purge, hourly ---------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where cron.job.jobname = 'purge_write_rate_counters') then
    perform cron.unschedule('purge_write_rate_counters');
  end if;
  perform cron.schedule('purge_write_rate_counters', '7 * * * *', $cron$delete from public.write_rate_counters where window_start < now() - interval '2 days' or (window_kind = 'minute' and window_start < now() - interval '2 hours');$cron$);
exception when others then
  raise notice 'pg_cron scheduling skipped (%): schedule purge_write_rate_counters (7 * * * *, delete from public.write_rate_counters where window_start < now() - interval 2 days or (window_kind = minute and window_start < now() - interval 2 hours)) by hand.', sqlerrm;
end
$$;
