-- 0072: start the SHAKEmap worker when an earthquake is registered (26.4.4).
-- Supersedes the parked 0041 (2026-10-07), brought up to date.
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- Why: the worker (bumelerze-atlas, .github/workflows/shake-worker.yml) is
-- scheduled every 5 minutes, but GitHub starts it only 5 to 7 times a day
-- (median gap 3 to 4 hours, up to about 10 hours, ops health check
-- 2026-10-22). A new earthquake waited that long for its SHAKEmap. Owner's
-- idea, 2026-10-22: start it when the registry records the earthquake.
--
-- How:
-- 1. worker_dispatch_state (one row, server only) remembers whether a start
--    is wanted, when the worker was last started and how GitHub answered.
-- 2. A trigger on events marks a start as wanted when an event is new, or
--    becomes published, or is revised by at least the worker's own
--    thresholds (bumelerze-engine feed_watcher.py: magnitude 0.1, epicentre
--    5 km, depth max(5 km, 25 percent of the depth)), if it is published,
--    not merged, not deleted, at most 14 days old, and inside the worker's
--    trigger policy (shake_worker_wanted: any epicentre in Iraq, or one
--    whose footprint reaches the Kurdistan box: 100 km below M5.0, 200 km
--    below M6.5, 300 km above; config.py IRAQ_BBOX, REGION_BBOX,
--    GRID_EXTENT_KM, MAGNITUDE_BAND_EDGES). Every writer counts (ingest,
--    the app, the Atlas worker, a manual event): a duplicate start is
--    cheap, a missed one costs hours.
-- 3. dispatch_shake_worker(), pg_cron every minute: reads GitHub's answer
--    to the previous start (204 = started), then, if a start is wanted and
--    the last one is at least 3 minutes old, asks GitHub's workflow_dispatch
--    API through pg_net to run shake-worker.yml on main, with no inputs (the
--    workflow's defaults: a normal sweep with a 3-event registry catch-up).
--    The workflow's concurrency group (shake-worker, cancel-in-progress
--    false) queues a start that arrives during a run; GitHub keeps one
--    waiting run, so nothing ever runs twice at once. A failed start is
--    retried after 3, 6, 12 minutes and so on (at most every 6 hours);
--    after two failures in a row an operations alert ('shake_dispatch')
--    opens and is pushed to the admins (0070), and closes on the next
--    success.
-- 4. Without the Vault secret github_dispatch_token it records "no token"
--    once and does nothing else: no request leaves the database. The
--    existing schedule stays as the safety net either way.
-- 5. admin_source_status() (0070) also returns the worker line: whether a
--    token is set, the last start and how GitHub answered.
--
-- The token is read from Vault inside the function and sent only in the
-- request header; it is never written to a table, a log or a return value.
--
-- OWNER STEPS (once; until then nothing is started from here):
--   a. github.com, signed in as Peshawa-LH: profile picture -> Settings ->
--      Developer settings -> Personal access tokens -> Fine-grained tokens
--      -> Generate new token.
--   b. Token name: bumelerze-shake-dispatch. Resource owner: Peshawa-LH.
--      Expiration: the longest offered (or No expiration if offered); put
--      the date in the calendar.
--   c. Repository access: Only select repositories -> bumelerze-atlas.
--   d. Permissions -> Repository permissions -> Actions: Read and write.
--      Nothing else (Metadata: Read-only is added by GitHub on its own).
--   e. Generate token and copy it (it starts with github_pat_).
--   f. Supabase dashboard, project bcgyxepgruwardhozvfq -> Integrations ->
--      Vault (older dashboards: Project Settings -> Vault) -> Secrets ->
--      Add new secret. Name: github_dispatch_token. Secret: the token.
--      Description: GitHub Actions dispatch for bumelerze-atlas. Save.
--   g. Done. The admin home (Source status) shows "SHAKEmap worker: ready"
--      at once and the last start once an earthquake arrives. When the
--      token expires the card says the start failed (GitHub 401) and the
--      admins get a push: make a new token and replace the secret's value
--      in Vault (same name).
--
-- Needs 0062 (alert_distance_km), 0067 (ops_alerts) and 0070
-- (ops_notify_admins, admin_source_status).

-- 1. State --------------------------------------------------------------------------------------
create table if not exists public.worker_dispatch_state (
  id smallint primary key default 1 check (id = 1),
  pending boolean not null default false,
  pending_since timestamptz,
  pending_reason text check (pending_reason is null or char_length(pending_reason) <= 200),
  last_dispatched_at timestamptz,
  last_request_id bigint,
  last_status integer,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  dispatch_count integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.worker_dispatch_state add column if not exists last_outcome text
  check (last_outcome is null or last_outcome in ('sent', 'ok', 'failed', 'no_token'));
alter table public.worker_dispatch_state add column if not exists last_reason text
  check (last_reason is null or char_length(last_reason) <= 200);
alter table public.worker_dispatch_state add column if not exists last_answer_at timestamptz;
alter table public.worker_dispatch_state add column if not exists failures integer not null default 0;
insert into public.worker_dispatch_state (id) values (1) on conflict (id) do nothing;
alter table public.worker_dispatch_state enable row level security;
revoke all on public.worker_dispatch_state from public, anon, authenticated;

-- 2. Which events want a map, and the trigger ------------------------------------------------------
-- The worker's trigger policy (feed_watcher.triggers_shakemap): any
-- epicentre in Iraq, or one whose magnitude-scaled footprint reaches the
-- Kurdistan box (distance to its nearest point). Keep in sync with the
-- engine's config.py.
create or replace function public.shake_worker_wanted(
  p_lat double precision, p_lon double precision, p_magnitude numeric
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_lat is not null and p_lon is not null and (
    (p_lat between 29.0 and 37.5 and p_lon between 38.8 and 48.8)
    or public.alert_distance_km(
         p_lat, p_lon,
         least(greatest(p_lat, 33.0), 38.5),
         least(greatest(p_lon, 41.0), 48.5)
       ) <= case
              when coalesce(p_magnitude, 0) >= 6.5 then 300
              when coalesce(p_magnitude, 0) >= 5.0 then 200
              else 100
            end
  )
$$;

-- Marks a start as wanted. Keeps the first reason and time while a start
-- is already wanted, so a burst of revisions writes the row once.
create or replace function public.request_shake_worker(p_reason text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.worker_dispatch_state
     set pending = true,
         pending_since = now(),
         pending_reason = left(p_reason, 200),
         updated_at = now()
   where id = 1
     and not pending;
$$;
revoke all on function public.request_shake_worker(text) from public, anon, authenticated;

create or replace function public.events_request_shake_worker()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := coalesce(new.bumelerze_id, new.event_id::text);
  v_was boolean;
begin
  if new.status is distinct from 'published'
     or new.merged_into is not null
     or new.review_status = 'deleted'
     or new.origin_time < now() - interval '14 days'
     or not public.shake_worker_wanted(new.lat, new.lon, new.magnitude) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.request_shake_worker('new ' || v_key);
    return new;
  end if;
  v_was := old.status = 'published'
       and old.merged_into is null
       and old.review_status <> 'deleted'
       and public.shake_worker_wanted(old.lat, old.lon, old.magnitude);
  if not coalesce(v_was, false) then
    perform public.request_shake_worker('now mapped ' || v_key);
  elsif abs(coalesce(new.magnitude, 0) - coalesce(old.magnitude, 0)) >= 0.1
     or public.alert_distance_km(old.lat, old.lon, new.lat, new.lon) >= 5
     or abs(coalesce(new.depth_km, 0) - coalesce(old.depth_km, 0))
        >= greatest(5, 0.25 * abs(coalesce(old.depth_km, 0))) then
    perform public.request_shake_worker('revised ' || v_key);
  end if;
  return new;
end
$$;
revoke all on function public.events_request_shake_worker() from public, anon, authenticated;

drop trigger if exists events_request_shake_worker on public.events;
create trigger events_request_shake_worker
  after insert or update of magnitude, lat, lon, depth_km, status, merged_into, review_status
  on public.events
  for each row execute function public.events_request_shake_worker();

-- 3. The dispatcher -----------------------------------------------------------------------------------
-- Is the token there. Never returns or stores the value; any problem
-- reading Vault counts as no token.
create or replace function public.shake_dispatch_token_set()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_set boolean := false;
begin
  begin
    select exists (
      select 1 from vault.decrypted_secrets ds
       where ds.name = 'github_dispatch_token'
         and coalesce(btrim(ds.decrypted_secret), '') <> ''
    ) into v_set;
  exception when others then
    v_set := false;
  end;
  return coalesce(v_set, false);
end
$$;
revoke all on function public.shake_dispatch_token_set() from public, anon, authenticated;

-- pg_cron, every minute. Returns what it did, for a manual run.
create or replace function public.dispatch_shake_worker()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.worker_dispatch_state;
  v_found boolean := false;
  v_status integer;
  v_body text;
  v_error text;
  v_token text;
  v_request bigint;
  v_wait interval;
begin
  select * into s from public.worker_dispatch_state where id = 1 for update;
  if not found then
    return 'no state row';
  end if;

  if s.last_outcome = 'sent' and s.last_request_id is not null then
    select r.status_code, left(coalesce(r.content, r.error_msg, ''), 200)
      into v_status, v_body
      from net._http_response r
     where r.id = s.last_request_id;
    v_found := found;
    if v_found and v_status between 200 and 299 then
      update public.worker_dispatch_state
         set last_status = v_status, last_outcome = 'ok', last_error = null,
             failures = 0, last_answer_at = now(), updated_at = now()
       where id = 1
      returning * into s;
      update public.ops_alerts
         set closed_at = now(),
             details = details || jsonb_build_object('recovered_at', now())
       where kind = 'shake_dispatch'
         and closed_at is null;
    elsif v_found or s.last_dispatched_at < now() - interval '10 minutes' then
      v_error := case
                   when not v_found then 'No answer from GitHub recorded'
                   when v_status is null then 'No answer from GitHub: ' || v_body
                   else 'GitHub ' || v_status::text || ': ' || v_body
                 end;
      update public.worker_dispatch_state
         set last_status = v_status, last_outcome = 'failed', last_error = left(v_error, 300),
             failures = failures + 1, last_answer_at = now(),
             pending = true, pending_since = coalesce(pending_since, now()),
             pending_reason = coalesce(pending_reason, last_reason, 'retry'),
             updated_at = now()
       where id = 1
      returning * into s;
      if s.failures >= 2 and not exists (
        select 1 from public.ops_alerts a
         where a.kind = 'shake_dispatch' and a.closed_at is null
      ) then
        insert into public.ops_alerts (kind, message, details)
        values (
          'shake_dispatch',
          'Starting the SHAKEmap worker failed ' || s.failures || ' times in a row. ' || left(v_error, 200),
          jsonb_build_object('provider', 'github', 'last_status', v_status, 'failures', s.failures));
        begin
          perform public.ops_notify_admins();
        exception when others then
          null;
        end;
      end if;
    end if;
  end if;

  if not s.pending then
    return 'idle';
  end if;
  if s.last_outcome = 'sent' then
    return 'waiting for the answer';
  end if;
  v_wait := case
              when s.failures = 0 then interval '3 minutes'
              else least(interval '3 minutes' * power(2, least(s.failures, 10) - 1)::integer, interval '6 hours')
            end;
  if s.last_dispatched_at is not null and s.last_dispatched_at > now() - v_wait then
    return 'throttled';
  end if;

  v_token := null;
  begin
    select btrim(ds.decrypted_secret) into v_token
      from vault.decrypted_secrets ds
     where ds.name = 'github_dispatch_token'
     limit 1;
  exception when others then
    v_token := null;
  end;
  if v_token is null or v_token = '' then
    if s.last_outcome is distinct from 'no_token' then
      update public.worker_dispatch_state
         set last_outcome = 'no_token',
             last_error = 'No github_dispatch_token in Vault: nothing is started from here until the owner adds it.',
             updated_at = now()
       where id = 1;
    end if;
    return 'no token';
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/Peshawa-LH/bumelerze-atlas/actions/workflows/shake-worker.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'bumelerze-registry',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  ) into v_request;

  update public.worker_dispatch_state
     set pending = false,
         pending_since = null,
         last_reason = pending_reason,
         pending_reason = null,
         last_dispatched_at = now(),
         last_request_id = v_request,
         last_outcome = 'sent',
         dispatch_count = dispatch_count + 1,
         updated_at = now()
   where id = 1;
  return 'dispatched';
end
$$;
revoke all on function public.dispatch_shake_worker() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where cron.job.jobname = 'dispatch_shake_worker') then
    perform cron.unschedule('dispatch_shake_worker');
  end if;
  perform cron.schedule('dispatch_shake_worker', '* * * * *', $cron$select public.dispatch_shake_worker();$cron$);
exception when others then
  raise notice 'pg_cron scheduling skipped (%): schedule dispatch_shake_worker (* * * * *, select public.dispatch_shake_worker();) by hand.', sqlerrm;
end
$$;

-- 4. The admin home: the 0070 body plus the worker line ---------------------------------------------
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
       where a.closed_at is null), '[]'::jsonb),
    'shake_worker', (
      select jsonb_build_object(
               'token_set', public.shake_dispatch_token_set(),
               'pending', s.pending,
               'pending_since', s.pending_since,
               'last_dispatched_at', s.last_dispatched_at,
               'last_outcome', s.last_outcome,
               'last_status', s.last_status,
               'last_error', left(s.last_error, 200),
               'last_reason', s.last_reason,
               'last_answer_at', s.last_answer_at,
               'failures', s.failures,
               'dispatch_count', s.dispatch_count)
        from public.worker_dispatch_state s
       where s.id = 1)
  );
end
$$;
revoke all on function public.admin_source_status() from public, anon;
grant execute on function public.admin_source_status() to authenticated;
