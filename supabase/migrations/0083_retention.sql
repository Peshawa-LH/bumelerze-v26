-- 0083: retention and deletion (security checklist A2.2, audit findings
-- PRIV-03, PRIV-05, PRIV-06, DB-09; owner approval of the periods and the
-- policy lines 2026-11-23).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- 1. storage_purge: a queue of photo files and folders to remove from the
--    avatars, felt-photos and feedback-photos buckets. SQL cannot delete
--    storage objects, so the database queues them and the edge function
--    purge-home-photos drains this queue nightly after the home photos
--    (same function, same 04:15 job). An entry is either a folder (the
--    account's uuid: every file directly under it) or one file
--    (uuid/name). RLS on, no client privileges; service_role reads and
--    deletes.
-- 2. Triggers after delete on felt_photos and feedback_photos queue the
--    row's file, whatever removed the row (account deletion, the nightly
--    purge below, an admin). A path of another shape is skipped, never an
--    error, so a delete is never blocked.
-- 3. delete_my_account (0056) also: queues the account's three folders;
--    deletes the photo rows of its felt reports and feedback (their files
--    are queued by 2, including files a guest uploaded before a device
--    handover, 0079); and on the felt reports and feedback it keeps,
--    replaces the device id with a random stand-in (one per device and
--    deletion, so the people count of a hub and the one live report per
--    device and event rule stay as they were, and nothing links back to the
--    install) and rounds the report location to 0.01 degrees (about 1 km).
--    Everything else is as in 0056.
-- 4. New and changed felt reports store lat and lon rounded to 0.001
--    degrees (about 100 m), by a trigger, so old cached apps are covered;
--    existing rows are rounded once. Every downstream use is a geohash cell
--    of 1.2 km or more.
-- 5. purge_retention(), nightly at 04:05 (before the storage purge):
--    withdrawn felt reports 30 days after withdrawal (details, photos and
--    comments go with them by their foreign keys), feedback 1 year after it
--    was sent, launch counts (telemetry_pings) after 13 months, and guest
--    users (anonymous auth users) unused for 90 days that hold no data: no
--    row in any public table that points at auth.users (the list is read
--    from the catalog each night, so a later table is covered), except the
--    daily activity record and handover tokens, and no file in a storage
--    folder named after them. Use is the latest of the user's creation,
--    sign-in, update, session refresh and daily activity record. At most
--    500 guests a night.
-- 6. Once: avatar folders of accounts that no longer exist are queued
--    (two files live on 2026-11-23).

-- 1. The storage queue ---------------------------------------------------------------------------
create table if not exists public.storage_purge (
  bucket_id text not null,
  object_path text not null,
  queued_at timestamptz not null default now(),
  primary key (bucket_id, object_path),
  constraint storage_purge_bucket check (bucket_id in ('avatars', 'felt-photos', 'feedback-photos')),
  constraint storage_purge_path check (
    object_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (
      object_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
      and object_path !~ '/[.]{1,2}$'
    )
  )
);
alter table public.storage_purge enable row level security;
revoke all on public.storage_purge from public, anon, authenticated;
grant select, delete on public.storage_purge to service_role;

-- Queues one entry when it has the allowed shape; never raises.
create or replace function public.queue_storage_purge(p_bucket text, p_path text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_bucket in ('avatars', 'felt-photos', 'feedback-photos')
     and p_path is not null
     and (
       p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (
         p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
         and p_path !~ '/[.]{1,2}$'
       )
     ) then
    insert into public.storage_purge (bucket_id, object_path) values (p_bucket, p_path)
    on conflict (bucket_id, object_path) do nothing;
  end if;
end
$$;

-- 2. Photo rows take their files with them ------------------------------------------------------
create or replace function public.felt_photos_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.queue_storage_purge('felt-photos', old.storage_path);
  return old;
end
$$;
drop trigger if exists felt_photos_after_delete on public.felt_photos;
create trigger felt_photos_after_delete
  after delete on public.felt_photos
  for each row execute function public.felt_photos_after_delete();

create or replace function public.feedback_photos_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.queue_storage_purge('feedback-photos', old.storage_path);
  return old;
end
$$;
drop trigger if exists feedback_photos_after_delete on public.feedback_photos;
create trigger feedback_photos_after_delete
  after delete on public.feedback_photos
  for each row execute function public.feedback_photos_after_delete();

-- 4. Felt report locations at about 100 m ---------------------------------------------------------
create or replace function public.felt_reports_round_location()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.lat := round(new.lat::numeric, 3)::double precision;
  new.lon := round(new.lon::numeric, 3)::double precision;
  return new;
end
$$;
drop trigger if exists felt_reports_round_location on public.felt_reports;
create trigger felt_reports_round_location
  before insert or update of lat, lon on public.felt_reports
  for each row execute function public.felt_reports_round_location();

update public.felt_reports
   set lat = round(lat::numeric, 3)::double precision,
       lon = round(lon::numeric, 3)::double precision
 where lat <> round(lat::numeric, 3)::double precision
    or lon <> round(lon::numeric, 3)::double precision;

-- 3. Delete my account, with its files, without its device ---------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tags uuid[];
  v_complexes uuid[];
  v_keep_evidence boolean;
  v_salt text := gen_random_uuid()::text;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'delete_my_account: no account to delete' using errcode = '42501';
  end if;

  select coalesce(array_agg(t.tag_id), '{}'::uuid[]) into v_tags
    from public.home_tags t
   where t.owner_user_id = v_uid
      or exists (
        select 1 from public.home_members m
         where m.tag_id = t.tag_id and m.user_id = v_uid and m.role = 'owner'
      );
  select coalesce(array_agg(distinct t.complex_id), '{}'::uuid[]) into v_complexes
    from public.home_tags t
   where t.tag_id = any (v_tags) and t.complex_id is not null;
  delete from public.home_tags where tag_id = any (v_tags);
  delete from public.building_complexes c
   where c.complex_id = any (v_complexes)
     and not exists (select 1 from public.home_tags h where h.complex_id = c.complex_id);

  update public.comment_flags f
     set settled = true
   where not f.settled
     and f.comment_id in (select c.comment_id from public.event_comments c where c.user_id = v_uid);
  update public.event_comments c
     set body = '',
         area_geohash = null,
         user_id = null,
         account_deleted_at = now(),
         flag_count = 0,
         author_deleted_prev_status = null,
         author_deleted_prev_reason = null,
         author_deleted_at = case
           when c.status in ('visible', 'removed') then c.author_deleted_at
           else coalesce(c.author_deleted_at, now()) end,
         hidden_reason = case
           when c.status in ('visible', 'removed') then c.hidden_reason
           else 'account_deleted' end,
         status = case
           when c.status in ('visible', 'removed') then c.status
           else 'hidden' end,
         updated_at = now()
   where c.user_id = v_uid;

  select exists (
    select 1
      from public.account_restrictions r
     where r.user_id = v_uid
       and r.lifted_at is null
       and r.starts_at <= now()
       and (r.ends_at is null or r.ends_at > now())
       and (r.level in ('restrict', 'suspend') or r.appeal_requested_at is not null)
  ) into v_keep_evidence;
  if not v_keep_evidence then
    delete from public.moderation_evidence where author_id = v_uid;
  end if;

  update public.moderation_log
     set snapshot = null
   where target_user_id = v_uid and action = 'profile_reset' and snapshot is not null;

  -- The account's photo files: its own folders, and through the triggers
  -- the file of every photo row of its reports and feedback.
  perform public.queue_storage_purge('avatars', v_uid::text);
  perform public.queue_storage_purge('felt-photos', v_uid::text);
  perform public.queue_storage_purge('feedback-photos', v_uid::text);
  delete from public.felt_photos p
   using public.felt_reports r
   where p.report_id = r.report_id and r.user_id = v_uid;
  delete from public.feedback_photos p
   using public.feedback f
   where p.feedback_id = f.feedback_id and f.user_id = v_uid;

  -- Research data stays, unlinked: no account, no install, location at
  -- about 1 km. Feedback keeps its message without contact or install.
  update public.felt_reports
     set user_id = null,
         device_id = 'deleted-' || left(encode(sha256(convert_to(v_salt || device_id, 'UTF8')), 'hex'), 32),
         lat = round(lat::numeric, 2)::double precision,
         lon = round(lon::numeric, 2)::double precision
   where user_id = v_uid;
  update public.feedback
     set user_id = null,
         contact = null,
         device_id = 'deleted-' || left(encode(sha256(convert_to(v_salt || device_id, 'UTF8')), 'hex'), 32)
   where user_id = v_uid;
  delete from public.felt_comments where user_id = v_uid;

  delete from public.comment_reactions where user_id = v_uid;
  delete from public.comment_flags where user_id = v_uid;
  delete from public.notification_subscriptions where user_id = v_uid;
  delete from public.user_roles where user_id = v_uid;
  delete from public.profile_private where user_id = v_uid;
  delete from public.profiles where user_id = v_uid;
  delete from auth.users where id = v_uid;
end
$$;

-- 5. Nightly retention --------------------------------------------------------------------------
create or replace function public.purge_retention()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_withdrawn integer;
  n_feedback integer;
  n_pings integer;
  n_guests integer := 0;
  v_checks text;
  v_ids uuid[];
begin
  delete from public.felt_reports
   where withdrawn_at is not null and withdrawn_at < now() - interval '30 days';
  get diagnostics n_withdrawn = row_count;

  delete from public.feedback where created_at < now() - interval '1 year';
  get diagnostics n_feedback = row_count;

  delete from public.telemetry_pings where created_at < now() - interval '13 months';
  get diagnostics n_pings = row_count;

  -- One not exists per foreign key column into auth.users.
  select string_agg(
           format('not exists (select 1 from %s x where x.%I = u.id)', c.conrelid::regclass::text, a.attname),
           ' and ' order by c.conrelid::regclass::text, a.attname)
    into v_checks
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f'
     and c.confrelid = 'auth.users'::regclass
     and c.connamespace = 'public'::regnamespace
     and c.conrelid not in ('public.app_presence'::regclass, 'public.device_handovers'::regclass);

  execute format(
    'select coalesce(array_agg(id), %L::uuid[]) from (
       select u.id from auth.users u
        where u.is_anonymous
          and greatest(u.created_at, u.last_sign_in_at, u.updated_at) < now() - interval %L
          and not exists (
            select 1 from auth.sessions s
             where s.user_id = u.id
               and greatest(s.created_at, s.updated_at) >= now() - interval %L)
          and not exists (
            select 1 from public.app_presence p
             where p.user_id = u.id and p.last_seen >= now() - interval %L)
          and not exists (
            select 1 from storage.objects o
             where split_part(o.name, %L, 1) = u.id::text)
          and %s
        order by u.created_at
        limit 500) g',
    '{}', '90 days', '90 days', '90 days', '/', coalesce(v_checks, 'true'))
    into v_ids;

  if cardinality(v_ids) > 0 then
    delete from auth.users where id = any (v_ids) and is_anonymous;
    get diagnostics n_guests = row_count;
  end if;

  return jsonb_build_object(
    'withdrawn_reports', n_withdrawn,
    'feedback', n_feedback,
    'launch_counts', n_pings,
    'guests', n_guests);
end
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge_retention') then
    perform cron.unschedule('purge_retention');
  end if;
  perform cron.schedule('purge_retention', '5 4 * * *', $cron$select public.purge_retention();$cron$);
end
$$;

-- 6. Avatar files of accounts already gone --------------------------------------------------------
insert into public.storage_purge (bucket_id, object_path)
select distinct 'avatars', split_part(o.name, '/', 1)
  from storage.objects o
 where o.bucket_id = 'avatars'
   and split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and not exists (select 1 from auth.users u where u.id::text = split_part(o.name, '/', 1))
on conflict (bucket_id, object_path) do nothing;

-- Who may call what --------------------------------------------------------------------------------
revoke all on function public.queue_storage_purge(text, text) from public, anon, authenticated;
revoke all on function public.felt_photos_after_delete() from public, anon, authenticated;
revoke all on function public.feedback_photos_after_delete() from public, anon, authenticated;
revoke all on function public.felt_reports_round_location() from public, anon, authenticated;
revoke all on function public.purge_retention() from public, anon, authenticated;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Check ------------------------------------------------------------------------------------------
do $$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.storage_purge') is null
     or has_table_privilege('anon', 'public.storage_purge', 'select')
     or has_table_privilege('authenticated', 'public.storage_purge', 'select')
     or not has_table_privilege('service_role', 'public.storage_purge', 'delete') then
    v_missing := v_missing || 'storage_purge for service_role only'::text;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'felt_photos_after_delete' and tgrelid = 'public.felt_photos'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'feedback_photos_after_delete' and tgrelid = 'public.feedback_photos'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'felt_reports_round_location' and tgrelid = 'public.felt_reports'::regclass) then
    v_missing := v_missing || 'triggers'::text;
  end if;
  if exists (
    select 1 from public.felt_reports
     where lat <> round(lat::numeric, 3)::double precision
        or lon <> round(lon::numeric, 3)::double precision
  ) then
    v_missing := v_missing || 'felt locations rounded'::text;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_my_account' and p.prosrc like '%queue_storage_purge%'
  ) or has_function_privilege('anon', 'public.delete_my_account()', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_my_account()', 'execute') then
    v_missing := v_missing || 'delete_my_account'::text;
  end if;
  if to_regprocedure('public.purge_retention()') is null
     or has_function_privilege('authenticated', 'public.purge_retention()', 'execute')
     or has_function_privilege('anon', 'public.purge_retention()', 'execute')
     or has_function_privilege('authenticated', 'public.queue_storage_purge(text, text)', 'execute') then
    v_missing := v_missing || 'purge functions not callable by clients'::text;
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge_retention' and schedule = '5 4 * * *') then
    v_missing := v_missing || 'purge_retention job'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '0083: not in place: %', array_to_string(v_missing, ', ');
  end if;
end
$$;
