-- 0055: social + admin P1, batch 4 (People and devices directory).
-- Review: social-admin-review-2026-10-08 (section 4b, P1-9, S9), decisions D78, D79.
--
-- Admin > People: find any account or guest install, see what it has done
-- (counts, status, history) and act on it, without ever exposing a location or
-- a secret. Every read goes through SECURITY DEFINER functions that return a
-- fixed, hand-written list of fields (jsonb), never a table row.
--
--   1. permissions people.view (moderator, official), people.view_email and
--      people.view_guests (official only); the log learns profile_restore;
--      moderators may read profile_reset / profile_restore rows in Activity
--   2. app_presence: one row per identity (first seen, last seen, platform,
--      app version, language), written only by touch_presence(), which the
--      app calls at most once a day (the server also ignores a second call
--      within 20 hours). No client can read the table
--   3. device_fingerprint(): the first 8 hex characters of the SHA-256 of a
--      device id. Raw device ids are bearer secrets (S9: claim_device_reports
--      moves a device's data to whoever presents the id) and are NEVER
--      returned by anything below
--   4. admin_people_search(): accounts / guests / all, search, filters, sort,
--      keyset paging, 50 per page. Guests with no activity are not listed,
--      they come back as one number (idle_guests)
--   5. admin_person(): one person's page. Writes a person_view audit row
--      (once per 5 minutes per admin and person, so a screen refresh does not
--      fill the log). admin_reveal_email(): the full address, audited
--   6. admin_reset_profile_fields(): put a copied display name back to a
--      placeholder and/or remove a copied photo (impersonation), with an
--      audit snapshot that Undo restores; admin_undo_action() learns it
--   7. admin_person_notes: private notes about a person, added and listed by
--      RPC only
--   8. admin_people_stats(): the numbers header (accounts, guests with
--      activity, new and active in 7 / 30 days, restricted, suspended, by
--      platform); counts only, guest numbers need people.view_guests
--
-- Who may do what:
--   * people.view (moderator, official): the directory and the person page for
--     ACCOUNTS: no email, no guests, no devices of guests
--   * people.view_email (official): masked email in rows, full email on tap
--   * people.view_guests (official): the Guests tab, guest person pages
--   * name / photo reset: accounts.restrict (moderator, official), never on
--     yourself or on an account that holds an admin permission
--   * the rest (restrict, reset password, badges) reuse their own permissions
--
-- Never returned by any function here: coordinates of any kind (felt reports,
-- homes, alert places), home join keys, survey answers, home photos,
-- profession, push tokens, raw device ids, IP addresses, password hashes,
-- feedback text or contact. Counts and ids only.
--
-- Needs 0035, 0036, 0037, 0043, 0045, 0047, 0050, 0051, 0052, 0053 and 0054.
-- Idempotent: safe to run twice. Written for the SQL editor as one line: no
-- transaction statements, only full-line comments, ASCII only.

-- 1. Permissions and log actions ----------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('moderator', 'people.view'),
  ('official', 'people.view'),
  ('official', 'people.view_email'),
  ('official', 'people.view_guests')
on conflict do nothing;

-- The action list is 0053's plus profile_restore. Dropped by shape, not by
-- name, so a differently named constraint cannot linger.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%comment_approve%'
  loop
    execute format('alter table public.moderation_log drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.moderation_log drop constraint if exists moderation_log_action_check;
alter table public.moderation_log
  add constraint moderation_log_action_check
  check (action in (
    'comment_approve', 'comment_hide', 'comment_remove', 'comment_restore',
    'role_grant', 'role_revoke', 'role_restore',
    'profile_reports_resolve', 'report_reopen',
    'post_remove', 'post_restore', 'post_reports_dismiss',
    'password_reset', 'profile_reset', 'profile_restore',
    'restrict', 'suspend', 'lift',
    'person_view', 'email_reveal', 'purge'
  ));

-- 0054's list plus the name / photo reset a moderator may do.
create or replace function public.is_content_audit_action(p_action text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_action ~ '^(comment|post|report)_'
      or p_action in (
        'profile_reports_resolve', 'restrict', 'suspend', 'lift',
        'profile_reset', 'profile_restore'
      )
$$;

-- 2. Presence ----------------------------------------------------------------------------
create table if not exists public.app_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  platform text check (platform is null or platform in ('ios', 'android', 'web')),
  app_version text check (app_version is null or char_length(app_version) <= 32),
  locale text check (locale is null or locale in ('en', 'ckb', 'kmr', 'ar'))
);
create index if not exists app_presence_last_seen_idx on public.app_presence (last_seen desc);
alter table public.app_presence enable row level security;
revoke all on public.app_presence from anon, authenticated;
-- no policy: nobody reads the table directly, only the admin functions below.

-- Private notes about a person: the table (the functions are in section 7).
create table if not exists public.admin_person_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists admin_person_notes_user_idx
  on public.admin_person_notes (user_id, created_at desc);
alter table public.admin_person_notes enable row level security;
revoke all on public.admin_person_notes from anon, authenticated;
-- no policy: written and read only through the functions below.

-- Indexes the per-person counts need (felt reports and feedback are looked up
-- by owner; 0003 and 0020 only indexed the device).
create index if not exists felt_reports_user_idx
  on public.felt_reports (user_id) where user_id is not null;
create index if not exists feedback_user_idx
  on public.feedback (user_id) where user_id is not null;

-- The app calls this when it opens, at most once a day. A second call within
-- 20 hours changes nothing. Values the app should never send are dropped, not
-- rejected, so an old or odd client never fails.
create or replace function public.touch_presence(
  p_platform text default null,
  p_app_version text default null,
  p_locale text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_platform text;
  v_version text;
  v_locale text;
begin
  if v_uid is null then
    raise exception 'touch_presence: not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid) then
    return;
  end if;
  v_platform := case when p_platform in ('ios', 'android', 'web') then p_platform end;
  v_locale := case when p_locale in ('en', 'ckb', 'kmr', 'ar') then p_locale end;
  v_version := case
    when p_app_version ~ '^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$' then p_app_version
  end;
  insert into public.app_presence as a (user_id, first_seen, last_seen, platform, app_version, locale)
  values (v_uid, now(), now(), v_platform, v_version, v_locale)
  on conflict (user_id) do update
     set last_seen = now(),
         platform = coalesce(excluded.platform, a.platform),
         app_version = coalesce(excluded.app_version, a.app_version),
         locale = coalesce(excluded.locale, a.locale)
   where a.last_seen < now() - interval '20 hours';
end
$$;

-- 3. Fingerprints and small helpers (internal, never callable by a client) -------------
-- sha256 is built into Postgres (no extension needed); the first 8 hex
-- characters are enough to tell devices apart and useless to anyone who wants
-- to impersonate one.
create or replace function public.device_fingerprint(p_device text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_device is null then null
    else left(encode(sha256(convert_to(p_device, 'UTF8')), 'hex'), 8)
  end
$$;

create or replace function public.people_like_escape(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- A guest "has activity" when it ever reported, commented, sent feedback,
-- flagged, reported a profile or post, blocked someone or was limited.
create or replace function public.guest_has_activity(p_user uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.felt_reports x where x.user_id = p_user)
      or exists (select 1 from public.event_comments x where x.user_id = p_user)
      or exists (select 1 from public.feedback x where x.user_id = p_user)
      or exists (select 1 from public.comment_flags x where x.user_id = p_user)
      or exists (select 1 from public.profile_reports x where x.reporter_id = p_user)
      or exists (select 1 from public.post_reports x where x.reporter_id = p_user)
      or exists (select 1 from public.blocks x where x.blocker_id = p_user)
      or exists (select 1 from public.account_restrictions x where x.user_id = p_user)
$$;

-- 4. The search ----------------------------------------------------------------------------
-- Returns jsonb: { rows: [...], next_cursor: {k, id} | null, idle_guests: n | null }.
--
-- p_query (all matches are OR-ed; an empty query lists everyone):
--   @name          username prefix
--   BMH-XXXXXX     the owner of that home code
--   name           username prefix (3+ characters), display name anywhere in
--                  it (2+ characters, case, accents and Arabic-script variants
--                  ignored, 0052's name_fold)
--   a@b / a@b.org  email prefix or exact (people.view_email only; 3+ characters)
--   6-36 hex       user id prefix
--   8 hex          device fingerprint
--   full uuid      the owner of that felt report
-- p_kind: accounts | guests | all (guests and all need people.view_guests; a
--   moderator asking for all gets accounts)
-- p_filters (jsonb object, unknown keys ignored): rank (any or a rank name),
--   status (active | restricted | suspended), reported (bool), joined_from,
--   joined_to (timestamps), active_days (7 | 30), platform, has_password
--   (bool, accounts.reset_password only)
-- p_sort: last_seen | joined | open_reports, always newest / most first.
-- p_cursor: the next_cursor of the previous page.
create or replace function public.admin_people_search(
  p_query text default null,
  p_kind text default 'accounts',
  p_filters jsonb default null,
  p_sort text default 'last_seen',
  p_cursor jsonb default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_guests boolean;
  v_email boolean;
  v_pw boolean;
  v_kind text := coalesce(nullif(btrim(p_kind), ''), 'accounts');
  v_sort text := coalesce(nullif(btrim(p_sort), ''), 'last_seen');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_f jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
  v_raw text := left(btrim(coalesce(p_query, '')), 80);
  v_q text;
  v_at boolean;
  v_home_code text;
  v_report uuid;
  v_by_user boolean := false;
  v_by_name boolean := false;
  v_by_mail boolean := false;
  v_by_id boolean := false;
  v_by_fp boolean := false;
  v_by_home boolean := false;
  v_by_report boolean := false;
  v_any boolean;
  v_pat_user text;
  v_pat_name text;
  v_pat_mail text;
  v_pat_id text;
  v_rank text := nullif(btrim(v_f ->> 'rank'), '');
  v_status text := nullif(btrim(v_f ->> 'status'), '');
  v_platform text := nullif(btrim(v_f ->> 'platform'), '');
  v_reported boolean := false;
  v_haspw boolean;
  v_from timestamptz;
  v_to timestamptz;
  v_days integer;
  v_ck numeric;
  v_cid uuid;
  v_out jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'people.view') then
    raise exception 'admin_people_search: not_allowed' using errcode = '42501';
  end if;
  v_guests := public.has_permission(v_uid, 'people.view_guests');
  v_email := public.has_permission(v_uid, 'people.view_email');
  v_pw := public.has_permission(v_uid, 'accounts.reset_password');

  if v_kind not in ('accounts', 'guests', 'all') then
    raise exception 'admin_people_search: invalid_kind' using errcode = '22023';
  end if;
  if v_kind = 'guests' and not v_guests then
    raise exception 'admin_people_search: not_allowed' using errcode = '42501';
  end if;
  if v_kind = 'all' and not v_guests then
    v_kind := 'accounts';
  end if;
  if v_sort not in ('last_seen', 'joined', 'open_reports') then
    raise exception 'admin_people_search: invalid_sort' using errcode = '22023';
  end if;

  -- filters
  if v_rank is not null and v_rank <> 'any' and v_rank not in (
       'official', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then
    raise exception 'admin_people_search: invalid_filter' using errcode = '22023';
  end if;
  if v_status is not null and v_status not in ('active', 'restricted', 'suspended') then
    raise exception 'admin_people_search: invalid_filter' using errcode = '22023';
  end if;
  if v_platform is not null and v_platform not in ('ios', 'android', 'web') then
    raise exception 'admin_people_search: invalid_filter' using errcode = '22023';
  end if;
  v_reported := coalesce(v_f ->> 'reported', 'false') = 'true';
  if (v_f ->> 'has_password') in ('true', 'false') then
    if not v_pw then
      raise exception 'admin_people_search: not_allowed' using errcode = '42501';
    end if;
    v_haspw := (v_f ->> 'has_password') = 'true';
  end if;
  v_from := nullif(v_f ->> 'joined_from', '')::timestamptz;
  v_to := nullif(v_f ->> 'joined_to', '')::timestamptz;
  v_days := nullif(v_f ->> 'active_days', '')::integer;
  if v_days is not null and v_days not in (7, 30) then
    raise exception 'admin_people_search: invalid_filter' using errcode = '22023';
  end if;

  -- cursor
  if p_cursor is not null then
    v_ck := nullif(p_cursor ->> 'k', '')::numeric;
    v_cid := nullif(p_cursor ->> 'id', '')::uuid;
    if v_ck is null or v_cid is null then
      raise exception 'admin_people_search: invalid_cursor' using errcode = '22023';
    end if;
  end if;

  -- what the query can mean
  v_q := lower(v_raw);
  v_at := left(v_q, 1) = '@';
  if v_raw <> '' then
    if upper(v_raw) ~ '^BMH-[0-9A-Z]{6}$' then
      v_by_home := true;
      v_home_code := upper(v_raw);
    elsif v_at then
      v_by_user := char_length(ltrim(v_q, '@')) >= 1;
      v_pat_user := public.people_like_escape(ltrim(v_q, '@')) || '%';
    else
      v_by_user := char_length(v_q) >= 3;
      v_pat_user := public.people_like_escape(v_q) || '%';
      v_by_name := char_length(public.name_fold(v_raw)) >= 2;
      v_pat_name := '%' || public.people_like_escape(public.name_fold(v_raw)) || '%';
      v_by_mail := v_email and char_length(v_q) >= 3;
      v_pat_mail := public.people_like_escape(v_q) || '%';
      v_by_id := v_q ~ '^[0-9a-f][0-9a-f-]{5,35}$';
      v_pat_id := public.people_like_escape(v_q) || '%';
      v_by_fp := v_q ~ '^[0-9a-f]{8}$';
      if v_q ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_by_report := true;
        v_report := v_q::uuid;
      end if;
    end if;
  end if;
  v_any := v_raw = '' or v_by_user or v_by_name or v_by_mail or v_by_id or v_by_fp
           or v_by_home or v_by_report;

  with cand as (
    select u.id as uid,
           coalesce(u.is_anonymous, false) as guest,
           u.email as email,
           p.username as username,
           p.display_name as display_name,
           p.avatar_path as avatar_path,
           case when coalesce(u.is_anonymous, false) then u.created_at
                else coalesce(p.created_at, u.created_at) end as joined_at,
           coalesce(greatest(pr.last_seen, u.last_sign_in_at), u.created_at) as seen_at,
           coalesce(
             pr.platform,
             (select f.platform from public.feedback f
               where f.user_id = u.id and f.platform is not null
               order by f.created_at desc limit 1)
           ) as platform,
           coalesce(rep.n, 0) as open_reports,
           case when coalesce(lim.suspended, false) then 'suspended'
                when coalesce(lim.restricted, false) then 'restricted'
                else 'active' end as status,
           (u.encrypted_password is not null and u.encrypted_password <> '') as has_pw,
           (not coalesce(u.is_anonymous, false)) or public.guest_has_activity(u.id) as has_activity
      from auth.users u
      left join public.profiles p on p.user_id = u.id
      left join public.app_presence pr on pr.user_id = u.id
      left join lateral (
        select (select count(*) from public.profile_reports x
                 where x.reported_id = u.id and x.resolved_at is null)
             + (select count(*) from public.post_reports x
                  join public.profile_posts po on po.post_id = x.post_id
                 where po.user_id = u.id and x.resolved_at is null) as n
      ) rep on true
      left join lateral (
        select bool_or(r.level = 'suspend') as suspended,
               bool_or(r.level = 'restrict') as restricted
          from public.account_restrictions r
         where r.user_id = u.id
           and r.level in ('restrict', 'suspend')
           and r.lifted_at is null
           and r.starts_at <= now()
           and (r.ends_at is null or r.ends_at > now())
      ) lim on true
     where v_any
       and (case v_kind
              when 'accounts' then not coalesce(u.is_anonymous, false)
              when 'guests' then coalesce(u.is_anonymous, false)
              else true end)
       and (v_guests or not coalesce(u.is_anonymous, false))
       and (
         v_raw = ''
         or (v_by_user and lower(p.username) like v_pat_user)
         or (v_by_name and public.name_fold(p.display_name) like v_pat_name)
         or (v_by_mail and lower(u.email) like v_pat_mail)
         or (v_by_id and u.id::text like v_pat_id)
         or (v_by_fp and (
               exists (select 1 from public.felt_reports x
                        where x.user_id = u.id and public.device_fingerprint(x.device_id) = v_q)
            or exists (select 1 from public.feedback x
                        where x.user_id = u.id and public.device_fingerprint(x.device_id) = v_q)))
         or (v_by_report and exists (
               select 1 from public.felt_reports x where x.report_id = v_report and x.user_id = u.id))
         or (v_by_home and exists (
               select 1 from public.home_tags h
                where h.code = v_home_code and h.owner_user_id = u.id))
       )
  ),
  flt as (
    select c.*,
           case v_sort
             when 'joined' then extract(epoch from c.joined_at)::numeric
             when 'open_reports' then c.open_reports::numeric * 10000000000
                                      + extract(epoch from c.seen_at)::numeric
             else extract(epoch from c.seen_at)::numeric
           end as k
      from cand c
     where (v_rank is null or exists (
              select 1 from public.user_roles r
               where r.user_id = c.uid and (v_rank = 'any' or r.role = v_rank)))
       and (v_status is null or c.status = v_status)
       and (not v_reported or c.open_reports > 0)
       and (v_from is null or c.joined_at >= v_from)
       and (v_to is null or c.joined_at <= v_to)
       and (v_days is null or c.seen_at >= now() - make_interval(days => v_days))
       and (v_platform is null or c.platform = v_platform)
       and (v_haspw is null or c.has_pw = v_haspw)
  ),
  page as (
    select f.*, row_number() over (order by f.k desc, f.uid desc) as rn
      from flt f
     where (not f.guest or f.has_activity)
       and (v_ck is null or (f.k, f.uid) < (v_ck, v_cid))
     order by f.k desc, f.uid desc
     limit v_limit + 1
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', s.uid,
          'kind', case when s.guest then 'guest' else 'account' end,
          'username', s.username,
          'display_name', s.display_name,
          'avatar_path', s.avatar_path,
          'ranks', coalesce((
            select jsonb_agg(r.role order by array_position(
                     array['official', 'moderator', 'seismologist', 'professor',
                           'researcher', 'engineer', 'partner'], r.role))
              from public.user_roles r where r.user_id = s.uid), '[]'::jsonb),
          'status', s.status,
          'joined', s.joined_at,
          'last_seen', s.seen_at,
          'platform', s.platform,
          'open_reports', s.open_reports,
          'counts', jsonb_build_object(
            'felt_reports', (select count(*) from public.felt_reports x where x.user_id = s.uid),
            'comments', (select count(*) from public.event_comments x where x.user_id = s.uid),
            'posts', (select count(*) from public.profile_posts x
                       where x.user_id = s.uid and x.status <> 'deleted'),
            'homes_owned', (select count(*) from public.home_tags x where x.owner_user_id = s.uid),
            'homes_member', (select count(*) from public.home_members x
                              where x.user_id = s.uid and x.role = 'member' and x.status = 'approved'),
            'feedback', (select count(*) from public.feedback x where x.user_id = s.uid)
          )
        ) || case
          when v_email then jsonb_build_object(
            'masked_email',
            case when s.email is null or position('@' in s.email) = 0 then null
                 else left(s.email, 1) || '***@' || split_part(s.email, '@', 2) end)
          else '{}'::jsonb
        end
        order by s.rn)
      from page s
     where s.rn <= v_limit), '[]'::jsonb),
    'next_cursor', (
      select jsonb_build_object('k', s.k::text, 'id', s.uid)
        from page s
       where s.rn = v_limit
         and exists (select 1 from page x where x.rn = v_limit + 1)),
    'idle_guests', case
      when v_guests and v_kind <> 'accounts'
        then (select count(*) from flt x where x.guest and not x.has_activity)
      else null end
  )
  into v_out;
  return v_out;
end
$$;

-- 5. One person -----------------------------------------------------------------------------
-- Returns jsonb. A guest does not exist for a caller without people.view_guests
-- (not_found, not "not allowed", so a moderator learns nothing about guests).
-- Opening a person writes a person_view audit row (target_type account), once
-- per 5 minutes per admin and person.
create or replace function public.admin_person(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_guests boolean;
  v_email boolean;
  v_pw boolean;
  v_restrict boolean;
  v_evidence boolean;
  u record;
  v_identity jsonb;
  v_devices jsonb;
  v_same jsonb;
  v_counts jsonb;
  v_recent jsonb;
  v_restrictions jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'people.view') then
    raise exception 'admin_person: not_allowed' using errcode = '42501';
  end if;
  v_guests := public.has_permission(v_uid, 'people.view_guests');
  v_email := public.has_permission(v_uid, 'people.view_email');
  v_pw := public.has_permission(v_uid, 'accounts.reset_password');
  v_restrict := public.has_permission(v_uid, 'accounts.restrict');
  v_evidence := public.has_permission(v_uid, 'audit.read_all');

  select x.id as id, coalesce(x.is_anonymous, false) as guest, x.email as email,
         x.created_at as created_at, x.last_sign_in_at as last_sign_in_at,
         (x.encrypted_password is not null and x.encrypted_password <> '') as has_pw
    into u
    from auth.users x
   where x.id = p_user_id;
  if not found or (u.guest and not v_guests) then
    raise exception 'admin_person: not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.moderation_log l
     where l.actor_id = v_uid
       and l.action = 'person_view'
       and l.target_user_id = p_user_id
       and l.created_at > now() - interval '5 minutes'
  ) then
    perform public.write_audit(
      v_uid, 'person_view', 'account', p_user_id::text,
      p_user_id, null, null, null, null, null
    );
  end if;

  -- identity
  select jsonb_build_object(
           'user_id', u.id,
           'kind', case when u.guest then 'guest' else 'account' end,
           'username', p.username,
           'display_name', p.display_name,
           'avatar_path', p.avatar_path,
           'is_private', p.is_private,
           'ranks', coalesce((
             select jsonb_agg(jsonb_build_object('role', r.role, 'org_name', r.org_name)
                    order by array_position(
                      array['official', 'moderator', 'seismologist', 'professor',
                            'researcher', 'engineer', 'partner'], r.role))
               from public.user_roles r where r.user_id = u.id), '[]'::jsonb),
           'status', case
             when public.is_suspended(u.id) then 'suspended'
             when public.is_restricted(u.id) then 'restricted'
             else 'active' end,
           'joined', case when u.guest then u.created_at else coalesce(p.created_at, u.created_at) end,
           'first_seen', pr.first_seen,
           'last_seen', coalesce(greatest(pr.last_seen, u.last_sign_in_at), u.created_at),
           'platform', coalesce(pr.platform, fb.platform),
           'app_version', coalesce(pr.app_version, fb.app_version),
           'locale', coalesce(pr.locale, pp.locale, fb.locale),
           'terms_version', pp.terms_version,
           'terms_accepted_at', pp.terms_accepted_at,
           'research_consent_version', pp.research_consent_version,
           'research_consent_at', pp.research_consent_at
         )
         || case when v_email then jsonb_build_object(
              'masked_email',
              case when u.email is null or position('@' in u.email) = 0 then null
                   else left(u.email, 1) || '***@' || split_part(u.email, '@', 2) end)
            else '{}'::jsonb end
         || case when v_pw then jsonb_build_object('has_password', u.has_pw) else '{}'::jsonb end
    into v_identity
    from (select 1) one
    left join public.profiles p on p.user_id = u.id
    left join public.profile_private pp on pp.user_id = u.id
    left join public.app_presence pr on pr.user_id = u.id
    left join lateral (
      select f.platform as platform, f.app_version as app_version, f.locale as locale
        from public.feedback f
       where f.user_id = u.id
       order by f.created_at desc
       limit 1
    ) fb on true;

  -- devices: fingerprints only, from the person's own felt reports and feedback
  select coalesce(jsonb_agg(d.j order by d.last_seen desc), '[]'::jsonb)
    into v_devices
    from (
      select max(x.ts) as last_seen,
             jsonb_build_object(
               'fingerprint', x.fp,
               'first_seen', min(x.ts),
               'last_seen', max(x.ts),
               'felt_reports', sum(x.rep),
               'feedback', sum(x.fb),
               'platform', max(x.platform)) as j
        from (
          select public.device_fingerprint(fr.device_id) as fp, fr.created_at as ts,
                 1 as rep, 0 as fb, null::text as platform
            from public.felt_reports fr where fr.user_id = p_user_id
          union all
          select public.device_fingerprint(f.device_id), f.created_at, 0, 1, f.platform
            from public.feedback f where f.user_id = p_user_id
        ) x
       group by x.fp
       order by max(x.ts) desc
       limit 20
    ) d;

  -- other identities that used one of the same devices (a reinstall, a second
  -- account on a shared phone). Guests only for callers who may see guests.
  select coalesce(jsonb_agg(s.j order by s.uid), '[]'::jsonb)
    into v_same
    from (
      select distinct on (o.uid) o.uid as uid,
             jsonb_build_object(
               'user_id', o.uid,
               'kind', case when coalesce(ou.is_anonymous, false) then 'guest' else 'account' end,
               'username', op.username,
               'display_name', op.display_name,
               'fingerprint', public.device_fingerprint(o.device_id)) as j
        from (
          select fr2.user_id as uid, fr2.device_id as device_id
            from public.felt_reports fr2
           where fr2.user_id is not null and fr2.user_id <> p_user_id
             and fr2.device_id in (select a.device_id from public.felt_reports a where a.user_id = p_user_id
                                    union select b.device_id from public.feedback b where b.user_id = p_user_id)
          union
          select f2.user_id, f2.device_id
            from public.feedback f2
           where f2.user_id is not null and f2.user_id <> p_user_id
             and f2.device_id in (select a.device_id from public.felt_reports a where a.user_id = p_user_id
                                   union select b.device_id from public.feedback b where b.user_id = p_user_id)
        ) o
        join auth.users ou on ou.id = o.uid
        left join public.profiles op on op.user_id = o.uid
       where (v_guests or not coalesce(ou.is_anonymous, false))
       order by o.uid
       limit 20
    ) s;

  -- counts
  v_counts := jsonb_build_object(
    'felt_reports', (select count(*) from public.felt_reports x where x.user_id = p_user_id),
    'comments', (select count(*) from public.event_comments x where x.user_id = p_user_id),
    'comments_visible', (select count(*) from public.event_comments x
                          where x.user_id = p_user_id and x.status = 'visible'),
    'comments_pending', (select count(*) from public.event_comments x
                          where x.user_id = p_user_id and x.status = 'pending'),
    'comments_hidden', (select count(*) from public.event_comments x
                         where x.user_id = p_user_id and x.status = 'hidden'),
    'comments_removed', (select count(*) from public.event_comments x
                          where x.user_id = p_user_id and x.status = 'removed'),
    'posts', (select count(*) from public.profile_posts x
               where x.user_id = p_user_id and x.status <> 'deleted'),
    'feedback', (select count(*) from public.feedback x where x.user_id = p_user_id),
    'followers', (select count(*) from public.follows x
                   where x.followee_id = p_user_id and x.status = 'accepted'),
    'following', (select count(*) from public.follows x
                   where x.follower_id = p_user_id and x.status = 'accepted'),
    'blocks_made', (select count(*) from public.blocks x where x.blocker_id = p_user_id),
    'blocks_received', (select count(*) from public.blocks x where x.blocked_id = p_user_id),
    'reports_filed',
      (select count(*) from public.profile_reports x where x.reporter_id = p_user_id)
      + (select count(*) from public.post_reports x where x.reporter_id = p_user_id)
      + (select count(*) from public.comment_flags x where x.user_id = p_user_id),
    'reports_received',
      (select count(*) from public.profile_reports x where x.reported_id = p_user_id)
      + (select count(*) from public.post_reports x
           join public.profile_posts po on po.post_id = x.post_id
          where po.user_id = p_user_id),
    'reports_open',
      (select count(*) from public.profile_reports x
        where x.reported_id = p_user_id and x.resolved_at is null)
      + (select count(*) from public.post_reports x
           join public.profile_posts po on po.post_id = x.post_id
          where po.user_id = p_user_id and x.resolved_at is null),
    'homes_owned', (select count(*) from public.home_tags x where x.owner_user_id = p_user_id),
    'homes_member', (select count(*) from public.home_members x
                      where x.user_id = p_user_id and x.role = 'member' and x.status = 'approved'),
    'notes', (select count(*) from public.admin_person_notes x where x.user_id = p_user_id)
  );

  -- small recent lists. Felt reports: time, event and the intensity picked,
  -- never a place. Text: only what the viewer may already read (an author's
  -- own delete is never shown; a removed item only from the evidence copy, and
  -- only with audit.read_all). Feedback: ids and dates, never the message.
  v_recent := jsonb_build_object(
    'felt_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'report_id', r.report_id,
               'created_at', r.created_at,
               'event', e.bumelerze_id,
               'intensity', r.cartoon_level) order by r.created_at desc)
        from (select * from public.felt_reports fr
               where fr.user_id = p_user_id
               order by fr.created_at desc limit 10) r
        left join public.events e on e.event_id = r.event_id), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'comment_id', c.comment_id,
               'created_at', c.created_at,
               'event', e.bumelerze_id,
               'status', c.status,
               'author_deleted', c.author_deleted_at is not null,
               'excerpt', case
                 when c.author_deleted_at is not null then null
                 when c.status = 'removed' then
                   case when v_evidence then
                     (select left(ev.body, 160) from public.moderation_evidence ev
                       where ev.comment_id = c.comment_id)
                   end
                 else left(c.body, 160) end) order by c.created_at desc)
        from (select * from public.event_comments cm
               where cm.user_id = p_user_id
               order by cm.created_at desc limit 10) c
        left join public.events e on e.event_id = c.event_id), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'post_id', po.post_id,
               'created_at', po.created_at,
               'status', po.status,
               'excerpt', case
                 when po.status = 'deleted' then null
                 when po.status = 'removed' then
                   case when v_evidence then
                     (select left(ev.body, 160) from public.moderation_evidence ev
                       where ev.post_id = po.post_id)
                   end
                 else left(po.body, 160) end) order by po.created_at desc)
        from (select * from public.profile_posts pp2
               where pp2.user_id = p_user_id and pp2.status <> 'deleted'
               order by pp2.created_at desc limit 10) po), '[]'::jsonb),
    'feedback', coalesce((
      select jsonb_agg(jsonb_build_object(
               'feedback_id', f.feedback_id,
               'created_at', f.created_at,
               'category', f.category,
               'status', f.status) order by f.created_at desc)
        from (select * from public.feedback fb2
               where fb2.user_id = p_user_id
               order by fb2.created_at desc limit 10) f), '[]'::jsonb)
  );

  -- the person's limits, newest first (the private note and who acted are for
  -- accounts.restrict holders, like Admin > Limited accounts)
  if v_restrict then
    select coalesce(jsonb_agg(jsonb_build_object(
             'restriction_id', r.id,
             'level', r.level,
             'reason', r.reason,
             'note', r.note,
             'starts_at', r.starts_at,
             'ends_at', r.ends_at,
             'created_at', r.created_at,
             'created_by_name', cp.display_name,
             'lifted_at', r.lifted_at,
             'lifted_by_name', lp.display_name,
             'appeal_requested_at', r.appeal_requested_at,
             'active', (r.lifted_at is null and r.starts_at <= now()
                        and (r.ends_at is null or r.ends_at > now()))
           ) order by r.created_at desc), '[]'::jsonb)
      into v_restrictions
      from (select * from public.account_restrictions x
             where x.user_id = p_user_id
             order by x.created_at desc limit 20) r
      left join public.profiles cp on cp.user_id = r.created_by
      left join public.profiles lp on lp.user_id = r.lifted_by;
  else
    v_restrictions := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'identity', v_identity,
    'devices', v_devices,
    'same_device_users', v_same,
    'counts', v_counts,
    'recent', v_recent,
    'restrictions', v_restrictions
  );
end
$$;

-- The full email of one account. Audited every time (email_reveal).
create or replace function public.admin_reveal_email(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null or not public.has_permission(v_uid, 'people.view_email') then
    raise exception 'admin_reveal_email: not_allowed' using errcode = '42501';
  end if;
  select u.email
    into v_email
    from auth.users u
   where u.id = p_user_id;
  if not found then
    raise exception 'admin_reveal_email: not_found' using errcode = 'P0002';
  end if;
  perform public.write_audit(
    v_uid, 'email_reveal', 'account', p_user_id::text,
    p_user_id, null, null, null, null, null
  );
  return v_email;
end
$$;

-- 6. Name and photo reset (impersonation) -----------------------------------------------------
-- display_name goes to a placeholder ("Member 3fa9c1", the profile row needs a
-- name) and/or the photo is removed from the profile. The photo FILE is kept,
-- so that Undo can bring it back; nobody can find its path once the profile no
-- longer points at it. Returns the audit row id (the app's Undo), or null when
-- there was nothing to reset (a replay changes nothing and writes nothing).
create or replace function public.admin_reset_profile_fields(p_user_id uuid, p_fields text[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_fields text[];
  v_placeholder text;
  pr record;
  v_changed text[] := '{}';
  v_snap jsonb := '{}'::jsonb;
  v_log uuid;
begin
  if v_uid is null or not public.has_permission(v_uid, 'accounts.restrict') then
    raise exception 'admin_reset_profile_fields: not_allowed' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct f), '{}'::text[]) into v_fields
    from unnest(coalesce(p_fields, '{}'::text[])) f;
  if cardinality(v_fields) = 0
     or exists (select 1 from unnest(v_fields) f where f not in ('display_name', 'avatar')) then
    raise exception 'admin_reset_profile_fields: invalid_fields' using errcode = '22023';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'admin_reset_profile_fields: not_found' using errcode = 'P0002';
  end if;
  if p_user_id = v_uid then
    raise exception 'admin_reset_profile_fields: self_reset' using errcode = '42501';
  end if;
  if public.holds_admin_permission(p_user_id) then
    raise exception 'admin_reset_profile_fields: protected_account' using errcode = '42501';
  end if;

  select x.display_name as display_name, x.avatar_path as avatar_path
    into pr
    from public.profiles x
   where x.user_id = p_user_id
   for update;
  if not found then
    raise exception 'admin_reset_profile_fields: not_found' using errcode = 'P0002';
  end if;

  v_placeholder := 'Member ' || left(replace(p_user_id::text, '-', ''), 6);
  if 'display_name' = any (v_fields) and pr.display_name is distinct from v_placeholder then
    v_changed := array_append(v_changed, 'display_name');
    v_snap := v_snap || jsonb_build_object('display_name', pr.display_name);
  end if;
  if 'avatar' = any (v_fields) and pr.avatar_path is not null then
    v_changed := array_append(v_changed, 'avatar');
    v_snap := v_snap || jsonb_build_object('avatar_path', pr.avatar_path);
  end if;
  if cardinality(v_changed) = 0 then
    return null;
  end if;

  update public.profiles
     set display_name = case when 'display_name' = any (v_changed) then v_placeholder else display_name end,
         avatar_path = case when 'avatar' = any (v_changed) then null else avatar_path end
   where user_id = p_user_id;

  v_log := public.write_audit(
    v_uid, 'profile_reset', 'profile', p_user_id::text,
    p_user_id, null, null, null, null,
    v_snap || jsonb_build_object('fields', to_jsonb(v_changed))
  );
  return v_log;
end
$$;

-- 0054's dispatcher plus the profile_reset branch: a field is put back only if
-- the person has not changed it since (name still the placeholder, photo still
-- empty).
create or replace function public.admin_undo_action(p_log_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  l record;
  pr record;
  v_latest uuid;
  v_expected text;
  v_current text;
  v_role text;
  v_granted_by uuid;
  v_new uuid;
  v_rid uuid;
  v_placeholder text;
  v_back text[] := '{}';
begin
  if v_uid is null then
    raise exception 'admin_undo_action: not allowed' using errcode = '42501';
  end if;
  select x.log_id as log_id, x.action as action, x.reverted_by as reverted_by,
         x.comment_id as comment_id, x.post_id as post_id,
         x.target_user_id as target_user_id, x.snapshot as snapshot
    into l
    from public.moderation_log x
   where x.log_id = p_log_id
   for update;
  if not found then
    raise exception 'admin_undo_action: not_found' using errcode = 'P0002';
  end if;
  if l.reverted_by is not null then
    return;
  end if;

  if l.action in ('comment_hide', 'comment_remove') then
    if l.comment_id is null then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    select x.log_id into v_latest
      from public.moderation_log x
     where x.comment_id = l.comment_id and x.action = l.action and x.reverted_by is null
     order by x.created_at desc, x.log_id desc
     limit 1;
    v_expected := case when l.action = 'comment_hide' then 'hidden' else 'removed' end;
    select cm.status into v_current
      from public.event_comments cm
     where cm.comment_id = l.comment_id;
    if v_latest is distinct from l.log_id or v_current is distinct from v_expected then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    perform public.admin_restore_comment(l.comment_id, p_note);
  elsif l.action = 'post_remove' then
    if l.post_id is null then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    select x.log_id into v_latest
      from public.moderation_log x
     where x.post_id = l.post_id and x.action = 'post_remove' and x.reverted_by is null
     order by x.created_at desc, x.log_id desc
     limit 1;
    if v_latest is distinct from l.log_id then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    perform public.admin_restore_post(l.post_id, p_note);
  elsif l.action in ('profile_reports_resolve', 'post_reports_dismiss') then
    perform public.admin_reopen_reports(l.log_id, p_note);
  elsif l.action in ('restrict', 'suspend') then
    v_rid := nullif(l.snapshot ->> 'restriction_id', '')::uuid;
    if v_rid is null or not exists (
      select 1 from public.account_restrictions x
       where x.id = v_rid
         and x.lifted_at is null
         and (x.ends_at is null or x.ends_at > now())
    ) then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    perform public.admin_lift_restriction(v_rid, p_note);
  elsif l.action = 'profile_reset' then
    if not public.has_permission(v_uid, 'accounts.restrict') then
      raise exception 'admin_undo_action: not allowed' using errcode = '42501';
    end if;
    if l.target_user_id is null then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    select x.display_name as display_name, x.avatar_path as avatar_path
      into pr
      from public.profiles x
     where x.user_id = l.target_user_id
     for update;
    if not found then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    v_placeholder := 'Member ' || left(replace(l.target_user_id::text, '-', ''), 6);
    if l.snapshot ->> 'display_name' is not null and pr.display_name = v_placeholder then
      v_back := array_append(v_back, 'display_name');
    end if;
    if l.snapshot ->> 'avatar_path' is not null and pr.avatar_path is null then
      v_back := array_append(v_back, 'avatar');
    end if;
    if cardinality(v_back) = 0 then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    update public.profiles
       set display_name = case when 'display_name' = any (v_back)
                               then l.snapshot ->> 'display_name' else display_name end,
           avatar_path = case when 'avatar' = any (v_back)
                              then l.snapshot ->> 'avatar_path' else avatar_path end
     where user_id = l.target_user_id;
    v_new := public.write_audit(
      v_uid, 'profile_restore', 'profile', l.target_user_id::text,
      l.target_user_id, null, null, null, p_note,
      jsonb_build_object('fields', to_jsonb(v_back), 'undid', l.log_id)
    );
    update public.moderation_log set reverted_by = v_new where log_id = l.log_id;
  elsif l.action = 'role_revoke' then
    if not public.has_permission(v_uid, 'badges.grant') then
      raise exception 'admin_undo_action: not allowed' using errcode = '42501';
    end if;
    v_role := l.snapshot ->> 'role';
    if l.target_user_id is null
       or v_role is null
       or v_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner')
       or not exists (select 1 from auth.users u where u.id = l.target_user_id)
       or exists (
         select 1 from public.user_roles r
          where r.user_id = l.target_user_id and r.role = v_role
       ) then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    v_granted_by := nullif(l.snapshot ->> 'granted_by', '')::uuid;
    if v_granted_by is null or not exists (select 1 from auth.users u where u.id = v_granted_by) then
      v_granted_by := v_uid;
    end if;
    insert into public.user_roles (user_id, role, org_name, granted_by, granted_at, note)
    values (
      l.target_user_id, v_role, l.snapshot ->> 'org_name', v_granted_by,
      coalesce((l.snapshot ->> 'granted_at')::timestamptz, now()), l.snapshot ->> 'note'
    );
    v_new := public.write_audit(
      v_uid, 'role_restore', 'rank', l.target_user_id::text,
      l.target_user_id, null, null, v_role, p_note,
      jsonb_build_object('role', v_role, 'undid', l.log_id)
    );
    update public.moderation_log set reverted_by = v_new where log_id = l.log_id;
  else
    raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
  end if;
end
$$;

-- 7. Private notes -----------------------------------------------------------------------------
-- Adding the same text again within a minute returns the first note (a double
-- tap or a replay adds nothing).
create or replace function public.admin_add_person_note(p_user_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_guest boolean;
  v_id uuid;
begin
  if v_uid is null or not public.has_permission(v_uid, 'people.view') then
    raise exception 'admin_add_person_note: not_allowed' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'admin_add_person_note: invalid_body' using errcode = '22023';
  end if;
  select coalesce(u.is_anonymous, false) into v_guest from auth.users u where u.id = p_user_id;
  if not found or (v_guest and not public.has_permission(v_uid, 'people.view_guests')) then
    raise exception 'admin_add_person_note: not_found' using errcode = 'P0002';
  end if;
  select n.id into v_id
    from public.admin_person_notes n
   where n.user_id = p_user_id and n.author_id = v_uid and n.body = v_body
     and n.created_at > now() - interval '1 minute'
   order by n.created_at desc
   limit 1;
  if found then
    return v_id;
  end if;
  insert into public.admin_person_notes (user_id, author_id, body)
  values (p_user_id, v_uid, v_body)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.admin_person_notes(p_user_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_guest boolean;
begin
  if v_uid is null or not public.has_permission(v_uid, 'people.view') then
    raise exception 'admin_person_notes: not_allowed' using errcode = '42501';
  end if;
  select coalesce(u.is_anonymous, false) into v_guest from auth.users u where u.id = p_user_id;
  if not found or (v_guest and not public.has_permission(v_uid, 'people.view_guests')) then
    raise exception 'admin_person_notes: not_found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id,
             'body', n.body,
             'created_at', n.created_at,
             'author_id', n.author_id,
             'author_name', ap.display_name) order by n.created_at desc, n.id)
      from (select * from public.admin_person_notes x
             where x.user_id = p_user_id
             order by x.created_at desc, x.id
             limit least(greatest(coalesce(p_limit, 50), 1), 100)) n
      left join public.profiles ap on ap.user_id = n.author_id
  ), '[]'::jsonb);
end
$$;

-- 8. Numbers ---------------------------------------------------------------------------------
-- Counts only, no personal data. Guest numbers are null without
-- people.view_guests; platform, presence and restricted numbers then cover
-- accounts only. "Active" comes from app_presence, which only exists since
-- this migration: presence_since is when the first row was written, anything
-- before it is unknown (not zero).
create or replace function public.admin_people_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_guests boolean;
  v_out jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'people.view') then
    raise exception 'admin_people_stats: not_allowed' using errcode = '42501';
  end if;
  v_guests := public.has_permission(v_uid, 'people.view_guests');

  with usr as (
    select u.id as uid,
           coalesce(u.is_anonymous, false) as guest,
           case when coalesce(u.is_anonymous, false) then u.created_at
                else coalesce(p.created_at, u.created_at) end as joined_at,
           pr.last_seen as seen_at,
           pr.platform as platform
      from auth.users u
      left join public.profiles p on p.user_id = u.id
      left join public.app_presence pr on pr.user_id = u.id
     where v_guests or not coalesce(u.is_anonymous, false)
  )
  select jsonb_build_object(
    'accounts_total', (select count(*) from usr where not guest),
    'guests_total', case when v_guests
      then (select count(*) from usr where guest and public.guest_has_activity(uid)) end,
    'new_accounts_7d', (select count(*) from usr
                         where not guest and joined_at >= now() - interval '7 days'),
    'new_accounts_30d', (select count(*) from usr
                          where not guest and joined_at >= now() - interval '30 days'),
    'active_accounts_7d', (select count(*) from usr
                            where not guest and seen_at >= now() - interval '7 days'),
    'active_accounts_30d', (select count(*) from usr
                             where not guest and seen_at >= now() - interval '30 days'),
    'active_guests_7d', case when v_guests
      then (select count(*) from usr where guest and seen_at >= now() - interval '7 days') end,
    'active_guests_30d', case when v_guests
      then (select count(*) from usr where guest and seen_at >= now() - interval '30 days') end,
    'presence_since', (select min(first_seen) from public.app_presence),
    'restricted', (select count(*) from usr
                    where public.is_restricted(uid) and not public.is_suspended(uid)),
    'suspended', (select count(*) from usr where public.is_suspended(uid)),
    'platforms', jsonb_build_object(
      'ios', (select count(*) from usr where platform = 'ios'),
      'android', (select count(*) from usr where platform = 'android'),
      'web', (select count(*) from usr where platform = 'web'))
  )
  into v_out;
  return v_out;
end
$$;

-- Grants -------------------------------------------------------------------------------------------
revoke all on function public.device_fingerprint(text) from public, anon, authenticated;
revoke all on function public.people_like_escape(text) from public, anon, authenticated;
revoke all on function public.is_content_audit_action(text) from public, anon;
revoke all on function public.touch_presence(text, text, text) from public, anon;
revoke all on function public.admin_people_search(text, text, jsonb, text, jsonb, integer) from public, anon;
revoke all on function public.admin_person(uuid) from public, anon;
revoke all on function public.admin_reveal_email(uuid) from public, anon;
revoke all on function public.admin_reset_profile_fields(uuid, text[]) from public, anon;
revoke all on function public.admin_undo_action(uuid, text) from public, anon;
revoke all on function public.admin_add_person_note(uuid, text) from public, anon;
revoke all on function public.admin_person_notes(uuid, integer) from public, anon;
revoke all on function public.admin_people_stats() from public, anon;
revoke all on function public.guest_has_activity(uuid) from public, anon, authenticated;

grant execute on function public.is_content_audit_action(text) to authenticated;
grant execute on function public.touch_presence(text, text, text) to authenticated;
grant execute on function public.admin_people_search(text, text, jsonb, text, jsonb, integer) to authenticated;
grant execute on function public.admin_person(uuid) to authenticated;
grant execute on function public.admin_reveal_email(uuid) to authenticated;
grant execute on function public.admin_reset_profile_fields(uuid, text[]) to authenticated;
grant execute on function public.admin_undo_action(uuid, text) to authenticated;
grant execute on function public.admin_add_person_note(uuid, text) to authenticated;
grant execute on function public.admin_person_notes(uuid, integer) to authenticated;
grant execute on function public.admin_people_stats() to authenticated;
