-- 0017_aggregation_cron.sql
--
-- Persists the aggregate-felt-cells scheduling that was first created live
-- on 2026-08-16 (pg_net http invocation of the edge function every 5 min,
-- empty body = sweep mode: recompute cells for every event with reports
-- newer than its last aggregation; the function's own >=60s debounce and
-- skip-if-unchanged guard make frequent invocation cheap). Recorded as a
-- migration so a fresh environment reproduces the full self-running felt
-- pipeline: assign (2 min, 0013) -> detect (2 min, 0013) -> aggregate
-- (5 min, here) -> expire (hourly, 0013).
--
-- The embedded key is the PUBLISHABLE anon key (same one shipped in every
-- client bundle — see netlify.toml's comment); the function is JWT-gated
-- and does its privileged work via its own service-role env internally, so
-- this invocation intentionally carries no elevated privileges.

create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('aggregate_felt_cells')
  where exists (select 1 from cron.job where jobname = 'aggregate_felt_cells');
end
$$;

select cron.schedule(
  'aggregate_felt_cells',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://bcgyxepgruwardhozvfq.supabase.co/functions/v1/aggregate-felt-cells',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I',
      'Authorization', 'Bearer sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I'
    ),
    timeout_milliseconds := 30000
  );
  $job$
);
