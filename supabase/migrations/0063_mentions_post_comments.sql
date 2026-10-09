-- 0063: comments on profile posts and @mentions (review
-- social-admin-review-2026-10-08 section 5, items listed as P3; the owner asked
-- for both on 2026-10-09). Decisions D76, D78 to D83.
--
--   1. Comments on profile posts (post_comments). One level of replies (a
--      reply to a reply joins the top comment, as in the Event hub). At most
--      500 characters. Who may comment: an ACCOUNT (not a guest) with a
--      @username, who may read the post (the same rule as can_read_post), is
--      not in a block either way with the post's author or with the person
--      replied to, is not restricted (0054) and accepted the community
--      guidelines (0056); 20 comments in 10 minutes at most. The word filter
--      and busy-time review (0059) hold a comment for review exactly as a
--      post. The post's author can switch comments off per post
--      (profile_posts.comments_off, set_post_comments_off) and delete anybody's
--      comment on their own post (quietly, with 24 hours of Undo). The author
--      of a comment deletes it with 24 hours of Undo too ("Recently deleted").
--      Reads: post_comments_page() (who may see what is decided there, never
--      by a table grant; the table has no client privilege at all) and the
--      comment count in profile_posts_page().
--   2. Moderation of post comments, like Event hub comments: report through
--      the shared report sheet (post_comment_reports, the 0056 reasons and
--      note, 20 a day); moderators approve or hide (moderate_post_comment),
--      the official account removes with an evidence copy
--      (admin_remove_post_comment) and restores (admin_restore_post_comment,
--      30 days), every action audited (write_audit) and undoable from the
--      Activity screen (admin_undo_action); held and reported comments are
--      listed by post_comment_queue(); Admin > Hidden and removed lists them.
--   3. Activity (0061): the post's author gets post_comment, the author of
--      the comment replied to gets post_comment_reply, both once the comment
--      is visible and withdrawn when it stops being visible. A hide or
--      removal tells the author (content_removed, with "Ask for review") and
--      the reporters (report_reviewed), as for hub comments.
--   4. @mentions in Event hub comments, profile posts and post comments.
--      Parsed on the server whenever the text is written (insert, a post
--      edit): @ followed by a username (0045 rules: a to z, 0 to 9, dot and
--      underscore, 3 to 24 characters; a trailing full stop is tried both
--      ways), not preceded by a letter, digit or @ (so an email address is
--      not a mention). At most 5 people per text; further names stay plain
--      text. Stored in mentions (one row per text and person). The person is
--      told (activity kind mention) ONLY when they can see the text
--      themselves: a visible hub comment, a post they may read
--      (can_read_post_as), a visible comment under such a post; never across
--      a block, never from someone they muted, never from a suspended
--      author. Hiding, removing or deleting the text, or editing the name
--      out, takes the notice back; it is also re-checked every time the list
--      is read. A mention never shows anybody anything they could not see
--      already. mention_suggestions() (people I follow or who follow me
--      first, then public accounts; never private accounts I cannot see,
--      never blocked or suspended people; 8 at most) and mention_lookup()
--      (which @names exist, for links) serve the app.
--   5. Account deletion: a deleted account's post comments are blanked like
--      hub comments (0056): text wiped, author link gone, "Deleted account".
--      This is done by a trigger on the foreign key's set null, so
--      delete_my_account() is unchanged. Mentions made by or of the person
--      cascade. export_my_data() adds the person's post comments, the
--      reports they made on post comments and the mentions they made; it is
--      wrapped (the version live before this migration becomes
--      export_my_data_base and is called unchanged), so whatever an earlier
--      batch added to it stays.
--
-- Shared check constraints (moderation_log action and target_type,
-- activity_items kind, content_holds target_type, moderation_evidence kind)
-- are rebuilt as the UNION of what the live constraint allows and the values
-- added here, never a fixed list.
--
-- Redefined from their latest versions: content_holds_for (0059),
-- profile_posts_page (0058, two new columns), my_recently_deleted (0058),
-- admin_hidden_removed (0053), admin_undo_action (0055), activity_visible,
-- my_activity (three new columns) and request_content_review (0061).
--
-- Error tokens (message text, the app maps them): not_account,
-- profile_required, not_found, comments_off, blocked, rate_limited, too_long,
-- empty, forbidden, expired, not_restorable, invalid_reason, plus the
-- restriction and guidelines tokens.
--
-- Needs 0035 to 0061. Independent of 0062. Idempotent: safe to run twice.
-- Written for the SQL editor as one line: no transaction statements, only
-- full-line comments, ASCII only, no question marks.

-- 1. One helper: rebuild a check constraint as a union ---------------------------------------
-- Reads the values of every check on p_table whose definition matches p_like,
-- adds p_add, drops them and creates p_name over the union. Internal.
create or replace function public.rebuild_check_union(
  p_table regclass,
  p_like text,
  p_name text,
  p_expr text,
  p_nullable boolean,
  p_add text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c record;
  v_vals text[] := coalesce(p_add, '{}'::text[]);
  v_list text;
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = p_table
       and contype = 'c'
       and pg_get_constraintdef(oid) like p_like
  loop
    v_vals := v_vals || coalesce((
      select array_agg(r.m[1])
        from regexp_matches(c.def, '''([a-z0-9_]+)''', 'g') as r(m)
    ), '{}'::text[]);
    v_vals := v_vals || coalesce((
      select array_agg(x)
        from regexp_matches(c.def, '''[{]([a-z0-9_,]+)[}]''', 'g') as r(m),
             unnest(string_to_array(r.m[1], ',')) as x
    ), '{}'::text[]);
    execute format('alter table %s drop constraint %I', p_table, c.conname);
  end loop;
  select string_agg(quote_literal(a), ', ' order by a) into v_list
    from (select distinct a from unnest(v_vals) as a where a <> 'text') d;
  execute format(
    'alter table %s add constraint %I check (%s%s in (%s))',
    p_table, p_name,
    case when p_nullable then p_expr || ' is null or ' else '' end,
    p_expr, v_list
  );
end
$$;
revoke all on function public.rebuild_check_union(regclass, text, text, text, boolean, text[]) from public, anon, authenticated;

-- 2. Tables ---------------------------------------------------------------------------------------
alter table public.profile_posts add column if not exists comments_off boolean not null default false;

create table if not exists public.post_comments (
  comment_id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.profile_posts (post_id) on delete cascade,
  parent_id uuid references public.post_comments (comment_id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  body text not null,
  status text not null default 'visible',
  hidden_reason text,
  author_deleted_at timestamptz,
  owner_deleted_at timestamptz,
  deleted_prev_status text,
  deleted_prev_reason text,
  account_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_comments_status_check
    check (status in ('visible', 'pending', 'hidden', 'removed')),
  constraint post_comments_body_check
    check (
      char_length(body) <= 500
      and (status in ('hidden', 'removed') or account_deleted_at is not null or char_length(btrim(body)) >= 1)
    ),
  constraint post_comments_reason_check
    check (hidden_reason is null or char_length(hidden_reason) <= 200)
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at desc);
create index if not exists post_comments_parent_idx on public.post_comments (parent_id);
create index if not exists post_comments_user_idx on public.post_comments (user_id, created_at desc);
create index if not exists post_comments_pending_idx on public.post_comments (created_at) where status = 'pending';
alter table public.post_comments enable row level security;
revoke all on public.post_comments from public, anon, authenticated;

create table if not exists public.post_comment_reports (
  report_id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.post_comments (comment_id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (comment_id, reporter_id),
  constraint post_comment_reports_reason_check
    check (reason in ('spam', 'abuse_harassment', 'rumour_prediction', 'private_info', 'sexual_violent', 'other')),
  constraint post_comment_reports_note_check
    check (note is null or char_length(note) <= 200)
);
create index if not exists post_comment_reports_open_idx
  on public.post_comment_reports (comment_id) where resolved_at is null;
create index if not exists post_comment_reports_reporter_idx
  on public.post_comment_reports (reporter_id, created_at desc);
alter table public.post_comment_reports enable row level security;
revoke all on public.post_comment_reports from public, anon, authenticated;

create table if not exists public.mentions (
  mention_id uuid primary key default gen_random_uuid(),
  comment_id uuid references public.event_comments (comment_id) on delete cascade,
  post_id uuid references public.profile_posts (post_id) on delete cascade,
  post_comment_id uuid references public.post_comments (comment_id) on delete cascade,
  source_type text generated always as (
    case when comment_id is not null then 'comment'
         when post_id is not null then 'post'
         else 'post_comment' end
  ) stored,
  source_id uuid generated always as (coalesce(comment_id, post_id, post_comment_id)) stored,
  mentioned_user_id uuid not null references auth.users (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint mentions_one_source check (num_nonnulls(comment_id, post_id, post_comment_id) = 1),
  constraint mentions_not_self check (mentioned_user_id <> author_id)
);
create unique index if not exists mentions_source_person_idx
  on public.mentions (source_type, source_id, mentioned_user_id);
create index if not exists mentions_mentioned_idx on public.mentions (mentioned_user_id);
create index if not exists mentions_author_idx on public.mentions (author_id);
alter table public.mentions enable row level security;
revoke all on public.mentions from public, anon, authenticated;

alter table public.activity_items
  add column if not exists post_comment_id uuid references public.post_comments (comment_id) on delete cascade;
create index if not exists activity_items_post_comment_idx
  on public.activity_items (post_comment_id) where post_comment_id is not null;

alter table public.moderation_evidence
  add column if not exists post_comment_id uuid references public.post_comments (comment_id) on delete set null;
create unique index if not exists moderation_evidence_post_comment_idx
  on public.moderation_evidence (post_comment_id) where post_comment_id is not null;

create index if not exists moderation_log_target_idx
  on public.moderation_log (target_type, target_id, created_at desc);

-- 3. Shared lists, as unions ------------------------------------------------------------------------
select public.rebuild_check_union(
  'public.moderation_log'::regclass, '%comment_approve%', 'moderation_log_action_check', 'action', false,
  array['post_comment_approve', 'post_comment_hide', 'post_comment_remove', 'post_comment_restore']
);
select public.rebuild_check_union(
  'public.moderation_log'::regclass, '%target_type%', 'moderation_log_target_type_check', 'target_type', true,
  array['post_comment']
);
select public.rebuild_check_union(
  'public.activity_items'::regclass, '%new_follower%', 'activity_items_kind_check', 'kind', false,
  array['post_comment', 'post_comment_reply', 'mention']
);
select public.rebuild_check_union(
  'public.content_holds'::regclass, '%target_type%', 'content_holds_target_type_check', 'target_type', false,
  array['comment', 'post', 'post_comment']
);
select public.rebuild_check_union(
  'public.moderation_evidence'::regclass, '%kind%', 'moderation_evidence_kind_check', 'kind', false,
  array['comment', 'post', 'post_comment']
);

-- 4. Who may read what (internal) ---------------------------------------------------------------
-- can_read_post (0058) for a given viewer instead of the caller: the author
-- reads their own post unless deleted; anybody else a visible post of a
-- person not in a block with them, public or followed (accepted), not
-- suspended. p_viewer may be null (not signed in).
create or replace function public.can_read_post_as(p_viewer uuid, p_author uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (p_viewer is not null and p_author = p_viewer and p_status <> 'deleted')
    or (
      p_status = 'visible'
      and p_author is not null
      and not public.blocked_between(p_viewer, p_author)
      and exists (
        select 1 from public.profiles pr
         where pr.user_id = p_author
           and (
             not pr.is_private
             or exists (
               select 1 from public.follows f
                where f.follower_id = p_viewer
                  and f.followee_id = p_author
                  and f.status = 'accepted'
             )
           )
      )
      and not public.is_suspended(p_author)
    ),
    false
  )
$$;

-- A visible comment under a visible post, both readable by p_viewer: the
-- post by can_read_post_as, the comment's author not in a block with the
-- viewer and not suspended.
create or replace function public.can_read_post_comment(p_viewer uuid, p_comment uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.post_comments c
      join public.profile_posts po on po.post_id = c.post_id
     where c.comment_id = p_comment
       and c.status = 'visible'
       and c.author_deleted_at is null
       and c.owner_deleted_at is null
       and c.account_deleted_at is null
       and c.user_id is not null
       and po.status = 'visible'
       and public.can_read_post_as(p_viewer, po.user_id, po.status)
       and (
         c.user_id = p_viewer
         or (not public.blocked_between(p_viewer, c.user_id) and not public.is_suspended(c.user_id))
       )
  )
$$;

-- Can p_viewer see the text a mention is in: a visible hub comment (not
-- blanked, author not blocked either way, not suspended), a post they may
-- read, or a post comment they may read.
create or replace function public.can_see_mention_source(p_viewer uuid, p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_type
    when 'comment' then exists (
      select 1 from public.event_comments c
       where c.comment_id = p_id
         and c.status = 'visible'
         and c.author_deleted_at is null
         and c.account_deleted_at is null
         and c.user_id is not null
         and not public.blocked_between(p_viewer, c.user_id)
         and not public.is_suspended(c.user_id)
    )
    when 'post' then exists (
      select 1 from public.profile_posts po
       where po.post_id = p_id
         and po.status = 'visible'
         and public.can_read_post_as(p_viewer, po.user_id, po.status)
    )
    when 'post_comment' then public.can_read_post_comment(p_viewer, p_id)
    else false
  end
$$;

-- Visible comments of a post the caller may count: not blanked, authors not
-- in a block with the caller and not suspended.
create or replace function public.post_comment_visible_count(p_post uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.post_comments c
   where c.post_id = p_post
     and c.status = 'visible'
     and c.author_deleted_at is null
     and c.owner_deleted_at is null
     and c.account_deleted_at is null
     and c.user_id is not null
     and (
       c.user_id = auth.uid()
       or (not public.blocked_between(auth.uid(), c.user_id) and not public.is_suspended(c.user_id))
     )
$$;

-- 5. Mentions --------------------------------------------------------------------------------------
-- The people a text mentions, in the order they first appear, at most 5,
-- never the author. A name ending in a full stop is tried as written, then
-- without the stop(s).
create or replace function public.mention_targets(p_body text, p_author uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(t.user_id order by t.pos), '{}'::uuid[])
    from (
      select x.user_id, min(x.pos) as pos
        from (
          select (
                   select p.user_id
                     from public.profiles p
                    where lower(p.username) in (c.name, rtrim(c.name, '.'))
                    order by (lower(p.username) = c.name) desc
                    limit 1
                 ) as user_id,
                 c.pos
            from (
              select lower(r.m[2]) as name, r.pos
                from regexp_matches(
                       coalesce(p_body, ''),
                       '(^|[^A-Za-z0-9_.@])@([A-Za-z0-9_.]{3,24})',
                       'g'
                     ) with ordinality as r(m, pos)
            ) c
        ) x
       where x.user_id is not null
         and x.user_id is distinct from p_author
       group by x.user_id
       order by min(x.pos)
       limit 5
    ) t
$$;

-- Bring the mention rows of one text in line with its words. No author (a
-- deleted account) or no text: no mentions.
create or replace function public.sync_mentions(p_type text, p_id uuid, p_author uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_targets uuid[] := '{}'::uuid[];
begin
  if p_author is not null and coalesce(p_body, '') <> '' then
    v_targets := public.mention_targets(p_body, p_author);
  end if;
  delete from public.mentions m
   where m.source_type = p_type
     and m.source_id = p_id
     and (not (m.mentioned_user_id = any (v_targets)) or m.author_id is distinct from p_author);
  if cardinality(v_targets) = 0 then
    return;
  end if;
  insert into public.mentions (comment_id, post_id, post_comment_id, mentioned_user_id, author_id)
  select case when p_type = 'comment' then p_id end,
         case when p_type = 'post' then p_id end,
         case when p_type = 'post_comment' then p_id end,
         t, p_author
    from unnest(v_targets) as t
  on conflict (source_type, source_id, mentioned_user_id) do nothing;
end
$$;

-- Tell (or stop telling) the mentioned people of one text. A person hears
-- about it only while they can see the text; on a post comment the post's
-- author and the person replied to are told by their own notices already.
create or replace function public.mention_refresh(p_type text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := 'mention:' || p_type || ':' || p_id::text;
  v_comment uuid;
  v_post uuid;
  v_event uuid;
  v_pc uuid;
  v_skip uuid[] := '{}'::uuid[];
  r record;
begin
  if p_type = 'comment' then
    v_comment := p_id;
    select c.event_id into v_event from public.event_comments c where c.comment_id = p_id;
  elsif p_type = 'post' then
    v_post := p_id;
  elsif p_type = 'post_comment' then
    v_pc := p_id;
    select c.post_id,
           array_remove(array[po.user_id, pc.user_id], null)
      into v_post, v_skip
      from public.post_comments c
      join public.profile_posts po on po.post_id = c.post_id
      left join public.post_comments pc on pc.comment_id = c.parent_id
     where c.comment_id = p_id;
    v_skip := coalesce(v_skip, '{}'::uuid[]);
  else
    return;
  end if;
  for r in
    select m.mentioned_user_id, m.author_id
      from public.mentions m
     where m.source_type = p_type and m.source_id = p_id
  loop
    if not (r.mentioned_user_id = any (v_skip))
       and public.can_see_mention_source(r.mentioned_user_id, p_type, p_id) then
      perform public.activity_add(
        r.mentioned_user_id, 'mention', r.author_id, v_key,
        p_comment => v_comment, p_post => v_post, p_event => v_event,
        p_meta => jsonb_build_object('source', p_type), p_refresh => false
      );
      if v_pc is not null then
        update public.activity_items
           set post_comment_id = v_pc
         where user_id = r.mentioned_user_id and dedupe_key = v_key
           and post_comment_id is distinct from v_pc;
      end if;
    else
      delete from public.activity_items
       where user_id = r.mentioned_user_id and dedupe_key = v_key;
    end if;
  end loop;
  delete from public.activity_items a
   where a.dedupe_key = v_key
     and not exists (
       select 1 from public.mentions m
        where m.source_type = p_type and m.source_id = p_id and m.mentioned_user_id = a.user_id
     );
end
$$;

-- The read-time check of a mention notice (activity_visible).
create or replace function public.mention_item_visible(
  p_user uuid,
  p_source text,
  p_comment uuid,
  p_post uuid,
  p_post_comment uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.mentions m
     where m.mentioned_user_id = p_user
       and m.source_type = p_source
       and m.source_id = case p_source
             when 'comment' then p_comment
             when 'post' then p_post
             else p_post_comment end
  )
  and public.can_see_mention_source(
    p_user, p_source,
    case p_source when 'comment' then p_comment when 'post' then p_post else p_post_comment end
  )
$$;

-- One trigger function for the three kinds of text: keep the rows in line
-- with the words, then the notices in line with who can see it. A failure
-- here never stops the comment or post itself (it is logged and skipped).
create or replace function public.mentions_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := tg_argv[0];
  v_id uuid;
begin
  if v_type = 'post' then
    v_id := new.post_id;
  else
    v_id := new.comment_id;
  end if;
  begin
    if tg_op = 'INSERT'
       or new.body is distinct from old.body
       or new.user_id is distinct from old.user_id then
      perform public.sync_mentions(v_type, v_id, new.user_id, new.body);
    end if;
    perform public.mention_refresh(v_type, v_id);
  exception when others then
    raise warning 'mentions skipped for % %: %', v_type, v_id, sqlerrm;
  end;
  return null;
end
$$;

drop trigger if exists mentions_after_write on public.event_comments;
create trigger mentions_after_write
  after insert or update of status, body, user_id on public.event_comments
  for each row execute function public.mentions_after_write('comment');
drop trigger if exists mentions_after_write on public.profile_posts;
create trigger mentions_after_write
  after insert or update of status, body, user_id on public.profile_posts
  for each row execute function public.mentions_after_write('post');

-- 6. Post comments: the write path -------------------------------------------------------------------
-- New comment: every rule is checked here, whatever path wrote it (the app
-- writes through add_post_comment). The server decides status and times.
create or replace function public.post_comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post record;
  v_parent record;
  v_recent integer;
  v_n integer;
begin
  if new.user_id is null or not exists (
    select 1 from auth.users u where u.id = new.user_id and not coalesce(u.is_anonymous, true)
  ) then
    raise exception 'post_comments: not_account' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p where p.user_id = new.user_id and p.username is not null
  ) then
    raise exception 'post_comments: profile_required' using errcode = '42501';
  end if;
  perform public.assert_not_restricted(new.user_id, 'post_comments');
  perform public.assert_guidelines_accepted(new.user_id, 'post_comments');
  new.body := btrim(coalesce(new.body, ''));
  if new.body = '' then
    raise exception 'post_comments: empty' using errcode = '22023';
  end if;
  if char_length(new.body) > 500 then
    raise exception 'post_comments: too_long' using errcode = '22023';
  end if;
  select po.user_id as user_id, po.status as status, po.comments_off as comments_off
    into v_post
    from public.profile_posts po
   where po.post_id = new.post_id;
  if not found
     or v_post.status <> 'visible'
     or not public.can_read_post_as(new.user_id, v_post.user_id, v_post.status) then
    raise exception 'post_comments: not_found' using errcode = 'P0002';
  end if;
  if v_post.comments_off then
    raise exception 'post_comments: comments_off' using errcode = '42501';
  end if;
  if new.parent_id is not null then
    select c.parent_id as parent_id, c.post_id as post_id, c.user_id as user_id,
           c.status as status, c.author_deleted_at as author_deleted_at,
           c.owner_deleted_at as owner_deleted_at, c.account_deleted_at as account_deleted_at
      into v_parent
      from public.post_comments c
     where c.comment_id = new.parent_id;
    if not found
       or v_parent.post_id <> new.post_id
       or v_parent.status <> 'visible'
       or v_parent.author_deleted_at is not null
       or v_parent.owner_deleted_at is not null
       or v_parent.account_deleted_at is not null then
      raise exception 'post_comments: not_found' using errcode = 'P0002';
    end if;
    if public.blocked_between(new.user_id, v_parent.user_id) then
      raise exception 'post_comments: blocked' using errcode = '42501';
    end if;
    if v_parent.parent_id is not null then
      new.parent_id := v_parent.parent_id;
    end if;
  end if;
  select count(*) into v_recent
    from public.post_comments c
   where c.user_id = new.user_id and c.created_at > now() - interval '10 minutes';
  if v_recent >= 20 then
    raise exception 'post_comments: rate_limited' using errcode = '54000';
  end if;
  new.status := 'visible';
  new.hidden_reason := null;
  new.author_deleted_at := null;
  new.owner_deleted_at := null;
  new.deleted_prev_status := null;
  new.deleted_prev_reason := null;
  new.account_deleted_at := null;
  new.created_at := now();
  new.updated_at := now();
  if not public.has_permission(new.user_id, 'comments.moderate') then
    insert into public.content_holds (target_type, target_id, user_id, reason, term_id, term, kind)
    select 'post_comment', new.comment_id, new.user_id, 'filter', m.term_id, m.term, m.kind
      from public.content_filter_matches(new.body) m;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      new.status := 'pending';
    elsif public.account_is_new(new.user_id) and public.surge_active() then
      new.status := 'pending';
      insert into public.content_holds (target_type, target_id, user_id, reason)
      values ('post_comment', new.comment_id, new.user_id, 'surge');
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists post_comments_before_insert on public.post_comments;
create trigger post_comments_before_insert before insert on public.post_comments
  for each row execute function public.post_comments_before_insert();

-- Any change: the post, the thread and the time of writing are fixed; the
-- author link can only go (the foreign key's set null when the account is
-- deleted), and then the comment is blanked as 0056 blanks hub comments: a
-- visible one stays as an empty "Deleted account" row so replies keep their
-- place, anything else becomes a hidden blank, and its open reports are
-- closed. Leaving review closes the holds (an own delete does not: Undo
-- brings it back to review).
create or replace function public.post_comments_before_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.post_id := old.post_id;
  new.parent_id := old.parent_id;
  new.created_at := old.created_at;
  if new.user_id is not null then
    new.user_id := old.user_id;
  end if;
  if old.user_id is not null and new.user_id is null then
    new.body := '';
    new.account_deleted_at := coalesce(old.account_deleted_at, now());
    new.deleted_prev_status := null;
    new.deleted_prev_reason := null;
    if old.status not in ('visible', 'removed') then
      new.status := 'hidden';
      new.hidden_reason := 'account_deleted';
      new.author_deleted_at := coalesce(old.author_deleted_at, now());
    end if;
    update public.post_comment_reports
       set resolved_at = now()
     where comment_id = old.comment_id and resolved_at is null;
  end if;
  if old.status = 'pending' and new.status <> 'pending'
     and new.author_deleted_at is null and new.owner_deleted_at is null then
    update public.content_holds
       set resolved_at = now()
     where target_type = 'post_comment' and target_id = new.comment_id and resolved_at is null;
  end if;
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists post_comments_before_update on public.post_comments;
create trigger post_comments_before_update before update on public.post_comments
  for each row execute function public.post_comments_before_update();

-- Activity rows that point at a post comment get its id (activity_add of
-- 0061 has no such argument). Internal.
create or replace function public.activity_link_post_comment(p_user uuid, p_key text, p_post_comment uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.activity_items
     set post_comment_id = p_post_comment
   where user_id = p_user and dedupe_key = p_key
     and post_comment_id is distinct from p_post_comment
$$;

-- Notices about a comment: once it is visible, the post's author
-- (post_comment) and the author of the comment replied to
-- (post_comment_reply; then not twice for the post's author). Taken back
-- when it stops being visible. Then the mentions in it.
create or replace function public.post_comments_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now boolean;
  v_was boolean := false;
  v_owner uuid;
  v_parent_author uuid;
  v_key text;
begin
  v_now := new.status = 'visible' and new.author_deleted_at is null and new.owner_deleted_at is null
           and new.account_deleted_at is null and new.user_id is not null;
  if tg_op = 'UPDATE' then
    v_was := old.status = 'visible' and old.author_deleted_at is null and old.owner_deleted_at is null
             and old.account_deleted_at is null and old.user_id is not null;
  end if;
  if v_now and not v_was then
    select po.user_id into v_owner from public.profile_posts po where po.post_id = new.post_id;
    if new.parent_id is not null then
      select c.user_id into v_parent_author
        from public.post_comments c
       where c.comment_id = new.parent_id
         and c.author_deleted_at is null
         and c.account_deleted_at is null;
    end if;
    if v_parent_author is not null then
      v_key := 'post_comment_reply:' || new.comment_id::text;
      perform public.activity_add(v_parent_author, 'post_comment_reply', new.user_id, v_key, p_post => new.post_id);
      perform public.activity_link_post_comment(v_parent_author, v_key, new.comment_id);
    end if;
    if v_owner is not null and v_owner is distinct from v_parent_author then
      v_key := 'post_comment:' || new.comment_id::text;
      perform public.activity_add(v_owner, 'post_comment', new.user_id, v_key, p_post => new.post_id);
      perform public.activity_link_post_comment(v_owner, v_key, new.comment_id);
    end if;
  elsif v_was and not v_now then
    delete from public.activity_items
     where post_comment_id = new.comment_id
       and kind in ('post_comment', 'post_comment_reply');
  end if;
  begin
    if tg_op = 'INSERT'
       or new.body is distinct from old.body
       or new.user_id is distinct from old.user_id then
      perform public.sync_mentions('post_comment', new.comment_id, new.user_id, new.body);
    end if;
    perform public.mention_refresh('post_comment', new.comment_id);
  exception when others then
    raise warning 'mentions skipped for post_comment %: %', new.comment_id, sqlerrm;
  end;
  return null;
end
$$;
drop trigger if exists post_comments_after_write on public.post_comments;
create trigger post_comments_after_write
  after insert or update of status, body, user_id, author_deleted_at, owner_deleted_at, account_deleted_at
  on public.post_comments
  for each row execute function public.post_comments_after_write();

-- A post that is hidden, deleted or brought back changes who can see the
-- mentions in its comments: they are checked again.
create or replace function public.post_comments_on_post_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  if old.status is distinct from new.status then
    begin
      for r in
        select distinct m.source_id
          from public.mentions m
          join public.post_comments c on c.comment_id = m.post_comment_id
         where c.post_id = new.post_id
      loop
        perform public.mention_refresh('post_comment', r.source_id);
      end loop;
    exception when others then
      raise warning 'mentions skipped for post %: %', new.post_id, sqlerrm;
    end;
  end if;
  return null;
end
$$;
drop trigger if exists post_comments_on_post_status on public.profile_posts;
create trigger post_comments_on_post_status
  after update of status on public.profile_posts
  for each row execute function public.post_comments_on_post_status();

-- 7. Post comments: what the app calls ---------------------------------------------------------------
-- Write a comment (or a reply). p_comment_id lets the app retry on a weak
-- network without making a second comment: the same id returns the same
-- comment. Returns the id and the status (visible, or pending when held).
create or replace function public.add_post_comment(
  p_post_id uuid,
  p_body text,
  p_parent_id uuid default null,
  p_comment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_status text;
  v_id uuid;
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'add_post_comment: not_account' using errcode = '42501';
  end if;
  if p_comment_id is not null then
    select c.user_id, c.status into v_owner, v_status
      from public.post_comments c
     where c.comment_id = p_comment_id;
    if found then
      if v_owner is distinct from v_uid then
        raise exception 'add_post_comment: not_found' using errcode = 'P0002';
      end if;
      return jsonb_build_object('comment_id', p_comment_id, 'status', v_status);
    end if;
  end if;
  insert into public.post_comments (comment_id, post_id, parent_id, user_id, body)
  values (coalesce(p_comment_id, gen_random_uuid()), p_post_id, p_parent_id, v_uid, p_body)
  returning comment_id, status into v_id, v_status;
  return jsonb_build_object('comment_id', v_id, 'status', v_status);
end
$$;

-- The comments of one post the caller may see, newest first (at most 200;
-- the app builds the threads). Nothing when the caller may not read the
-- post. Visible comments (not from someone in a block with the caller, not
-- from a suspended account), the caller's own held ones, removed ones as an
-- empty placeholder (no author), and blanked ones of deleted accounts (no
-- author).
create or replace function public.post_comments_page(p_post_id uuid, p_limit integer default 200)
returns table (
  comment_id uuid,
  post_id uuid,
  parent_id uuid,
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  roles jsonb,
  body text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_status text;
begin
  select po.user_id, po.status into v_author, v_status
    from public.profile_posts po
   where po.post_id = p_post_id;
  if not found or v_status <> 'visible' or not public.can_read_post(v_author, v_status) then
    return;
  end if;
  return query
    select c.comment_id, c.post_id, c.parent_id,
           case when c.status = 'removed' then null else c.user_id end,
           case when c.status = 'removed' then null else p.username::text end,
           case when c.status = 'removed' then null else p.display_name::text end,
           case when c.status = 'removed' then null else p.avatar_path::text end,
           case when c.status = 'removed' or c.user_id is null then '[]'::jsonb else coalesce((
             select jsonb_agg(jsonb_build_object('role', ur.role, 'org_name', ur.org_name))
               from public.user_roles ur where ur.user_id = c.user_id
           ), '[]'::jsonb) end,
           case when c.status = 'removed' then '' else c.body end,
           c.status, c.created_at
      from public.post_comments c
      left join public.profiles p on p.user_id = c.user_id
     where c.post_id = p_post_id
       and c.author_deleted_at is null
       and c.owner_deleted_at is null
       and (
         c.status = 'removed'
         or (c.status = 'pending' and v_uid is not null and c.user_id = v_uid)
         or (
           c.status = 'visible'
           and (
             c.user_id is null
             or c.user_id = v_uid
             or (not public.blocked_between(v_uid, c.user_id) and not public.is_suspended(c.user_id))
           )
         )
       )
     order by c.created_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 200);
end
$$;

-- Delete a comment: my own (with Undo and "Recently deleted"), or anybody's
-- on my own post (quietly; Undo for 24 hours). Returns who deleted it:
-- 'author' or 'owner'. Repeating it is harmless. Tokens: not_account,
-- not_found, forbidden (a removed comment of mine).
create or replace function public.delete_post_comment(p_comment_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  c record;
begin
  if v_uid is null then
    raise exception 'delete_post_comment: not_account' using errcode = '42501';
  end if;
  select pc.user_id as user_id, pc.status as status, pc.hidden_reason as hidden_reason,
         pc.author_deleted_at as author_deleted_at, pc.owner_deleted_at as owner_deleted_at,
         po.user_id as post_owner
    into c
    from public.post_comments pc
    join public.profile_posts po on po.post_id = pc.post_id
   where pc.comment_id = p_comment_id
   for update of pc;
  if not found then
    raise exception 'delete_post_comment: not_found' using errcode = 'P0002';
  end if;
  if c.user_id = v_uid then
    if c.status = 'removed' then
      raise exception 'delete_post_comment: forbidden' using errcode = '42501';
    end if;
    if c.author_deleted_at is not null then
      return 'author';
    end if;
    update public.post_comments
       set deleted_prev_status = case when owner_deleted_at is null then status else deleted_prev_status end,
           deleted_prev_reason = case when owner_deleted_at is null then hidden_reason else deleted_prev_reason end,
           status = 'hidden',
           hidden_reason = 'deleted_by_author',
           author_deleted_at = now()
     where comment_id = p_comment_id;
    return 'author';
  end if;
  if c.post_owner = v_uid then
    if c.status = 'removed' or c.owner_deleted_at is not null or c.author_deleted_at is not null then
      return 'owner';
    end if;
    update public.post_comments
       set deleted_prev_status = status,
           deleted_prev_reason = hidden_reason,
           status = 'hidden',
           hidden_reason = 'deleted_by_post_owner',
           owner_deleted_at = now()
     where comment_id = p_comment_id;
    return 'owner';
  end if;
  raise exception 'delete_post_comment: not_found' using errcode = 'P0002';
end
$$;

-- Undo a delete (24 hours): the author takes back their own delete, the
-- post's author takes back theirs. Back to the state it had (a held comment
-- waits for review again). Tokens: not_account, not_found, not_restorable,
-- expired.
create or replace function public.restore_post_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  c record;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'restore_post_comment: not_account' using errcode = '42501';
  end if;
  select pc.user_id as user_id, pc.status as status, pc.body as body,
         pc.author_deleted_at as author_deleted_at, pc.owner_deleted_at as owner_deleted_at,
         pc.deleted_prev_status as prev_status, pc.deleted_prev_reason as prev_reason,
         po.user_id as post_owner
    into c
    from public.post_comments pc
    join public.profile_posts po on po.post_id = pc.post_id
   where pc.comment_id = p_comment_id
   for update of pc;
  if not found then
    raise exception 'restore_post_comment: not_found' using errcode = 'P0002';
  end if;
  if c.user_id = v_uid and c.author_deleted_at is not null then
    v_at := c.author_deleted_at;
  elsif c.post_owner = v_uid and c.owner_deleted_at is not null and c.author_deleted_at is null then
    v_at := c.owner_deleted_at;
  elsif c.user_id = v_uid or c.post_owner = v_uid then
    return;
  else
    raise exception 'restore_post_comment: not_found' using errcode = 'P0002';
  end if;
  if c.status = 'removed' or c.body = '' then
    raise exception 'restore_post_comment: not_restorable' using errcode = '22023';
  end if;
  if v_at < now() - interval '24 hours' then
    raise exception 'restore_post_comment: expired' using errcode = '22023';
  end if;
  if c.user_id = v_uid and c.author_deleted_at is not null then
    update public.post_comments
       set status = case when owner_deleted_at is not null then 'hidden'
                         else coalesce(deleted_prev_status, 'visible') end,
           hidden_reason = case when owner_deleted_at is not null then 'deleted_by_post_owner'
                                else deleted_prev_reason end,
           author_deleted_at = null,
           deleted_prev_status = case when owner_deleted_at is not null then deleted_prev_status end,
           deleted_prev_reason = case when owner_deleted_at is not null then deleted_prev_reason end
     where comment_id = p_comment_id;
  else
    update public.post_comments
       set status = coalesce(deleted_prev_status, 'visible'),
           hidden_reason = deleted_prev_reason,
           owner_deleted_at = null,
           deleted_prev_status = null,
           deleted_prev_reason = null
     where comment_id = p_comment_id;
  end if;
end
$$;

-- Comments on or off for one of my posts. Tokens: not_account, not_found.
create or replace function public.set_post_comments_off(p_post_id uuid, p_off boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'set_post_comments_off: not_account' using errcode = '42501';
  end if;
  update public.profile_posts
     set comments_off = coalesce(p_off, false)
   where post_id = p_post_id and user_id = v_uid and status <> 'deleted';
  if not found then
    raise exception 'set_post_comments_off: not_found' using errcode = 'P0002';
  end if;
end
$$;

-- Report a comment (the shared reasons and note of 0056). Anybody signed in
-- who can see it, not their own; 20 a day. Tokens: not_account, not_found,
-- invalid_reason, rate_limited, account_restricted.
create or replace function public.report_post_comment(p_comment_id uuid, p_reason text, p_note text default null)
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
    raise exception 'report_post_comment: not_account' using errcode = '42501';
  end if;
  perform public.assert_not_restricted(v_uid, 'report_post_comment');
  if v_reason is null or v_reason = 'impersonation' then
    raise exception 'report_post_comment: invalid_reason' using errcode = '22023';
  end if;
  select c.user_id into v_author from public.post_comments c where c.comment_id = p_comment_id;
  if not found or v_author = v_uid or not public.can_read_post_comment(v_uid, p_comment_id) then
    raise exception 'report_post_comment: not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.post_comment_reports r
       where r.reporter_id = v_uid and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'report_post_comment: rate_limited' using errcode = '54000';
  end if;
  insert into public.post_comment_reports (comment_id, reporter_id, reason, note)
  values (p_comment_id, v_uid, v_reason, public.normalize_report_note(p_note))
  on conflict (comment_id, reporter_id) do update
    set reason = excluded.reason, note = excluded.note, created_at = now(), resolved_at = null;
end
$$;

-- 8. Moderation ------------------------------------------------------------------------------------------
-- Held comments, then visible ones with open reports (comments.moderate).
create or replace function public.post_comment_queue(p_limit integer default 50)
returns table (
  comment_id uuid,
  post_id uuid,
  post_author_id uuid,
  post_author_username text,
  author_id uuid,
  username text,
  display_name text,
  body text,
  status text,
  report_count integer,
  last_reason text,
  last_note text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.has_permission(auth.uid(), 'comments.moderate') then
    raise exception 'post_comment_queue: moderators only' using errcode = '42501';
  end if;
  return query
    select c.comment_id, c.post_id, po.user_id, op.username::text,
           c.user_id, p.username::text, p.display_name::text, c.body, c.status,
           coalesce(rc.n, 0)::integer, rc.last_reason, rc.last_note, c.created_at
      from public.post_comments c
      join public.profile_posts po on po.post_id = c.post_id
      left join public.profiles op on op.user_id = po.user_id
      left join public.profiles p on p.user_id = c.user_id
      left join lateral (
        select count(*)::integer as n,
               (array_agg(r.reason order by r.created_at desc))[1] as last_reason,
               (array_agg(r.note order by r.created_at desc))[1] as last_note,
               max(r.created_at) as last_at
          from public.post_comment_reports r
         where r.comment_id = c.comment_id and r.resolved_at is null
      ) rc on true
     where c.author_deleted_at is null
       and c.owner_deleted_at is null
       and c.account_deleted_at is null
       and (
         c.status = 'pending'
         or (c.status = 'visible' and coalesce(rc.n, 0) > 0)
       )
     order by (c.status = 'pending') desc, coalesce(rc.n, 0) desc,
              coalesce(rc.last_at, c.created_at) desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

-- Approve (a held or reported comment stays or becomes visible, its open
-- reports close) or hide (the text stays, for Restore). comments.moderate.
-- A comment its author or the post's author deleted, or a removed one, is
-- left alone. The reports a hide or approve closed are in the snapshot.
create or replace function public.moderate_post_comment(p_comment_id uuid, p_action text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  c record;
  v_ids jsonb;
  v_log uuid;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 200), '');
begin
  if not public.has_permission(v_uid, 'comments.moderate') then
    raise exception 'moderate_post_comment: moderators only' using errcode = '42501';
  end if;
  if coalesce(p_action, '') not in ('approve', 'hide') then
    raise exception 'moderate_post_comment: action must be approve or hide' using errcode = '22023';
  end if;
  select pc.user_id as user_id, pc.status as status, pc.hidden_reason as hidden_reason,
         pc.post_id as post_id
    into c
    from public.post_comments pc
   where pc.comment_id = p_comment_id
     and pc.status <> 'removed'
     and pc.author_deleted_at is null
     and pc.owner_deleted_at is null
     and pc.account_deleted_at is null
   for update;
  if not found then
    return;
  end if;
  update public.post_comments
     set status = case when p_action = 'approve' then 'visible' else 'hidden' end,
         hidden_reason = case when p_action = 'hide' then coalesce(v_reason, 'moderator') else null end
   where comment_id = p_comment_id;
  with closed as (
    update public.post_comment_reports
       set resolved_at = now()
     where comment_id = p_comment_id and resolved_at is null
    returning report_id
  )
  select coalesce(jsonb_agg(closed.report_id), '[]'::jsonb) into v_ids from closed;
  v_log := public.write_audit(
    v_uid, 'post_comment_' || p_action, 'post_comment', p_comment_id::text,
    c.user_id, null, c.post_id, v_reason, null,
    jsonb_build_object('status', c.status, 'hidden_reason', c.hidden_reason, 'report_ids', v_ids)
  );
  if p_action = 'approve' then
    update public.moderation_log
       set reverted_by = v_log
     where target_type = 'post_comment'
       and target_id = p_comment_id::text
       and action = 'post_comment_hide'
       and reverted_by is null
       and log_id <> v_log;
  end if;
end
$$;

-- Remove (comments.delete, the official account): an evidence copy first
-- (90 days), then the text is wiped; open reports close.
create or replace function public.admin_remove_post_comment(p_comment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := coalesce(nullif(left(btrim(coalesce(p_reason, '')), 200), ''), 'removed_by_admin');
  c record;
  v_ids jsonb;
  v_log uuid;
begin
  if not public.has_permission(v_uid, 'comments.delete') then
    raise exception 'admin_remove_post_comment: not allowed' using errcode = '42501';
  end if;
  select pc.user_id as user_id, pc.status as status, pc.hidden_reason as hidden_reason,
         pc.post_id as post_id, pc.parent_id as parent_id, pc.body as body,
         pc.author_deleted_at as author_deleted_at, pc.account_deleted_at as account_deleted_at
    into c
    from public.post_comments pc
   where pc.comment_id = p_comment_id
   for update;
  if not found then
    raise exception 'admin_remove_post_comment: not_found' using errcode = 'P0002';
  end if;
  if c.status = 'removed' or c.author_deleted_at is not null or c.account_deleted_at is not null then
    return;
  end if;
  insert into public.moderation_evidence (kind, post_comment_id, parent_id, author_id, body)
  values ('post_comment', p_comment_id, c.parent_id, c.user_id, c.body)
  on conflict (post_comment_id) where post_comment_id is not null do update
    set body = excluded.body,
        author_id = excluded.author_id,
        log_id = null,
        created_at = now(),
        expires_at = now() + interval '90 days';
  update public.post_comments
     set status = 'removed',
         body = '',
         hidden_reason = v_reason
   where comment_id = p_comment_id;
  with closed as (
    update public.post_comment_reports
       set resolved_at = now()
     where comment_id = p_comment_id and resolved_at is null
    returning report_id
  )
  select coalesce(jsonb_agg(closed.report_id), '[]'::jsonb) into v_ids from closed;
  v_log := public.write_audit(
    v_uid, 'post_comment_remove', 'post_comment', p_comment_id::text,
    c.user_id, null, c.post_id, v_reason, null,
    jsonb_build_object('status', c.status, 'hidden_reason', c.hidden_reason, 'report_ids', v_ids)
  );
  update public.moderation_evidence set log_id = v_log where post_comment_id = p_comment_id;
end
$$;

-- Restore a hidden (comments.moderate) or removed (content.restore, 30
-- days, text from the evidence copy) comment to the state it had; the
-- reports the action closed are opened again. Quiet when there is nothing to
-- restore. Tokens: not_found, not_restorable, expired.
create or replace function public.admin_restore_post_comment(p_comment_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  c record;
  l record;
  ev record;
  v_status text;
  v_hidden text;
  v_new uuid;
  v_action text;
begin
  if not public.has_permission(v_uid, 'comments.moderate') then
    raise exception 'admin_restore_post_comment: not allowed' using errcode = '42501';
  end if;
  select pc.user_id as user_id, pc.status as status, pc.post_id as post_id,
         pc.updated_at as updated_at, pc.author_deleted_at as author_deleted_at,
         pc.owner_deleted_at as owner_deleted_at, pc.account_deleted_at as account_deleted_at
    into c
    from public.post_comments pc
   where pc.comment_id = p_comment_id
   for update;
  if not found then
    raise exception 'admin_restore_post_comment: not_found' using errcode = 'P0002';
  end if;
  if c.status not in ('hidden', 'removed') then
    return;
  end if;
  if c.author_deleted_at is not null or c.owner_deleted_at is not null or c.account_deleted_at is not null then
    raise exception 'admin_restore_post_comment: not_restorable' using errcode = '22023';
  end if;
  v_action := case when c.status = 'hidden' then 'post_comment_hide' else 'post_comment_remove' end;
  select x.log_id as log_id, x.snapshot as snapshot, x.created_at as created_at
    into l
    from public.moderation_log x
   where x.target_type = 'post_comment' and x.target_id = p_comment_id::text
     and x.action = v_action and x.reverted_by is null
   order by x.created_at desc, x.log_id desc
   limit 1;
  if c.status = 'hidden' then
    v_status := case when l.snapshot ->> 'status' in ('visible', 'pending') then l.snapshot ->> 'status'
                     else 'pending' end;
    v_hidden := null;
    update public.post_comments
       set status = v_status, hidden_reason = v_hidden
     where comment_id = p_comment_id;
  else
    if not public.has_permission(v_uid, 'content.restore') then
      raise exception 'admin_restore_post_comment: not allowed' using errcode = '42501';
    end if;
    if coalesce(l.created_at, c.updated_at) < now() - interval '30 days' then
      raise exception 'admin_restore_post_comment: expired' using errcode = '22023';
    end if;
    select e.body as body into ev
      from public.moderation_evidence e
     where e.post_comment_id = p_comment_id;
    if not found or coalesce(btrim(ev.body), '') = '' then
      raise exception 'admin_restore_post_comment: not_restorable' using errcode = '22023';
    end if;
    v_status := case when l.snapshot ->> 'status' in ('visible', 'pending', 'hidden') then l.snapshot ->> 'status'
                     else 'visible' end;
    v_hidden := case when v_status = 'hidden' then coalesce(l.snapshot ->> 'hidden_reason', 'moderator') end;
    update public.post_comments
       set status = v_status, body = ev.body, hidden_reason = v_hidden
     where comment_id = p_comment_id;
  end if;
  if jsonb_typeof(l.snapshot -> 'report_ids') = 'array' then
    update public.post_comment_reports r
       set resolved_at = null
     where r.comment_id = p_comment_id
       and r.resolved_at is not null
       and r.report_id in (
         select (j.value)::uuid from jsonb_array_elements_text(l.snapshot -> 'report_ids') j
       );
  end if;
  v_new := public.write_audit(
    v_uid, 'post_comment_restore', 'post_comment', p_comment_id::text,
    c.user_id, null, c.post_id, null, p_note,
    jsonb_build_object('from', c.status, 'to', v_status, 'undid', l.log_id)
  );
  if l.log_id is not null then
    update public.moderation_log set reverted_by = v_new where log_id = l.log_id;
  end if;
end
$$;

-- Activity from the audit log, for post comments only (0061's trigger is
-- left as it is): the author hears what was hidden or removed and why, an
-- approve or restore takes it back, reporters hear "we reviewed it".
create or replace function public.activity_on_post_comment_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_key text;
  v_ids uuid[];
begin
  if new.target_type is distinct from 'post_comment' or new.target_id is null then
    return new;
  end if;
  v_id := new.target_id::uuid;
  v_key := 'removed:post_comment:' || new.target_id;
  if new.action in ('post_comment_hide', 'post_comment_remove') then
    perform public.activity_add(
      new.target_user_id, 'content_removed', null, v_key,
      p_post => new.post_id, p_log => new.log_id,
      p_meta => jsonb_build_object(
        'target', 'post_comment',
        'action', case when new.action = 'post_comment_hide' then 'hide' else 'remove' end,
        'reason', new.reason)
    );
    perform public.activity_link_post_comment(new.target_user_id, v_key, v_id);
  elsif new.action in ('post_comment_approve', 'post_comment_restore') then
    delete from public.activity_items where dedupe_key = v_key and kind = 'content_removed';
  end if;
  if new.action in ('post_comment_hide', 'post_comment_remove', 'post_comment_approve') then
    select array_agg(r.reporter_id) into v_ids
      from public.post_comment_reports r
     where r.comment_id = v_id
       and r.report_id::text in (
         select j.value from jsonb_array_elements_text(
           case when jsonb_typeof(new.snapshot -> 'report_ids') = 'array'
                then new.snapshot -> 'report_ids' else '[]'::jsonb end) j);
    perform public.activity_reviewed('post_comment', new.target_id, v_ids);
  end if;
  return new;
end
$$;
drop trigger if exists activity_on_post_comment_moderation on public.moderation_log;
create trigger activity_on_post_comment_moderation
  after insert on public.moderation_log
  for each row execute function public.activity_on_post_comment_moderation();

-- 0059's list of open holds, plus post comments.
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
  if p_target_type not in ('comment', 'post', 'post_comment') then
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

-- 0055's admin_undo_action plus the two post comment actions.
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
         x.target_user_id as target_user_id, x.snapshot as snapshot,
         x.target_type as target_type, x.target_id as target_id
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

  if l.action in ('post_comment_hide', 'post_comment_remove') then
    if l.target_type is distinct from 'post_comment' or l.target_id is null then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    select x.log_id into v_latest
      from public.moderation_log x
     where x.target_type = 'post_comment' and x.target_id = l.target_id
       and x.action = l.action and x.reverted_by is null
     order by x.created_at desc, x.log_id desc
     limit 1;
    v_expected := case when l.action = 'post_comment_hide' then 'hidden' else 'removed' end;
    select pc.status into v_current
      from public.post_comments pc
     where pc.comment_id = l.target_id::uuid;
    if v_latest is distinct from l.log_id or v_current is distinct from v_expected then
      raise exception 'admin_undo_action: not_restorable' using errcode = '22023';
    end if;
    perform public.admin_restore_post_comment(l.target_id::uuid, p_note);
  elsif l.action in ('comment_hide', 'comment_remove') then
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

-- 0053's Admin > Hidden and removed, plus post comments a moderator hid or
-- the official account removed (kind post_comment). Same columns.
create or replace function public.admin_hidden_removed(
  p_before timestamptz default null,
  p_limit integer default 50
)
returns table (
  kind text,
  item_id uuid,
  status text,
  acted_at timestamptz,
  log_id uuid,
  actor_name text,
  reason text,
  author_id uuid,
  author_name text,
  author_username text,
  hub_id text,
  place text,
  body text,
  can_restore boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_mod boolean := public.my_has_permission('comments.moderate');
  v_full boolean := public.my_has_permission('audit.read_all');
  v_rest boolean := public.my_has_permission('content.restore');
begin
  if not v_mod then
    raise exception 'admin_hidden_removed: not allowed' using errcode = '42501';
  end if;
  return query
    with items as (
      select 'comment'::text as kind, c.comment_id as item_id, c.status as status,
             coalesce(l.created_at, c.updated_at) as acted_at, l.log_id as log_id,
             ap.display_name as actor_name, coalesce(l.reason, c.hidden_reason) as reason,
             c.user_id as author_id, up.display_name as author_name, up.username as author_username,
             ev.bumelerze_id::text as hub_id, ev.place::text as place,
             case when c.status = 'hidden' then c.body
                  when v_full then x.body
                  else null end as body,
             case when c.status = 'hidden' then v_mod
                  else v_rest and x.evidence_id is not null
                       and coalesce(l.created_at, c.updated_at) > now() - interval '30 days' end as can_restore
        from public.event_comments c
        left join lateral (
          select m.log_id, m.created_at, m.reason, m.actor_id
            from public.moderation_log m
           where m.comment_id = c.comment_id
             and m.action = case when c.status = 'hidden' then 'comment_hide' else 'comment_remove' end
             and m.reverted_by is null
           order by m.created_at desc, m.log_id desc
           limit 1
        ) l on true
        left join public.profiles ap on ap.user_id = l.actor_id
        left join public.profiles up on up.user_id = c.user_id
        left join public.events ev on ev.event_id = c.event_id
        left join public.moderation_evidence x on x.comment_id = c.comment_id
       where c.status in ('hidden', 'removed')
         and c.author_deleted_at is null
      union all
      select 'post'::text, po.post_id, po.status,
             coalesce(l.created_at, po.updated_at), l.log_id,
             ap.display_name, coalesce(l.reason, po.removed_reason),
             po.user_id, up.display_name, up.username,
             null::text, null::text,
             case when v_full then x.body else null end,
             v_rest and x.evidence_id is not null
               and coalesce(l.created_at, po.updated_at) > now() - interval '30 days'
        from public.profile_posts po
        left join lateral (
          select m.log_id, m.created_at, m.reason, m.actor_id
            from public.moderation_log m
           where m.post_id = po.post_id
             and m.action = 'post_remove'
             and m.reverted_by is null
           order by m.created_at desc, m.log_id desc
           limit 1
        ) l on true
        left join public.profiles ap on ap.user_id = l.actor_id
        left join public.profiles up on up.user_id = po.user_id
        left join public.moderation_evidence x on x.post_id = po.post_id
       where po.status = 'removed'
      union all
      select 'post_comment'::text, pc.comment_id, pc.status,
             coalesce(l.created_at, pc.updated_at), l.log_id,
             ap.display_name, coalesce(l.reason, pc.hidden_reason),
             pc.user_id, up.display_name, up.username,
             null::text, null::text,
             case when pc.status = 'hidden' then pc.body
                  when v_full then x.body
                  else null end,
             case when pc.status = 'hidden' then v_mod
                  else v_rest and x.evidence_id is not null
                       and coalesce(l.created_at, pc.updated_at) > now() - interval '30 days' end
        from public.post_comments pc
        left join lateral (
          select m.log_id, m.created_at, m.reason, m.actor_id
            from public.moderation_log m
           where m.target_type = 'post_comment'
             and m.target_id = pc.comment_id::text
             and m.action = case when pc.status = 'hidden' then 'post_comment_hide' else 'post_comment_remove' end
             and m.reverted_by is null
           order by m.created_at desc, m.log_id desc
           limit 1
        ) l on true
        left join public.profiles ap on ap.user_id = l.actor_id
        left join public.profiles up on up.user_id = pc.user_id
        left join public.moderation_evidence x on x.post_comment_id = pc.comment_id
       where pc.status in ('hidden', 'removed')
         and pc.author_deleted_at is null
         and pc.owner_deleted_at is null
         and pc.account_deleted_at is null
    )
    select r.kind, r.item_id, r.status, r.acted_at, r.log_id, r.actor_name, r.reason,
           r.author_id, r.author_name, r.author_username, r.hub_id, r.place, r.body, r.can_restore
      from items r
     where r.acted_at > now() - interval '30 days'
       and (p_before is null or r.acted_at < p_before)
     order by r.acted_at desc, r.item_id
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

-- 9. Reading posts and my deleted things -----------------------------------------------------------
-- 0058's profile_posts_page plus the comment count the reader may see and
-- whether comments are off. The return shape changes, so it is dropped and
-- created again (same rules).
drop function if exists public.profile_posts_page(uuid, timestamptz, integer, boolean, uuid);
create or replace function public.profile_posts_page(
  p_user uuid,
  p_before timestamptz default null,
  p_limit integer default 20,
  p_include_removed boolean default false,
  p_post_id uuid default null
)
returns table (
  post_id uuid,
  user_id uuid,
  body text,
  status text,
  kind text,
  created_at timestamptz,
  edited_at timestamptz,
  event_ref text,
  event_magnitude numeric,
  event_lat double precision,
  event_lon double precision,
  event_time timestamptz,
  helpful_count integer,
  my_helpful boolean,
  edit_locked boolean,
  comment_count integer,
  comments_off boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select po.post_id,
         po.user_id,
         po.body,
         po.status,
         po.kind,
         po.created_at,
         po.edited_at,
         e.bumelerze_id::text,
         e.magnitude::numeric,
         e.lat::double precision,
         e.lon::double precision,
         e.origin_time,
         case when po.status = 'visible'
              then public.post_helpful_visible_count(po.post_id, po.user_id)
              else 0 end,
         exists (
           select 1 from public.post_helpful h
            where h.post_id = po.post_id and h.user_id = auth.uid()
         ),
         coalesce(
           po.user_id = auth.uid()
           and po.status = 'visible'
           and exists (
             select 1 from public.post_reports r
              where r.post_id = po.post_id and r.resolved_at is null
           ),
           false
         ),
         case when po.status = 'visible'
              then public.post_comment_visible_count(po.post_id)
              else 0 end,
         po.comments_off
    from public.profile_posts po
    left join public.events e0 on e0.event_id = po.event_id
    left join public.events e
      on e.event_id = coalesce(e0.merged_into, e0.event_id)
     and e.review_status <> 'deleted'
   where po.user_id = p_user
     and public.can_read_post(po.user_id, po.status)
     and (coalesce(p_include_removed, false) or po.status = 'visible')
     and (p_before is null or po.created_at < p_before)
     and (p_post_id is null or po.post_id = p_post_id)
   order by po.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 51)
$$;

-- 0058's "Recently deleted", plus my own deleted post comments.
create or replace function public.my_recently_deleted()
returns table (
  kind text,
  item_id uuid,
  body text,
  deleted_at timestamptz,
  expires_at timestamptz,
  hub_id text,
  place text,
  magnitude numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    return;
  end if;
  return query
    select * from (
      select 'comment'::text, c.comment_id, c.body, c.author_deleted_at,
             c.author_deleted_at + interval '24 hours',
             e.bumelerze_id::text, e.place::text, e.magnitude::numeric
        from public.event_comments c
        left join public.events e on e.event_id = c.event_id
       where c.user_id = auth.uid()
         and c.status = 'hidden'
         and c.body <> ''
         and c.author_deleted_at > now() - interval '24 hours'
      union all
      select 'post'::text, po.post_id, po.body, po.deleted_at,
             po.deleted_at + interval '24 hours',
             e.bumelerze_id::text, e.place::text, e.magnitude::numeric
        from public.profile_posts po
        left join public.events e on e.event_id = po.event_id
       where po.user_id = auth.uid()
         and po.status = 'deleted'
         and po.deleted_at > now() - interval '24 hours'
      union all
      select 'post_comment'::text, pc.comment_id, pc.body, pc.author_deleted_at,
             pc.author_deleted_at + interval '24 hours',
             null::text, null::text, null::numeric
        from public.post_comments pc
       where pc.user_id = auth.uid()
         and pc.status = 'hidden'
         and pc.body <> ''
         and pc.author_deleted_at > now() - interval '24 hours'
    ) r
    order by 4 desc
    limit 50;
end
$$;

-- 10. Activity: reading the list ---------------------------------------------------------------------------
-- 0061's activity_visible plus the three new kinds: a comment notice while
-- the comment is visible and its post readable by the reader; a mention
-- while the mention still stands and the reader can see the text.
create or replace function public.activity_visible(p_user uuid)
returns setof public.activity_items
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.*
    from public.activity_items a
   where a.user_id = p_user
     and a.created_at > now() - interval '90 days'
     and (
       a.actor_id is null
       or (
         not public.blocked_between(p_user, a.actor_id)
         and (
           a.kind = 'family_safe'
           or (not public.has_muted(p_user, a.actor_id) and not public.is_suspended(a.actor_id))
         )
       )
     )
     and (
       a.tag_id is null
       or exists (
         select 1
           from public.home_members m
           join public.home_tags t on t.tag_id = m.tag_id and t.status = 'active'
          where m.tag_id = a.tag_id and m.user_id = p_user and m.status = 'approved'
       )
     )
     and (
       a.kind <> 'family_safe'
       or exists (
         select 1 from public.home_members s
          where s.tag_id = a.tag_id and s.user_id = a.actor_id
            and s.status = 'approved' and s.share_checkins
       )
     )
     and (
       a.kind <> 'comment_reply'
       or exists (
         select 1 from public.event_comments c
          where c.comment_id = a.comment_id and c.status = 'visible'
       )
     )
     and (
       a.kind <> 'comment_helpful'
       or exists (
         select 1 from public.event_comments c
          where c.comment_id = a.comment_id and c.status = 'visible' and c.user_id = p_user
       )
     )
     and (
       a.kind <> 'post_helpful'
       or exists (
         select 1 from public.profile_posts po
          where po.post_id = a.post_id and po.status = 'visible' and po.user_id = p_user
       )
     )
     and (
       a.kind not in ('post_comment', 'post_comment_reply')
       or public.can_read_post_comment(p_user, a.post_comment_id)
     )
     and (
       a.kind <> 'mention'
       or public.mention_item_visible(
            p_user, coalesce(a.meta ->> 'source', ''), a.comment_id, a.post_id, a.post_comment_id)
     )
$$;

-- 0061's list plus, for the new kinds: the post comment's id, the @username
-- of the post's author (the app opens that profile), and for a mention where
-- the text is (comment, post or post_comment). The return shape changes, so
-- it is dropped and created again.
drop function if exists public.my_activity(integer, timestamptz);
create or replace function public.my_activity(p_limit integer default 50, p_before timestamptz default null)
returns table (
  item_id uuid,
  kind text,
  created_at timestamptz,
  read_at timestamptz,
  actor_id uuid,
  actor_username text,
  actor_name text,
  actor_avatar text,
  item_count integer,
  role text,
  org_name text,
  target text,
  action text,
  reason text,
  appealed boolean,
  hub_id text,
  place text,
  magnitude numeric,
  snippet text,
  comment_id uuid,
  post_id uuid,
  tag_id uuid,
  home_label text,
  home_code text,
  post_comment_id uuid,
  post_author_username text,
  source text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  return query
    select a.item_id, a.kind, a.created_at, a.read_at, a.actor_id,
           p.username::text, p.display_name::text, p.avatar_path::text,
           coalesce((a.meta ->> 'count')::integer, 1),
           (a.meta ->> 'role')::text, (a.meta ->> 'org_name')::text,
           (a.meta ->> 'target')::text, (a.meta ->> 'action')::text,
           (a.meta ->> 'reason')::text,
           (a.meta ->> 'appealed_at') is not null,
           e.bumelerze_id::text, e.place::text, e.magnitude::numeric,
           case
             when a.kind = 'comment_reply' then left(rc.body, 140)
             when a.kind in ('post_comment', 'post_comment_reply') then left(pc.body, 140)
             when a.kind = 'mention' then left(case a.meta ->> 'source'
               when 'comment' then rc.body
               when 'post' then case when po.status = 'visible' then po.body end
               else pc.body end, 140)
             else null
           end,
           a.comment_id, a.post_id, a.tag_id,
           t.label::text, t.code::text,
           a.post_comment_id, pa.username::text, (a.meta ->> 'source')::text
      from public.activity_visible(v_uid) a
      left join public.profiles p on p.user_id = a.actor_id
      left join public.events e0 on e0.event_id = a.event_id
      left join public.events e on e.event_id = coalesce(e0.merged_into, e0.event_id)
      left join public.event_comments rc on rc.comment_id = a.comment_id and rc.status = 'visible'
      left join public.post_comments pc on pc.comment_id = a.post_comment_id and pc.status = 'visible'
      left join public.profile_posts po on po.post_id = a.post_id
      left join public.profiles pa on pa.user_id = po.user_id
      left join public.home_tags t on t.tag_id = a.tag_id
     where p_before is null or a.created_at < p_before
     order by a.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

-- 0061's "Ask for review", which now also names a post comment.
create or replace function public.request_content_review(p_item uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  a record;
  v_msg text := left(btrim(coalesce(p_message, '')), 1000);
  v_ref text;
  v_fid uuid;
begin
  if v_uid is null then
    raise exception 'request_content_review: not_account' using errcode = '42501';
  end if;
  select i.item_id as item_id, i.meta as meta, i.comment_id as comment_id,
         i.post_id as post_id, i.post_comment_id as post_comment_id, i.log_id as log_id
    into a
    from public.activity_items i
   where i.item_id = p_item and i.user_id = v_uid and i.kind = 'content_removed'
   for update;
  if not found then
    raise exception 'request_content_review: not_found' using errcode = 'P0002';
  end if;
  if (a.meta ->> 'appealed_at') is not null then
    raise exception 'request_content_review: already_requested' using errcode = '22023';
  end if;
  v_ref := coalesce(a.meta ->> 'target', 'content') || ' '
           || coalesce(a.comment_id, a.post_comment_id, a.post_id)::text;
  insert into public.feedback (device_id, user_id, message)
  values (
    'appeal-' || a.item_id::text,
    v_uid,
    'Review request for removed ' || coalesce(v_ref, 'content')
      || ' (reason: ' || coalesce(a.meta ->> 'reason', 'none') || ')'
      || case when a.log_id is not null then ' log ' || a.log_id::text else '' end
      || case when v_msg <> '' then E'\n\n' || v_msg else '' end
  )
  returning feedback_id into v_fid;
  update public.feedback set category = 'appeal' where feedback_id = v_fid;
  update public.activity_items
     set meta = meta || jsonb_build_object('appealed_at', now())
   where item_id = a.item_id;
end
$$;

-- 11. Composer help: suggestions and which @names exist ----------------------------------------------
-- People to mention for a typed prefix (2 to 24 characters, an @ in front
-- is allowed): username or display name starting with it. People I follow
-- or who follow me (accepted) first, then public accounts. Never myself,
-- never a private account I do not follow, never anybody in a block with
-- me, never a suspended account. 8 at most.
create or replace function public.mention_suggestions(p_prefix text)
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  relation text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_p text := lower(ltrim(btrim(coalesce(p_prefix, '')), '@'));
  v_like text;
begin
  if v_uid is null or char_length(v_p) < 2 or char_length(v_p) > 24 then
    return;
  end if;
  v_like := public.people_like_escape(v_p) || '%';
  return query
    select x.user_id, x.username, x.display_name, x.avatar_path, x.relation
      from (
        select p.user_id, p.username::text as username, p.display_name::text as display_name,
               p.avatar_path::text as avatar_path,
               case
                 when exists (select 1 from public.follows f
                               where f.follower_id = v_uid and f.followee_id = p.user_id
                                 and f.status = 'accepted') then 'following'
                 when exists (select 1 from public.follows f
                               where f.follower_id = p.user_id and f.followee_id = v_uid
                                 and f.status = 'accepted') then 'follower'
                 else 'other'
               end as relation
          from public.profiles p
         where p.username is not null
           and p.user_id <> v_uid
           and (lower(p.username) like v_like or lower(p.display_name) like v_like)
           and not public.blocked_between(v_uid, p.user_id)
           and not public.is_suspended(p.user_id)
           and (
             not p.is_private
             or exists (
               select 1 from public.follows f
                where f.follower_id = v_uid and f.followee_id = p.user_id and f.status = 'accepted'
             )
           )
      ) x
     order by (x.relation <> 'other') desc, (x.username = v_p) desc,
              char_length(x.username), x.username
     limit 8;
end
$$;

-- Which of these @names belong to an account the caller may open (not in a
-- block with them). Lower case in, lower case out; 50 names at most.
create or replace function public.mention_lookup(p_names text[])
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct lower(p.username)), '{}'::text[])
    from public.profiles p
   where p.username is not null
     and lower(p.username) = any (
       select lower(n) from unnest(coalesce(p_names, '{}'::text[])) with ordinality as u(n, i)
        where u.i <= 50
     )
     and not public.blocked_between(auth.uid(), p.user_id)
$$;

-- 12. Download my data: post comments and mentions --------------------------------------------------
-- The export live before this migration (0061, or a later batch's version)
-- becomes export_my_data_base and is called unchanged; this adds the
-- person's post comments, their reports on post comments and the mentions
-- they made (who, by public fields only).
do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'export_my_data'
       and p.pronargs = 0
       and p.prosrc like '%export_my_data_base%'
  ) then
    drop function if exists public.export_my_data_base();
    alter function public.export_my_data() rename to export_my_data_base;
  end if;
end
$$;
revoke all on function public.export_my_data_base() from public, anon, authenticated;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_base jsonb;
begin
  v_base := public.export_my_data_base();
  return v_base
    || jsonb_build_object(
      'post_comments', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'comment_id', c.comment_id, 'post_id', c.post_id, 'parent_id', c.parent_id,
                 'body', c.body, 'status', c.status, 'hidden_reason', c.hidden_reason,
                 'created_at', c.created_at, 'updated_at', c.updated_at,
                 'deleted_by_me_at', c.author_deleted_at,
                 'deleted_by_post_author_at', c.owner_deleted_at)
               order by c.created_at)
          from public.post_comments c where c.user_id = v_uid
      ), '[]'::jsonb),
      'mentions_made', coalesce((
        select jsonb_agg(public.export_person(m.mentioned_user_id)
                         || jsonb_build_object(
                              'in', m.source_type, 'id', m.source_id, 'created_at', m.created_at)
                         order by m.created_at)
          from public.mentions m where m.author_id = v_uid
      ), '[]'::jsonb),
      'reports_made', coalesce(v_base -> 'reports_made', '{}'::jsonb)
        || jsonb_build_object('post_comments', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'comment_id', r.comment_id, 'reason', r.reason, 'note', r.note,
                   'created_at', r.created_at, 'resolved_at', r.resolved_at))
            from public.post_comment_reports r where r.reporter_id = v_uid
        ), '[]'::jsonb))
    );
end
$$;

-- 13. Nightly: deleted comment text after 30 days ----------------------------------------------------
-- The text of a post comment its author or the post's author deleted is
-- wiped 30 days after the delete (the row stays, blank and hidden).
create or replace function public.purge_post_comments()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  update public.post_comments
     set body = ''
   where status = 'hidden'
     and body <> ''
     and coalesce(author_deleted_at, owner_deleted_at) < now() - interval '30 days';
  get diagnostics n = row_count;
  return jsonb_build_object('post_comments_wiped', n);
end
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge_post_comments') then
    perform cron.unschedule('purge_post_comments');
  end if;
  perform cron.schedule('purge_post_comments', '35 3 * * *', $cron$select public.purge_post_comments();$cron$);
exception
  when others then
    raise notice 'pg_cron scheduling skipped (%): schedule purge_post_comments by hand', sqlerrm;
end
$$;

-- 14. Who may call what ---------------------------------------------------------------------------
revoke all on function public.can_read_post_as(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.can_read_post_comment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_see_mention_source(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.post_comment_visible_count(uuid) from public, anon, authenticated;
revoke all on function public.mention_targets(text, uuid) from public, anon, authenticated;
revoke all on function public.sync_mentions(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mention_refresh(text, uuid) from public, anon, authenticated;
revoke all on function public.mention_item_visible(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mentions_after_write() from public, anon, authenticated;
revoke all on function public.post_comments_before_insert() from public, anon, authenticated;
revoke all on function public.post_comments_before_update() from public, anon, authenticated;
revoke all on function public.activity_link_post_comment(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.post_comments_after_write() from public, anon, authenticated;
revoke all on function public.post_comments_on_post_status() from public, anon, authenticated;
revoke all on function public.activity_on_post_comment_moderation() from public, anon, authenticated;
revoke all on function public.activity_visible(uuid) from public, anon, authenticated;
revoke all on function public.purge_post_comments() from public, anon, authenticated;
revoke all on function public.add_post_comment(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.post_comments_page(uuid, integer) from public;
revoke all on function public.delete_post_comment(uuid) from public, anon;
revoke all on function public.restore_post_comment(uuid) from public, anon;
revoke all on function public.set_post_comments_off(uuid, boolean) from public, anon;
revoke all on function public.report_post_comment(uuid, text, text) from public, anon;
revoke all on function public.post_comment_queue(integer) from public, anon;
revoke all on function public.moderate_post_comment(uuid, text, text) from public, anon;
revoke all on function public.admin_remove_post_comment(uuid, text) from public, anon;
revoke all on function public.admin_restore_post_comment(uuid, text) from public, anon;
revoke all on function public.content_holds_for(text, uuid[]) from public, anon;
revoke all on function public.admin_undo_action(uuid, text) from public, anon;
revoke all on function public.admin_hidden_removed(timestamptz, integer) from public, anon;
revoke all on function public.profile_posts_page(uuid, timestamptz, integer, boolean, uuid) from public;
revoke all on function public.my_recently_deleted() from public, anon;
revoke all on function public.my_activity(integer, timestamptz) from public, anon;
revoke all on function public.request_content_review(uuid, text) from public, anon;
revoke all on function public.mention_suggestions(text) from public, anon;
revoke all on function public.mention_lookup(text[]) from public;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.add_post_comment(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.post_comments_page(uuid, integer) to anon, authenticated;
grant execute on function public.delete_post_comment(uuid) to authenticated;
grant execute on function public.restore_post_comment(uuid) to authenticated;
grant execute on function public.set_post_comments_off(uuid, boolean) to authenticated;
grant execute on function public.report_post_comment(uuid, text, text) to authenticated;
grant execute on function public.post_comment_queue(integer) to authenticated;
grant execute on function public.moderate_post_comment(uuid, text, text) to authenticated;
grant execute on function public.admin_remove_post_comment(uuid, text) to authenticated;
grant execute on function public.admin_restore_post_comment(uuid, text) to authenticated;
grant execute on function public.content_holds_for(text, uuid[]) to authenticated;
grant execute on function public.admin_undo_action(uuid, text) to authenticated;
grant execute on function public.admin_hidden_removed(timestamptz, integer) to authenticated;
grant execute on function public.profile_posts_page(uuid, timestamptz, integer, boolean, uuid) to anon, authenticated;
grant execute on function public.my_recently_deleted() to authenticated;
grant execute on function public.my_activity(integer, timestamptz) to authenticated;
grant execute on function public.request_content_review(uuid, text) to authenticated;
grant execute on function public.mention_suggestions(text) to authenticated;
grant execute on function public.mention_lookup(text[]) to anon, authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.purge_post_comments() to service_role;
