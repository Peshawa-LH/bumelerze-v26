-- 0056: social + admin P1, batch 5 (account deletion, report reasons, guidelines).
-- Review: social-admin-review-2026-10-08 (S4, S11, section 4e, P1-3, P1-10,
-- P1-11), decisions D77, D78 (a deleted account's public comments are blanked,
-- felt reports stay as research data per the consent, evidence is kept 90 days)
-- and D79.
--
--   1. P1-3 Delete my account, completed:
--        * the homes the person owns are deleted (exact coordinates, answers,
--          photo rows, members), as delete_home_tag() does; the photo FILES
--          are removed by the app first, because Supabase does not let SQL
--          delete storage objects
--        * every comment of the person is blanked: the text and the area are
--          wiped, the author link goes, account_deleted_at marks it, and a
--          visible comment stays visible as an empty row so replies keep their
--          place (the app shows "Deleted account"). A comment that was
--          waiting, hidden or flagged becomes a hidden, author-deleted blank
--          and its flags are settled, so nothing empty reaches the review
--          queue
--        * feedback keeps the message for the inbox, unlinked, and loses the
--          contact (email or phone) the person typed
--        * old felt-report comments (felt_comments, public once approved) are
--          deleted
--        * felt reports STAY, unlinked from the user id (the research consent
--          says: used without my name). Nothing else about them changes
--        * moderation_evidence copies of the person's removed text are purged
--          now, UNLESS a restriction or an appeal is still active: then they
--          stay until their own 90-day expiry (the nightly job removes them)
--          and are no longer linked to anybody
--        * audit rows (moderation_log) stay, unlinked; the before-image of a
--          name or photo reset is dropped from them
--        * the Event hub's comment count (event_hub_summary) does not count
--          blanked comments
--        * everything else cascades or is removed explicitly (the list is
--          pinned by supabase/migrations/__tests__ so a new table cannot be
--          forgotten)
--   2. P1-10 One report reason list for comments, posts and profiles:
--      spam, abuse_harassment, rumour_prediction, private_info, sexual_violent,
--      impersonation (profiles only), other, plus an optional note of at most
--      200 characters. The earlier words (abuse, false, private) are still
--      accepted and stored as their new names, so an app that has not updated
--      keeps working; old rows are renamed. comment_flags, profile_reports and
--      post_reports get a note column; the three admin queues return the last
--      reason and note. The batch-1 limits (20 reports a day for profiles and
--      posts, 30 flags a day, guests do not count toward auto-hide) are kept.
--   3. P1-11 Community guidelines before a first comment or post:
--      guidelines_acceptance (one row per identity, guest or account, keyed on
--      the auth user id so an upgrade of a guest into an account keeps it),
--      current_guidelines_version(), accept_guidelines() (also records "I am 13
--      or older"), and the refusal guidelines_required in the comment and post
--      insert triggers. Accounts that accepted the terms before, and every rank
--      holder, are backfilled as accepted (source backfill).
--
-- Error tokens (message text, the app maps them): guidelines_required
-- (SQLSTATE 42501), age_required, version_mismatch, not_signed_in,
-- invalid_reason (22023), plus the existing ones.
--
-- Needs 0035 to 0055 (0037 and 0049 for homes, 0053 for evidence, 0054 for
-- restrictions). Idempotent: safe to run twice. Written for the SQL editor as
-- one line: no transaction statements, only full-line comments, ASCII only.

-- 1. One list of report reasons ---------------------------------------------------------
-- Maps the earlier words to the new ones; null for anything unknown. Internal.
create or replace function public.normalize_report_reason(p_reason text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_reason
    when 'spam' then 'spam'
    when 'abuse' then 'abuse_harassment'
    when 'abuse_harassment' then 'abuse_harassment'
    when 'false' then 'rumour_prediction'
    when 'rumour_prediction' then 'rumour_prediction'
    when 'private' then 'private_info'
    when 'private_info' then 'private_info'
    when 'sexual_violent' then 'sexual_violent'
    when 'impersonation' then 'impersonation'
    when 'other' then 'other'
    else null
  end
$$;

-- The optional note: trimmed, empty becomes null, at most 200 characters.
create or replace function public.normalize_report_note(p_note text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(left(btrim(coalesce(p_note, '')), 200), '')
$$;

alter table public.comment_flags add column if not exists note text;
alter table public.profile_reports add column if not exists note text;
alter table public.post_reports add column if not exists note text;

-- Old rows first take the new names, then the checks are replaced. The reason
-- checks are dropped by shape, not by name, so a differently named one cannot
-- linger.
do $$
declare
  t text;
  c record;
begin
  foreach t in array array['comment_flags', 'profile_reports', 'post_reports'] loop
    for c in
      select conname
        from pg_constraint
       where conrelid = ('public.' || t)::regclass
         and contype = 'c'
         and pg_get_constraintdef(oid) like '%reason%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
  end loop;
end
$$;

update public.comment_flags
   set reason = public.normalize_report_reason(reason)
 where reason is not null and reason is distinct from public.normalize_report_reason(reason);
update public.profile_reports
   set reason = public.normalize_report_reason(reason)
 where reason is distinct from public.normalize_report_reason(reason);
update public.post_reports
   set reason = public.normalize_report_reason(reason)
 where reason is distinct from public.normalize_report_reason(reason);

alter table public.comment_flags drop constraint if exists comment_flags_reason_check;
alter table public.comment_flags
  add constraint comment_flags_reason_check
  check (reason is null or reason in (
    'spam', 'abuse_harassment', 'rumour_prediction', 'private_info', 'sexual_violent', 'other'
  ));
alter table public.comment_flags drop constraint if exists comment_flags_note_check;
alter table public.comment_flags
  add constraint comment_flags_note_check check (note is null or char_length(note) <= 200);

alter table public.profile_reports drop constraint if exists profile_reports_reason_check;
alter table public.profile_reports
  add constraint profile_reports_reason_check
  check (reason in (
    'spam', 'abuse_harassment', 'rumour_prediction', 'private_info', 'sexual_violent',
    'impersonation', 'other'
  ));
alter table public.profile_reports drop constraint if exists profile_reports_note_check;
alter table public.profile_reports
  add constraint profile_reports_note_check check (note is null or char_length(note) <= 200);

alter table public.post_reports drop constraint if exists post_reports_reason_check;
alter table public.post_reports
  add constraint post_reports_reason_check
  check (reason in (
    'spam', 'abuse_harassment', 'rumour_prediction', 'private_info', 'sexual_violent', 'other'
  ));
alter table public.post_reports drop constraint if exists post_reports_note_check;
alter table public.post_reports
  add constraint post_reports_note_check check (note is null or char_length(note) <= 200);

-- Reporting a comment: 0054's trigger plus the reason and the note. A report
-- needs a valid reason now (the earlier words are renamed on the way in). The
-- limit of 30 a day and "guests do not count" are unchanged.
create or replace function public.comment_flags_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anonymous boolean;
  v_recent integer;
begin
  perform public.assert_not_restricted(new.user_id, 'comment_flags');
  new.reason := public.normalize_report_reason(new.reason);
  if new.reason is null or new.reason = 'impersonation' then
    raise exception 'comment_flags: invalid_reason' using errcode = '22023';
  end if;
  new.note := public.normalize_report_note(new.note);
  new.created_at := now();
  new.settled := false;
  new.withdrawn_at := null;
  select coalesce(u.is_anonymous, true) into v_anonymous
    from auth.users u where u.id = new.user_id;
  new.counts := not coalesce(v_anonymous, true);
  select count(*) into v_recent
    from public.comment_flags f
   where f.user_id = new.user_id and f.created_at > now() - interval '24 hours';
  if v_recent >= 30 then
    raise exception 'comment_flags: flag_limit' using errcode = '54000';
  end if;
  return new;
end
$$;

-- Reporting a profile (0054 plus the new list and the note). The old
-- two-argument version is dropped, the note argument has a default, so an app
-- that sends only the reason still works.
drop function if exists public.report_profile(uuid, text);
create or replace function public.report_profile(p_user uuid, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := public.normalize_report_reason(p_reason);
begin
  if v_uid is null then
    raise exception 'report_profile: not_account' using errcode = '42501';
  end if;
  perform public.assert_not_restricted(v_uid, 'report_profile');
  if p_user is null or p_user = v_uid or v_reason is null then
    raise exception 'report_profile: not_found' using errcode = '22023';
  end if;
  if (select count(*) from public.profile_reports r
       where r.reporter_id = v_uid and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'report_profile: rate_limited' using errcode = '54000';
  end if;
  insert into public.profile_reports (reporter_id, reported_id, reason, note)
  values (v_uid, p_user, v_reason, public.normalize_report_note(p_note))
  on conflict (reporter_id, reported_id) do update
    set reason = excluded.reason, note = excluded.note, created_at = now(), resolved_at = null;
end
$$;

-- Reporting a post (0054 plus the new list and the note). Impersonation is for
-- profiles only.
drop function if exists public.report_post(uuid, text);
create or replace function public.report_post(p_post uuid, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := public.normalize_report_reason(p_reason);
  v_author uuid;
begin
  if v_uid is null then
    raise exception 'report_post: not_account' using errcode = '42501';
  end if;
  perform public.assert_not_restricted(v_uid, 'report_post');
  if p_post is null or v_reason is null or v_reason = 'impersonation' then
    raise exception 'report_post: not_found' using errcode = '22023';
  end if;
  select po.user_id into v_author
    from public.profile_posts po
   where po.post_id = p_post and po.status = 'visible';
  if not found or v_author = v_uid or not public.can_view_posts_of(v_author) then
    raise exception 'report_post: not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.post_reports r
       where r.reporter_id = v_uid and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'report_post: rate_limited' using errcode = '54000';
  end if;
  insert into public.post_reports (post_id, reporter_id, reason, note)
  values (p_post, v_uid, v_reason, public.normalize_report_note(p_note))
  on conflict (post_id, reporter_id) do update
    set reason = excluded.reason, note = excluded.note, created_at = now(), resolved_at = null;
end
$$;

-- The three admin queues now also return the last open reason and its note.
-- The return shape changes, so they are dropped and created again (0044, 0050
-- and 0047 are the earlier versions; the rules are the same).
drop function if exists public.moderation_queue(integer);
create or replace function public.moderation_queue(p_limit integer default 50)
returns table (
  comment_id uuid,
  event_id uuid,
  hub_id text,
  parent_id uuid,
  author_id uuid,
  author_name text,
  body text,
  status text,
  flag_count integer,
  created_at timestamptz,
  last_reason text,
  last_note text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'moderation_queue: moderators only' using errcode = '42501';
  end if;
  return query
    select c.comment_id, c.event_id, e.bumelerze_id, c.parent_id, c.user_id,
           p.display_name, c.body, c.status, c.flag_count, c.created_at,
           lf.reason, lf.note
      from public.event_comments c
      join public.events e on e.event_id = c.event_id
      left join public.profiles p on p.user_id = c.user_id
      left join lateral (
        select f.reason, f.note
          from public.comment_flags f
         where f.comment_id = c.comment_id
           and not f.settled
           and f.withdrawn_at is null
         order by f.created_at desc
         limit 1
      ) lf on true
     where c.status = 'pending'
        or (c.status = 'visible' and c.flag_count > 0)
     order by (c.status = 'pending') desc, c.flag_count desc, c.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

drop function if exists public.post_queue(integer);
create or replace function public.post_queue(p_limit integer default 50)
returns table (
  post_id uuid,
  author_id uuid,
  username text,
  display_name text,
  body text,
  report_count integer,
  last_reason text,
  last_reported_at timestamptz,
  created_at timestamptz,
  last_note text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'post_queue: moderators only' using errcode = '42501';
  end if;
  return query
    select po.post_id, po.user_id, pr.username, pr.display_name, po.body,
           count(*)::integer,
           (array_agg(r.reason order by r.created_at desc))[1],
           max(r.created_at),
           po.created_at,
           (array_agg(r.note order by r.created_at desc))[1]
      from public.post_reports r
      join public.profile_posts po on po.post_id = r.post_id
      left join public.profiles pr on pr.user_id = po.user_id
     where r.resolved_at is null
       and po.status = 'visible'
     group by po.post_id, po.user_id, pr.username, pr.display_name, po.body, po.created_at
     order by count(*) desc, max(r.created_at) desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

drop function if exists public.moderation_profile_reports();
create or replace function public.moderation_profile_reports()
returns table (
  reported_id uuid,
  username text,
  display_name text,
  report_count integer,
  last_reason text,
  last_reported_at timestamptz,
  last_note text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'moderation_profile_reports: moderators only' using errcode = '42501';
  end if;
  return query
    select r.reported_id, p.username, p.display_name, count(*)::integer,
           (array_agg(r.reason order by r.created_at desc))[1],
           max(r.created_at),
           (array_agg(r.note order by r.created_at desc))[1]
      from public.profile_reports r
      left join public.profiles p on p.user_id = r.reported_id
     where r.resolved_at is null
     group by r.reported_id, p.username, p.display_name
     order by count(*) desc, max(r.created_at) desc
     limit 100;
end
$$;

-- 2. Guidelines accepted before a first comment or post --------------------------------
-- One row per identity. The key is the auth user id, so a guest who later
-- creates an account (the same user, upgraded in place) keeps the acceptance.
-- A client reads its own row and can write nothing directly: accept_guidelines()
-- is the only way in. age_confirmed is true when the person ticked "I am 13 or
-- older"; a backfilled row (people who accepted the terms before this existed)
-- is false and says so in source.
create table if not exists public.guidelines_acceptance (
  user_id uuid primary key references auth.users (id) on delete cascade,
  version text not null check (char_length(version) between 1 and 20),
  age_confirmed boolean not null default false,
  source text not null default 'prompt' check (source in ('prompt', 'signup', 'settings', 'backfill')),
  accepted_at timestamptz not null default now()
);
alter table public.guidelines_acceptance enable row level security;
drop policy if exists guidelines_acceptance_read_own on public.guidelines_acceptance;
create policy guidelines_acceptance_read_own on public.guidelines_acceptance
  for select to authenticated using (user_id = auth.uid());
revoke all on public.guidelines_acceptance from anon, authenticated;
grant select (user_id, version, age_confirmed, accepted_at)
  on public.guidelines_acceptance to authenticated;

-- The version people must have accepted. Change the text, then change this in a
-- later migration: everybody is asked once more before their next comment.
create or replace function public.current_guidelines_version()
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select 'g1'::text
$$;

-- Internal: has this identity accepted the current version.
create or replace function public.guidelines_accepted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null
     and exists (
       select 1
         from public.guidelines_acceptance g
        where g.user_id = p_user
          and g.version = public.current_guidelines_version()
     )
$$;

-- The guard the comment and post triggers call. Writes made without a client
-- session (the SQL editor, a service job) are not asked.
create or replace function public.assert_guidelines_accepted(p_user uuid, p_where text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.guidelines_accepted(p_user) then
    raise exception '%: guidelines_required', p_where using errcode = '42501';
  end if;
end
$$;

-- "I agree" (and "I am 13 or older"). Guests and accounts alike; a repeat call
-- for the same version changes nothing, so the first time stays on record.
create or replace function public.accept_guidelines(
  p_version text,
  p_age_ok boolean,
  p_source text default 'prompt'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_source text := case when p_source in ('prompt', 'signup', 'settings') then p_source else 'prompt' end;
begin
  if v_uid is null then
    raise exception 'accept_guidelines: not_signed_in' using errcode = '42501';
  end if;
  if p_age_ok is not true then
    raise exception 'accept_guidelines: age_required' using errcode = '22023';
  end if;
  if p_version is distinct from public.current_guidelines_version() then
    raise exception 'accept_guidelines: version_mismatch' using errcode = '22023';
  end if;
  insert into public.guidelines_acceptance (user_id, version, age_confirmed, source, accepted_at)
  values (v_uid, p_version, true, v_source, now())
  on conflict (user_id) do update
    set version = excluded.version,
        age_confirmed = true,
        source = excluded.source,
        accepted_at = now()
    where public.guidelines_acceptance.version is distinct from excluded.version
       or not public.guidelines_acceptance.age_confirmed;
end
$$;

-- Everybody who accepted the terms when making an account, and every rank
-- holder, counts as having accepted the first version.
insert into public.guidelines_acceptance (user_id, version, age_confirmed, source)
select pp.user_id, public.current_guidelines_version(), false, 'backfill'
  from public.profile_private pp
 where pp.terms_accepted_at is not null
   and exists (select 1 from auth.users u where u.id = pp.user_id)
on conflict (user_id) do nothing;
insert into public.guidelines_acceptance (user_id, version, age_confirmed, source)
select ur.user_id, public.current_guidelines_version(), false, 'backfill'
  from public.user_roles ur
 where exists (select 1 from auth.users u where u.id = ur.user_id)
on conflict (user_id) do nothing;

-- A comment (0054's trigger plus the guidelines guard and the new column).
alter table public.event_comments add column if not exists account_deleted_at timestamptz;
alter table public.event_comments drop constraint if exists event_comments_body_check;
alter table public.event_comments
  add constraint event_comments_body_check
  check (
    status = 'removed'
    or author_deleted_at is not null
    or account_deleted_at is not null
    or char_length(btrim(body)) between 1 and 1000
  );

create or replace function public.event_comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anonymous boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true);
  v_recent integer;
  v_parent record;
begin
  perform public.assert_not_restricted(new.user_id, 'event_comments');
  perform public.assert_guidelines_accepted(new.user_id, 'event_comments');
  new.created_at := now();
  new.updated_at := now();
  new.helpful_count := 0;
  new.reply_count := 0;
  new.flag_count := 0;
  new.hidden_reason := null;
  new.author_deleted_at := null;
  new.account_deleted_at := null;
  new.status := case when v_anonymous then 'pending' else 'visible' end;
  new.body := btrim(new.body);

  if new.parent_id is not null then
    select parent_id, event_id into v_parent from public.event_comments where comment_id = new.parent_id;
    if not found or v_parent.event_id <> new.event_id then
      raise exception 'event_comments: reply target not found' using errcode = '22023';
    end if;
    if v_parent.parent_id is not null then
      new.parent_id := v_parent.parent_id;
    end if;
  end if;

  select count(*) into v_recent from public.event_comments
  where user_id = new.user_id and created_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    raise exception 'event_comments: too many comments, try again in a few minutes' using errcode = '54000';
  end if;

  select fr.geohash_p5 into new.area_geohash
  from public.felt_reports fr
  where fr.user_id = new.user_id and fr.event_id = new.event_id
  order by fr.created_at desc
  limit 1;

  return new;
end
$$;

-- A profile post: create (0054's trigger plus the guidelines guard).
create or replace function public.profile_posts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent integer;
begin
  perform public.assert_not_restricted(new.user_id, 'profile_posts');
  perform public.assert_guidelines_accepted(new.user_id, 'profile_posts');
  new.body := btrim(new.body);
  new.status := 'visible';
  new.created_at := now();
  new.updated_at := now();
  new.removed_by := null;
  new.removed_reason := null;
  select count(*) into v_recent
    from public.profile_posts p
   where p.user_id = new.user_id and p.created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'profile_posts: rate_limited' using errcode = '54000';
  end if;
  return new;
end
$$;

-- 3. Delete my account, completed ---------------------------------------------------------
-- 0036's function plus everything listed in the header. One transaction (a
-- function body is one). The app removes the avatar and the owned homes' photo
-- files before it calls this.
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
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'delete_my_account: no account to delete' using errcode = '42501';
  end if;

  -- Homes the person owns: gone with their members, answers, assessments and
  -- photo rows (all cascade from home_tags). A building complex left without
  -- any home goes too, as in delete_home_tag().
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

  -- Their comments are blanked. A visible one stays visible and empty (replies
  -- keep their place); one that was waiting, hidden or flagged becomes a
  -- hidden, author-deleted blank, and the flags on any of them are settled.
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

  -- Evidence copies of what an admin removed from them: purged now, unless a
  -- restriction or an appeal is still active; then they wait for their own
  -- 90-day expiry (the nightly job) and no longer point at anybody.
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

  -- Audit rows stay (unlinked by the foreign keys); the before-image of a name
  -- or photo reset holds the old name, so it goes.
  update public.moderation_log
     set snapshot = null
   where target_user_id = v_uid and action = 'profile_reset' and snapshot is not null;

  -- Research data stays unlinked, as the consent says; feedback keeps its
  -- message for the inbox without the contact the person typed.
  update public.felt_reports set user_id = null where user_id = v_uid;
  update public.feedback set user_id = null, contact = null where user_id = v_uid;
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

-- 4. The felt summary does not count blanked comments (0054's function plus one condition).
create or replace function public.event_hub_summary(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'reports', (select count(*) from public.felt_reports where event_id = p_event_id),
    'people', (select count(distinct coalesce(user_id::text, device_id)) from public.felt_reports where event_id = p_event_id),
    'levels', coalesce((
      select jsonb_object_agg(cartoon_level::text, n) from (
        select cartoon_level, count(*) as n from public.felt_reports
        where event_id = p_event_id group by cartoon_level
      ) l
    ), '{}'::jsonb),
    'first_report_at', (select min(created_at) from public.felt_reports where event_id = p_event_id),
    'comments', (select count(*) from public.event_comments c
                  where c.event_id = p_event_id and c.status = 'visible'
                    and c.account_deleted_at is null
                    and not public.is_suspended(c.user_id)),
    'featured', coalesce((select hub_featured from public.events where event_id = p_event_id), false)
  )
$$;

-- 5. Who may call what ------------------------------------------------------------------------
revoke all on function public.normalize_report_reason(text) from public, anon, authenticated;
revoke all on function public.normalize_report_note(text) from public, anon, authenticated;
revoke all on function public.guidelines_accepted(uuid) from public, anon, authenticated;
revoke all on function public.assert_guidelines_accepted(uuid, text) from public, anon, authenticated;
revoke all on function public.comment_flags_before_insert() from public, anon, authenticated;
revoke all on function public.event_comments_before_insert() from public, anon, authenticated;
revoke all on function public.profile_posts_before_insert() from public, anon, authenticated;
revoke all on function public.current_guidelines_version() from public;
revoke all on function public.accept_guidelines(text, boolean, text) from public, anon;
revoke all on function public.report_profile(uuid, text, text) from public, anon;
revoke all on function public.report_post(uuid, text, text) from public, anon;
revoke all on function public.moderation_queue(integer) from public, anon;
revoke all on function public.post_queue(integer) from public, anon;
revoke all on function public.moderation_profile_reports() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.event_hub_summary(uuid) from public;
grant execute on function public.event_hub_summary(uuid) to anon, authenticated;
grant execute on function public.current_guidelines_version() to anon, authenticated;
grant execute on function public.accept_guidelines(text, boolean, text) to authenticated;
grant execute on function public.report_profile(uuid, text, text) to authenticated;
grant execute on function public.report_post(uuid, text, text) to authenticated;
grant execute on function public.moderation_queue(integer) to authenticated;
grant execute on function public.post_queue(integer) to authenticated;
grant execute on function public.moderation_profile_reports() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
