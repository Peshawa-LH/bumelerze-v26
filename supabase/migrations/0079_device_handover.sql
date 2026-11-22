-- 0079: device handover (security audit DB-03: the install's device id
-- worked as a password for a guest's felt reports, comments and feedback).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- Why. claim_device_reports (0035) let any signed-in account move every
-- guest felt report, felt comment and feedback message carrying a given
-- device id into itself, and owns_felt_report (0064) let anyone holding
-- that string withdraw or restore the reports and overwrite their answers.
-- The device id is not a secret: the app shows it as the Contributor ID and
-- invites people to send it to support. With it, an account could take
-- over where somebody was during an earthquake (exact coordinates) and the
-- contact they left in feedback.
--
-- Since 0073 and 0078 every felt and feedback write carries the session
-- (user_id = auth.uid()), and the app signs in anonymously before writing,
-- so a guest's rows already name the guest's anonymous user. Ownership is
-- therefore decided by the session, never by the device id:
--
-- 1. device_handovers: one-time tokens for "move my guest rows into the
--    account I am signing in to". Only the sha256 of a token is stored,
--    with the guest's anonymous user id; a token lives 10 minutes and works
--    once. guest_uid follows auth.users on delete cascade, so a removed
--    guest takes its tokens with it. RLS on, no policies, no client
--    privileges: only the two functions below touch the table.
-- 2. prepare_device_handover(): called by the app while it is still in the
--    guest session, just before it signs in to an account. Refuses
--    anything but an anonymous session (42501). Returns a fresh token of
--    64 lowercase hex characters (32 random bytes from pgcrypto); replaces
--    the guest's earlier tokens and clears rows that expired more than a
--    day ago (so no cron job is needed).
-- 3. claim_device_handover(p_token): called by the app right after the
--    sign-in, now as the account. Refuses anything but a real account
--    (42501). A malformed, unknown, expired or used token returns 0 (no
--    error: the app treats 0 as nothing to move). The token is marked used
--    at once; the guest must still be an anonymous user (a guest that has
--    become an account in the meantime keeps its rows) and must not be the
--    caller. Then felt_reports, felt_comments and feedback rows of the
--    guest move to the account (the three tables of 0035), and a report
--    the guest withdrew keeps its withdrawn_by pointing at its owner.
--    Returns the number of rows moved. Rows that follow by themselves:
--    felt_report_details and felt_photos hang on the report id,
--    feedback_photos on the feedback id; the photo files stay in the
--    guest's storage folder (the rows point at them; files are not
--    renamed by SQL). Rows that do not move: write_rate_counters (a
--    count, not data), telemetry_pings (no user column on purpose),
--    push_subscriptions and notification_subscriptions (alerts belong to
--    the session that turned them on; the app registers the device again
--    under the account, and the account may already have its own alert
--    places; alerts are in testers mode, accounts only, today). Everything
--    else a guest could keep (I'm safe, comments on hubs, hearts, follows,
--    homes, profiles) needs a real account already.
-- 4. owns_felt_report keeps its signature (withdraw_felt_report,
--    restore_felt_report and submit_felt_report_details keep theirs, old
--    cached apps still pass the device id) but answers true only for the
--    report's own session: auth.uid() is not null and the report's user_id
--    is auth.uid(). The device id argument is ignored. A caller without a
--    session now always gets the functions' not_found (live has no report
--    without a user_id, measured 2026-11-22).
-- 5. claim_device_reports stays defined but nobody may run it any more
--    (execute revoked from public, anon and authenticated). The app's
--    caller never throws and reads any error as 0 moved, so old cached apps
--    sign in as before and just move nothing. Rollback of this step is one
--    statement: grant execute on function
--    public.claim_device_reports(text) to authenticated.
--
-- Already in place and checked below: felt_comments.device_id cannot be
-- read by anon or authenticated (0077 column grants). Left for other
-- items: existing_report_ids (0039/0064) still filters by device id, but
-- returns only which of the report ids the caller already holds are still
-- live; felt_report_details_insert is still with check (true) (A2.6,
-- DB-07).

-- 1. One-time handover tokens ---------------------------------------------------------------------
create table if not exists public.device_handovers (
  token_hash bytea primary key,
  guest_uid uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint device_handovers_hash_length check (octet_length(token_hash) = 32)
);
create index if not exists device_handovers_guest_uid_idx on public.device_handovers (guest_uid);
alter table public.device_handovers enable row level security;
revoke all on public.device_handovers from public, anon, authenticated;

-- 2. The guest session asks for a token -----------------------------------------------------------
create or replace function public.prepare_device_handover()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
begin
  if v_uid is null
     or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous) then
    raise exception 'prepare_device_handover: guest_only' using errcode = '42501';
  end if;
  delete from public.device_handovers h
   where h.guest_uid = v_uid
      or h.expires_at < now() - interval '1 day';
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.device_handovers (token_hash, guest_uid, created_at, expires_at)
  values (sha256(convert_to(v_token, 'UTF8')), v_uid, now(), now() + interval '10 minutes');
  return v_token;
end
$$;
revoke all on function public.prepare_device_handover() from public, anon;
grant execute on function public.prepare_device_handover() to authenticated;

-- 3. The account takes the guest's rows with the token --------------------------------------------
create or replace function public.claim_device_handover(p_token text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_token text := lower(btrim(p_token));
  v_hash bytea;
  v_guest uuid;
  n integer := 0;
  k integer;
begin
  if v_uid is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     or not exists (select 1 from auth.users u where u.id = v_uid and not u.is_anonymous) then
    raise exception 'claim_device_handover: sign in with an account first' using errcode = '42501';
  end if;
  if v_token is null or v_token !~ '^[0-9a-f]{64}$' then
    return 0;
  end if;
  v_hash := sha256(convert_to(v_token, 'UTF8'));
  select h.guest_uid into v_guest
    from public.device_handovers h
   where h.token_hash = v_hash
     and h.used_at is null
     and h.expires_at > now()
   for update;
  if not found then
    return 0;
  end if;
  update public.device_handovers set used_at = now() where token_hash = v_hash;
  if v_guest = v_uid
     or not exists (select 1 from auth.users u where u.id = v_guest and u.is_anonymous) then
    return 0;
  end if;

  update public.felt_reports fr
     set user_id = v_uid,
         withdrawn_by = case when fr.withdrawn_by = v_guest then v_uid else fr.withdrawn_by end
   where fr.user_id = v_guest;
  get diagnostics k = row_count; n := n + k;

  update public.felt_comments fc
     set user_id = v_uid
   where fc.user_id = v_guest;
  get diagnostics k = row_count; n := n + k;

  update public.feedback f
     set user_id = v_uid
   where f.user_id = v_guest;
  get diagnostics k = row_count; n := n + k;

  return n;
end
$$;
revoke all on function public.claim_device_handover(text) from public, anon;
grant execute on function public.claim_device_handover(text) to authenticated;

-- 4. A report belongs to its session only ---------------------------------------------------------
-- Same signature, language, security and search_path as 0064; the device
-- id argument stays for the three callers and is ignored. Internal.
create or replace function public.owns_felt_report(p_report_id uuid, p_device_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.felt_reports r
     where r.report_id = p_report_id
       and auth.uid() is not null
       and r.user_id = auth.uid()
  )
$$;
revoke all on function public.owns_felt_report(uuid, text) from public, anon, authenticated;

-- 5. The device-id claim is switched off ----------------------------------------------------------
revoke all on function public.claim_device_reports(text) from public, anon, authenticated;

-- End-of-paste check: fails the paste when a part is missing. --------------------------------------
do $$
declare
  v_missing text[] := '{}'::text[];
  v_all constant text := 'select, insert, update, delete, truncate, references, trigger';
begin
  if to_regclass('public.device_handovers') is null then
    v_missing := v_missing || 'device_handovers table'::text;
  else
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.device_handovers')) then
      v_missing := v_missing || 'device_handovers rls'::text;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'device_handovers') then
      v_missing := v_missing || 'device_handovers without policies'::text;
    end if;
    if has_table_privilege('anon', 'public.device_handovers', v_all)
       or has_table_privilege('authenticated', 'public.device_handovers', v_all) then
      v_missing := v_missing || 'device_handovers grants'::text;
    end if;
    if (
      select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'device_handovers'
         and column_name in ('token_hash', 'guest_uid', 'created_at', 'expires_at', 'used_at')
    ) <> 5 then
      v_missing := v_missing || 'device_handovers columns'::text;
    end if;
  end if;
  if (
    select count(*) from pg_proc p
     where p.oid in (to_regprocedure('public.prepare_device_handover()'),
                     to_regprocedure('public.claim_device_handover(text)'))
       and p.prosecdef
       and p.proconfig @> array['search_path=public, pg_temp']
  ) <> 2 then
    v_missing := v_missing || 'handover functions'::text;
  elsif not has_function_privilege('authenticated', 'public.prepare_device_handover()', 'execute')
     or not has_function_privilege('authenticated', 'public.claim_device_handover(text)', 'execute')
     or has_function_privilege('anon', 'public.prepare_device_handover()', 'execute')
     or has_function_privilege('anon', 'public.claim_device_handover(text)', 'execute') then
    v_missing := v_missing || 'handover function grants'::text;
  end if;
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.owns_felt_report(uuid, text)')
       and p.prosrc like '%r.user_id = auth.uid()%'
       and p.prosrc not like '%device_id%'
  ) then
    v_missing := v_missing || 'owns_felt_report by session only'::text;
  elsif has_function_privilege('anon', 'public.owns_felt_report(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.owns_felt_report(uuid, text)', 'execute') then
    v_missing := v_missing || 'owns_felt_report internal'::text;
  end if;
  if to_regprocedure('public.claim_device_reports(text)') is null then
    v_missing := v_missing || 'claim_device_reports kept for rollback'::text;
  elsif has_function_privilege('anon', 'public.claim_device_reports(text)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_device_reports(text)', 'execute') then
    v_missing := v_missing || 'claim_device_reports revoked'::text;
  end if;
  if has_column_privilege('anon', 'public.felt_comments', 'device_id', 'select')
     or has_column_privilege('authenticated', 'public.felt_comments', 'device_id', 'select') then
    v_missing := v_missing || 'felt_comments.device_id closed (0077)'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '0079: not in place: %', array_to_string(v_missing, ', ');
  end if;
end
$$;
