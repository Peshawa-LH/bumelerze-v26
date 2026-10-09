-- 0059: word filter, busy-time review and pinned notes (review
-- social-admin-review-2026-10-08 sections 3 and 4f, plan rows P2-5, P2-6 and
-- P2-7; decisions D78 to D81).
--
--   1. P2-5 word filter (Apple guideline 1.2, Google Play UGC): a list of
--      words, phrases and a few patterns in four languages
--      (content_filter_terms). A new comment, a new post or an author's post
--      edit that matches is HELD for review (status 'pending'), never
--      refused. Which term matched is recorded in content_holds, readable by
--      moderators only (content_holds_for). The official account manages the
--      list (permission filter.manage): add, switch off, test a text.
--      Matching folds case, accents, Arabic vowel marks and Arabic-script
--      letter variants the way 0052 folds names (filter_fold), without the
--      look-alike digit step, so times and phone numbers stay digits. A
--      single word matches a whole word; a phrase matches anywhere in the
--      text; a pattern is a regular expression on the folded text (patterns
--      come from migrations or the SQL editor only, never from the app).
--   2. Posts gain the 'pending' state ("Waiting for review"): only the
--      author sees a held post, moderators approve it
--      (admin_approve_post) and the official account can remove it as any
--      post. post_queue() lists held posts above reported ones. A held post
--      the author deletes and restores comes back held.
--   3. P2-6 busy-time review ("surge mode"): for 24 hours after a regional
--      M5.0 or larger, or after an earthquake that collected 50 felt
--      reports within its first hour, comments and posts of accounts younger
--      than 7 days are held. Computed when the comment or post is written
--      (no cron). The official account can force it on or off for 24 hours
--      (moderation_settings, one row). hub_surge_active() lets the app show
--      a calm banner in the Event hub.
--   4. P2-7 pinned note: a holder of hubs.feature (the official account)
--      pins one comment per Event hub to the top (pin_hub_comment,
--      unpin_hub_comment). A pinned comment is never sent to review by
--      readers' reports (it stays visible and waits in the queue as
--      "reported"); it is unpinned when it stops being visible.
--
-- The staff (comments.moderate) are never held. Guests' comments wait for
-- review already; a filter match on them is still recorded so the
-- moderator sees why it is risky.
--
-- New triggers only: event_comments_hold_check (before insert, runs after
-- 0056's event_comments_before_insert because triggers fire in name order),
-- event_comments_pin_guard (before update), profile_posts_hold_check (before
-- insert or update, after 0058's two triggers). No existing trigger
-- function is changed. Redefined from their latest versions: post_queue
-- (0056) and share_event_to_profile (0058, a replay also finds a held post).
--
-- Account deletion: content_holds cascade from auth.users; the filter
-- list and the setting keep the admin unlinked (set null).
--
-- Error tokens (message text): not_allowed, term_invalid, lang_invalid,
-- kind_invalid, mode_invalid, not_found, not_top_level, not_visible,
-- too_many.
--
-- Needs 0035 to 0058. Idempotent: safe to run twice. Written for the SQL
-- editor as one line: no transaction statements, only full-line comments,
-- ASCII only (non-ASCII letters are U& escapes), no question marks.

-- 1. Permission and log actions ----------------------------------------------------------
-- filter.manage: the official rank. If the private 'admin' rank of 0060
-- exists already (any apply order), it gets the permission too; when 0060
-- runs later it copies the official's permissions itself.
insert into public.role_permissions (role, permission) values
  ('official', 'filter.manage')
on conflict do nothing;
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.role_permissions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%''admin''%'
  ) then
    insert into public.role_permissions (role, permission) values ('admin', 'filter.manage')
    on conflict do nothing;
  end if;
end
$$;

-- The log's action list becomes the UNION of what the live constraint allows
-- now (0055's list, plus whatever a later batch such as 0060 added, in any
-- apply order) and this batch's actions: post_approve, comment_pin,
-- comment_unpin, filter_term_add, filter_term_update, surge_set. Read from
-- the live definition, never a fixed list, so no other batch's action is
-- ever dropped. Dropped by shape, not by name (as 0050 to 0055).
do $$
declare
  c record;
  v_actions text[] := array[
    'comment_approve', 'comment_hide', 'comment_remove', 'comment_restore',
    'role_grant', 'role_revoke', 'role_restore',
    'profile_reports_resolve', 'report_reopen',
    'post_remove', 'post_restore', 'post_reports_dismiss',
    'password_reset', 'profile_reset', 'profile_restore',
    'restrict', 'suspend', 'lift',
    'person_view', 'email_reveal', 'purge',
    'post_approve', 'comment_pin', 'comment_unpin',
    'filter_term_add', 'filter_term_update', 'surge_set'
  ];
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%comment_approve%'
  loop
    v_actions := v_actions || array(
      select m[1] from regexp_matches(c.def, '''([a-z0-9_]+)''', 'g') as m
    );
    execute format('alter table public.moderation_log drop constraint %I', c.conname);
  end loop;
  select array_agg(distinct a order by a) into v_actions from unnest(v_actions) as a;
  execute format(
    'alter table public.moderation_log add constraint moderation_log_action_check check (action in (%s))',
    (select string_agg(quote_literal(a), ', ' order by a) from unnest(v_actions) as a)
  );
end
$$;

-- 2. Folding --------------------------------------------------------------------------------
-- 0052's name_fold without its last step (look-alike digits and @ $ turned
-- into letters): lower case, no accents, Arabic vowel marks, tatweel or
-- invisible marks, Arabic-script variants merged (yeh, kaf, heh, waw, alef,
-- Kurdish letters), Arabic-Indic digits as 0-9, Cyrillic and Greek
-- look-alikes and full-width letters as Latin.
create or replace function public.filter_fold(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select translate(
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
      'aeopcxiykmtbhsjoeikmuapvaeopcxiykmtbhabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz')
$$;

-- The text patterns run on: folded, a repeated Arabic-script letter written
-- once (so the Sorani spellings with and without a doubled waw meet), every
-- run of spaces one space.
create or replace function public.filter_text(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(
    regexp_replace(
      regexp_replace(public.filter_fold(p), U&'([\0621-\06FF])' || '\1+', '\1', 'g'),
      U&'[[:space:]\00A0\2000-\200A\202F\205F\3000]+', ' ', 'g'))
$$;

-- The text words and phrases are matched in: filter_text with punctuation
-- turned into spaces, so a word is what sits between two spaces.
create or replace function public.filter_words(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(
    regexp_replace(
      public.filter_text(p),
      U&'[[:space:][:punct:]\00A0\2000-\206F\3000\060C\061B\061F\066A-\066D\06D4]+',
      ' ', 'g'))
$$;

-- 3. The list -------------------------------------------------------------------------------
-- term: what the official typed (or the pattern). term_norm: filter_words of
-- it (the pattern itself for patterns), so the same word cannot be listed
-- twice. lang is for the list only: every active term is checked on every
-- text, whatever its language. action: only 'hold' for now. draft: a
-- starter term not yet reviewed by the official account (any decision in
-- the app clears it).
create table if not exists public.content_filter_terms (
  term_id uuid primary key default gen_random_uuid(),
  term text not null check (char_length(term) between 1 and 400),
  term_norm text not null,
  lang text not null default 'any' check (lang in ('en', 'ckb', 'kmr', 'ar', 'any')),
  kind text not null check (kind in ('abuse', 'prediction', 'spam', 'other')),
  action text not null default 'hold' check (action in ('hold')),
  is_pattern boolean not null default false,
  active boolean not null default true,
  draft boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists content_filter_terms_norm_idx
  on public.content_filter_terms (is_pattern, term_norm);
alter table public.content_filter_terms enable row level security;
revoke all on public.content_filter_terms from public, anon, authenticated;
-- no policies: read and written through the admin functions below only.

-- Why a comment or post was held. Private: moderators read it through
-- content_holds_for(). target_id has no foreign key (the row is written
-- before the comment or post exists, in its insert trigger); a failed
-- insert takes its hold rows with it.
create table if not exists public.content_holds (
  hold_id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('comment', 'post')),
  target_id uuid not null,
  user_id uuid references auth.users (id) on delete cascade,
  reason text not null check (reason in ('filter', 'surge')),
  term_id uuid references public.content_filter_terms (term_id) on delete set null,
  term text,
  kind text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists content_holds_target_idx
  on public.content_holds (target_type, target_id);
create index if not exists content_holds_term_idx
  on public.content_holds (term_id, created_at desc);
alter table public.content_holds enable row level security;
revoke all on public.content_holds from public, anon, authenticated;

-- One row per setting. Today only 'surge': {"mode": "auto" | "on" | "off",
-- "until": timestamp}. A forced mode ends at "until" (24 hours after the
-- switch), then automatic again.
create table if not exists public.moderation_settings (
  key text primary key check (key in ('surge')),
  value jsonb not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.moderation_settings enable row level security;
revoke all on public.moderation_settings from public, anon, authenticated;
insert into public.moderation_settings (key, value) values ('surge', '{"mode": "auto"}'::jsonb)
on conflict (key) do nothing;

-- 4. Posts: the held state; comments: the pin ----------------------------------------------------
alter table public.profile_posts add column if not exists held_at timestamptz;
alter table public.profile_posts drop constraint if exists profile_posts_status_check;
alter table public.profile_posts
  add constraint profile_posts_status_check
  check (status in ('visible', 'pending', 'removed', 'deleted'));
create index if not exists profile_posts_pending_idx
  on public.profile_posts (created_at) where status = 'pending';

alter table public.event_comments add column if not exists pinned_at timestamptz;
create unique index if not exists event_comments_one_pin_idx
  on public.event_comments (event_id) where pinned_at is not null;

-- 5. Matching --------------------------------------------------------------------------------
-- Every active term the text matches. A pattern that does not compile is
-- skipped, never an error for the person writing. Internal.
create or replace function public.content_filter_matches(p_text text)
returns table (term_id uuid, term text, kind text, lang text, is_pattern boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_text text := public.filter_text(p_text);
  v_words text := public.filter_words(p_text);
  v_tokens text[];
  r record;
begin
  if coalesce(v_words, '') = '' then
    return;
  end if;
  v_tokens := string_to_array(v_words, ' ');
  return query
    select t.term_id, t.term, t.kind, t.lang, false
      from public.content_filter_terms t
     where t.active
       and not t.is_pattern
       and t.term_norm <> ''
       and (
         (position(' ' in t.term_norm) = 0 and t.term_norm = any (v_tokens))
         or (position(' ' in t.term_norm) > 0 and position(t.term_norm in v_words) > 0)
       )
     order by t.created_at, t.term_id;
  for r in
    select t.term_id, t.term, t.kind, t.lang
      from public.content_filter_terms t
     where t.active and t.is_pattern
     order by t.created_at, t.term_id
  loop
    begin
      if v_text ~ r.term then
        term_id := r.term_id;
        term := r.term;
        kind := r.kind;
        lang := r.lang;
        is_pattern := true;
        return next;
      end if;
    exception when others then
      null;
    end;
  end loop;
end
$$;

-- 6. Busy times ------------------------------------------------------------------------------
-- Account age: the profile's creation (an install that later made an
-- account counts from the account), else the sign-in record.
create or replace function public.account_is_new(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select coalesce(p.created_at, u.created_at) > now() - interval '7 days'
      from auth.users u
      left join public.profiles p on p.user_id = u.id
     where u.id = p_user
  ), false)
$$;

-- The busy-time state and why. Thresholds: a regional event of M5.0 or more
-- in the last 24 hours, or an event of the last 24 hours with 50 felt
-- reports in its first hour; or the official's forced mode.
create or replace function public.surge_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
  v_mode text;
  v_until timestamptz;
  v_ev record;
  v_felt record;
begin
  select s.value into v_value from public.moderation_settings s where s.key = 'surge';
  v_mode := coalesce(v_value ->> 'mode', 'auto');
  v_until := nullif(v_value ->> 'until', '')::timestamptz;
  if v_mode not in ('auto', 'on', 'off') or (v_until is not null and v_until <= now()) then
    v_mode := 'auto';
    v_until := null;
  end if;
  if v_mode = 'on' then
    return jsonb_build_object('active', true, 'mode', 'on', 'until', v_until, 'reason', 'manual');
  end if;
  if v_mode = 'off' then
    return jsonb_build_object('active', false, 'mode', 'off', 'until', v_until, 'reason', 'manual');
  end if;
  select e.bumelerze_id, e.magnitude, e.place, e.origin_time
    into v_ev
    from public.events e
   where e.region_flag
     and e.magnitude >= 5.0
     and e.origin_time > now() - interval '24 hours'
     and e.origin_time <= now() + interval '10 minutes'
     and e.merged_into is null
     and e.review_status <> 'deleted'
   order by e.magnitude desc, e.origin_time desc
   limit 1;
  if found then
    return jsonb_build_object(
      'active', true, 'mode', 'auto', 'until', v_ev.origin_time + interval '24 hours',
      'reason', 'magnitude', 'event_ref', v_ev.bumelerze_id,
      'magnitude', v_ev.magnitude, 'place', v_ev.place, 'origin_time', v_ev.origin_time
    );
  end if;
  select e.bumelerze_id, e.place, e.origin_time, count(*)::integer as n
    into v_felt
    from public.events e
    join public.felt_reports fr on fr.event_id = e.event_id
   where e.origin_time > now() - interval '24 hours'
     and e.review_status <> 'deleted'
     and fr.created_at >= e.origin_time
     and fr.created_at < e.origin_time + interval '1 hour'
   group by e.event_id, e.bumelerze_id, e.place, e.origin_time
  having count(*) >= 50
   order by count(*) desc
   limit 1;
  if found then
    return jsonb_build_object(
      'active', true, 'mode', 'auto', 'until', v_felt.origin_time + interval '24 hours',
      'reason', 'felt', 'event_ref', v_felt.bumelerze_id, 'place', v_felt.place,
      'origin_time', v_felt.origin_time, 'reports', v_felt.n
    );
  end if;
  return jsonb_build_object('active', false, 'mode', 'auto', 'until', null, 'reason', null);
end
$$;

create or replace function public.surge_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((public.surge_state() ->> 'active')::boolean, false)
$$;

-- For the Event hub banner: on or off, nothing else.
create or replace function public.hub_surge_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.surge_active()
$$;

-- 7. Holding in the write path ------------------------------------------------------------------
-- A new comment. Runs after event_comments_before_insert (name order), so
-- the status is already the server's: 'visible' for an account, 'pending'
-- for a guest. A client can never pin.
create or replace function public.event_comments_hold_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  new.pinned_at := null;
  if new.status not in ('visible', 'pending')
     or public.has_permission(new.user_id, 'comments.moderate') then
    return new;
  end if;
  insert into public.content_holds (target_type, target_id, user_id, reason, term_id, term, kind)
  select 'comment', new.comment_id, new.user_id, 'filter', m.term_id, m.term, m.kind
    from public.content_filter_matches(new.body) m;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    new.status := 'pending';
  elsif new.status = 'visible'
        and public.account_is_new(new.user_id)
        and public.surge_active() then
    new.status := 'pending';
    insert into public.content_holds (target_type, target_id, user_id, reason)
    values ('comment', new.comment_id, new.user_id, 'surge');
  end if;
  return new;
end
$$;
drop trigger if exists event_comments_hold_check on public.event_comments;
create trigger event_comments_hold_check before insert on public.event_comments
  for each row execute function public.event_comments_hold_check();

-- Any change to a comment: readers' reports cannot send a pinned comment
-- back to review (0052's auto-hide is undone here; the flag count stays, so
-- it waits in the queue as "reported"); a comment that stops being a
-- visible top-level comment is unpinned; leaving review closes its holds
-- (an author's own delete does not: Undo brings it back to review).
create or replace function public.event_comments_pin_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.pinned_at is not null and old.status = 'visible' and new.status = 'pending' then
    new.status := 'visible';
    new.hidden_reason := old.hidden_reason;
  end if;
  if new.pinned_at is not null and (
       new.status <> 'visible'
       or new.parent_id is not null
       or new.author_deleted_at is not null
       or new.account_deleted_at is not null
     ) then
    new.pinned_at := null;
  end if;
  if old.status = 'pending' and new.status <> 'pending'
     and not (new.status = 'hidden' and new.author_deleted_at is not null) then
    update public.content_holds
       set resolved_at = now()
     where target_type = 'comment' and target_id = new.comment_id and resolved_at is null;
  end if;
  return new;
end
$$;
drop trigger if exists event_comments_pin_guard on public.event_comments;
create trigger event_comments_pin_guard before update on public.event_comments
  for each row execute function public.event_comments_pin_guard();

-- Posts. New: like comments (accounts only write posts). Edited by the
-- author: the filter only (busy times are about new accounts' new posts).
-- Restored by the author after a delete while held: held again. Approved,
-- removed or restored by an admin: the holds close and held_at clears.
create or replace function public.profile_posts_hold_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if tg_op = 'INSERT' then
    new.held_at := null;
    if new.status <> 'visible' or public.has_permission(new.user_id, 'comments.moderate') then
      return new;
    end if;
    insert into public.content_holds (target_type, target_id, user_id, reason, term_id, term, kind)
    select 'post', new.post_id, new.user_id, 'filter', m.term_id, m.term, m.kind
      from public.content_filter_matches(new.body) m;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      new.status := 'pending';
      new.held_at := now();
    elsif public.account_is_new(new.user_id) and public.surge_active() then
      new.status := 'pending';
      new.held_at := now();
      insert into public.content_holds (target_type, target_id, user_id, reason)
      values ('post', new.post_id, new.user_id, 'surge');
    end if;
    return new;
  end if;

  if new.body is distinct from old.body
     and old.status = 'visible'
     and new.status = 'visible'
     and auth.uid() is not distinct from new.user_id
     and not public.has_permission(new.user_id, 'comments.moderate') then
    insert into public.content_holds (target_type, target_id, user_id, reason, term_id, term, kind)
    select 'post', new.post_id, new.user_id, 'filter', m.term_id, m.term, m.kind
      from public.content_filter_matches(new.body) m;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      new.status := 'pending';
      new.held_at := now();
    end if;
  elsif old.status = 'deleted'
        and new.status = 'visible'
        and old.held_at is not null
        and auth.uid() is not distinct from new.user_id then
    new.status := 'pending';
  end if;

  if old.status in ('pending', 'removed') and new.status in ('visible', 'removed')
     and old.status <> new.status then
    update public.content_holds
       set resolved_at = now()
     where target_type = 'post' and target_id = new.post_id and resolved_at is null;
    if new.status = 'visible' then
      new.held_at := null;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists profile_posts_hold_check on public.profile_posts;
create trigger profile_posts_hold_check before insert or update on public.profile_posts
  for each row execute function public.profile_posts_hold_check();

-- 8. Moderators: why something waits, approve a held post ------------------------------------------
-- The open holds of the given comments or posts (at most 200 ids).
create or replace function public.content_holds_for(p_target_type text, p_ids uuid[])
returns table (target_id uuid, reason text, term text, kind text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'content_holds_for: not_allowed' using errcode = '42501';
  end if;
  if p_target_type not in ('comment', 'post') then
    raise exception 'content_holds_for: kind_invalid' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_ids), 0) > 200 then
    raise exception 'content_holds_for: too_many' using errcode = '22023';
  end if;
  return query
    select h.target_id, h.reason, h.term, h.kind, h.created_at
      from public.content_holds h
     where h.target_type = p_target_type
       and h.target_id = any (coalesce(p_ids, '{}'::uuid[]))
       and h.resolved_at is null
     order by h.created_at, h.hold_id;
end
$$;

-- Approve a held post (comments.moderate, like approving a comment).
-- Repeating it is harmless. Tokens: not_allowed, not_found.
create or replace function public.admin_approve_post(p_post_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_status text;
  v_terms jsonb;
begin
  if not public.has_permission(v_uid, 'comments.moderate') then
    raise exception 'admin_approve_post: not_allowed' using errcode = '42501';
  end if;
  select po.user_id, po.status into v_author, v_status
    from public.profile_posts po
   where po.post_id = p_post_id
   for update;
  if not found then
    raise exception 'admin_approve_post: not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    return;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('reason', h.reason, 'term', h.term, 'kind', h.kind)), '[]'::jsonb)
    into v_terms
    from public.content_holds h
   where h.target_type = 'post' and h.target_id = p_post_id and h.resolved_at is null;
  update public.profile_posts
     set status = 'visible', held_at = null, updated_at = now()
   where post_id = p_post_id;
  perform public.write_audit(
    v_uid, 'post_approve', 'post', p_post_id::text,
    v_author, null, p_post_id, null, p_note,
    jsonb_build_object('status', v_status, 'holds', v_terms)
  );
end
$$;

-- 0056's post_queue plus: held posts (with or without reports) first, and
-- the status of each row.
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
  last_note text,
  status text
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
           coalesce(rc.n, 0)::integer,
           rc.last_reason,
           rc.last_at,
           po.created_at,
           rc.last_note,
           po.status
      from public.profile_posts po
      left join public.profiles pr on pr.user_id = po.user_id
      left join lateral (
        select count(*)::integer as n,
               (array_agg(r.reason order by r.created_at desc))[1] as last_reason,
               max(r.created_at) as last_at,
               (array_agg(r.note order by r.created_at desc))[1] as last_note
          from public.post_reports r
         where r.post_id = po.post_id and r.resolved_at is null
      ) rc on true
     where po.status = 'pending'
        or (
          po.status = 'visible'
          and po.post_id in (select r2.post_id from public.post_reports r2 where r2.resolved_at is null)
        )
     order by (po.status = 'pending') desc, coalesce(rc.n, 0) desc,
              coalesce(rc.last_at, po.created_at) desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

-- 0058's share, plus: the replay check also finds the share when it is
-- waiting for review, so a retry never makes a second post.
create or replace function public.share_event_to_profile(p_event text, p_body text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := btrim(coalesce(p_event, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_event uuid;
  v_post uuid;
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'share_event_to_profile: not_account' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p where p.user_id = v_uid and p.username is not null
  ) then
    raise exception 'share_event_to_profile: profile_required' using errcode = '42501';
  end if;
  if char_length(v_body) > 280 then
    raise exception 'share_event_to_profile: too_long' using errcode = '22023';
  end if;
  select coalesce(e0.merged_into, e0.event_id) into v_event
    from public.events e0
   where v_ref <> ''
     and (e0.bumelerze_id = v_ref or e0.event_id::text = lower(v_ref))
   limit 1;
  if v_event is null or not exists (
    select 1 from public.events e where e.event_id = v_event and e.review_status <> 'deleted'
  ) then
    raise exception 'share_event_to_profile: event_not_found' using errcode = 'P0002';
  end if;
  select po.post_id into v_post
    from public.profile_posts po
   where po.user_id = v_uid
     and po.kind = 'event'
     and po.event_id = v_event
     and po.status in ('visible', 'pending')
     and po.body = v_body
     and po.created_at > now() - interval '10 minutes'
   order by po.created_at desc
   limit 1;
  if v_post is not null then
    return v_post;
  end if;
  insert into public.profile_posts (user_id, body, kind, event_id)
  values (v_uid, v_body, 'event', v_event)
  returning post_id into v_post;
  return v_post;
end
$$;

-- 9. The official: the list, a test box, busy times -------------------------------------------------
-- The list, with how often each term held something in the last 30 days.
create or replace function public.admin_filter_terms()
returns table (
  term_id uuid,
  term text,
  lang text,
  kind text,
  is_pattern boolean,
  active boolean,
  draft boolean,
  created_at timestamptz,
  created_by_name text,
  holds_30d integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'filter.manage') then
    raise exception 'admin_filter_terms: not_allowed' using errcode = '42501';
  end if;
  return query
    select t.term_id, t.term, t.lang, t.kind, t.is_pattern, t.active, t.draft, t.created_at,
           p.display_name,
           (select count(*)::integer from public.content_holds h
             where h.term_id = t.term_id and h.created_at > now() - interval '30 days')
      from public.content_filter_terms t
      left join public.profiles p on p.user_id = t.created_by
     order by t.active desc, t.kind, t.lang, t.term;
end
$$;

-- Add a word or phrase (patterns only through the SQL editor). Adding a
-- term that is listed already switches it on again and returns its id.
create or replace function public.admin_add_filter_term(p_term text, p_lang text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_term text := btrim(regexp_replace(coalesce(p_term, ''), '[[:space:]]+', ' ', 'g'));
  v_norm text;
  v_id uuid;
begin
  if not public.has_permission(v_uid, 'filter.manage') then
    raise exception 'admin_add_filter_term: not_allowed' using errcode = '42501';
  end if;
  v_norm := public.filter_words(v_term);
  if char_length(v_term) > 100 or char_length(coalesce(v_norm, '')) < 2 then
    raise exception 'admin_add_filter_term: term_invalid' using errcode = '22023';
  end if;
  if coalesce(p_lang, '') not in ('en', 'ckb', 'kmr', 'ar', 'any') then
    raise exception 'admin_add_filter_term: lang_invalid' using errcode = '22023';
  end if;
  if coalesce(p_kind, '') not in ('abuse', 'prediction', 'spam', 'other') then
    raise exception 'admin_add_filter_term: kind_invalid' using errcode = '22023';
  end if;
  insert into public.content_filter_terms (term, term_norm, lang, kind, created_by)
  values (v_term, v_norm, p_lang, p_kind, v_uid)
  on conflict (is_pattern, term_norm) do update
    set active = true, draft = false, lang = excluded.lang, kind = excluded.kind,
        updated_at = now()
  returning term_id into v_id;
  perform public.write_audit(
    v_uid, 'filter_term_add', 'system', v_id::text,
    null, null, null, p_kind, null,
    jsonb_build_object('term', v_term, 'lang', p_lang, 'kind', p_kind)
  );
  return v_id;
end
$$;

-- Switch a term on or off. Either way it counts as reviewed (draft clears).
create or replace function public.admin_set_filter_term(p_term_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_before boolean;
  v_term text;
begin
  if not public.has_permission(v_uid, 'filter.manage') then
    raise exception 'admin_set_filter_term: not_allowed' using errcode = '42501';
  end if;
  select t.active, t.term into v_before, v_term
    from public.content_filter_terms t
   where t.term_id = p_term_id
   for update;
  if not found then
    raise exception 'admin_set_filter_term: not_found' using errcode = 'P0002';
  end if;
  update public.content_filter_terms
     set active = coalesce(p_active, false), draft = false, updated_at = now()
   where term_id = p_term_id;
  perform public.write_audit(
    v_uid, 'filter_term_update', 'system', p_term_id::text,
    null, null, null, null, null,
    jsonb_build_object('term', v_term, 'active_before', v_before, 'active', coalesce(p_active, false))
  );
end
$$;

-- "Would this be held": the terms a text matches (nothing is recorded), and
-- whether busy-time review is on right now.
create or replace function public.admin_test_filter(p_text text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_matches jsonb;
begin
  if not public.has_permission(auth.uid(), 'filter.manage') then
    raise exception 'admin_test_filter: not_allowed' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'term', m.term, 'kind', m.kind, 'lang', m.lang, 'is_pattern', m.is_pattern)), '[]'::jsonb)
    into v_matches
    from public.content_filter_matches(left(coalesce(p_text, ''), 1000)) m;
  return jsonb_build_object(
    'held', jsonb_array_length(v_matches) > 0,
    'matches', v_matches,
    'surge', public.surge_active()
  );
end
$$;

create or replace function public.admin_surge_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission(auth.uid(), 'filter.manage') then
    raise exception 'admin_surge_status: not_allowed' using errcode = '42501';
  end if;
  return public.surge_state() || jsonb_build_object(
    'min_magnitude', 5.0, 'felt_reports', 50, 'account_days', 7, 'hours', 24
  );
end
$$;

-- auto, on (24 hours) or off (24 hours).
create or replace function public.admin_set_surge_mode(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
begin
  if not public.has_permission(v_uid, 'filter.manage') then
    raise exception 'admin_set_surge_mode: not_allowed' using errcode = '42501';
  end if;
  if coalesce(p_mode, '') not in ('auto', 'on', 'off') then
    raise exception 'admin_set_surge_mode: mode_invalid' using errcode = '22023';
  end if;
  select s.value into v_before from public.moderation_settings s where s.key = 'surge';
  v_after := case
    when p_mode = 'auto' then jsonb_build_object('mode', 'auto')
    else jsonb_build_object('mode', p_mode, 'until', now() + interval '24 hours')
  end;
  insert into public.moderation_settings (key, value, updated_by, updated_at)
  values ('surge', v_after, v_uid, now())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform public.write_audit(
    v_uid, 'surge_set', 'system', 'surge',
    null, null, null, p_mode, null,
    jsonb_build_object('before', v_before, 'after', v_after)
  );
  return public.admin_surge_status();
end
$$;

-- 10. Pinned note -----------------------------------------------------------------------------------
-- Pin one visible top-level comment of an Event hub (hubs.feature); the
-- hub's earlier pin is replaced. Repeating it is harmless.
create or replace function public.pin_hub_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_c record;
  v_prev uuid;
begin
  if not public.has_permission(v_uid, 'hubs.feature') then
    raise exception 'pin_hub_comment: not_allowed' using errcode = '42501';
  end if;
  select c.comment_id, c.event_id, c.parent_id, c.status, c.user_id, c.pinned_at,
         c.author_deleted_at, c.account_deleted_at
    into v_c
    from public.event_comments c
   where c.comment_id = p_comment_id
   for update;
  if not found then
    raise exception 'pin_hub_comment: not_found' using errcode = 'P0002';
  end if;
  if v_c.parent_id is not null then
    raise exception 'pin_hub_comment: not_top_level' using errcode = '22023';
  end if;
  if v_c.status <> 'visible' or v_c.author_deleted_at is not null or v_c.account_deleted_at is not null then
    raise exception 'pin_hub_comment: not_visible' using errcode = '22023';
  end if;
  if v_c.pinned_at is not null then
    return;
  end if;
  select c.comment_id into v_prev
    from public.event_comments c
   where c.event_id = v_c.event_id and c.pinned_at is not null
   for update;
  update public.event_comments
     set pinned_at = null
   where event_id = v_c.event_id and pinned_at is not null;
  update public.event_comments
     set pinned_at = now()
   where comment_id = p_comment_id;
  perform public.write_audit(
    v_uid, 'comment_pin', 'comment', p_comment_id::text,
    v_c.user_id, p_comment_id, null, null, null,
    jsonb_build_object('event_id', v_c.event_id, 'previous', v_prev)
  );
end
$$;

create or replace function public.unpin_hub_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_event uuid;
begin
  if not public.has_permission(v_uid, 'hubs.feature') then
    raise exception 'unpin_hub_comment: not_allowed' using errcode = '42501';
  end if;
  update public.event_comments
     set pinned_at = null
   where comment_id = p_comment_id and pinned_at is not null
  returning user_id, event_id into v_author, v_event;
  if found then
    perform public.write_audit(
      v_uid, 'comment_unpin', 'comment', p_comment_id::text,
      v_author, p_comment_id, null, null, null,
      jsonb_build_object('event_id', v_event)
    );
  end if;
end
$$;

-- 11. Starter list (drafts for the official to review) ------------------------------------------------
-- Conservative on purpose: predictions name a time or claim a coming big
-- one, so testimonies ("it woke me at 3 am") are not caught. Abuse and spam
-- are a handful of obvious phrases, no slur list. Every row is a draft
-- until the official keeps or switches it off in Admin.
insert into public.content_filter_terms (term, term_norm, lang, kind, is_pattern, draft)
select v.term,
       case when v.pat then v.term else public.filter_words(v.term) end,
       v.lang, v.kind, v.pat, true
  from (values
    ('quake tomorrow', 'en', 'prediction', false),
    ('quake tonight', 'en', 'prediction', false),
    ('quake next week', 'en', 'prediction', false),
    ('earthquake predicted', 'en', 'prediction', false),
    ('earthquake is predicted', 'en', 'prediction', false),
    ('earthquake was predicted', 'en', 'prediction', false),
    ('predicted earthquake', 'en', 'prediction', false),
    ('predicted an earthquake', 'en', 'prediction', false),
    ('predicts an earthquake', 'en', 'prediction', false),
    ('dam will collapse', 'en', 'prediction', false),
    ('dam is collapsing', 'en', 'prediction', false),
    ('\m(big|bigger|stronger|huge|massive) (one|earthquake|quake) (is |will be ){0,1}(coming|expected|on its way)\M', 'en', 'prediction', true),
    ('\m(tonight|tomorrow|next (week|month)|will (hit|strike|come)|going to (hit|strike))\M.{0,40}\m[0-9]{1,2}(:[0-9]{2}){0,1} {0,1}(am|pm|o''clock|oclock)\M|\m[0-9]{1,2}(:[0-9]{2}){0,1} {0,1}(am|pm)\M.{0,30}\m(tonight|tomorrow)\M', 'en', 'prediction', true),
    ('kill yourself', 'en', 'abuse', false),
    ('kys', 'en', 'abuse', false),
    ('buy followers', 'en', 'spam', false),
    ('free followers', 'en', 'spam', false),
    ('earn money from home', 'en', 'spam', false),
    ('guaranteed profit', 'en', 'spam', false),
    ('(\+964 {0,1}|00964 {0,1}|\m0)7[0-9]{2}[ -]{0,1}[0-9]{3}[ -]{0,1}[0-9]{4}\M', 'any', 'other', true),
    (U&'\0628\0648\0648\0645\06D5\0644\06D5\0631\0632\06D5 \0633\0628\06D5\06CC\0646\06CE', 'ckb', 'prediction', false),
    (U&'\0633\0628\06D5\06CC\0646\06CE \0628\0648\0648\0645\06D5\0644\06D5\0631\0632\06D5', 'ckb', 'prediction', false),
    (U&'\0626\06D5\0645\0634\06D5\0648 \0628\0648\0648\0645\06D5\0644\06D5\0631\0632\06D5', 'ckb', 'prediction', false),
    (U&'\0628\0648\0648\0645\06D5\0644\06D5\0631\0632\06D5 \0626\06D5\0645\0634\06D5\0648', 'ckb', 'prediction', false),
    (U&'\0628\0648\0648\0645\06D5\0644\06D5\0631\0632\06D5\06CC\06D5\06A9\06CC \06AF\06D5\0648\0631\06D5 \062F\06CE\062A', 'ckb', 'prediction', false),
    (U&'\0628\0648\0648\0645\06D5\0644\06D5\0631\0632\06D5\06CC \06AF\06D5\0648\0631\06D5 \062F\06CE\062A', 'ckb', 'prediction', false),
    (U&'\067E\06CE\0634\0628\06CC\0646\06CC \0628\0648\0648\0645\06D5\0644\06D5\0631\0632\06D5', 'ckb', 'prediction', false),
    (U&'\0633\0628\06D5\06CC\0646\06CE \0632\06D5\0644\0632\06D5\0644\06D5', 'ckb', 'prediction', false),
    (U&'\0632\06D5\0644\0632\06D5\0644\06D5\06CC \06AF\06D5\0648\0631\06D5 \062F\06CE\062A', 'ckb', 'prediction', false),
    ('(^|[ [:punct:]])(' || public.filter_text(U&'\0633\0628\06D5\06CC\0646\06CE') || '|' || public.filter_text(U&'\0626\06D5\0645\0634\06D5\0648') || ').{0,30}(' || public.filter_text(U&'\06A9\0627\062A\0698\0645\06CE\0631') || '|' || public.filter_text(U&'\0633\06D5\0639\0627\062A') || ') {0,1}[0-9]', 'ckb', 'prediction', true),
    (U&'\062E\06C6\062A \0628\06A9\0648\0698\06D5', 'ckb', 'abuse', false),
    (U&'sib\00EA erdhej', 'kmr', 'prediction', false),
    (U&'\00EE\015Fev erdhej', 'kmr', 'prediction', false),
    (U&'erdhejeke mezin t\00EA', 'kmr', 'prediction', false),
    (U&'erdheja mezin t\00EA', 'kmr', 'prediction', false),
    (U&'p\00EA\015Fb\00EEniya erdhej', 'kmr', 'prediction', false),
    ('\m(' || public.filter_text(U&'sib\00EA') || '|' || public.filter_text(U&'\00EE\015Fev') || ')\M.{0,30}\m(saet|seet|' || public.filter_text(U&'demjim\00EAr') || ') {0,1}[0-9]', 'kmr', 'prediction', true),
    ('xwe bikuje', 'kmr', 'abuse', false),
    (U&'\0632\0644\0632\0627\0644 \063A\062F\0627', 'ar', 'prediction', false),
    (U&'\0632\0644\0632\0627\0644 \0627\0644\0644\064A\0644\0629', 'ar', 'prediction', false),
    (U&'\0633\064A\0636\0631\0628 \0632\0644\0632\0627\0644', 'ar', 'prediction', false),
    (U&'\0632\0644\0632\0627\0644 \0633\064A\0636\0631\0628', 'ar', 'prediction', false),
    (U&'\0632\0644\0632\0627\0644 \0642\0648\064A \0642\0627\062F\0645', 'ar', 'prediction', false),
    (U&'\0632\0644\0632\0627\0644 \0643\0628\064A\0631 \0642\0627\062F\0645', 'ar', 'prediction', false),
    (U&'\0632\0644\0632\0627\0644 \0645\062F\0645\0631 \0642\0627\062F\0645', 'ar', 'prediction', false),
    (U&'\062A\0646\0628\0624 \0628\0632\0644\0632\0627\0644', 'ar', 'prediction', false),
    (U&'\062A\0648\0642\0639 \0632\0644\0632\0627\0644', 'ar', 'prediction', false),
    (U&'\062A\0648\0642\0639\0627\062A \0632\0644\0632\0627\0644', 'ar', 'prediction', false),
    (U&'\0627\0646\0647\064A\0627\0631 \0633\062F \0627\0644\0645\0648\0635\0644', 'ar', 'prediction', false),
    ('(^|[ [:punct:]])(' || public.filter_text(U&'\063A\062F\0627') || '|' || public.filter_text(U&'\0627\0644\0644\064A\0644\0629') || '|' || public.filter_text(U&'\0633\064A\0636\0631\0628') || '|' || public.filter_text(U&'\0633\064A\062D\062F\062B') || ').{0,30}' || public.filter_text(U&'\0627\0644\0633\0627\0639\0629') || ' {0,1}[0-9]', 'ar', 'prediction', true),
    (U&'\0627\0642\062A\0644 \0646\0641\0633\0643', 'ar', 'abuse', false),
    (U&'\0627\0631\0628\062D \0627\0644\0645\0627\0644', 'ar', 'spam', false),
    (U&'\0631\0628\062D \0645\0636\0645\0648\0646', 'ar', 'spam', false)
  ) as v(term, lang, kind, pat)
on conflict (is_pattern, term_norm) do nothing;

-- 12. Who may call what -------------------------------------------------------------------------------
revoke all on function public.filter_fold(text) from public, anon, authenticated;
revoke all on function public.filter_text(text) from public, anon, authenticated;
revoke all on function public.filter_words(text) from public, anon, authenticated;
revoke all on function public.content_filter_matches(text) from public, anon, authenticated;
revoke all on function public.account_is_new(uuid) from public, anon, authenticated;
revoke all on function public.surge_state() from public, anon, authenticated;
revoke all on function public.surge_active() from public, anon, authenticated;
revoke all on function public.hub_surge_active() from public;
revoke all on function public.event_comments_hold_check() from public, anon, authenticated;
revoke all on function public.event_comments_pin_guard() from public, anon, authenticated;
revoke all on function public.profile_posts_hold_check() from public, anon, authenticated;
revoke all on function public.content_holds_for(text, uuid[]) from public, anon;
revoke all on function public.admin_approve_post(uuid, text) from public, anon;
revoke all on function public.post_queue(integer) from public, anon;
revoke all on function public.share_event_to_profile(text, text) from public, anon;
revoke all on function public.admin_filter_terms() from public, anon;
revoke all on function public.admin_add_filter_term(text, text, text) from public, anon;
revoke all on function public.admin_set_filter_term(uuid, boolean) from public, anon;
revoke all on function public.admin_test_filter(text) from public, anon;
revoke all on function public.admin_surge_status() from public, anon;
revoke all on function public.admin_set_surge_mode(text) from public, anon;
revoke all on function public.pin_hub_comment(uuid) from public, anon;
revoke all on function public.unpin_hub_comment(uuid) from public, anon;
grant execute on function public.hub_surge_active() to anon, authenticated;
grant execute on function public.content_holds_for(text, uuid[]) to authenticated;
grant execute on function public.admin_approve_post(uuid, text) to authenticated;
grant execute on function public.post_queue(integer) to authenticated;
grant execute on function public.share_event_to_profile(text, text) to authenticated;
grant execute on function public.admin_filter_terms() to authenticated;
grant execute on function public.admin_add_filter_term(text, text, text) to authenticated;
grant execute on function public.admin_set_filter_term(uuid, boolean) to authenticated;
grant execute on function public.admin_test_filter(text) to authenticated;
grant execute on function public.admin_surge_status() to authenticated;
grant execute on function public.admin_set_surge_mode(text) to authenticated;
grant execute on function public.pin_hub_comment(uuid) to authenticated;
grant execute on function public.unpin_hub_comment(uuid) to authenticated;
