-- 0078: guest write limits (security checklist A1.3; audit finding DB-06,
-- write and storage flooding).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- Why. Three tables still took inserts from anon without a session and
-- without any limit (feedback, feedback_photos, telemetry_pings), the
-- felt-photos and feedback-photos buckets took any number of 5 MB files
-- from any session, and no jsonb column the app writes had a size cap. A
-- script could fill the free plan's 500 MB database or 1 GB storage, most
-- likely right after a big earthquake, and flood the admin inbox. This
-- caps a stuck client or a single session; a script that keeps making new
-- anonymous sessions is the job of the sign-in CAPTCHA (A1.4).
--
-- 1. Every client write needs a session. anon loses INSERT (and the
--    update, delete, truncate, references and trigger privileges no policy
--    ever used) on feedback, feedback_photos and telemetry_pings; the app
--    of this release signs in anonymously before these writes. The insert
--    policies are for authenticated only and tie the row to the session:
--      * feedback_insert (latest: 0033): the 0033 checks, and user_id must
--        be auth.uid(). A before-insert trigger (feedback_fill_user, as
--        felt_comments_fill_user in 0073) fills a null user_id from the
--        session, so the app's existing row (user_id null when its own
--        sign-in call failed but a session exists) still lands.
--      * feedback_photos_insert (latest: 0020, with check true): the
--        storage path must start with the caller's auth.uid() folder, the
--        path the app uploads to (<uid>/<feedback_id>/<photo_id>.jpg,
--        0021). The table has no user column.
--      * telemetry_pings_insert (latest: 0005, with check true): a session
--        is required. The table has no user column on purpose (anonymous
--        means anonymous) and gets none.
--    feedback_photos also gets select-own and update-own policies on the
--    same path rule. The app writes its photo rows with an upsert
--    (on conflict photo_id), and Postgres applies the SELECT policy to the
--    new row of an upsert: with no SELECT policy every row was refused
--    (42501) even without a conflict, so screenshots reached storage but
--    never the admin inbox. A person reads only rows that point into their
--    own folder. authenticated keeps INSERT and UPDATE on the table (an
--    upsert needs both, as for felt_photos in 0067).
-- 2. Per-session daily limits, counted in write_rate_counters (0071) in a
--    new 'day' window (fixed UTC days; the hourly purge of 0071 already
--    drops rows older than two days). One trigger function for the three
--    tables, the limit is the trigger argument:
--      * feedback: 30 a day (also counts the two review-request RPCs,
--        which write into feedback on the caller's behalf). The busiest
--        real day so far is 14 messages from one person (the owner
--        testing, measured live on 2026-11-22);
--      * feedback_photos: 150 a day (the form allows 5 photos per message,
--        FEEDBACK_PHOTO_MAX_COUNT, times the 30 messages, so the photo
--        limit never bites before the message limit);
--      * telemetry_pings: 50 a day (the app sends one ping per app start;
--        a refused ping is dropped silently, nothing is shown). Only a
--        day count is kept, never the time of a ping.
--    A refusal is P0001 (HTTP 400) '<table>: rate_limited' with a hint,
--    the 0071 style. The feedback queue retries any error but a duplicate
--    with a growing pause (at most 10 minutes), so a 31st message waits
--    for the next UTC day and is never lost. post_reports and
--    profile_reports need nothing: clients have no insert policy on them
--    and report_post / report_profile (0056) already allow 20 a day.
--    Server callers (service role, pg_cron, the SQL editor) are never
--    counted (request_is_client, 0033).
-- 3. Storage: the insert policies felt_photos_storage_insert_own (latest:
--    0016) and feedback_photos_storage_insert_own (latest: 0020) keep
--    their checks and add a per-person count of files uploaded into the
--    caller's folder in the last 24 hours, through the security definer
--    helper my_recent_upload_count (the home_photo_count pattern of
--    0042): fewer than 20 felt photos (one photo per felt report, one
--    report per earthquake) and fewer than 150 feedback screenshots (5 per
--    message, 30 messages). A rolling day and not a lifetime total: a
--    reporter in an active region, or a tester, adds photos for years. A
--    re-upload of the same file (the app uploads with upsert) adds no
--    file. A refused upload stays in the app's photo queue and is retried.
-- 4. Size caps on every jsonb column the app writes: felt_report_details
--    raw_answers, home_surveys answers, home_assessments ims_type_probs,
--    vc_probs and hazard: octet_length(x::text) < 16384 (the app's largest
--    is a few KB: about 300 bytes of felt answers plus the comment; a
--    survey of about 350 bytes plus remarks of at most 1000 characters).
--    Added NOT VALID, so a row already stored never blocks the paste, then
--    validated where every stored row fits (a notice otherwise). A row
--    over the cap is refused with 23514.
--
-- Left for other items: the sign-in CAPTCHA (A1.4), the details and photo
-- RPCs with ownership checks (A2.6: DB-07, DB-08), purges of feedback and
-- telemetry (A2.2). A per-address backstop from request.headers is not
-- added: many phones in Kurdistan share one carrier address (D106).

-- 1. Every client write needs a session ---------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on public.feedback, public.feedback_photos, public.telemetry_pings
  from anon;
revoke update, delete, truncate, references, trigger
  on public.feedback, public.telemetry_pings
  from authenticated;
revoke delete, truncate, references, trigger
  on public.feedback_photos
  from authenticated;

-- 0033's feedback_insert, for authenticated only, the row carries the session.
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (
    device_id is not null
    and status = 'unseen'
    and triage_note is null
    and user_id = auth.uid()
  );

-- A message carries the session's account when the app sent none (as
-- felt_comments_fill_user, 0073).
create or replace function public.feedback_fill_user()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.user_id is null and v_uid is not null then
    new.user_id := v_uid;
  end if;
  return new;
end
$$;
revoke all on function public.feedback_fill_user() from public, anon, authenticated;
drop trigger if exists feedback_fill_user on public.feedback;
create trigger feedback_fill_user
  before insert on public.feedback
  for each row execute function public.feedback_fill_user();

-- 0020's feedback_photos_insert was with check (true).
drop policy if exists feedback_photos_insert on public.feedback_photos;
create policy feedback_photos_insert on public.feedback_photos
  for insert to authenticated
  with check (split_part(storage_path, '/', 1) = auth.uid()::text);

drop policy if exists feedback_photos_select_own on public.feedback_photos;
create policy feedback_photos_select_own on public.feedback_photos
  for select to authenticated
  using (split_part(storage_path, '/', 1) = auth.uid()::text);

drop policy if exists feedback_photos_update_own on public.feedback_photos;
create policy feedback_photos_update_own on public.feedback_photos
  for update to authenticated
  using (split_part(storage_path, '/', 1) = auth.uid()::text)
  with check (split_part(storage_path, '/', 1) = auth.uid()::text);

-- 0005's telemetry_pings_insert was with check (true) for anon too.
drop policy if exists telemetry_pings_insert on public.telemetry_pings;
create policy telemetry_pings_insert on public.telemetry_pings
  for insert to authenticated
  with check (auth.uid() is not null);

-- 2. Per-session daily limits -------------------------------------------------------------------
-- write_rate_counters (0071) gains a 'day' window.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.write_rate_counters'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%window_kind%'
  loop
    execute format('alter table public.write_rate_counters drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.write_rate_counters
  add constraint write_rate_counters_window_kind_check
  check (window_kind in ('minute', 'hour', 'day'));

-- Counts one write in the current UTC day and says whether it is within
-- the limit. Called inside the writing transaction, as write_rate_take
-- (0071): a refused or failed write counts nothing.
create or replace function public.write_rate_take_day(p_bucket text, p_per_day integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day integer;
begin
  insert into public.write_rate_counters as c (bucket, window_kind, window_start, hits)
  values (p_bucket, 'day', date_trunc('day', now(), 'UTC'), 1)
  on conflict (bucket, window_kind, window_start) do update set hits = c.hits + 1
  returning c.hits into v_day;
  return v_day <= p_per_day;
end
$$;
revoke all on function public.write_rate_take_day(text, integer) from public, anon, authenticated;

-- One trigger function; the daily limit is the trigger argument. The
-- caller is the session (md5 of auth.uid(), as in 0071).
create or replace function public.client_daily_write_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_caller text;
begin
  if not public.request_is_client() then
    return new;
  end if;
  v_limit := tg_argv[0]::integer;
  v_uid := auth.uid();
  v_caller := case when v_uid is null then 'nosession' else 'u:' || md5(v_uid::text) end;
  if not public.write_rate_take_day(tg_table_name || ':' || v_caller, v_limit) then
    raise exception '%: rate_limited', tg_table_name using errcode = 'P0001',
      hint = format('At most %s a day from one device.', v_limit);
  end if;
  return new;
end
$$;
revoke all on function public.client_daily_write_limit() from public, anon, authenticated;

drop trigger if exists feedback_rate_limit on public.feedback;
create trigger feedback_rate_limit
  before insert on public.feedback
  for each row execute function public.client_daily_write_limit('30');
drop trigger if exists feedback_photos_rate_limit on public.feedback_photos;
create trigger feedback_photos_rate_limit
  before insert on public.feedback_photos
  for each row execute function public.client_daily_write_limit('150');
drop trigger if exists telemetry_pings_rate_limit on public.telemetry_pings;
create trigger telemetry_pings_rate_limit
  before insert on public.telemetry_pings
  for each row execute function public.client_daily_write_limit('50');

-- 3. Storage: files per person per bucket, last 24 hours ----------------------------------------
-- Files in the caller's own folder (<auth.uid()>/...) of one bucket,
-- uploaded in the last 24 hours. The home_photo_count pattern (0042).
create or replace function public.my_recent_upload_count(p_bucket text)
returns integer
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select count(*)::integer
    from storage.objects o
   where o.bucket_id = p_bucket
     and o.name like auth.uid()::text || '/%'
     and o.created_at > now() - interval '1 day'
$$;
revoke all on function public.my_recent_upload_count(text) from public, anon;
grant execute on function public.my_recent_upload_count(text) to authenticated;

-- 0016's felt_photos_storage_insert_own plus the count.
drop policy if exists felt_photos_storage_insert_own on storage.objects;
create policy felt_photos_storage_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'felt-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.my_recent_upload_count('felt-photos') < 20
  );

-- 0020's feedback_photos_storage_insert_own plus the count.
drop policy if exists feedback_photos_storage_insert_own on storage.objects;
create policy feedback_photos_storage_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.my_recent_upload_count('feedback-photos') < 150
  );

-- 4. Size caps on the jsonb columns the app writes ----------------------------------------------
alter table public.felt_report_details drop constraint if exists felt_report_details_raw_answers_size;
alter table public.felt_report_details
  add constraint felt_report_details_raw_answers_size
  check (octet_length(raw_answers::text) < 16384) not valid;
alter table public.home_surveys drop constraint if exists home_surveys_answers_size;
alter table public.home_surveys
  add constraint home_surveys_answers_size
  check (octet_length(answers::text) < 16384) not valid;
alter table public.home_assessments drop constraint if exists home_assessments_json_size;
alter table public.home_assessments
  add constraint home_assessments_json_size
  check (
    octet_length(ims_type_probs::text) < 16384
    and octet_length(vc_probs::text) < 16384
    and (hazard is null or octet_length(hazard::text) < 16384)
  ) not valid;

-- Rows already stored are checked too where all of them fit; a larger old
-- row only leaves its constraint unvalidated (new rows are always checked).
do $$
begin
  begin
    alter table public.felt_report_details validate constraint felt_report_details_raw_answers_size;
  exception when check_violation then
    raise notice '0078: an old felt_report_details row is over 16384 bytes; the cap holds for new rows';
  end;
  begin
    alter table public.home_surveys validate constraint home_surveys_answers_size;
  exception when check_violation then
    raise notice '0078: an old home_surveys row is over 16384 bytes; the cap holds for new rows';
  end;
  begin
    alter table public.home_assessments validate constraint home_assessments_json_size;
  exception when check_violation then
    raise notice '0078: an old home_assessments row is over 16384 bytes; the cap holds for new rows';
  end;
end
$$;

-- End-of-paste check: fails the paste when a part is missing. --------------------------------------
do $$
declare
  v_missing text[] := '{}'::text[];
begin
  if has_table_privilege('anon', 'public.feedback', 'insert')
     or has_table_privilege('anon', 'public.feedback_photos', 'insert')
     or has_table_privilege('anon', 'public.telemetry_pings', 'insert')
     or has_table_privilege('anon', 'public.feedback', 'truncate')
     or has_table_privilege('authenticated', 'public.feedback', 'truncate')
     or has_table_privilege('authenticated', 'public.feedback_photos', 'truncate')
     or has_table_privilege('authenticated', 'public.telemetry_pings', 'truncate') then
    v_missing := v_missing || 'anon insert revoked'::text;
  end if;
  if not has_table_privilege('authenticated', 'public.feedback', 'insert')
     or not has_table_privilege('authenticated', 'public.feedback_photos', 'insert')
     or not has_table_privilege('authenticated', 'public.feedback_photos', 'update')
     or not has_table_privilege('authenticated', 'public.telemetry_pings', 'insert') then
    v_missing := v_missing || 'authenticated insert kept'::text;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'feedback' and policyname = 'feedback_insert'
       and roles = '{authenticated}' and with_check like '%user_id = auth.uid()%'
       and with_check not like '%user_id IS NULL%'
  ) then
    v_missing := v_missing || 'feedback_insert'::text;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'feedback_photos' and policyname = 'feedback_photos_insert'
       and roles = '{authenticated}' and with_check like '%auth.uid()%'
  ) or (
    select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'feedback_photos'
       and policyname in ('feedback_photos_select_own', 'feedback_photos_update_own')
       and roles = '{authenticated}'
  ) <> 2 then
    v_missing := v_missing || 'feedback_photos policies'::text;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'telemetry_pings' and policyname = 'telemetry_pings_insert'
       and roles = '{authenticated}' and with_check like '%auth.uid()%'
  ) then
    v_missing := v_missing || 'telemetry_pings_insert'::text;
  end if;
  if (
    select count(*) from pg_trigger t
     where not t.tgisinternal
       and (t.tgrelid, t.tgname) in (
         ('public.feedback'::regclass, 'feedback_fill_user'),
         ('public.feedback'::regclass, 'feedback_rate_limit'),
         ('public.feedback_photos'::regclass, 'feedback_photos_rate_limit'),
         ('public.telemetry_pings'::regclass, 'telemetry_pings_rate_limit')
       )
  ) <> 4 then
    v_missing := v_missing || 'triggers'::text;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.write_rate_counters'::regclass
       and conname = 'write_rate_counters_window_kind_check'
       and pg_get_constraintdef(oid) like '%day%'
  ) then
    v_missing := v_missing || 'day window'::text;
  end if;
  if has_function_privilege('authenticated', 'public.write_rate_take_day(text, integer)', 'execute')
     or has_function_privilege('anon', 'public.write_rate_take_day(text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.client_daily_write_limit()', 'execute')
     or has_function_privilege('anon', 'public.my_recent_upload_count(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.my_recent_upload_count(text)', 'execute') then
    v_missing := v_missing || 'function grants'::text;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'felt_photos_storage_insert_own'
       and with_check like '%my_recent_upload_count(%felt-photos%) < 20%'
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'feedback_photos_storage_insert_own'
       and with_check like '%my_recent_upload_count(%feedback-photos%) < 150%'
  ) then
    v_missing := v_missing || 'storage counts'::text;
  end if;
  if (
    select count(*) from pg_constraint
     where contype = 'c'
       and (conrelid, conname) in (
         ('public.felt_report_details'::regclass, 'felt_report_details_raw_answers_size'),
         ('public.home_surveys'::regclass, 'home_surveys_answers_size'),
         ('public.home_assessments'::regclass, 'home_assessments_json_size')
       )
       and pg_get_constraintdef(oid) like '%16384%'
  ) <> 3 then
    v_missing := v_missing || 'jsonb size caps'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '0078: not in place: %', array_to_string(v_missing, ', ');
  end if;
end
$$;
