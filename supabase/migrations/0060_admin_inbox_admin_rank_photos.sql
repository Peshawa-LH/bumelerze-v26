-- 0060: personal admin accounts, the feedback inbox and the felt photo queue.
-- Review: social-admin-review-2026-10-08 (S12, P2-1, P2-2, P2-3), decisions
-- D15 (felt photos stay pending until approved), D69, D78, D80.
--
--   1. P2-1 a PRIVATE rank "admin". It lives in its own table, private_ranks,
--      which no client can read or write. Every public reader of ranks (role
--      marks next to names, public_profile, follower lists, the People
--      directory) reads user_roles, so an admin rank can never appear on a
--      profile or next to a comment: invisible by construction, not by a
--      filter that a later function could forget. Only has_permission(),
--      my_permissions(), holds_admin_permission() and audit_actor_rank() also
--      look at private_ranks. The admin rank holds every permission of the
--      official rank EXCEPT the hubs.* ones (featuring a hub, a pinned hub
--      note): those are the public voice and stay with the Bumelerze account.
--      Moderators keep their content permissions (plus photos.moderate).
--      Granted in the SQL editor only, never in the app:
--        insert into public.private_ranks (user_id, role, note) select p.user_id, 'admin', 'owner personal account' from public.profiles p where p.username = 'YOUR_USERNAME' on conflict do nothing;
--      Taken back with:
--        delete from public.private_ranks where role = 'admin' and user_id = (select p.user_id from public.profiles p where p.username = 'YOUR_USERNAME');
--      The activity log names the real person who acted (actor_id), with the
--      rank "admin" in actor_rank.
--   2. permissions feedback.manage (official, admin) and photos.moderate
--      (official, admin, moderator); log actions feedback_status,
--      report_photo_approve and report_photo_reject (the report_ prefix keeps
--      the photo decisions readable for moderators with audit.read, without
--      redefining is_content_audit_action); target type felt_photo. Both
--      lists are extended from what the live constraint holds, so actions
--      another migration added are kept
--   3. P2-2 the feedback inbox: admin_feedback_list(), admin_feedback_counts(),
--      admin_feedback_get() (message, contact, platform, version, language,
--      the linked person, screenshots, the restriction an appeal is about),
--      admin_feedback_set_status() (status + triage note, audited) and
--      admin_feedback_grant_badge() (one tap: admin_grant_role() for the
--      person who asked, then the request is marked solved). Admins read
--      screenshots from the private feedback-photos bucket (signed URLs)
--   4. request_restriction_review() (0054) wrote a "screen" column that 0022
--      dropped from feedback: "Ask for review" failed on the live database.
--      Same function without that column
--   5. P2-3 the felt photo queue: admin_felt_photo_queue() (time, event,
--      intensity, never a coordinate, a geohash, a device or a person),
--      admin_felt_photo_moderate() (approve or reject, audited). A rejected
--      photo's FILE is removed by the app through the Storage API (Supabase
--      does not let SQL delete storage objects), allowed by a policy only for
--      photos already marked rejected
--   6. admin_person_flags(): for the person page, whether someone holds the
--      private admin rank and whether they are protected from limits and
--      password resets (permission based, not rank-name based)
--
-- Needs 0003, 0016, 0020-0022, 0043, 0048, 0052, 0054 and 0055.
-- Idempotent: safe to run twice. Written for the SQL editor as one line: no
-- transaction statements, only full-line comments, ASCII only.

-- 1. The private admin rank -----------------------------------------------------------------
create table if not exists public.private_ranks (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  note text check (note is null or char_length(note) <= 200),
  primary key (user_id, role)
);
alter table public.private_ranks enable row level security;
revoke all on public.private_ranks from anon, authenticated;
-- No policies on purpose: no client reads or writes this table. The SQL editor
-- (and the security definer functions below) are the only way in.

-- role_permissions learns the rank. Dropped by shape, so a differently named
-- check cannot linger.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.role_permissions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%seismologist%'
  loop
    execute format('alter table public.role_permissions drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions
  add constraint role_permissions_role_check
  check (role in (
    'official', 'admin', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'
  ));

-- 2. Permissions ---------------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('official', 'feedback.manage'),
  ('official', 'photos.moderate'),
  ('moderator', 'photos.moderate')
on conflict do nothing;

-- admin = everything the official rank may do, except the public voice (hubs.*).
insert into public.role_permissions (role, permission)
select 'admin', rp.permission
  from public.role_permissions rp
 where rp.role = 'official'
   and rp.permission not like 'hubs.%'
on conflict do nothing;

-- Every permission check goes through these four. Each is its latest
-- definition (0043, 0043, 0054, 0052) plus private_ranks.
create or replace function public.has_permission(p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and (
       exists (
         select 1
           from public.user_roles r
           join public.role_permissions rp on rp.role = r.role
          where r.user_id = p_user
            and rp.permission = p_permission
       )
       or exists (
         select 1
           from public.private_ranks k
           join public.role_permissions rp on rp.role = k.role
          where k.user_id = p_user
            and rp.permission = p_permission
       )
     )
$$;

create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct x.permission order by x.permission), '{}'::text[])
    from (
      select rp.permission
        from public.user_roles r
        join public.role_permissions rp on rp.role = r.role
       where r.user_id = auth.uid()
      union
      select rp.permission
        from public.private_ranks k
        join public.role_permissions rp on rp.role = k.role
       where k.user_id = auth.uid()
    ) x
$$;

create or replace function public.holds_admin_permission(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and (
       exists (
         select 1
           from public.user_roles r
           join public.role_permissions rp on rp.role = r.role
          where r.user_id = p_user
       )
       or exists (
         select 1
           from public.private_ranks k
           join public.role_permissions rp on rp.role = k.role
          where k.user_id = p_user
       )
     )
$$;

-- The rank the activity log records next to the person who acted.
create or replace function public.audit_actor_rank(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select x.role
    from (
      select r.role from public.user_roles r where r.user_id = p_user
      union
      select k.role from public.private_ranks k where k.user_id = p_user
    ) x
   order by array_position(
              array['official', 'admin', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'],
              x.role)
   limit 1
$$;

-- 3. Log actions and target types: what is there now, plus the new ones ----------------------------
do $$
declare
  c record;
  v_found text[];
  v_list text;
  v_actions text[] := array[
    'comment_approve', 'comment_hide', 'comment_remove', 'comment_restore',
    'role_grant', 'role_revoke', 'role_restore',
    'profile_reports_resolve', 'report_reopen',
    'post_remove', 'post_restore', 'post_reports_dismiss',
    'password_reset', 'profile_reset', 'profile_restore',
    'restrict', 'suspend', 'lift',
    'person_view', 'email_reveal', 'purge',
    'feedback_status', 'report_photo_approve', 'report_photo_reject'
  ];
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%comment_approve%'
  loop
    select coalesce(array_agg(r.m[1]), '{}'::text[]) into v_found
      from regexp_matches(c.def, '''([a-z_]+)''', 'g') as r(m);
    v_found := v_found || coalesce((
      select array_agg(x)
        from regexp_matches(c.def, '''[{]([a-z_,]+)[}]''', 'g') as r(m),
             unnest(string_to_array(r.m[1], ',')) as x), '{}'::text[]);
    v_actions := v_actions || v_found;
    execute format('alter table public.moderation_log drop constraint %I', c.conname);
  end loop;
  select string_agg(quote_literal(a), ', ' order by a) into v_list
    from (select distinct a from unnest(v_actions) as a where a <> 'text') d;
  execute format(
    'alter table public.moderation_log add constraint moderation_log_action_check check (action in (%s))',
    v_list);
end
$$;

do $$
declare
  c record;
  v_found text[];
  v_list text;
  v_types text[] := array[
    'comment', 'post', 'profile', 'account', 'rank', 'report', 'home', 'feedback', 'person', 'system',
    'felt_photo'
  ];
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%target_type%'
  loop
    select coalesce(array_agg(r.m[1]), '{}'::text[]) into v_found
      from regexp_matches(c.def, '''([a-z_]+)''', 'g') as r(m);
    v_found := v_found || coalesce((
      select array_agg(x)
        from regexp_matches(c.def, '''[{]([a-z_,]+)[}]''', 'g') as r(m),
             unnest(string_to_array(r.m[1], ',')) as x), '{}'::text[]);
    v_types := v_types || v_found;
    execute format('alter table public.moderation_log drop constraint %I', c.conname);
  end loop;
  select string_agg(quote_literal(a), ', ' order by a) into v_list
    from (select distinct a from unnest(v_types) as a where a <> 'text') d;
  execute format(
    'alter table public.moderation_log add constraint moderation_log_target_type_check check (target_type is null or target_type in (%s))',
    v_list);
end
$$;

-- 4. The feedback inbox ------------------------------------------------------------------------------
create index if not exists feedback_status_created_idx
  on public.feedback (status, created_at desc);

-- Newest first, 50 a page, keyset on created_at (pass the last row's
-- created_at as p_before). p_status: unseen, in_review, solved, wont_do, open
-- (unseen or in_review) or null for all. p_category: one of the categories,
-- none (no category: ordinary feedback) or null for all. p_search: words in
-- the message, a name or @username, or the start of the feedback id.
create or replace function public.admin_feedback_list(
  p_status text default null,
  p_category text default null,
  p_search text default null,
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  feedback_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  status text,
  category text,
  preview text,
  platform text,
  app_version text,
  locale text,
  user_id uuid,
  display_name text,
  username text,
  photo_count integer,
  has_note boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_q text := lower(ltrim(btrim(coalesce(p_search, '')), '@'));
begin
  if not public.has_permission(auth.uid(), 'feedback.manage') then
    raise exception 'admin_feedback_list: not_allowed' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('unseen', 'in_review', 'solved', 'wont_do', 'open') then
    raise exception 'admin_feedback_list: invalid_status' using errcode = '22023';
  end if;
  v_q := left(v_q, 100);
  return query
    select f.feedback_id, f.created_at, f.updated_at, f.status, f.category,
           left(f.message, 160), f.platform, f.app_version, f.locale,
           f.user_id, p.display_name, p.username,
           (select count(*)::integer from public.feedback_photos ph where ph.feedback_id = f.feedback_id),
           f.triage_note is not null and f.triage_note <> ''
      from public.feedback f
      left join public.profiles p on p.user_id = f.user_id
     where (p_status is null
            or f.status = p_status
            or (p_status = 'open' and f.status in ('unseen', 'in_review')))
       and (p_category is null
            or f.category = p_category
            or (p_category = 'none' and f.category is null))
       and (v_q = ''
            or position(v_q in lower(f.message)) > 0
            or position(v_q in lower(coalesce(p.display_name, ''))) > 0
            or lower(coalesce(p.username, '')) like v_q || '%'
            or f.feedback_id::text like v_q || '%')
       and (p_before is null or f.created_at < p_before)
     order by f.created_at desc, f.feedback_id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

-- Numbers for the Admin page: open feedback by status, open badge requests and
-- appeals, and the felt photos waiting. A part the caller may not see is null.
create or replace function public.admin_inbox_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_feedback jsonb := null;
  v_photos integer := null;
begin
  if not public.has_permission(v_uid, 'feedback.manage')
     and not public.has_permission(v_uid, 'photos.moderate') then
    raise exception 'admin_inbox_counts: not_allowed' using errcode = '42501';
  end if;
  if public.has_permission(v_uid, 'feedback.manage') then
    select jsonb_build_object(
             'unseen', count(*) filter (where f.status = 'unseen'),
             'in_review', count(*) filter (where f.status = 'in_review'),
             'solved', count(*) filter (where f.status = 'solved'),
             'wont_do', count(*) filter (where f.status = 'wont_do'),
             'badge_requests_open', count(*) filter (
               where f.category = 'badge_request' and f.status in ('unseen', 'in_review')),
             'appeals_open', count(*) filter (
               where f.category = 'appeal' and f.status in ('unseen', 'in_review')))
      into v_feedback
      from public.feedback f;
  end if;
  if public.has_permission(v_uid, 'photos.moderate') then
    select count(*)::integer into v_photos
      from public.felt_photos ph
     where ph.moderation_status = 'pending';
  end if;
  return jsonb_build_object('feedback', v_feedback, 'photos_pending', v_photos);
end
$$;

-- One message with everything the inbox shows. Never returned: the device id.
create or replace function public.admin_feedback_get(p_feedback_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  f record;
  v_person jsonb := null;
  v_photos jsonb;
  v_restriction jsonb := null;
  v_rid uuid;
begin
  if not public.has_permission(v_uid, 'feedback.manage') then
    raise exception 'admin_feedback_get: not_allowed' using errcode = '42501';
  end if;
  select x.feedback_id as feedback_id, x.created_at as created_at, x.updated_at as updated_at,
         x.status as status, x.category as category, x.message as message,
         x.contact as contact, x.platform as platform, x.app_version as app_version,
         x.locale as locale, x.triage_note as triage_note, x.user_id as user_id,
         x.device_id as device_id
    into f
    from public.feedback x
   where x.feedback_id = p_feedback_id;
  if not found then
    raise exception 'admin_feedback_get: not_found' using errcode = 'P0002';
  end if;

  if f.user_id is not null then
    select jsonb_build_object(
             'user_id', u.id,
             'is_account', not coalesce(u.is_anonymous, true),
             'display_name', p.display_name,
             'username', p.username,
             'ranks', coalesce((
               select jsonb_agg(r.role order by r.role)
                 from public.user_roles r where r.user_id = u.id), '[]'::jsonb))
      into v_person
      from auth.users u
      left join public.profiles p on p.user_id = u.id
     where u.id = f.user_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'photo_id', ph.photo_id,
           'storage_path', ph.storage_path) order by ph.created_at), '[]'::jsonb)
    into v_photos
    from public.feedback_photos ph
   where ph.feedback_id = f.feedback_id;

  -- An appeal is written by request_restriction_review() with the
  -- restriction id in device_id ("appeal-<id>").
  if f.category = 'appeal'
     and f.device_id ~ '^appeal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_rid := substr(f.device_id, 8)::uuid;
    if public.has_permission(v_uid, 'accounts.restrict') then
      select jsonb_build_object(
               'restriction_id', r.id,
               'level', r.level,
               'reason', r.reason,
               'starts_at', r.starts_at,
               'ends_at', r.ends_at,
               'lifted_at', r.lifted_at,
               'active', r.lifted_at is null
                         and r.starts_at <= now()
                         and (r.ends_at is null or r.ends_at > now()))
        into v_restriction
        from public.account_restrictions r
       where r.id = v_rid;
    end if;
  end if;

  return jsonb_build_object(
    'feedback_id', f.feedback_id,
    'created_at', f.created_at,
    'updated_at', f.updated_at,
    'status', f.status,
    'category', f.category,
    'message', f.message,
    'contact', f.contact,
    'platform', f.platform,
    'app_version', f.app_version,
    'locale', f.locale,
    'triage_note', f.triage_note,
    'person', v_person,
    'photos', v_photos,
    'restriction', v_restriction
  );
end
$$;

-- Status and triage note. p_note null keeps the note, an empty note clears it.
-- Nothing changed: no update and no audit row (a retry is harmless). Returns
-- the audit row id, or null when nothing changed.
create or replace function public.admin_feedback_set_status(
  p_feedback_id uuid,
  p_status text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  f record;
  v_note text;
begin
  if not public.has_permission(v_uid, 'feedback.manage') then
    raise exception 'admin_feedback_set_status: not_allowed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('unseen', 'in_review', 'solved', 'wont_do') then
    raise exception 'admin_feedback_set_status: invalid_status' using errcode = '22023';
  end if;
  if p_note is not null and char_length(btrim(p_note)) > 4000 then
    raise exception 'admin_feedback_set_status: too_long' using errcode = '22023';
  end if;
  select x.status as status, x.triage_note as triage_note, x.user_id as user_id
    into f
    from public.feedback x
   where x.feedback_id = p_feedback_id
   for update;
  if not found then
    raise exception 'admin_feedback_set_status: not_found' using errcode = 'P0002';
  end if;
  v_note := case when p_note is null then f.triage_note else nullif(btrim(p_note), '') end;
  if f.status = p_status and f.triage_note is not distinct from v_note then
    return null;
  end if;
  update public.feedback
     set status = p_status,
         triage_note = v_note
   where feedback_id = p_feedback_id;
  return public.write_audit(
    v_uid, 'feedback_status', 'feedback', p_feedback_id::text,
    f.user_id, null, null, p_status, v_note,
    jsonb_build_object('status', f.status, 'triage_note', f.triage_note)
  );
end
$$;

-- "Grant requested badge": the existing admin_grant_role() (badges.grant,
-- audited as role_grant) for the person who sent a badge request, then the
-- request is marked solved (audited as feedback_status). A rank the person
-- already holds is not granted again, so a second tap only settles the status.
create or replace function public.admin_feedback_grant_badge(
  p_feedback_id uuid,
  p_role text,
  p_org_name text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  f record;
  v_username text;
begin
  if not public.has_permission(v_uid, 'feedback.manage')
     or not public.has_permission(v_uid, 'badges.grant') then
    raise exception 'admin_feedback_grant_badge: not_allowed' using errcode = '42501';
  end if;
  select x.status as status, x.category as category, x.user_id as user_id
    into f
    from public.feedback x
   where x.feedback_id = p_feedback_id
   for update;
  if not found then
    raise exception 'admin_feedback_grant_badge: not_found' using errcode = 'P0002';
  end if;
  if p_role is null or p_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then
    raise exception 'admin_feedback_grant_badge: invalid_role' using errcode = '22023';
  end if;
  if f.category is distinct from 'badge_request' then
    raise exception 'admin_feedback_grant_badge: not_badge_request' using errcode = '22023';
  end if;
  if f.user_id is null then
    raise exception 'admin_feedback_grant_badge: not_account' using errcode = 'P0002';
  end if;
  select p.username into v_username from public.profiles p where p.user_id = f.user_id;
  if v_username is null or v_username = '' then
    raise exception 'admin_feedback_grant_badge: no_username' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.user_roles r where r.user_id = f.user_id and r.role = p_role
  ) then
    perform public.admin_grant_role(
      v_username, p_role, p_org_name,
      'Badge request ' || left(p_feedback_id::text, 8)
    );
  end if;
  if f.status <> 'solved' then
    update public.feedback set status = 'solved' where feedback_id = p_feedback_id;
    perform public.write_audit(
      v_uid, 'feedback_status', 'feedback', p_feedback_id::text,
      f.user_id, null, null, 'solved', 'rank ' || p_role,
      jsonb_build_object('status', f.status)
    );
  end if;
end
$$;

-- Screenshots: admins with feedback.manage may read them (signed URLs). No
-- client may list, change or delete them otherwise (0020 has insert only).
drop policy if exists feedback_photos_storage_read_admin on storage.objects;
create policy feedback_photos_storage_read_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-photos' and public.my_has_permission('feedback.manage'));

-- 5. "Ask for review" without the dropped column (0054's function otherwise unchanged) ----------------
create or replace function public.request_restriction_review(p_restriction_id uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_msg text := left(btrim(coalesce(p_message, '')), 1000);
  v_fid uuid;
begin
  if v_uid is null then
    raise exception 'request_restriction_review: not_account' using errcode = '42501';
  end if;
  select x.id as id, x.level as level, x.reason as reason,
         x.appeal_requested_at as appeal_requested_at
    into r
    from public.account_restrictions x
   where x.id = p_restriction_id
     and x.user_id = v_uid
     and x.lifted_at is null
     and x.starts_at <= now()
     and (x.ends_at is null or x.ends_at > now())
   for update;
  if not found then
    raise exception 'request_restriction_review: not_found' using errcode = 'P0002';
  end if;
  if r.appeal_requested_at is not null then
    return;
  end if;
  insert into public.feedback (device_id, user_id, message)
  values (
    'appeal-' || r.id::text,
    v_uid,
    'Review request for restriction ' || r.id::text || ' (' || r.level || '): ' || r.reason
      || case when v_msg <> '' then E'\n\n' || v_msg else '' end
  )
  returning feedback_id into v_fid;
  update public.feedback set category = 'appeal' where feedback_id = v_fid;
  update public.account_restrictions set appeal_requested_at = now() where id = r.id;
end
$$;

-- 6. The felt photo queue ------------------------------------------------------------------------------
-- Pending first by default, oldest first so nothing waits forever; approved
-- and rejected newest first by decision time. p_cursor is the last row's
-- created_at (pending) or moderated_at (approved, rejected). What a moderator sees: the photo, when the report
-- was made, the earthquake and the intensity picked. Never a coordinate, a
-- geohash, a device id or who sent it. storage_path is returned only so the
-- app can ask Storage for a short-lived signed URL.
create or replace function public.admin_felt_photo_queue(
  p_status text default 'pending',
  p_cursor timestamptz default null,
  p_limit integer default 30
)
returns table (
  photo_id uuid,
  storage_path text,
  status text,
  created_at timestamptz,
  report_created_at timestamptz,
  intensity smallint,
  event_id uuid,
  hub_id text,
  place text,
  magnitude real,
  origin_time timestamptz,
  moderated_at timestamptz,
  moderated_by_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_status text := coalesce(p_status, 'pending');
begin
  if not public.has_permission(auth.uid(), 'photos.moderate') then
    raise exception 'admin_felt_photo_queue: not_allowed' using errcode = '42501';
  end if;
  if v_status not in ('pending', 'approved', 'rejected') then
    raise exception 'admin_felt_photo_queue: invalid_status' using errcode = '22023';
  end if;
  if v_status = 'pending' then
    return query
      select ph.photo_id, ph.storage_path, ph.moderation_status, ph.created_at,
             fr.created_at, fr.cartoon_level::smallint, e.event_id, e.bumelerze_id, e.place,
             e.magnitude::real, e.origin_time, ph.moderated_at, null::text
        from public.felt_photos ph
        join public.felt_reports fr on fr.report_id = ph.report_id
        left join public.events e on e.event_id = fr.event_id
       where ph.moderation_status = 'pending'
         and (p_cursor is null or ph.created_at > p_cursor)
       order by ph.created_at asc, ph.photo_id asc
       limit least(greatest(coalesce(p_limit, 30), 1), 100);
  else
    return query
      select ph.photo_id, ph.storage_path, ph.moderation_status, ph.created_at,
             fr.created_at, fr.cartoon_level::smallint, e.event_id, e.bumelerze_id, e.place,
             e.magnitude::real, e.origin_time, ph.moderated_at, mp.display_name
        from public.felt_photos ph
        join public.felt_reports fr on fr.report_id = ph.report_id
        left join public.events e on e.event_id = fr.event_id
        left join public.profiles mp on mp.user_id::text = ph.moderated_by
       where ph.moderation_status = v_status
         and (p_cursor is null or ph.moderated_at < p_cursor)
       order by ph.moderated_at desc nulls last, ph.photo_id desc
       limit least(greatest(coalesce(p_limit, 30), 1), 100);
  end if;
end
$$;

-- Approve or reject one photo. pending -> approved or rejected; approved ->
-- rejected (taken down later). A rejected photo stays rejected: its file is
-- removed. Repeating the same decision changes nothing and writes no audit
-- row, and returns the storage path again so the app can retry removing a
-- rejected file. moderated_by keeps the moderator's user id (as text, the
-- column is free text since 0003).
create or replace function public.admin_felt_photo_moderate(
  p_photo_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  ph record;
  v_new text;
  v_log uuid;
  v_hub text;
begin
  if not public.has_permission(v_uid, 'photos.moderate') then
    raise exception 'admin_felt_photo_moderate: not_allowed' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve', 'reject') then
    raise exception 'admin_felt_photo_moderate: invalid_action' using errcode = '22023';
  end if;
  v_new := case when p_action = 'approve' then 'approved' else 'rejected' end;
  select x.photo_id as photo_id, x.report_id as report_id, x.storage_path as storage_path,
         x.moderation_status as moderation_status
    into ph
    from public.felt_photos x
   where x.photo_id = p_photo_id
   for update;
  if not found then
    raise exception 'admin_felt_photo_moderate: not_found' using errcode = 'P0002';
  end if;
  if ph.moderation_status = v_new then
    return jsonb_build_object('status', v_new, 'storage_path', ph.storage_path, 'log_id', null);
  end if;
  if ph.moderation_status = 'rejected' then
    raise exception 'admin_felt_photo_moderate: already_rejected' using errcode = '22023';
  end if;
  update public.felt_photos
     set moderation_status = v_new,
         moderated_at = now(),
         moderated_by = v_uid::text
   where photo_id = p_photo_id;
  select e.bumelerze_id into v_hub
    from public.felt_reports fr
    join public.events e on e.event_id = fr.event_id
   where fr.report_id = ph.report_id;
  v_log := public.write_audit(
    v_uid, 'report_photo_' || p_action, 'felt_photo', p_photo_id::text,
    null, null, null, left(btrim(coalesce(p_reason, '')), 200), null,
    jsonb_build_object('status', ph.moderation_status, 'hub_id', v_hub)
  );
  return jsonb_build_object('status', v_new, 'storage_path', ph.storage_path, 'log_id', v_log);
end
$$;

-- For the storage delete policy: is this path a rejected felt photo.
create or replace function public.felt_photo_file_rejected(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1 from public.felt_photos ph
     where ph.storage_path = p_path and ph.moderation_status = 'rejected'
  );
end
$$;

-- Moderators read felt photos (signed URLs) and remove the file of a photo
-- they rejected. Nothing else in the bucket can be removed by a client.
drop policy if exists felt_photos_storage_read_moderator on storage.objects;
create policy felt_photos_storage_read_moderator on storage.objects
  for select to authenticated
  using (bucket_id = 'felt-photos' and public.my_has_permission('photos.moderate'));

drop policy if exists felt_photos_storage_delete_rejected on storage.objects;
create policy felt_photos_storage_delete_rejected on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'felt-photos'
    and public.my_has_permission('photos.moderate')
    and public.felt_photo_file_rejected(name)
  );

-- 7. The person page: private admin rank and protection, by permission ---------------------------------
create or replace function public.admin_person_flags(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission(auth.uid(), 'people.view') then
    raise exception 'admin_person_flags: not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'admin_rank', exists (
      select 1 from public.private_ranks k where k.user_id = p_user_id and k.role = 'admin'),
    'protected', public.holds_admin_permission(p_user_id),
    'resets_passwords', public.has_permission(p_user_id, 'accounts.reset_password')
  );
end
$$;

-- Grants -------------------------------------------------------------------------------------------------
revoke all on function public.my_permissions() from public, anon;
revoke all on function public.holds_admin_permission(uuid) from public, anon, authenticated;
revoke all on function public.audit_actor_rank(uuid) from public, anon, authenticated;
revoke all on function public.admin_feedback_list(text, text, text, timestamptz, integer) from public, anon;
revoke all on function public.admin_inbox_counts() from public, anon;
revoke all on function public.admin_feedback_get(uuid) from public, anon;
revoke all on function public.admin_feedback_set_status(uuid, text, text) from public, anon;
revoke all on function public.admin_feedback_grant_badge(uuid, text, text) from public, anon;
revoke all on function public.request_restriction_review(uuid, text) from public, anon;
revoke all on function public.admin_felt_photo_queue(text, timestamptz, integer) from public, anon;
revoke all on function public.admin_felt_photo_moderate(uuid, text, text) from public, anon;
revoke all on function public.felt_photo_file_rejected(text) from public, anon;
revoke all on function public.admin_person_flags(uuid) from public, anon;

grant execute on function public.my_permissions() to authenticated;
grant execute on function public.admin_feedback_list(text, text, text, timestamptz, integer) to authenticated;
grant execute on function public.admin_inbox_counts() to authenticated;
grant execute on function public.admin_feedback_get(uuid) to authenticated;
grant execute on function public.admin_feedback_set_status(uuid, text, text) to authenticated;
grant execute on function public.admin_feedback_grant_badge(uuid, text, text) to authenticated;
grant execute on function public.request_restriction_review(uuid, text) to authenticated;
grant execute on function public.admin_felt_photo_queue(text, timestamptz, integer) to authenticated;
grant execute on function public.admin_felt_photo_moderate(uuid, text, text) to authenticated;
grant execute on function public.felt_photo_file_rejected(text) to authenticated;
grant execute on function public.admin_person_flags(uuid) to authenticated;
