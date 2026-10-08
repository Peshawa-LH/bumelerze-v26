-- 0052: social + admin P1, batch 1 (security fixes and audit log v2).
-- Review: social-admin-review-2026-10-08 (S1, S2, S3, S5, S6, S7, P1-1, P1-2,
-- P1-4, P1-7), decision D78.
--
--   1. helpers: my_has_permission(), audit_actor_rank(), write_audit()
--   2. S1 flag brigading: flags from anonymous installs are kept but do not
--      count toward the 3-flag auto-hide; a rank holder's comment is never
--      auto-hidden (it stays visible and waits in the review queue as
--      "flagged"); 30 flags per person per 24 hours (error token flag_limit,
--      SQLSTATE 54000); withdraw_comment_flag()
--   3. S2/S3 a deleted comment stays deleted: author_deleted_at, moderators
--      cannot approve, hide or remove it or read its text, the text is wiped
--      30 days after the author deleted it (nightly pg_cron job)
--   4. S5/S6 profile hardening: reserved names also for display names (case,
--      diacritics, spaces and dots, Arabic-script variants), user_id and
--      created_at immutable, avatar_path must lie in the owner's own folder
--   5. P1-7 audit log v2: moderation_log gains target_type, target_id,
--      actor_rank, snapshot, reverted_by and note; append-only for every API
--      role; permissions audit.read (content actions) and audit.read_all
--      (everything); every admin RPC writes the new fields; admin_activity()
--   6. S7 has_permission() and is_moderator() stop being callable by clients
--      (policies use my_has_permission()); skipped with a notice if some other
--      policy still depends on them
--
-- Needs 0035, 0036, 0043, 0044, 0045, 0046, 0047, 0050 and 0051.
-- Idempotent: safe to run twice. Written for the SQL editor as one line: no
-- transaction statements, only full-line comments, ASCII only (non-ASCII
-- letters are U& escapes).

-- 1. Helpers --------------------------------------------------------------------
-- "Do I hold this permission": the only permission check clients can run. It
-- answers for the caller (auth.uid()) and nobody else.
create or replace function public.my_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select public.has_permission(auth.uid(), p_permission)
$$;

-- The highest rank a person holds, as text (null for none).
create or replace function public.audit_actor_rank(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select r.role
    from public.user_roles r
   where r.user_id = p_user
   order by array_position(
              array['official', 'moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner'],
              r.role)
   limit 1
$$;

-- Content actions: what a moderator may read in the activity log.
create or replace function public.is_content_audit_action(p_action text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_action ~ '^(comment|post|report)_' or p_action = 'profile_reports_resolve'
$$;

-- 2. Permissions -----------------------------------------------------------------
-- audit.read: the activity log, content actions only (moderators).
-- audit.read_all: every action (official).
insert into public.role_permissions (role, permission) values
  ('official', 'audit.read'),
  ('official', 'audit.read_all'),
  ('moderator', 'audit.read')
on conflict do nothing;

-- 3. Audit log v2: the table ---------------------------------------------------------
alter table public.moderation_log add column if not exists target_type text;
alter table public.moderation_log add column if not exists target_id text;
alter table public.moderation_log add column if not exists actor_rank text;
alter table public.moderation_log add column if not exists snapshot jsonb;
alter table public.moderation_log
  add column if not exists reverted_by uuid references public.moderation_log (log_id) on delete set null;
alter table public.moderation_log add column if not exists note text;

alter table public.moderation_log drop constraint if exists moderation_log_note_check;
alter table public.moderation_log
  add constraint moderation_log_note_check check (note is null or char_length(note) <= 500);

alter table public.moderation_log drop constraint if exists moderation_log_target_type_check;
alter table public.moderation_log
  add constraint moderation_log_target_type_check
  check (target_type is null or target_type in (
    'comment', 'post', 'profile', 'account', 'rank', 'report', 'home', 'feedback', 'person', 'system'
  ));

-- The action list. Dropped by shape, not by name, so a differently named
-- constraint cannot linger (same approach as 0050 and 0051). The list is
-- 0051's plus the actions the next batches write.
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
    'role_grant', 'role_revoke',
    'profile_reports_resolve', 'report_reopen',
    'post_remove', 'post_restore', 'post_reports_dismiss',
    'password_reset', 'profile_reset',
    'restrict', 'suspend', 'lift',
    'person_view', 'email_reveal', 'purge'
  ));

-- Rows written before this migration get a target (the actor's rank at the
-- time was not recorded and is not guessed).
update public.moderation_log l
   set target_type = case
         when l.action like 'comment\_%' then 'comment'
         when l.action like 'role\_%' then 'rank'
         when l.action = 'profile_reports_resolve' then 'profile'
         when l.action like 'post\_%' then 'post'
         when l.action = 'password_reset' then 'account'
       end,
       target_id = case
         when l.action like 'comment\_%' then l.comment_id::text
         when l.action like 'post\_%' then l.post_id::text
         else l.target_user_id::text
       end
 where l.target_type is null;

create index if not exists moderation_log_actor_idx on public.moderation_log (actor_id, created_at desc);
create index if not exists moderation_log_target_user_idx on public.moderation_log (target_user_id, created_at desc);
create index if not exists moderation_log_action_idx on public.moderation_log (action, created_at desc);

-- Append-only. The log is written only by the security definer functions
-- below. No API role may insert, update or delete (a trigger would also stop
-- the foreign keys' own "set null" when a comment or post is deleted, so the
-- guarantee is made with privileges instead).
revoke insert, update, delete, truncate on public.moderation_log from anon, authenticated;

drop policy if exists moderation_log_read on public.moderation_log;
create policy moderation_log_read on public.moderation_log
  for select to authenticated
  using (
    public.my_has_permission('audit.read_all')
    or (public.my_has_permission('audit.read') and public.is_content_audit_action(action))
  );

-- The one writer. Internal: never callable by a client.
create or replace function public.write_audit(
  p_actor uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_target_user uuid default null,
  p_comment uuid default null,
  p_post uuid default null,
  p_reason text default null,
  p_note text default null,
  p_snapshot jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.moderation_log (
    actor_id, actor_rank, action, target_type, target_id,
    target_user_id, comment_id, post_id, reason, note, snapshot
  )
  values (
    p_actor, public.audit_actor_rank(p_actor), p_action, p_target_type, p_target_id,
    p_target_user, p_comment, p_post, left(p_reason, 200), left(p_note, 500), p_snapshot
  )
  returning log_id into v_id;
  return v_id;
end
$$;

-- 4. S1 flag brigading ----------------------------------------------------------------
-- counts: the flag came from a real account and counts toward auto-hide.
-- settled: a moderator approved the comment after this flag.
-- withdrawn_at: the reader took the flag back. A withdrawn flag stays as a row
-- (it still counts toward the daily limit and the same reader cannot raise it
-- again), so flag/unflag cycles cannot be used to get around the limit.
alter table public.comment_flags add column if not exists counts boolean not null default true;
alter table public.comment_flags add column if not exists settled boolean not null default false;
alter table public.comment_flags add column if not exists withdrawn_at timestamptz;

update public.comment_flags f
   set counts = false
 where f.counts
   and exists (select 1 from auth.users u where u.id = f.user_id and u.is_anonymous);

create index if not exists comment_flags_user_idx on public.comment_flags (user_id, created_at desc);

-- A reader sees only their own flags (so the app can offer "withdraw").
drop policy if exists comment_flags_read_own on public.comment_flags;
create policy comment_flags_read_own on public.comment_flags
  for select to authenticated using (user_id = auth.uid());
revoke update, delete, truncate on public.comment_flags from anon, authenticated;

-- The server decides who counts and how many flags one person may raise.
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
drop trigger if exists comment_flags_before_insert on public.comment_flags;
create trigger comment_flags_before_insert before insert on public.comment_flags
  for each row execute function public.comment_flags_before_insert();

-- flag_count = open flags of anyone (the review queue shows a visible comment
-- with flag_count > 0). Only open flags from real accounts can send a visible
-- comment of an ordinary person back to review, and the comment of a rank
-- holder is never sent back: it stays visible and waits in the queue.
create or replace function public.comment_flags_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_open integer;
  v_counted integer;
  v_rank boolean;
begin
  select count(*) filter (where not f.settled and f.withdrawn_at is null),
         count(*) filter (where not f.settled and f.withdrawn_at is null and f.counts)
    into v_open, v_counted
    from public.comment_flags f
   where f.comment_id = new.comment_id;
  select exists (
    select 1
      from public.event_comments c
      join public.user_roles r on r.user_id = c.user_id
     where c.comment_id = new.comment_id
  ) into v_rank;
  update public.event_comments
     set flag_count = v_open,
         hidden_reason = case
           when status = 'visible' and v_counted >= 3 and not v_rank then 'flagged'
           else hidden_reason
         end,
         status = case
           when status = 'visible' and v_counted >= 3 and not v_rank then 'pending'
           else status
         end
   where comment_id = new.comment_id;
  return new;
end
$$;
drop trigger if exists comment_flags_after_insert on public.comment_flags;
create trigger comment_flags_after_insert after insert on public.comment_flags
  for each row execute function public.comment_flags_after_insert();

-- Withdraw my flag. flag_count goes down. A comment that went to review only
-- because of flags is NOT put back on screen automatically: a moderator
-- decides (approve in the queue). Repeating the call is harmless.
create or replace function public.withdraw_comment_flag(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_settled boolean;
begin
  if v_uid is null then
    raise exception 'withdraw_comment_flag: not_account' using errcode = '42501';
  end if;
  update public.comment_flags f
     set withdrawn_at = now()
   where f.comment_id = p_comment_id
     and f.user_id = v_uid
     and f.withdrawn_at is null
  returning f.settled into v_settled;
  if not found then
    if exists (
      select 1 from public.comment_flags f
       where f.comment_id = p_comment_id and f.user_id = v_uid
    ) then
      return;
    end if;
    raise exception 'withdraw_comment_flag: not_found' using errcode = 'P0002';
  end if;
  if not v_settled then
    update public.event_comments c
       set flag_count = (
         select count(*) from public.comment_flags f
          where f.comment_id = c.comment_id and not f.settled and f.withdrawn_at is null
       )
     where c.comment_id = p_comment_id;
  end if;
end
$$;

-- 5. S2/S3 a deleted comment stays deleted ------------------------------------------------
alter table public.event_comments add column if not exists author_deleted_at timestamptz;

update public.event_comments
   set author_deleted_at = updated_at
 where hidden_reason = 'deleted_by_author' and author_deleted_at is null;

-- The wiped text of an author-deleted comment is empty: let the body check
-- allow that for those rows (and removed ones, as in 0044) only.
alter table public.event_comments drop constraint if exists event_comments_body_check;
alter table public.event_comments
  add constraint event_comments_body_check
  check (
    status = 'removed'
    or author_deleted_at is not null
    or char_length(btrim(body)) between 1 and 1000
  );

-- Moderators no longer read author-deleted rows (their text is private to the
-- author until it is wiped). Everything else is 0047's rule.
drop policy if exists event_comments_read on public.event_comments;
create policy event_comments_read on public.event_comments
  for select to anon, authenticated
  using (
    user_id = auth.uid()
    or (public.my_has_permission('comments.moderate') and author_deleted_at is null)
    or (
      status in ('visible', 'removed')
      and not exists (
        select 1 from public.blocks b
         where b.blocker_id = auth.uid()
           and b.blocked_id = event_comments.user_id
      )
    )
  );

-- 0036's insert trigger plus: a client can never set author_deleted_at.
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
  new.created_at := now();
  new.updated_at := now();
  new.helpful_count := 0;
  new.reply_count := 0;
  new.flag_count := 0;
  new.hidden_reason := null;
  new.author_deleted_at := null;
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

-- The author's delete: hidden at once, text kept for 30 days (then wiped by
-- the nightly job below). A removed or already deleted comment is left alone.
create or replace function public.delete_my_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.event_comments
     set status = 'hidden',
         hidden_reason = 'deleted_by_author',
         author_deleted_at = coalesce(author_deleted_at, now()),
         updated_at = now()
   where comment_id = p_comment_id
     and user_id = auth.uid()
     and status <> 'removed';
  if not found then
    if exists (
      select 1 from public.event_comments c
       where c.comment_id = p_comment_id and c.user_id = auth.uid()
    ) then
      return;
    end if;
    raise exception 'delete_my_comment: not your comment' using errcode = '42501';
  end if;
end
$$;

-- Approve or hide. 0043's rules, plus: an author-deleted comment is never
-- touched; approving settles the open flags; the audit row carries the state
-- before (for the undo of the next batch).
create or replace function public.moderate_comment(p_comment_id uuid, p_action text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
  v_status text;
  v_hidden text;
  v_flags integer;
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'moderate_comment: moderators only' using errcode = '42501';
  end if;
  if p_action not in ('approve', 'hide') then
    raise exception 'moderate_comment: action must be approve or hide' using errcode = '22023';
  end if;
  select c.user_id, c.status, c.hidden_reason, c.flag_count
    into v_author, v_status, v_hidden, v_flags
    from public.event_comments c
   where c.comment_id = p_comment_id
     and c.status <> 'removed'
     and c.author_deleted_at is null
   for update;
  if not found then
    return;
  end if;
  update public.event_comments
     set status = case when p_action = 'approve' then 'visible' else 'hidden' end,
         hidden_reason = case when p_action = 'hide' then coalesce(p_reason, 'moderator') else null end,
         flag_count = case when p_action = 'approve' then 0 else flag_count end,
         updated_at = now()
   where comment_id = p_comment_id;
  if p_action = 'approve' then
    update public.comment_flags
       set settled = true
     where comment_id = p_comment_id and not settled;
  end if;
  perform public.write_audit(
    auth.uid(), 'comment_' || p_action, 'comment', p_comment_id::text,
    v_author, p_comment_id, null, p_reason, null,
    jsonb_build_object('status', v_status, 'hidden_reason', v_hidden, 'flag_count', v_flags)
  );
end
$$;

-- Remove (admins). 0044's rules, plus: an author-deleted comment is not
-- reachable; the audit row carries the state before.
create or replace function public.admin_delete_comment(p_comment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := coalesce(nullif(left(btrim(coalesce(p_reason, '')), 200), ''), 'removed_by_admin');
  v_author uuid;
  v_status text;
  v_hidden text;
  v_flags integer;
  v_deleted timestamptz;
begin
  if not public.has_permission(v_uid, 'comments.delete') then
    raise exception 'admin_delete_comment: not allowed' using errcode = '42501';
  end if;
  select c.user_id, c.status, c.hidden_reason, c.flag_count, c.author_deleted_at
    into v_author, v_status, v_hidden, v_flags, v_deleted
    from public.event_comments c
   where c.comment_id = p_comment_id
   for update;
  if not found then
    raise exception 'admin_delete_comment: comment not found' using errcode = 'P0002';
  end if;
  if v_status = 'removed' or v_deleted is not null then
    return;
  end if;
  update public.event_comments
     set status = 'removed',
         body = '',
         area_geohash = null,
         hidden_reason = v_reason,
         updated_at = now()
   where comment_id = p_comment_id;
  perform public.write_audit(
    v_uid, 'comment_remove', 'comment', p_comment_id::text,
    v_author, p_comment_id, null, v_reason, null,
    jsonb_build_object('status', v_status, 'hidden_reason', v_hidden, 'flag_count', v_flags)
  );
end
$$;

-- Nightly: 30 days after the author deleted a comment its text (and area) is
-- wiped for good. The row stays so replies keep their place.
create or replace function public.wipe_deleted_comment_text()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  update public.event_comments
     set body = '', area_geohash = null
   where author_deleted_at is not null
     and author_deleted_at < now() - interval '30 days'
     and (body <> '' or area_geohash is not null);
  get diagnostics n = row_count;
  if n > 0 then
    perform public.write_audit(
      null, 'purge', 'comment', null, null, null, null,
      'author_deleted_text', n::text || ' comments', null
    );
  end if;
  return n;
end
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wipe_deleted_comment_text') then
    perform cron.unschedule('wipe_deleted_comment_text');
  end if;
  perform cron.schedule('wipe_deleted_comment_text', '10 3 * * *', $cron$select public.wipe_deleted_comment_text();$cron$);
exception
  when others then
    raise notice 'pg_cron scheduling skipped (%): schedule wipe_deleted_comment_text by hand: select cron.schedule(''wipe_deleted_comment_text'', ''10 3 * * *'', ''select public.wipe_deleted_comment_text();'');', sqlerrm;
end
$$;

-- 6. S5 reserved display names ---------------------------------------------------------------
-- Names are compared in a folded form: lower case, no accents or Arabic
-- vowel marks, Arabic-script variants merged (yeh, kaf, heh), look-alike
-- digits turned into letters, separators removed, repeated letters collapsed.
create or replace function public.name_fold(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select translate(
    translate(
      translate(
        translate(
          regexp_replace(
            lower(coalesce(p, '')),
            U&'[\0300-\036F\064B-\065F\0670\0640\200B-\200F\202A-\202E\2066-\2069\FEFF\00AD]',
            '', 'g'),
          U&'\00E0\00E1\00E2\00E3\00E4\00E5\0101\0103\0105\00E7\0107\010D\010F\0111\00E8\00E9\00EA\00EB\0113\011B\0119\011F\00EC\00ED\00EE\00EF\012B\0131\0142\00F1\0144\0148\00F2\00F3\00F4\00F5\00F6\00F8\0151\0155\0159\015B\0161\015F\0165\00F9\00FA\00FB\00FC\016B\016F\0171\00FD\00FF\017E\017A\017C',
          'aaaaaaaaacccddeeeeeeegiiiiiilnnnooooooorrssstuuuuuuuyyzzz'),
        U&'\064A\0649\06CE\06D0\0643\06D5\0629\06C0\06C6\0624\06A4\0695\06B5\0623\0625\0622\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9\0626\0621',
        U&'\06CC\06CC\06CC\06CC\06A9\0647\0647\0647\0648\0648\0641\0631\0644\0627\0627\0627' || '01234567890123456789'),
      U&'\0430\0435\043E\0440\0441\0445\0456\0443\043A\043C\0442\0432\043D\0455\0458\03BF\03B5\03B9\03BA\03BC\03C5\03B1\03C1\03BD\0410\0415\041E\0420\0421\0425\0406\0423\041A\041C\0422\0412\041D\FF41\FF42\FF43\FF44\FF45\FF46\FF47\FF48\FF49\FF4A\FF4B\FF4C\FF4D\FF4E\FF4F\FF50\FF51\FF52\FF53\FF54\FF55\FF56\FF57\FF58\FF59\FF5A\FF21\FF22\FF23\FF24\FF25\FF26\FF27\FF28\FF29\FF2A\FF2B\FF2C\FF2D\FF2E\FF2F\FF30\FF31\FF32\FF33\FF34\FF35\FF36\FF37\FF38\FF39\FF3A',
      'aeopcxiykmtbhsjoeikmuapvaeopcxiykmtbhabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'),
    '013457@$', 'oieastas')
$$;

create or replace function public.name_key(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(
    regexp_replace(
      public.name_fold(p),
      U&'[[:space:][:punct:]\00A0\2000-\206F\3000\060C\061B\061F]',
      '', 'g'),
    '(.)\1+', '\1', 'g')
$$;

-- Terms nobody but the official account may carry in a display name. A
-- 'brand' term is blocked anywhere inside the name; a 'word' term only as a
-- whole word (or as the whole name), so ordinary names are not caught.
-- Edit by migration or in the SQL editor; nothing is stored folded.
create table if not exists public.reserved_display_terms (
  term text primary key check (char_length(btrim(term)) between 1 and 60),
  kind text not null check (kind in ('brand', 'word'))
);
alter table public.reserved_display_terms enable row level security;
-- no policies: never read or written by a client; the guard below reads it.

insert into public.reserved_display_terms (term, kind) values
  ('bumelerze', 'brand'),
  (U&'b\00FBmelerze', 'brand'),
  (U&'\0628\0648\0648\0645\06D5\0644\06D5\0631\0632\06D5', 'brand'),
  (U&'\0628\0648\0645\06D5\0644\06D5\0631\0632\06D5', 'brand'),
  (U&'\0628\0648\0645\0644\06CE\0631\0632\06D5', 'brand'),
  ('official', 'word'),
  ('admin', 'word'),
  ('administrator', 'word'),
  ('moderator', 'word'),
  ('mod', 'word'),
  ('usgs', 'word'),
  ('emsc', 'word'),
  ('gfz', 'word'),
  ('geofon', 'word'),
  (U&'ferm\00EE', 'word'),
  (U&'r\00EAveber', 'word'),
  (U&'\0631\0633\0645\064A', 'word'),
  (U&'\0631\06D5\0633\0645\06CC', 'word'),
  (U&'\0626\06D5\062F\0645\06CC\0646', 'word'),
  (U&'\0627\062F\0645\06CC\0646', 'word'),
  (U&'\0627\062F\0645\0646', 'word'),
  (U&'\0645\062F\064A\0631', 'word'),
  (U&'\0645\0634\0631\0641', 'word')
on conflict do nothing;

-- True when the name imitates the team: a brand term anywhere, a word term as
-- a word, or one of 0045's reserved usernames as the whole name.
create or replace function public.display_name_reserved(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.name_key(p_name);
  v_split text := U&'[[:space:][:punct:]\00A0\2000-\206F\3000\060C\061B\061F]+';
begin
  if v_key = '' then
    return false;
  end if;
  return exists (
           select 1 from public.reserved_display_terms t
            where t.kind = 'brand'
              and public.name_key(t.term) <> ''
              and position(public.name_key(t.term) in v_key) > 0
         )
      or exists (
           select 1 from public.reserved_display_terms t
            where t.kind = 'word'
              and public.name_key(t.term) <> ''
              and (
                public.name_key(t.term) = v_key
                or exists (
                  select 1
                    from regexp_split_to_table(public.name_fold(p_name), v_split) tok
                   where public.name_key(tok) = public.name_key(t.term)
                )
              )
         )
      or exists (
           select 1 from public.reserved_usernames r
            where public.name_key(r.name) = v_key
         );
end
$$;

-- 7. S5/S6 the profile row: reserved names, immutable fields, own avatar folder ----------------------
-- Clients may change display_name, avatar_path, username and is_private (the
-- columns the app edits). user_id and created_at never change. A trigger
-- rather than column privileges, because the app saves with an upsert that
-- lists user_id in its update. The official rank may use reserved names.
create or replace function public.profiles_integrity_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;

  if new.avatar_path is not null
     and (tg_op = 'INSERT' or new.avatar_path is distinct from old.avatar_path)
     and (
       position('..' in new.avatar_path) > 0
       or left(new.avatar_path, char_length(new.user_id::text) + 1) <> new.user_id::text || '/'
     ) then
    raise exception 'profiles: avatar_path_invalid' using errcode = '23514';
  end if;

  -- an unchanged name is never re-checked (the app re-sends it on every save)
  if tg_op = 'UPDATE' and new.display_name is not distinct from old.display_name then
    return new;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.profiles p
     where p.user_id = new.user_id and p.display_name = new.display_name
  ) then
    return new;
  end if;
  if public.display_name_reserved(new.display_name)
     and not exists (
       select 1 from public.user_roles ur
        where ur.user_id = new.user_id and ur.role = 'official'
     ) then
    raise exception 'profiles: display_name_reserved' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists profiles_integrity_guard on public.profiles;
create trigger profiles_integrity_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_integrity_guard();

-- 8. Read policies that used has_permission() directly now use my_has_permission() -------------------
drop policy if exists profile_reports_read on public.profile_reports;
create policy profile_reports_read on public.profile_reports
  for select to authenticated
  using (public.my_has_permission('comments.moderate'));

drop policy if exists post_reports_read on public.post_reports;
create policy post_reports_read on public.post_reports
  for select to authenticated
  using (public.my_has_permission('comments.moderate'));

-- 9. Admin RPCs write the audit fields ----------------------------------------------------------------
-- Each function below is its latest definition (0046, 0047, 0050, 0051) plus
-- the new log fields. Behaviour is unchanged except where noted.

-- Grant (0046). snapshot.previous is the rank row it replaced, if any.
create or replace function public.admin_grant_role(
  p_username text,
  p_role text,
  p_org_name text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_org text;
  v_note text;
  v_previous jsonb;
begin
  if not public.has_permission(v_uid, 'badges.grant') then
    raise exception 'admin_grant_role: not allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then
    raise exception 'admin_grant_role: this rank cannot be granted here' using errcode = '22023';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    raise exception 'admin_grant_role: user not found' using errcode = 'P0002';
  end if;
  v_org := case when p_role = 'partner' then nullif(left(btrim(coalesce(p_org_name, '')), 80), '') else null end;
  v_note := nullif(left(btrim(coalesce(p_note, '')), 200), '');
  select jsonb_build_object(
           'org_name', r.org_name, 'note', r.note,
           'granted_by', r.granted_by, 'granted_at', r.granted_at)
    into v_previous
    from public.user_roles r
   where r.user_id = v_target and r.role = p_role;
  insert into public.user_roles (user_id, role, org_name, granted_by, granted_at, note)
  values (v_target, p_role, v_org, v_uid, now(), v_note)
  on conflict (user_id, role) do update
    set org_name = excluded.org_name,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        note = excluded.note;
  perform public.write_audit(
    v_uid, 'role_grant', 'rank', v_target::text,
    v_target, null, null, p_role, null,
    jsonb_build_object('role', p_role, 'org_name', v_org, 'note', v_note, 'previous', v_previous)
  );
end
$$;

-- Revoke (0046). snapshot is the rank row that was deleted, so it can be given back.
create or replace function public.admin_revoke_role(p_username text, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_snapshot jsonb;
begin
  if not public.has_permission(v_uid, 'badges.grant') then
    raise exception 'admin_revoke_role: not allowed' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('moderator', 'seismologist', 'professor', 'researcher', 'engineer', 'partner') then
    raise exception 'admin_revoke_role: this rank cannot be revoked here' using errcode = '22023';
  end if;
  select p.user_id into v_target
    from public.profiles p
   where lower(p.username) = lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  if not found then
    raise exception 'admin_revoke_role: user not found' using errcode = 'P0002';
  end if;
  delete from public.user_roles r
   where r.user_id = v_target and r.role = p_role
  returning jsonb_build_object(
              'role', r.role, 'org_name', r.org_name, 'note', r.note,
              'granted_by', r.granted_by, 'granted_at', r.granted_at)
       into v_snapshot;
  if not found then
    raise exception 'admin_revoke_role: rank not held' using errcode = 'P0002';
  end if;
  perform public.write_audit(
    v_uid, 'role_revoke', 'rank', v_target::text,
    v_target, null, null, p_role, null, v_snapshot
  );
end
$$;

-- Resolve the open reports on a profile (0047). snapshot.report_ids are the
-- reports it closed, so they can be reopened. CHANGE: no log row when there
-- was nothing open to close.
create or replace function public.resolve_profile_reports(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids jsonb;
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'resolve_profile_reports: moderators only' using errcode = '42501';
  end if;
  with closed as (
    update public.profile_reports
       set resolved_at = now()
     where reported_id = p_user and resolved_at is null
    returning report_id
  )
  select coalesce(jsonb_agg(closed.report_id), '[]'::jsonb) into v_ids from closed;
  if jsonb_array_length(v_ids) > 0 then
    perform public.write_audit(
      auth.uid(), 'profile_reports_resolve', 'profile', p_user::text,
      p_user, null, null, null, null, jsonb_build_object('report_ids', v_ids)
    );
  end if;
end
$$;

-- Dismiss the reports on a post (0050). snapshot.report_ids as above.
create or replace function public.dismiss_post_reports(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
  v_ids jsonb;
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'dismiss_post_reports: moderators only' using errcode = '42501';
  end if;
  select po.user_id into v_author from public.profile_posts po where po.post_id = p_post_id;
  with closed as (
    update public.post_reports
       set resolved_at = now()
     where post_id = p_post_id and resolved_at is null
    returning report_id
  )
  select coalesce(jsonb_agg(closed.report_id), '[]'::jsonb) into v_ids from closed;
  if jsonb_array_length(v_ids) > 0 then
    perform public.write_audit(
      auth.uid(), 'post_reports_dismiss', 'post', p_post_id::text,
      v_author, null, p_post_id, null, null, jsonb_build_object('report_ids', v_ids)
    );
  end if;
end
$$;

-- Remove a post (0050). snapshot: the status before and the reports it closed.
create or replace function public.admin_remove_post(p_post_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := coalesce(nullif(left(btrim(coalesce(p_reason, '')), 200), ''), 'removed_by_admin');
  v_author uuid;
  v_status text;
  v_ids jsonb;
begin
  if not public.has_permission(v_uid, 'posts.delete') then
    raise exception 'admin_remove_post: not allowed' using errcode = '42501';
  end if;
  select po.user_id, po.status into v_author, v_status
    from public.profile_posts po
   where po.post_id = p_post_id
   for update;
  if not found then
    raise exception 'admin_remove_post: post not found' using errcode = 'P0002';
  end if;
  if v_status = 'removed' then
    return;
  end if;
  update public.profile_posts
     set status = 'removed',
         body = '',
         removed_by = v_uid,
         removed_reason = v_reason,
         updated_at = now()
   where post_id = p_post_id;
  with closed as (
    update public.post_reports
       set resolved_at = now()
     where post_id = p_post_id and resolved_at is null
    returning report_id
  )
  select coalesce(jsonb_agg(closed.report_id), '[]'::jsonb) into v_ids from closed;
  perform public.write_audit(
    v_uid, 'post_remove', 'post', p_post_id::text,
    v_author, null, p_post_id, v_reason, null,
    jsonb_build_object('status', v_status, 'report_ids', v_ids)
  );
end
$$;

-- Reset a password (0051), unchanged except for the log row.
create or replace function public.admin_reset_password(p_user_id uuid, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_anonymous boolean;
begin
  if not public.has_permission(v_uid, 'accounts.reset_password') then
    raise exception 'admin_reset_password: not allowed' using errcode = '42501';
  end if;
  if p_new_password is null
     or char_length(p_new_password) < 8
     or char_length(p_new_password) > 72 then
    raise exception 'admin_reset_password: password must be 8 to 72 characters' using errcode = '22023';
  end if;

  select coalesce(u.is_anonymous, false)
    into v_anonymous
    from auth.users u
   where u.id = p_user_id;
  if not found then
    raise exception 'admin_reset_password: user not found' using errcode = 'P0002';
  end if;
  if v_anonymous then
    raise exception 'admin_reset_password: anonymous users have no password' using errcode = '22023';
  end if;

  -- One admin cannot take over another admin's account this way.
  if p_user_id <> v_uid and public.has_permission(p_user_id, 'accounts.reset_password') then
    raise exception 'admin_reset_password: not allowed for this account' using errcode = '42501';
  end if;

  -- GoTrue stores bcrypt hashes (cost 10) and verifies any valid bcrypt hash.
  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user_id;

  -- A reset means the old password is no longer trusted: end every session.
  delete from auth.sessions where user_id = p_user_id;

  perform public.write_audit(
    v_uid, 'password_reset', 'account', p_user_id::text,
    p_user_id, null, null, null, null, null
  );
end
$$;

-- 10. The activity log ---------------------------------------------------------------------------------
-- Newest first, keyset paging on created_at (pass the last row's created_at
-- as p_before for the next page). audit.read_all sees every action; audit.read
-- sees content actions only (comments, posts, reports).
create or replace function public.admin_activity(
  p_actor uuid default null,
  p_action text default null,
  p_target_user uuid default null,
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  log_id uuid,
  created_at timestamptz,
  action text,
  actor_id uuid,
  actor_name text,
  actor_username text,
  actor_rank text,
  target_type text,
  target_id text,
  target_user_id uuid,
  target_name text,
  target_username text,
  target_summary text,
  reason text,
  note text,
  reverted_by uuid
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_all boolean := public.my_has_permission('audit.read_all');
begin
  if not v_all and not public.my_has_permission('audit.read') then
    raise exception 'admin_activity: not allowed' using errcode = '42501';
  end if;
  return query
    select l.log_id, l.created_at, l.action,
           l.actor_id, ap.display_name, ap.username, l.actor_rank,
           l.target_type, l.target_id,
           l.target_user_id, tp.display_name, tp.username,
           case l.target_type
             when 'comment' then (
               select e.bumelerze_id
                 from public.event_comments c
                 join public.events e on e.event_id = c.event_id
                where c.comment_id = l.comment_id)
             when 'rank' then l.reason
             else null
           end,
           l.reason, l.note, l.reverted_by
      from public.moderation_log l
      left join public.profiles ap on ap.user_id = l.actor_id
      left join public.profiles tp on tp.user_id = l.target_user_id
     where (v_all or public.is_content_audit_action(l.action))
       and (p_actor is null or l.actor_id = p_actor)
       and (p_action is null or l.action = p_action)
       and (p_target_user is null or l.target_user_id = p_target_user)
       and (p_before is null or l.created_at < p_before)
     order by l.created_at desc, l.log_id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

-- 11. S7 clients can no longer ask about other people's powers --------------------------------------------
-- Every policy that called has_permission(auth.uid(), ...) or is_moderator(auth.uid())
-- was recreated above. Revoke only if no other policy still depends on them.
do $$
begin
  if exists (
    select 1
      from pg_policies
     where coalesce(qual, '') ~* '\m(has_permission|is_moderator)\('
        or coalesce(with_check, '') ~* '\m(has_permission|is_moderator)\('
  ) then
    raise notice 'has_permission/is_moderator stay callable: another policy still uses them (see pg_policies)';
  else
    revoke execute on function public.has_permission(uuid, text) from anon, authenticated;
    revoke execute on function public.is_moderator(uuid) from anon, authenticated;
  end if;
end
$$;

-- Grants -----------------------------------------------------------------------------------------------------
revoke all on function public.my_has_permission(text) from public, anon;
revoke all on function public.audit_actor_rank(uuid) from public, anon, authenticated;
revoke all on function public.is_content_audit_action(text) from public, anon;
revoke all on function public.write_audit(uuid, text, text, text, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.comment_flags_before_insert() from public, anon, authenticated;
revoke all on function public.comment_flags_after_insert() from public, anon, authenticated;
revoke all on function public.withdraw_comment_flag(uuid) from public, anon;
revoke all on function public.event_comments_before_insert() from public, anon, authenticated;
revoke all on function public.delete_my_comment(uuid) from public, anon;
revoke all on function public.moderate_comment(uuid, text, text) from public, anon;
revoke all on function public.admin_delete_comment(uuid, text) from public, anon;
revoke all on function public.wipe_deleted_comment_text() from public, anon, authenticated;
revoke all on function public.name_fold(text) from public, anon, authenticated;
revoke all on function public.name_key(text) from public, anon, authenticated;
revoke all on function public.display_name_reserved(text) from public, anon, authenticated;
revoke all on function public.profiles_integrity_guard() from public, anon, authenticated;
revoke all on function public.admin_grant_role(text, text, text, text) from public, anon;
revoke all on function public.admin_revoke_role(text, text) from public, anon;
revoke all on function public.resolve_profile_reports(uuid) from public, anon;
revoke all on function public.dismiss_post_reports(uuid) from public, anon;
revoke all on function public.admin_remove_post(uuid, text) from public, anon;
revoke all on function public.admin_reset_password(uuid, text) from public, anon;
revoke all on function public.admin_activity(uuid, text, uuid, timestamptz, integer) from public, anon;

grant execute on function public.my_has_permission(text) to authenticated, anon;
grant execute on function public.is_content_audit_action(text) to authenticated;
grant execute on function public.withdraw_comment_flag(uuid) to authenticated;
grant execute on function public.delete_my_comment(uuid) to authenticated;
grant execute on function public.moderate_comment(uuid, text, text) to authenticated;
grant execute on function public.admin_delete_comment(uuid, text) to authenticated;
grant execute on function public.wipe_deleted_comment_text() to service_role;
grant execute on function public.admin_grant_role(text, text, text, text) to authenticated;
grant execute on function public.admin_revoke_role(text, text) to authenticated;
grant execute on function public.resolve_profile_reports(uuid) to authenticated;
grant execute on function public.dismiss_post_reports(uuid) to authenticated;
grant execute on function public.admin_remove_post(uuid, text) to authenticated;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
grant execute on function public.admin_activity(uuid, text, uuid, timestamptz, integer) to authenticated;
