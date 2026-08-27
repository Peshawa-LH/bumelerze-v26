-- 0024: pg_cron scheduling for the multi-source ingester
-- (supabase/functions/ingest-events/, source-and-ingestion-plan.md PART I
-- §5's channel register). Same `pg_net` HTTP-invocation pattern as
-- 0017_aggregation_cron.sql's `aggregate_felt_cells` job — four jobs here,
-- one per buildable channel, each POSTing `{ "channel": "<id>" }` at that
-- channel's own cadence:
--
--   emsc   */1 * * * *   (60s  — source-and-ingestion-plan.md §5 channel 1)
--   usgs   */1 * * * *   (60s  — channel 2)
--   geofon */5 * * * *   (5min — channel 3)
--   isc    17 3 * * *    (daily, off-peak UTC — channel 4, backfill/correction sweep)
--
-- pg_cron's own minimum granularity is one minute, which is exactly EMSC's
-- and USGS's stated 60s cadence — no sub-minute scheduling is needed.
--
-- The embedded key is the PUBLISHABLE anon key (same one 0017 already
-- committed, shipped in every client bundle) — `ingest-events`, like
-- `aggregate-felt-cells`, is JWT-gated at the HTTP layer and does its
-- actual privileged work via its own SUPABASE_SERVICE_ROLE_KEY env var
-- inside the function, so this invocation carries no elevated privilege
-- itself. Re-uses 0017's literal key value rather than inventing a
-- placeholder — same live project, same anon key.
--
-- NOT applied to production by this wave's author — orchestrator applies
-- per the task brief ("Do not apply migrations to production").

create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule(jobname)
  from unnest(array[
    'ingest_events_emsc', 'ingest_events_usgs', 'ingest_events_geofon', 'ingest_events_isc'
  ]) as jobname
  where exists (select 1 from cron.job where cron.job.jobname = jobname);
end
$$;

select cron.schedule(
  'ingest_events_emsc',
  '*/1 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://bcgyxepgruwardhozvfq.supabase.co/functions/v1/ingest-events',
    body := '{"channel":"emsc"}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I',
      'Authorization', 'Bearer sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I'
    ),
    timeout_milliseconds := 15000
  );
  $job$
);

select cron.schedule(
  'ingest_events_usgs',
  '*/1 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://bcgyxepgruwardhozvfq.supabase.co/functions/v1/ingest-events',
    body := '{"channel":"usgs"}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I',
      'Authorization', 'Bearer sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I'
    ),
    timeout_milliseconds := 15000
  );
  $job$
);

select cron.schedule(
  'ingest_events_geofon',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://bcgyxepgruwardhozvfq.supabase.co/functions/v1/ingest-events',
    body := '{"channel":"geofon"}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I',
      'Authorization', 'Bearer sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I'
    ),
    timeout_milliseconds := 20000
  );
  $job$
);

-- Once daily, off-peak UTC — arbitrary but fixed, deliberately not
-- overlapping the top of the hour with anything else scheduled in this
-- project. Generous timeout: ISC's ~450-day backfill window (see
-- channels.ts's ISC_LOOKBACK_DAYS comment) is the largest single fetch this
-- ingester makes.
select cron.schedule(
  'ingest_events_isc',
  '17 3 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://bcgyxepgruwardhozvfq.supabase.co/functions/v1/ingest-events',
    body := '{"channel":"isc"}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I',
      'Authorization', 'Bearer sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I'
    ),
    timeout_milliseconds := 45000
  );
  $job$
);
