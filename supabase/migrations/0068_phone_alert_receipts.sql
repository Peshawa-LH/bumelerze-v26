-- 0068: phone alerts (Expo push): push receipts, and releasing a phone after a sign-out.
--
-- The Expo push API answers a send with a ticket. A ticket of "ok" only
-- means Expo took the message; whether Apple or Google delivered it comes
-- later as a receipt, and that is where a phone that no longer exists shows
-- up (DeviceNotRegistered). Until now only tickets were read, so a dead iOS
-- token stayed "on" and kept being sent to. And after a sign-out a phone
-- could not remove its token from the previous account (its session is
-- gone), so that account's alerts kept arriving on the phone.
--
--   1. alert_deliveries.expo_ticket (the Expo ticket id) and
--      receipt_due_at (when to ask for the receipt; null once settled).
--   2. alert_record_results() (service role, send-alerts) also stores the
--      ticket of an Expo push that was accepted; its receipt is due 15
--      minutes later. Everything else is exactly as in 0062.
--   3. alert_receipts_due(p_limit) (service role) hands out up to p_limit
--      tickets whose receipt is due and holds them for 5 minutes, so two
--      runs do not ask twice. Tickets sent more than 23 hours ago are given
--      up (Expo keeps receipts for 24 hours).
--   4. alert_record_receipts(p_results) (service role) stores what Expo
--      said: ok (settled), gone (DeviceNotRegistered: the delivery is gone
--      and the phone is switched off, like a web push 404/410), failed (the
--      delivery failed; the phone is not blamed: a too big message or wrong
--      credentials are ours), pending (no receipt yet: asked again in 15
--      minutes). The run's counts follow, so Admin, Alerts stays true.
--   5. alert_work_pending() also says yes while receipts are due, so the
--      cron job calls send-alerts for them.
--   6. alerts_release_expo_push(p_token) (anyone signed in, anonymous users
--      too): removes the phone with this Expo token from whichever account
--      registered it. The token is the phone's own: only the phone and the
--      server know it (alerts_my_devices never returns it), and whoever has
--      it can already send that phone pushes through Expo. Removing the
--      registration is all this allows.
--
-- The web is not touched: web deliveries get no ticket and no receipt.
-- Needs 0062. Idempotent: safe to run twice. Written for the SQL editor as
-- one line: no transaction statements, only full-line comments, ASCII only.

-- 1. Columns ---------------------------------------------------------------------------------
alter table public.alert_deliveries add column if not exists expo_ticket text
  check (expo_ticket is null or char_length(expo_ticket) <= 100);
alter table public.alert_deliveries add column if not exists receipt_due_at timestamptz;
create index if not exists alert_deliveries_receipt_due_idx
  on public.alert_deliveries (receipt_due_at) where receipt_due_at is not null;

-- 2. Results, with the Expo ticket -----------------------------------------------------------
-- Only rows this run claimed and still 'sending' change, so replaying the
-- same results does nothing new.
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
  v_ticket text;
  v_sent integer := 0;
  v_failed integer := 0;
  v_gone integer := 0;
  v_retried integer := 0;
begin
  if p_run_id is null or jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'alert_record_results: invalid' using errcode = '22023';
  end if;
  for r in
    select x.delivery_id, x.outcome, x.error, x.ticket
      from jsonb_to_recordset(p_results) as x(delivery_id uuid, outcome text, error text, ticket text)
  loop
    if r.delivery_id is null or r.outcome is null or r.outcome not in ('sent', 'gone', 'retry', 'failed') then
      continue;
    end if;
    v_ticket := case
      when r.outcome = 'sent' and r.ticket ~ '^[A-Za-z0-9_-]{1,100}$' then r.ticket
      else null
    end;
    update public.alert_deliveries d
       set status = case
             when r.outcome = 'retry' and d.attempts >= 3 then 'failed'
             else r.outcome
           end,
           sent_at = case when r.outcome = 'sent' then now() else d.sent_at end,
           next_attempt_at = case when r.outcome = 'retry' then now() + d.attempts * interval '2 minutes' else null end,
           last_error = case when r.outcome = 'sent' then null else left(r.error, 300) end,
           expo_ticket = coalesce(v_ticket, d.expo_ticket),
           receipt_due_at = case when v_ticket is not null then now() + interval '15 minutes' else d.receipt_due_at end
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

-- 3. Receipts that are due -------------------------------------------------------------------
create or replace function public.alert_receipts_due(p_limit integer default 300)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000);
  v_items jsonb;
begin
  update public.alert_deliveries d
     set receipt_due_at = null
   where d.receipt_due_at is not null
     and d.sent_at < now() - interval '23 hours';
  with c as (
    select d.delivery_id
      from public.alert_deliveries d
     where d.receipt_due_at <= now()
       and d.expo_ticket is not null
     order by d.receipt_due_at
     limit v_limit
     for update of d skip locked
  ), held as (
    update public.alert_deliveries d
       set receipt_due_at = now() + interval '5 minutes'
      from c
     where d.delivery_id = c.delivery_id
    returning d.delivery_id, d.expo_ticket
  )
  select coalesce(jsonb_agg(jsonb_build_object('delivery_id', held.delivery_id, 'ticket', held.expo_ticket)), '[]'::jsonb)
    into v_items
    from held;
  return v_items;
end
$$;

-- 4. What the receipts said ------------------------------------------------------------------
create or replace function public.alert_record_receipts(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_sub uuid;
  v_run uuid;
  v_ok integer := 0;
  v_gone integer := 0;
  v_failed integer := 0;
  v_pending integer := 0;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'alert_record_receipts: invalid' using errcode = '22023';
  end if;
  for r in
    select x.delivery_id, x.outcome, x.error
      from jsonb_to_recordset(p_results) as x(delivery_id uuid, outcome text, error text)
  loop
    if r.delivery_id is null or r.outcome is null or r.outcome not in ('ok', 'gone', 'failed', 'pending') then
      continue;
    end if;
    if r.outcome = 'pending' then
      update public.alert_deliveries d
         set receipt_due_at = now() + interval '15 minutes'
       where d.delivery_id = r.delivery_id
         and d.receipt_due_at is not null;
      if found then
        v_pending := v_pending + 1;
      end if;
      continue;
    end if;
    update public.alert_deliveries d
       set receipt_due_at = null,
           status = case when r.outcome = 'ok' then d.status else r.outcome end,
           last_error = case when r.outcome = 'ok' then d.last_error else left(r.error, 300) end
     where d.delivery_id = r.delivery_id
       and d.receipt_due_at is not null
       and d.status = 'sent'
    returning d.push_subscription_id, d.run_id into v_sub, v_run;
    if not found then
      continue;
    end if;
    if r.outcome = 'ok' then
      v_ok := v_ok + 1;
    elsif r.outcome = 'gone' then
      v_gone := v_gone + 1;
      update public.push_subscriptions
         set disabled_at = coalesce(disabled_at, now()), disabled_reason = 'gone',
             last_error_at = now(), last_error = left(r.error, 300)
       where push_subscription_id = v_sub;
      update public.alert_runs
         set sent = greatest(sent - 1, 0), gone = gone + 1
       where run_id = v_run;
    else
      v_failed := v_failed + 1;
      update public.push_subscriptions
         set last_error_at = now(), last_error = left(r.error, 300)
       where push_subscription_id = v_sub;
      update public.alert_runs
         set sent = greatest(sent - 1, 0), failed = failed + 1
       where run_id = v_run;
    end if;
  end loop;
  return jsonb_build_object('ok', v_ok, 'gone', v_gone, 'failed', v_failed, 'pending', v_pending);
end
$$;

-- 5. Work for the cron job, receipts included ------------------------------------------------
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
      or exists (
           select 1 from public.alert_deliveries d
            where d.receipt_due_at <= now()
         )
$$;

-- 6. A phone releases its token after a sign-out ---------------------------------------------
create or replace function public.alerts_release_expo_push(p_token text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'alerts_release_expo_push: not_signed_in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent){0,1}PushToken\[[A-Za-z0-9_-]{10,100}\]$' then
    raise exception 'alerts_release_expo_push: token_invalid' using errcode = '22023';
  end if;
  delete from public.push_subscriptions ps
   where ps.kind = 'expo'
     and ps.expo_token = p_token;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- 7. Who may call what -----------------------------------------------------------------------
revoke all on function public.alert_record_results(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.alert_receipts_due(integer) from public, anon, authenticated;
revoke all on function public.alert_record_receipts(jsonb) from public, anon, authenticated;
revoke all on function public.alert_work_pending() from public, anon, authenticated;
revoke all on function public.alerts_release_expo_push(text) from public, anon;
grant execute on function public.alert_record_results(uuid, jsonb) to service_role;
grant execute on function public.alert_receipts_due(integer) to service_role;
grant execute on function public.alert_record_receipts(jsonb) to service_role;
grant execute on function public.alert_work_pending() to service_role;
grant execute on function public.alerts_release_expo_push(text) to authenticated;
