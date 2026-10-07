-- 0041: start the SHAKEmap worker when the registry changes (owner,
-- 2026-10-07, after the Urmia test event bml202602ia). The worker is a
-- GitHub Actions workflow scheduled every 5 minutes, but GitHub starts it
-- only 3-7 times a day (median gap 2 h 19 min, max 12 h since August), so a
-- shakemap waited for whichever run came next. Now a new or materially
-- revised event marks the worker as needed, and a one-minute cron starts
-- it through GitHub's workflow_dispatch API, at most once per 3 minutes.
-- The schedule stays as the fallback. The worker itself still decides what
-- to compute (trigger policy, registry catch-up and revision legs).
--
-- Needs a Vault secret named github_dispatch_token: a fine-grained GitHub
-- token limited to the bumelerze-atlas repository with "Actions: read and
-- write". Without it the dispatcher records "no token" and does nothing.

create table if not exists public.worker_dispatch_state (
  id smallint primary key default 1 check (id = 1),
  pending boolean not null default false,
  pending_since timestamptz,
  pending_reason text,
  last_dispatched_at timestamptz,
  last_request_id bigint,
  last_status integer,
  last_error text,
  dispatch_count integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.worker_dispatch_state (id) values (1) on conflict (id) do nothing;

-- Service role only: no policies.
alter table public.worker_dispatch_state enable row level security;

create or replace function public.request_shake_worker(p_reason text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.worker_dispatch_state
     set pending = true,
         pending_since = case when pending then pending_since else now() end,
         pending_reason = left(p_reason, 200),
         updated_at = now()
   where id = 1;
$$;

revoke all on function public.request_shake_worker(text) from public, anon, authenticated;

-- Great-circle distance in km, plain SQL (no PostGIS dependency).
create or replace function public.km_between(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
set search_path = pg_catalog
as $$
  select 6371.0 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  ))
$$;

-- Same thresholds as the worker's revision rule (feed_watcher.py):
-- |dM| >= 0.1, or the epicentre moved >= 5 km, or |d depth| >= 5 km.
create or replace function public.events_request_shake_worker()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := coalesce(new.bumelerze_id, new.event_id::text);
begin
  if new.status is distinct from 'published'
     or new.merged_into is not null
     or new.origin_time < now() - interval '14 days'
     or new.lat not between 25 and 45
     or new.lon not between 30 and 60 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform public.request_shake_worker('new ' || v_key);
  elsif old.status is distinct from 'published' or old.merged_into is not null then
    perform public.request_shake_worker('published ' || v_key);
  elsif abs(coalesce(new.magnitude, 0) - coalesce(old.magnitude, 0)) >= 0.1
     or abs(coalesce(new.depth_km, 0) - coalesce(old.depth_km, 0)) >= 5
     or public.km_between(old.lat, old.lon, new.lat, new.lon) >= 5 then
    perform public.request_shake_worker('revised ' || v_key);
  end if;
  return new;
end;
$$;

drop trigger if exists events_request_shake_worker on public.events;
create trigger events_request_shake_worker
  after insert or update of magnitude, lat, lon, depth_km, status, merged_into
  on public.events
  for each row execute function public.events_request_shake_worker();

-- Called every minute by pg_cron. Checks how the previous dispatch went
-- (GitHub answers 204 on success; anything else is retried), then starts
-- the worker if one is pending and the last start is 3+ minutes old.
create or replace function public.dispatch_shake_worker()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.worker_dispatch_state;
  v_status integer;
  v_body text;
  v_token text;
  v_request bigint;
begin
  select * into s from public.worker_dispatch_state where id = 1 for update;

  if s.last_request_id is not null and s.last_status is null then
    select status_code, left(coalesce(content, error_msg, ''), 300)
      into v_status, v_body
      from net._http_response where id = s.last_request_id;
    if found then
      update public.worker_dispatch_state
         set last_status = coalesce(v_status, -1),
             last_error = case when v_status between 200 and 299 then null
                               else 'GitHub ' || coalesce(v_status::text, 'no status') || ': ' || v_body end,
             pending = case when v_status between 200 and 299 then pending else true end,
             pending_since = case when v_status between 200 and 299 then pending_since
                                  else coalesce(pending_since, now()) end,
             updated_at = now()
       where id = 1
      returning * into s;
    end if;
  end if;

  if not s.pending then
    return 'idle';
  end if;
  if s.last_dispatched_at is not null and s.last_dispatched_at > now() - interval '3 minutes' then
    return 'throttled';
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1;
  if v_token is null or v_token = '' then
    update public.worker_dispatch_state
       set last_error = 'no github_dispatch_token in Vault', updated_at = now()
     where id = 1;
    return 'no token';
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/Peshawa-LH/bumelerze-atlas/actions/workflows/shake-worker.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'bumelerze-registry',
      'Content-Type', 'application/json'
    )
  ) into v_request;

  update public.worker_dispatch_state
     set pending = false,
         pending_since = null,
         last_dispatched_at = now(),
         last_request_id = v_request,
         last_status = null,
         dispatch_count = dispatch_count + 1,
         updated_at = now()
   where id = 1;
  return 'dispatched';
end;
$$;

revoke all on function public.dispatch_shake_worker() from public, anon, authenticated;

select cron.unschedule('dispatch_shake_worker')
  where exists (select 1 from cron.job where jobname = 'dispatch_shake_worker');
select cron.schedule('dispatch_shake_worker', '* * * * *', 'select public.dispatch_shake_worker();');
