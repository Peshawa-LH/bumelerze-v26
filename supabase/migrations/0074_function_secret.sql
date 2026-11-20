-- 0074: the edge functions require a shared secret held in Vault
-- (security audit CI-01, DB-16, LIVE-02, LIVE-03).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- Why. The four edge functions (aggregate-felt-cells, ingest-events,
-- purge-home-photos, send-alerts) are called only by seven pg_cron jobs,
-- with the publishable key, which every app bundle carries. So anyone could
-- call them: send-alerts and purge-home-photos accept calls without a JWT,
-- and the publishable key passes the JWT gate of the other two. None of
-- them takes targeting input, but a stranger could run feed fetches, sweeps
-- and alert runs as often as they liked and read the answers.
--
-- How.
-- 1. A random secret, edge_function_secret, is made inside the database
--    (32 random bytes, hex) and kept in Vault, once: a second run keeps the
--    value. Nobody ever needs to see or copy it.
-- 2. public.edge_function_secret() returns it, for the service role only:
--    each function reads it once per instance through its own service-role
--    client and compares it with the request header
--    x-bumelerze-function-secret (supabase/functions/_shared/
--    function-secret.ts). A missing or wrong header gets 401 before the body
--    is read; when the secret cannot be read the function answers 503 and
--    does nothing (fail closed).
-- 3. public.call_edge_function(name, body, timeout_ms) posts to one of the
--    four functions with the same headers as before plus the secret, read
--    from Vault at call time. It is not callable by the app (only the
--    database owner, so pg_cron, and the service role).
-- 4. The seven jobs are rescheduled by name with the same schedules,
--    bodies and timeouts (and the send_alerts guard alert_work_pending()),
--    now through call_edge_function. The command text holds no secret, so
--    cron.job and cron.job_run_details never show it. The last block checks
--    that each name is exactly one job calling call_edge_function, and
--    otherwise fails the whole paste (nothing is changed).
--
-- Order. Apply this first: the jobs then send the header, which the
-- deployed functions ignore until they are redeployed from the commit that
-- checks it. Redeploying a function before this migration would make it
-- refuse the old jobs (401).
--
-- Calling a function by hand from now on (SQL editor):
--   select public.call_edge_function('send-alerts', '{"health":true}'::jsonb);
--   select status_code, content from net._http_response where id = <the id>;
--
-- Rotating the secret: replace its value in Vault (same name). The jobs use
-- the new value at once; a running function instance reloads it when a call
-- does not match its copy (at most once a minute).

-- 1. The secret ------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets ds where ds.name = 'edge_function_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'edge_function_secret',
      'Shared secret the pg_cron jobs send to the edge functions (migration 0074). Generated in the database.');
  end if;
end
$$;

-- 2. Read by the edge functions (service role only) -------------------------------------------------
create or replace function public.edge_function_secret()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ds.decrypted_secret
    from vault.decrypted_secrets ds
   where ds.name = 'edge_function_secret'
   limit 1
$$;
revoke all on function public.edge_function_secret() from public, anon, authenticated;
grant execute on function public.edge_function_secret() to service_role;

-- 3. The one way to call a function ----------------------------------------------------------------
create or replace function public.call_edge_function(
  p_name text,
  p_body jsonb default '{}'::jsonb,
  p_timeout_ms integer default 30000
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_body jsonb := coalesce(p_body, '{}'::jsonb);
begin
  if p_name is null
     or p_name not in ('aggregate-felt-cells', 'ingest-events', 'purge-home-photos', 'send-alerts') then
    raise exception 'call_edge_function: unknown function' using errcode = '22023';
  end if;
  if jsonb_typeof(v_body) <> 'object' then
    raise exception 'call_edge_function: the body must be a JSON object' using errcode = '22023';
  end if;
  if p_timeout_ms is null or p_timeout_ms < 1000 or p_timeout_ms > 300000 then
    raise exception 'call_edge_function: timeout must be 1000 to 300000 ms' using errcode = '22023';
  end if;
  v_secret := public.edge_function_secret();
  if v_secret is null or v_secret = '' then
    raise exception 'call_edge_function: no edge_function_secret in Vault' using errcode = 'P0001';
  end if;
  return net.http_post(
    url := 'https://bcgyxepgruwardhozvfq.supabase.co/functions/v1/' || p_name,
    body := v_body,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I',
      'Authorization', 'Bearer sb_publishable_j1XFI8mQbqOOyIsNftgM9g_3BtcPJ9I',
      'x-bumelerze-function-secret', v_secret),
    timeout_milliseconds := p_timeout_ms
  );
end
$$;
revoke all on function public.call_edge_function(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.call_edge_function(text, jsonb, integer) to service_role;

-- 4. The seven jobs, same names, schedules, bodies and timeouts (0017, 0024, 0061, 0062) -----------
-- cron.schedule with an existing name replaces that job's schedule and
-- command and keeps its id.
select cron.schedule('aggregate_felt_cells', '*/5 * * * *', $cron$select public.call_edge_function('aggregate-felt-cells', '{}'::jsonb, 30000);$cron$);
select cron.schedule('ingest_events_emsc', '*/1 * * * *', $cron$select public.call_edge_function('ingest-events', '{"channel":"emsc"}'::jsonb, 15000);$cron$);
select cron.schedule('ingest_events_usgs', '*/1 * * * *', $cron$select public.call_edge_function('ingest-events', '{"channel":"usgs"}'::jsonb, 15000);$cron$);
select cron.schedule('ingest_events_geofon', '*/5 * * * *', $cron$select public.call_edge_function('ingest-events', '{"channel":"geofon"}'::jsonb, 20000);$cron$);
select cron.schedule('ingest_events_isc', '17 3 * * *', $cron$select public.call_edge_function('ingest-events', '{"channel":"isc"}'::jsonb, 45000);$cron$);
select cron.schedule('purge_home_photos', '15 4 * * *', $cron$select public.call_edge_function('purge-home-photos', '{}'::jsonb, 30000);$cron$);
select cron.schedule('send_alerts', '* * * * *', $cron$select public.call_edge_function('send-alerts', '{}'::jsonb, 60000) where public.alert_work_pending();$cron$);

-- 5. Check: each name is exactly one job and it calls call_edge_function --------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(n.name, ', ' order by n.name)
    into v_bad
    from unnest(array[
      'aggregate_felt_cells', 'ingest_events_emsc', 'ingest_events_usgs', 'ingest_events_geofon',
      'ingest_events_isc', 'purge_home_photos', 'send_alerts']) as n(name)
   where (select count(*) from cron.job j where j.jobname = n.name) <> 1
      or exists (
        select 1 from cron.job j
         where j.jobname = n.name
           and position('public.call_edge_function(' in j.command) = 0);
  if v_bad is not null then
    raise exception '0074: these jobs are missing, doubled or not rescheduled: %', v_bad;
  end if;
end
$$;
