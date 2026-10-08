-- 0058: profile P2 (review social-admin-review-2026-10-08 section 5, plan rows
-- P2-10 and P2-11; decisions D76, D78, D79, D80).
--
--   1. bio (at most 160 characters, plain text, no links) and a city label
--      ("Lives in <place>": a place id from the app's own town list plus the
--      name shown when it was picked; NEVER coordinates) on the profile
--   2. profiles columns are no longer all readable by everybody: the new
--      about fields are read only through public_profile(), which applies
--      the private account, block and suspension rules. The columns the app
--      reads directly keep their grant.
--   3. pinned post: one of my own visible posts at the top of my profile,
--      set_pinned_post(); a post that is deleted or removed is unpinned by
--      a trigger, whatever path changed it
--   4. edit a post with an "edited" mark (edited_at); editing is locked while
--      the post has open reports (no bait and switch), edit_my_post()
--   5. "Helpful" on posts (no likes): post_helpful, set_post_helpful(), one
--      per account per post, never on one's own post, not by guests; marks
--      by people in a block with the author or with the reader are not
--      counted
--   6. one read for profile posts, profile_posts_page(): the text, the event
--      card, the helpful count and my mark, and (for the author) the edit
--      lock, in one round trip. The read rule is can_read_post(), which the
--      table's read policy now uses too, so the two can never drift apart
--   7. share an earthquake to my profile: posts of kind 'event' reference
--      the event, the text is optional (at most 280),
--      share_event_to_profile(); a replay within 10 minutes returns the same
--      post. No location of the person is stored, ever
--   8. name change limits: @username at most once in 30 days, display name
--      at most 5 times in 30 days, enforced in profiles_integrity_guard()
--      and recorded in profile_name_changes (old value, 90 days). Changes
--      made by an admin (admin_reset_profile_fields) are not the person's
--      own and are neither limited nor counted. my_profile_about() tells the
--      owner when the next change is possible
--   9. admin_restore_post() can bring back an event post with no text;
--      my_recently_deleted() shows the event of a deleted event post;
--      the nightly purge removes name history after 90 days
--
-- Restriction guard (0054) and the community guidelines (0056) apply to: a
-- new bio, a new city, pinning, editing a post, marking helpful and sharing
-- an event (as to any post). Clearing a bio or a city, unpinning and taking
-- a helpful mark back stay allowed.
--
-- Visibility: bio, city and the pinned post are part of the FULL profile
-- (the same rule as posts and counts): a private account shows them only to
-- accepted followers, a block hides them both ways, a suspended account shows
-- none of them to others.
--
-- Account deletion: post_helpful and profile_name_changes cascade from
-- auth.users; the new profiles columns go with the profiles row.
--
-- Error tokens (message text, the app maps them): bio_too_long, bio_link,
-- city_invalid, pinned_invalid, username_change_limit and
-- display_name_change_limit (54000, with the next possible time in DETAIL),
-- edit_locked, too_long, event_not_found, own_post, plus the existing ones.
--
-- Needs 0035 to 0057. Idempotent: safe to run twice. Written for the SQL
-- editor as one line: no transaction statements, only full-line comments,
-- ASCII only.

-- 1. Profiles: bio, city, pinned post ----------------------------------------------------
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists city_place_id text;
alter table public.profiles add column if not exists city_name text;
alter table public.profiles add column if not exists pinned_post_id uuid
  references public.profile_posts (post_id) on delete set null;

alter table public.profiles drop constraint if exists profiles_bio_check;
alter table public.profiles
  add constraint profiles_bio_check
  check (bio is null or char_length(bio) between 1 and 160);
alter table public.profiles drop constraint if exists profiles_city_check;
alter table public.profiles
  add constraint profiles_city_check
  check (
    (city_place_id is null) = (city_name is null)
    and (city_place_id is null or char_length(city_place_id) between 1 and 40)
    and (city_name is null or char_length(city_name) between 1 and 80)
  );

-- 2. Reading profiles directly: only the columns the app reads ------------------------------
-- Before this migration every column was readable by everybody (the read
-- policy is "true"). The about fields must follow the private/blocked/
-- suspended rules, so they are left out of the grant and served by
-- public_profile() and my_profile_about().
revoke select on public.profiles from anon, authenticated;
grant select (user_id, display_name, avatar_path, username, is_private, created_at, updated_at)
  on public.profiles to anon, authenticated;

-- 3. Name change history (limits; admins investigating impersonation) --------------------
create table if not exists public.profile_name_changes (
  change_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  field text not null check (field in ('username', 'display_name')),
  old_value text check (old_value is null or char_length(old_value) <= 80),
  changed_at timestamptz not null default now()
);
create index if not exists profile_name_changes_user_idx
  on public.profile_name_changes (user_id, field, changed_at desc);
alter table public.profile_name_changes enable row level security;
revoke all on public.profile_name_changes from public, anon, authenticated;

-- 4. Posts: kind, event, edited mark ----------------------------------------------------------
alter table public.profile_posts add column if not exists kind text not null default 'text';
alter table public.profile_posts add column if not exists event_id uuid
  references public.events (event_id) on delete set null;
alter table public.profile_posts add column if not exists edited_at timestamptz;

alter table public.profile_posts drop constraint if exists profile_posts_kind_check;
alter table public.profile_posts
  add constraint profile_posts_kind_check
  check (kind in ('text', 'event'));
-- 0050's body rule, plus: an event post may have no text, and at most 280.
alter table public.profile_posts drop constraint if exists profile_posts_body_check;
alter table public.profile_posts
  add constraint profile_posts_body_check
  check (
    char_length(body) <= 500
    and (status = 'removed' or kind = 'event' or char_length(btrim(body)) >= 1)
    and (kind <> 'event' or char_length(body) <= 280)
  );

grant select (post_id, user_id, body, status, created_at, updated_at, removed_reason, kind, event_id, edited_at)
  on public.profile_posts to anon, authenticated;

-- 5. Helpful marks on posts -----------------------------------------------------------------
create table if not exists public.post_helpful (
  post_id uuid not null references public.profile_posts (post_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_helpful_user_idx on public.post_helpful (user_id);
alter table public.post_helpful enable row level security;
revoke all on public.post_helpful from public, anon, authenticated;

-- 6. Helpers -----------------------------------------------------------------------------------
-- A link in a bio or city: a scheme, www., or a word ending in a common
-- top-level domain. Plain text only; a false positive just asks to rephrase.
create or replace function public.text_has_link(p_text text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_text, '') ~* '((http|https)://|www[.]|[a-z0-9-]+[.](com|net|org|info|io|me|co|ly|app|xyz|site|online|link|krd|iq|gl|gg|tk|ru|ir|tr|de|uk)([^a-z0-9]|$))'
$$;

-- The one read rule for a post (the table policy and every read function):
-- the author sees their own post unless they deleted it; everybody else sees
-- a visible post of someone whose posts they may see (0050) who is not
-- suspended (0054).
create or replace function public.can_read_post(p_author uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (p_author = auth.uid() and p_status <> 'deleted')
    or (
      p_status = 'visible'
      and public.can_view_posts_of(p_author)
      and not public.is_suspended(p_author)
    ),
    false
  )
$$;

drop policy if exists profile_posts_read on public.profile_posts;
create policy profile_posts_read on public.profile_posts
  for select to anon, authenticated
  using (public.can_read_post(user_id, status));

-- Helpful marks the reader may count: not from someone in a block with the
-- author or with the reader (either direction). Internal.
create or replace function public.post_helpful_visible_count(p_post uuid, p_author uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.post_helpful h
   where h.post_id = p_post
     and not exists (
       select 1 from public.blocks b
        where (b.blocker_id = h.user_id and (b.blocked_id = p_author or b.blocked_id = auth.uid()))
           or (b.blocked_id = h.user_id and (b.blocker_id = p_author or b.blocker_id = auth.uid()))
     )
$$;

-- 7. The profile row guard ------------------------------------------------------------------------
-- 0054's guard, plus: the about fields are normalised and checked, the
-- restriction and guidelines rules cover them, the pinned post must be one
-- of the owner's visible posts, and the owner's own name changes are limited
-- and recorded. An admin who edits somebody else's profile (auth.uid() is
-- not the owner) and system jobs are not limited.
create or replace function public.profiles_integrity_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_self boolean;
  v_username text;
  v_first timestamptz;
  v_count integer;
begin
  if new.bio is not null then
    new.bio := nullif(btrim(regexp_replace(new.bio, '[[:space:]]+', ' ', 'g')), '');
  end if;
  if new.city_name is not null then
    new.city_name := nullif(btrim(regexp_replace(new.city_name, '[[:space:]]+', ' ', 'g')), '');
  end if;
  if new.city_place_id is not null then
    new.city_place_id := nullif(btrim(new.city_place_id), '');
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    v_self := auth.uid() is not distinct from new.user_id;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    v_self := auth.uid() is not distinct from new.user_id;
    if v_self
       and (
         new.display_name is distinct from old.display_name
         or new.avatar_path is distinct from old.avatar_path
         or new.username is distinct from old.username
         or new.is_private is distinct from old.is_private
         or (new.bio is not null and new.bio is distinct from old.bio)
         or (new.city_place_id is not null
             and (new.city_place_id is distinct from old.city_place_id
                  or new.city_name is distinct from old.city_name))
         or (new.pinned_post_id is not null and new.pinned_post_id is distinct from old.pinned_post_id)
       ) then
      perform public.assert_not_restricted(new.user_id, 'profiles');
    end if;

    if v_self then
      v_username := lower(btrim(new.username));
      if old.username is not null and v_username is distinct from old.username then
        select max(c.changed_at) into v_first
          from public.profile_name_changes c
         where c.user_id = new.user_id
           and c.field = 'username'
           and c.changed_at > now() - interval '30 days';
        if v_first is not null then
          raise exception 'profiles: username_change_limit'
            using errcode = '54000', detail = (v_first + interval '30 days')::text;
        end if;
        insert into public.profile_name_changes (user_id, field, old_value)
        values (new.user_id, 'username', left(old.username, 80));
      end if;
      if new.display_name is distinct from old.display_name then
        select count(*), min(c.changed_at) into v_count, v_first
          from public.profile_name_changes c
         where c.user_id = new.user_id
           and c.field = 'display_name'
           and c.changed_at > now() - interval '30 days';
        if v_count >= 5 then
          raise exception 'profiles: display_name_change_limit'
            using errcode = '54000', detail = (v_first + interval '30 days')::text;
        end if;
        insert into public.profile_name_changes (user_id, field, old_value)
        values (new.user_id, 'display_name', left(old.display_name, 80));
      end if;
    end if;
  end if;

  if new.bio is not null and (tg_op = 'INSERT' or new.bio is distinct from old.bio) then
    if char_length(new.bio) > 160 then
      raise exception 'profiles: bio_too_long' using errcode = '23514';
    end if;
    if public.text_has_link(new.bio) then
      raise exception 'profiles: bio_link' using errcode = '23514';
    end if;
    if v_self then
      perform public.assert_guidelines_accepted(new.user_id, 'profiles');
    end if;
  end if;

  if (new.city_place_id is null) <> (new.city_name is null) then
    raise exception 'profiles: city_invalid' using errcode = '23514';
  end if;
  if new.city_place_id is not null
     and (tg_op = 'INSERT'
          or new.city_place_id is distinct from old.city_place_id
          or new.city_name is distinct from old.city_name) then
    if new.city_place_id !~ '^[A-Za-z0-9_-]{1,40}$'
       or char_length(new.city_name) > 80
       or public.text_has_link(new.city_name) then
      raise exception 'profiles: city_invalid' using errcode = '23514';
    end if;
  end if;

  if new.pinned_post_id is not null
     and (tg_op = 'INSERT' or new.pinned_post_id is distinct from old.pinned_post_id)
     and not exists (
       select 1 from public.profile_posts po
        where po.post_id = new.pinned_post_id
          and po.user_id = new.user_id
          and po.status = 'visible'
     ) then
    raise exception 'profiles: pinned_invalid' using errcode = '23514';
  end if;

  if new.avatar_path is not null
     and (tg_op = 'INSERT' or new.avatar_path is distinct from old.avatar_path)
     and (
       position('..' in new.avatar_path) > 0
       or left(new.avatar_path, char_length(new.user_id::text) + 1) <> new.user_id::text || '/'
     ) then
    raise exception 'profiles: avatar_path_invalid' using errcode = '23514';
  end if;

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

-- 8. Post triggers ------------------------------------------------------------------------------------
-- Create (0056's trigger plus: kind and event are checked, an event post's
-- text is optional and at most 280, the edited mark starts empty).
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
  new.body := btrim(coalesce(new.body, ''));
  new.kind := coalesce(new.kind, 'text');
  if new.kind = 'event' then
    if new.event_id is null or not exists (
      select 1 from public.events e
       where e.event_id = new.event_id and e.review_status <> 'deleted'
    ) then
      raise exception 'profile_posts: event_not_found' using errcode = 'P0002';
    end if;
    if char_length(new.body) > 280 then
      raise exception 'profile_posts: too_long' using errcode = '22023';
    end if;
  else
    new.event_id := null;
  end if;
  new.status := 'visible';
  new.created_at := now();
  new.updated_at := now();
  new.edited_at := null;
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

-- Edit (0054's trigger plus: the author's own text edit is refused while the
-- post has open reports, an event post keeps to 280, and a real change sets
-- the edited mark). Admin remove/restore and the author's delete/restore are
-- not text edits by the author and pass as before.
create or replace function public.profile_posts_before_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.body := btrim(coalesce(new.body, ''));
  if new.body is distinct from old.body
     and old.status = 'visible'
     and new.status = 'visible'
     and auth.uid() is not distinct from new.user_id then
    perform public.assert_not_restricted(new.user_id, 'profile_posts');
    if exists (
      select 1 from public.post_reports r
       where r.post_id = new.post_id and r.resolved_at is null
    ) then
      raise exception 'profile_posts: edit_locked' using errcode = '42501';
    end if;
    if new.kind = 'event' and char_length(new.body) > 280 then
      raise exception 'profile_posts: too_long' using errcode = '22023';
    end if;
    new.edited_at := now();
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- A post that stops being visible (deleted by its author, removed by an
-- admin) is no longer pinned.
create or replace function public.profile_posts_after_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'visible' and new.status <> 'visible' then
    update public.profiles
       set pinned_post_id = null
     where user_id = new.user_id and pinned_post_id = new.post_id;
  end if;
  return null;
end
$$;
drop trigger if exists profile_posts_after_status on public.profile_posts;
create trigger profile_posts_after_status
  after update of status on public.profile_posts
  for each row execute function public.profile_posts_after_status();

-- 9. Reading posts -------------------------------------------------------------------------------------
-- Newest first, one page (the app asks for one more row than it shows, to
-- know whether there is another page), or one post by id (the pinned one).
-- An event post carries the EARTHQUAKE's public data (bml id, magnitude,
-- epicentre, origin time) so the app writes the place line in the reader's
-- language, as everywhere else; nothing about where the person was.
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
  edit_locked boolean
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
         )
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

-- 10. Writing ------------------------------------------------------------------------------------------
-- Edit my post. Tokens: not_account, not_found, forbidden (removed),
-- edit_locked, account_restricted, too_long.
create or replace function public.edit_my_post(p_post_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_kind text;
  v_body text := btrim(coalesce(p_body, ''));
  v_max integer;
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'edit_my_post: not_account' using errcode = '42501';
  end if;
  select po.status, po.kind into v_status, v_kind
    from public.profile_posts po
   where po.post_id = p_post_id and po.user_id = v_uid
   for update;
  if not found or v_status = 'deleted' then
    raise exception 'edit_my_post: not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'visible' then
    raise exception 'edit_my_post: forbidden' using errcode = '42501';
  end if;
  v_max := case when v_kind = 'event' then 280 else 500 end;
  if char_length(v_body) > v_max then
    raise exception 'edit_my_post: too_long' using errcode = '22023';
  end if;
  if v_kind <> 'event' and v_body = '' then
    raise exception 'edit_my_post: empty' using errcode = '22023';
  end if;
  update public.profile_posts set body = v_body where post_id = p_post_id;
end
$$;

-- Mark (or unmark) a post as helpful. Idempotent: the same call twice leaves
-- one mark. Returns the mark and the count the caller may see. Tokens:
-- not_account (guests too), not_found, own_post, account_restricted.
create or replace function public.set_post_helpful(p_post_id uuid, p_helpful boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'set_post_helpful: not_account' using errcode = '42501';
  end if;
  select po.user_id into v_author
    from public.profile_posts po
   where po.post_id = p_post_id and po.status = 'visible';
  if not found or not public.can_read_post(v_author, 'visible') then
    raise exception 'set_post_helpful: not_found' using errcode = 'P0002';
  end if;
  if v_author = v_uid then
    raise exception 'set_post_helpful: own_post' using errcode = '42501';
  end if;
  if coalesce(p_helpful, false) then
    perform public.assert_not_restricted(v_uid, 'post_helpful');
    insert into public.post_helpful (post_id, user_id)
    values (p_post_id, v_uid)
    on conflict (post_id, user_id) do nothing;
  else
    delete from public.post_helpful where post_id = p_post_id and user_id = v_uid;
  end if;
  return jsonb_build_object(
    'helpful', coalesce(p_helpful, false),
    'count', public.post_helpful_visible_count(p_post_id, v_author)
  );
end
$$;

-- Share an earthquake to my profile. p_event is the bml id or the internal
-- event id; a merged event resolves to the event it was merged into. The text
-- is optional (at most 280). The same share repeated within 10 minutes (a
-- retry on a weak network) returns the existing post instead of a second one.
-- Tokens: not_account, profile_required, event_not_found, too_long, plus the
-- insert trigger's (account_restricted, guidelines_required, rate_limited).
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
     and po.status = 'visible'
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

-- Pin one of my visible posts (null unpins). Tokens: not_account, not_found,
-- profile_required, account_restricted (pinning only).
create or replace function public.set_pinned_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'set_pinned_post: not_account' using errcode = '42501';
  end if;
  if p_post_id is not null and not exists (
    select 1 from public.profile_posts po
     where po.post_id = p_post_id and po.user_id = v_uid and po.status = 'visible'
  ) then
    raise exception 'set_pinned_post: not_found' using errcode = 'P0002';
  end if;
  update public.profiles set pinned_post_id = p_post_id where user_id = v_uid;
  if not found then
    raise exception 'set_pinned_post: profile_required' using errcode = '42501';
  end if;
end
$$;

-- Bio and city (null or empty clears). The guard checks and normalises.
-- Only an id and a name are accepted: there is no place for coordinates.
create or replace function public.set_profile_about(
  p_bio text,
  p_city_place_id text,
  p_city_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id text := nullif(btrim(coalesce(p_city_place_id, '')), '');
  v_name text := nullif(btrim(coalesce(p_city_name, '')), '');
begin
  if v_uid is null or not public.is_real_account() then
    raise exception 'set_profile_about: not_account' using errcode = '42501';
  end if;
  if (v_id is null) <> (v_name is null) then
    raise exception 'profiles: city_invalid' using errcode = '23514';
  end if;
  update public.profiles
     set bio = nullif(btrim(coalesce(p_bio, '')), ''),
         city_place_id = v_id,
         city_name = v_name
   where user_id = v_uid;
  if not found then
    raise exception 'set_profile_about: profile_required' using errcode = '42501';
  end if;
end
$$;

-- What the owner's Edit profile needs: the about fields and when the next
-- name change is possible. Null for a guest or before a profile exists.
create or replace function public.my_profile_about()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  p record;
  v_last_username timestamptz;
  v_name_count integer;
  v_name_first timestamptz;
begin
  if v_uid is null then
    return null;
  end if;
  select pr.bio as bio, pr.city_place_id as city_place_id, pr.city_name as city_name,
         pr.pinned_post_id as pinned_post_id
    into p
    from public.profiles pr
   where pr.user_id = v_uid;
  if not found then
    return null;
  end if;
  select max(c.changed_at) into v_last_username
    from public.profile_name_changes c
   where c.user_id = v_uid and c.field = 'username' and c.changed_at > now() - interval '30 days';
  select count(*), min(c.changed_at) into v_name_count, v_name_first
    from public.profile_name_changes c
   where c.user_id = v_uid and c.field = 'display_name' and c.changed_at > now() - interval '30 days';
  return jsonb_build_object(
    'bio', p.bio,
    'city_place_id', p.city_place_id,
    'city_name', p.city_name,
    'pinned_post_id', p.pinned_post_id,
    'username_next_change_at', v_last_username + interval '30 days',
    'display_name_changes_left', greatest(5 - v_name_count, 0),
    'display_name_next_change_at',
      case when v_name_count >= 5 then v_name_first + interval '30 days' end
  );
end
$$;

-- 11. The public profile page ------------------------------------------------------------------------
-- 0054's function plus, in the FULL part only (so private, blocked and
-- suspended rules apply exactly as to posts): bio, city label and the pinned
-- post id (only while that post is visible).
create or replace function public.public_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_viewer uuid := auth.uid();
  v_name text := lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  v_id uuid;
  v_username text;
  v_display text;
  v_avatar text;
  v_private boolean;
  v_since timestamptz;
  v_bio text;
  v_city_id text;
  v_city_name text;
  v_pinned uuid;
  v_self boolean;
  v_status text;
  v_blocked boolean;
  v_full boolean;
  v_hide boolean;
  v_suspended boolean;
  v_roles jsonb;
  v_base jsonb;
begin
  select p.user_id, p.username, p.display_name, p.avatar_path, p.is_private, p.created_at,
         p.bio, p.city_place_id, p.city_name, p.pinned_post_id
    into v_id, v_username, v_display, v_avatar, v_private, v_since,
         v_bio, v_city_id, v_city_name, v_pinned
    from public.profiles p
   where lower(p.username) = v_name;
  if not found then
    return null;
  end if;
  if v_viewer is not null and exists (
    select 1 from public.blocks b where b.blocker_id = v_id and b.blocked_id = v_viewer
  ) then
    return null;
  end if;

  v_self := v_viewer is not null and v_viewer = v_id;
  v_suspended := public.is_suspended(v_id);
  select f.status into v_status
    from public.follows f
   where f.follower_id = v_viewer and f.followee_id = v_id;
  v_blocked := v_viewer is not null and exists (
    select 1 from public.blocks b where b.blocker_id = v_viewer and b.blocked_id = v_id
  );
  if v_suspended and not v_self then
    return jsonb_build_object(
      'user_id', v_id,
      'username', v_username,
      'display_name', null::text,
      'avatar_path', null::text,
      'is_private', v_private,
      'roles', '[]'::jsonb,
      'is_self', false,
      'follow_status', 'none',
      'is_blocked', v_blocked,
      'can_view_full', false,
      'suspended', true
    );
  end if;
  v_full := not v_blocked
    and (not v_private or v_self or coalesce(v_status, '') = 'accepted');
  v_roles := coalesce((
    select jsonb_agg(jsonb_build_object('role', ur.role, 'org_name', ur.org_name))
      from public.user_roles ur where ur.user_id = v_id
  ), '[]'::jsonb);

  v_base := jsonb_build_object(
    'user_id', v_id,
    'username', v_username,
    'display_name', v_display,
    'avatar_path', v_avatar,
    'is_private', v_private,
    'roles', v_roles,
    'is_self', v_self,
    'follow_status', coalesce(v_status, 'none'),
    'is_blocked', v_blocked,
    'can_view_full', v_full,
    'suspended', v_suspended
  );
  if not v_full then
    return v_base;
  end if;

  select coalesce(pp.hide_badges, false) into v_hide
    from (select 1) one
    left join public.profile_private pp on pp.user_id = v_id;

  return v_base || jsonb_build_object(
    'member_since', v_since,
    'bio', v_bio,
    'city_place_id', v_city_id,
    'city_name', v_city_name,
    'pinned_post_id', (
      select po.post_id from public.profile_posts po
       where po.post_id = v_pinned and po.user_id = v_id and po.status = 'visible'
    ),
    'followers', (select count(*) from public.follows f where f.followee_id = v_id and f.status = 'accepted'),
    'following', (select count(*) from public.follows f where f.follower_id = v_id and f.status = 'accepted'),
    'comments', (select count(*) from public.event_comments c where c.user_id = v_id and c.status = 'visible'),
    'helpful_received', (select coalesce(sum(c.helpful_count), 0) from public.event_comments c where c.user_id = v_id and c.status = 'visible'),
    'posts_count', (select count(*) from public.profile_posts po where po.user_id = v_id and po.status = 'visible'),
    'badges_hidden', v_hide,
    'milestones', case when v_hide then null else jsonb_build_object(
      'reports', (select count(*) from public.felt_reports r where r.user_id = v_id),
      'detailed_reports', (select count(*) from public.felt_reports r
         where r.user_id = v_id
           and exists (select 1 from public.felt_report_details d where d.felt_report_id = r.report_id)),
      'photo_reports', (select count(*) from public.felt_reports r
         where r.user_id = v_id
           and exists (select 1 from public.felt_photos ph where ph.report_id = r.report_id))
    ) end,
    'recent_comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'comment_id', rc.comment_id,
               'body', left(rc.body, 280),
               'created_at', rc.created_at,
               'helpful_count', rc.helpful_count,
               'hub_id', e.bumelerze_id,
               'place', e.place,
               'magnitude', e.magnitude
             ) order by rc.created_at desc)
        from (
          select cc.comment_id, cc.event_id, cc.body, cc.created_at, cc.helpful_count
            from public.event_comments cc
           where cc.user_id = v_id and cc.status = 'visible'
           order by cc.created_at desc
           limit 10
        ) rc
        join public.events e on e.event_id = rc.event_id
    ), '[]'::jsonb)
  );
end
$$;

-- 12. Admin restore, recently deleted, purge -----------------------------------------------------------
-- 0053's admin_restore_post, plus: an event post whose text was empty is
-- restorable (the evidence copy is the empty text).
create or replace function public.admin_restore_post(p_post_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  p record;
  l record;
  ev record;
  v_at timestamptz;
  v_new uuid;
  v_reopened integer := 0;
begin
  if not public.has_permission(v_uid, 'content.restore') then
    raise exception 'admin_restore_post: not allowed' using errcode = '42501';
  end if;
  select po.user_id as user_id, po.status as status, po.updated_at as updated_at, po.kind as kind
    into p
    from public.profile_posts po
   where po.post_id = p_post_id
   for update;
  if not found then
    raise exception 'admin_restore_post: not_found' using errcode = 'P0002';
  end if;
  if p.status = 'visible' then
    return;
  end if;
  if p.status <> 'removed' then
    raise exception 'admin_restore_post: not_restorable' using errcode = '22023';
  end if;
  select x.log_id as log_id, x.snapshot as snapshot, x.created_at as created_at
    into l
    from public.moderation_log x
   where x.post_id = p_post_id and x.action = 'post_remove' and x.reverted_by is null
   order by x.created_at desc, x.log_id desc
   limit 1;
  v_at := coalesce(l.created_at, p.updated_at);
  if v_at < now() - interval '30 days' then
    raise exception 'admin_restore_post: expired' using errcode = '22023';
  end if;
  select e.body as body into ev
    from public.moderation_evidence e
   where e.post_id = p_post_id;
  if not found or (coalesce(btrim(ev.body), '') = '' and p.kind <> 'event') then
    raise exception 'admin_restore_post: not_restorable' using errcode = '22023';
  end if;
  update public.profile_posts
     set status = 'visible',
         body = coalesce(ev.body, ''),
         removed_by = null,
         removed_reason = null,
         updated_at = now()
   where post_id = p_post_id;
  if jsonb_typeof(l.snapshot -> 'report_ids') = 'array' then
    update public.post_reports r
       set resolved_at = null
     where r.post_id = p_post_id
       and r.resolved_at is not null
       and r.report_id in (
         select (j.value)::uuid from jsonb_array_elements_text(l.snapshot -> 'report_ids') j
       );
    get diagnostics v_reopened = row_count;
  end if;
  v_new := public.write_audit(
    v_uid, 'post_restore', 'post', p_post_id::text,
    p.user_id, null, p_post_id, null, p_note,
    jsonb_build_object('from', 'removed', 'to', 'visible', 'undid', l.log_id, 'reports_reopened', v_reopened)
  );
  if l.log_id is not null then
    update public.moderation_log set reverted_by = v_new where log_id = l.log_id;
  end if;
end
$$;

-- 0053's list, plus: a deleted event post carries its event (bml id, place,
-- magnitude) like a deleted comment does, so a post with no text is still
-- recognisable.
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
    ) r
    order by 4 desc
    limit 50;
end
$$;

-- 0053's nightly purge, plus: name history older than 90 days.
create or replace function public.purge_expired_social()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_posts integer;
  n_evidence integer;
  n_undo integer;
  n_names integer;
begin
  delete from public.profile_posts
   where status = 'deleted'
     and deleted_at < now() - interval '30 days';
  get diagnostics n_posts = row_count;
  delete from public.moderation_evidence
   where expires_at < now();
  get diagnostics n_evidence = row_count;
  delete from public.follow_undo
   where created_at < now() - interval '1 day';
  get diagnostics n_undo = row_count;
  delete from public.profile_name_changes
   where changed_at < now() - interval '90 days';
  get diagnostics n_names = row_count;
  if n_posts > 0 then
    perform public.write_audit(
      null, 'purge', 'post', null, null, null, null,
      'author_deleted_posts', n_posts::text || ' posts', null
    );
  end if;
  if n_evidence > 0 then
    perform public.write_audit(
      null, 'purge', 'system', null, null, null, null,
      'removal_evidence', n_evidence::text || ' items', null
    );
  end if;
  return jsonb_build_object('posts', n_posts, 'evidence', n_evidence, 'follow_undo', n_undo, 'name_changes', n_names);
end
$$;

-- 13. Who may call what -----------------------------------------------------------------------------
revoke all on function public.text_has_link(text) from public, anon, authenticated;
revoke all on function public.can_read_post(uuid, text) from public;
revoke all on function public.post_helpful_visible_count(uuid, uuid) from public, anon, authenticated;
revoke all on function public.profiles_integrity_guard() from public, anon, authenticated;
revoke all on function public.profile_posts_before_insert() from public, anon, authenticated;
revoke all on function public.profile_posts_before_update() from public, anon, authenticated;
revoke all on function public.profile_posts_after_status() from public, anon, authenticated;
revoke all on function public.profile_posts_page(uuid, timestamptz, integer, boolean, uuid) from public;
revoke all on function public.edit_my_post(uuid, text) from public, anon;
revoke all on function public.set_post_helpful(uuid, boolean) from public, anon;
revoke all on function public.share_event_to_profile(text, text) from public, anon;
revoke all on function public.set_pinned_post(uuid) from public, anon;
revoke all on function public.set_profile_about(text, text, text) from public, anon;
revoke all on function public.my_profile_about() from public, anon;
revoke all on function public.public_profile(text) from public;
revoke all on function public.admin_restore_post(uuid, text) from public, anon;
revoke all on function public.my_recently_deleted() from public, anon;
revoke all on function public.purge_expired_social() from public, anon, authenticated;
grant execute on function public.can_read_post(uuid, text) to anon, authenticated;
grant execute on function public.profile_posts_page(uuid, timestamptz, integer, boolean, uuid) to anon, authenticated;
grant execute on function public.edit_my_post(uuid, text) to authenticated;
grant execute on function public.set_post_helpful(uuid, boolean) to authenticated;
grant execute on function public.share_event_to_profile(text, text) to authenticated;
grant execute on function public.set_pinned_post(uuid) to authenticated;
grant execute on function public.set_profile_about(text, text, text) to authenticated;
grant execute on function public.my_profile_about() to authenticated;
grant execute on function public.public_profile(text) to anon, authenticated;
grant execute on function public.admin_restore_post(uuid, text) to authenticated;
grant execute on function public.my_recently_deleted() to authenticated;
grant execute on function public.purge_expired_social() to service_role;
