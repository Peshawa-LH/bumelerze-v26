-- 0064: "I'm safe" told inside the app, and withdrawing a felt report.
-- Review notes 3.3 and 10.1 (owner decisions 2026-10-13). D81 and 0057 stay
-- the base of the check-in; 0061 the base of the activity list.
--
--   1. "I'm safe" reaches chosen people in the app (activity list), not only
--      the family home:
--        * safety_settings: one row per account, audience family (family
--          only), mutual (family and mutual follows, the default when there
--          is no row) or followers (family and every accepted follower).
--          my_safe_audience() and set_safe_audience() read and change it,
--          with the numbers of people each choice reaches today.
--        * safe_recipients(user, at): the one list of who is told. Family =
--          approved members of an ACTIVE home the person shares check-ins
--          with, approved before the check-in (0057 rules), no block either
--          way. Follows = accepted follows only (a private profile has only
--          accepted followers anyway), no block either way, no suspended
--          reader, no guest; mutual = I follow them back (accepted). A
--          family member is told as family, never twice. Mutes are NOT
--          counted here, so the numbers shown to the sender never reveal a
--          mute; activity_add still drops the row of a reader who muted the
--          sender (family excepted, as in 0061).
--        * Delivery: an activity row per reader, kind family_safe (as
--          before, with its home) or the new kind safe_checkin. A
--          suspended sender still reaches people (D81: safety over
--          moderation). PUSH for these comes with public alerts (D83); the
--          hook is marked in activity_on_checkins and nothing is pushed now.
--        * check_in() takes p_report_id: from a felt report the check-in is
--          real even without a regional M4.0. The report must be the
--          caller's, not withdrawn and under 24 hours old; the check-in is
--          tied to the report's earthquake when it has one, else to the
--          report itself (safety_checkins.report_id). Without a report the
--          0057 rule stands (an event of the last 72 hours).
--        * One check-in per person per earthquake (or report): tapping
--          again updates the time on the same row and on the readers'
--          rows (no new notice, nothing marked unread again).
--        * Still no place of any kind. Check-ins and their activity rows are
--          deleted after 30 days (purge_safety_checkins), and with the
--          account (foreign keys on delete cascade).
--        * family_checkins() also shows check-ins tied to a report only
--          (their event fields are empty); my_activity() adds event_time and
--          checked_in_at for the "is safe after the earthquake at" line.
--        * export_my_data() is wrapped (the 0063 version becomes
--          export_my_data_0063 and is called unchanged) and adds the setting
--          and the check-ins with their report id.
--   2. Withdraw a felt report (soft delete, data kept for research):
--        * felt_reports.withdrawn_at, withdrawn_by and restored_at (the
--          aggregation sweep finds both changes by their time).
--          withdraw_felt_report() and restore_felt_report() (Undo, 10
--          minutes) for the owner: the report's account (auth.uid) or the
--          phone that sent it (the client-generated report id together with
--          its device id, the same proof existing_report_ids() relies on),
--          so guests and earlier anonymous identities can withdraw too.
--        * Withdrawn reports leave every public or personal count: Event hub
--          summary, my_stats, public_profile milestones, surge_state, crowd
--          detection and assignment, merge of possible events, the comment
--          area, existing_report_ids (the phone forgets them). Their photos
--          and comments leave the public policies (felt_report_is_live).
--          The one-report-per-phone-per-event index now counts live reports
--          only, so a person can report again after withdrawing.
--        * Felt map: a cell is public only in its LATEST version (policy and
--          view), so the aggregation function's recompute without the
--          withdrawn report (aggregate-felt-cells, redeployed with this)
--          really replaces the old numbers.
--        * Admins still see them: admin_person lists withdrawn_at with the
--          recent reports, admin_felt_photo_queue gives report_withdrawn_at.
--        * export_my_data() keeps them (whole felt_reports rows, withdrawn_at
--          included).
--
-- Needs 0035 to 0063 (0062 not required). Idempotent: safe to run twice.
-- Written for the SQL editor as one line: no transaction statements, only
-- full-line comments, ASCII only, no question marks.

-- 1. Columns, indexes and the settings table -------------------------------------------------
alter table public.felt_reports add column if not exists withdrawn_at timestamptz;
alter table public.felt_reports add column if not exists withdrawn_by uuid references auth.users (id) on delete set null;
alter table public.felt_reports add column if not exists restored_at timestamptz;
create index if not exists felt_reports_withdrawn_idx on public.felt_reports (withdrawn_at) where withdrawn_at is not null;
drop index if exists public.felt_reports_device_event_uq;
create unique index if not exists felt_reports_device_event_live_uq
  on public.felt_reports (device_id, event_id)
  where event_id is not null and withdrawn_at is null;

alter table public.safety_checkins add column if not exists report_id uuid references public.felt_reports (report_id) on delete cascade;
create index if not exists safety_checkins_report_idx on public.safety_checkins (report_id) where report_id is not null;
create index if not exists safety_checkins_user_event_idx on public.safety_checkins (user_id, event_id) where status = 'safe';
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.safety_checkins'::regclass
       and contype = 'c'
       and conname <> 'safety_checkins_target_check'
       and pg_get_constraintdef(oid) like '%event_id IS NOT NULL%'
  loop
    execute format('alter table public.safety_checkins drop constraint %I', c.conname);
  end loop;
end
$$;
alter table public.safety_checkins drop constraint if exists safety_checkins_target_check;
alter table public.safety_checkins
  add constraint safety_checkins_target_check
  check (status = 'retracted' or event_id is not null or report_id is not null);

create table if not exists public.safety_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  audience text not null default 'mutual',
  updated_at timestamptz not null default now(),
  constraint safety_settings_audience_check check (audience in ('family', 'mutual', 'followers'))
);
alter table public.safety_settings enable row level security;
revoke all on public.safety_settings from public, anon, authenticated;

select public.rebuild_check_union(
  'public.activity_items'::regclass, '%new_follower%', 'activity_items_kind_check', 'kind', false,
  array['safe_checkin']
);

-- 2. Who is told ---------------------------------------------------------------------------------
-- The person's choice; mutual when they never chose.
create or replace function public.safe_audience_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.audience from public.safety_settings s where s.user_id = p_user), 'mutual')
$$;

-- Every reader of a check-in made by p_user at p_at, once each: via family
-- (with the home it is shown in), mutual or follower. Internal.
create or replace function public.safe_recipients(p_user uuid, p_at timestamptz)
returns table (user_id uuid, via text, tag_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with fam as (
    select distinct on (reader.user_id) reader.user_id, reader.tag_id
      from public.home_members me
      join public.home_tags t on t.tag_id = me.tag_id and t.status = 'active'
      join public.home_members reader
        on reader.tag_id = me.tag_id
       and reader.status = 'approved'
       and reader.user_id <> me.user_id
     where me.user_id = p_user
       and me.status = 'approved'
       and me.share_checkins
       and coalesce(reader.decided_at, reader.requested_at) <= p_at
       and not public.blocked_between(p_user, reader.user_id)
     order by reader.user_id, t.created_at
  ),
  fol as (
    select f.follower_id as user_id,
           exists (
             select 1 from public.follows b
              where b.follower_id = p_user
                and b.followee_id = f.follower_id
                and b.status = 'accepted'
           ) as mutual
      from public.follows f
      join auth.users u on u.id = f.follower_id and not coalesce(u.is_anonymous, false)
     where f.followee_id = p_user
       and f.status = 'accepted'
       and f.follower_id <> p_user
       and not public.blocked_between(p_user, f.follower_id)
       and not public.is_suspended(f.follower_id)
  )
  select fam.user_id, 'family'::text, fam.tag_id from fam
  union all
  select fol.user_id, case when fol.mutual then 'mutual' else 'follower' end, null::uuid
    from fol
   where p_user is not null
     and public.safe_audience_of(p_user) <> 'family'
     and (public.safe_audience_of(p_user) = 'followers' or fol.mutual)
     and not exists (select 1 from fam where fam.user_id = fol.user_id)
$$;

-- How many people a check-in made now reaches: family and follows (the
-- number under the current choice), plus what the two other choices would
-- reach. Internal.
create or replace function public.safe_audience_counts(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with fam as (
    select r.user_id from public.safe_recipients(p_user, now()) r where r.via = 'family'
  ),
  fol as (
    select f.follower_id as user_id,
           exists (
             select 1 from public.follows b
              where b.follower_id = p_user
                and b.followee_id = f.follower_id
                and b.status = 'accepted'
           ) as mutual
      from public.follows f
      join auth.users u on u.id = f.follower_id and not coalesce(u.is_anonymous, false)
     where f.followee_id = p_user
       and f.status = 'accepted'
       and f.follower_id <> p_user
       and not public.blocked_between(p_user, f.follower_id)
       and not public.is_suspended(f.follower_id)
       and not exists (select 1 from fam where fam.user_id = f.follower_id)
  )
  select jsonb_build_object(
    'audience', public.safe_audience_of(p_user),
    'family', (select count(*) from fam),
    'mutual', (select count(*) from fol where fol.mutual),
    'followers', (select count(*) from fol),
    'follows', case public.safe_audience_of(p_user)
                 when 'family' then 0
                 when 'followers' then (select count(*) from fol)
                 else (select count(*) from fol where fol.mutual)
               end
  )
$$;

-- The caller's choice and the numbers. Accounts only (a guest has no
-- followers and no family). Token: not_account.
create or replace function public.my_safe_audience()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'my_safe_audience: not_account' using errcode = '42501';
  end if;
  return public.safe_audience_counts(v_uid);
end
$$;

-- Tokens: not_account, invalid_audience.
create or replace function public.set_safe_audience(p_audience text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'set_safe_audience: not_account' using errcode = '42501';
  end if;
  if p_audience is null or p_audience not in ('family', 'mutual', 'followers') then
    raise exception 'set_safe_audience: invalid_audience' using errcode = '22023';
  end if;
  insert into public.safety_settings (user_id, audience, updated_at)
  values (v_uid, p_audience, now())
  on conflict (user_id) do update
    set audience = excluded.audience, updated_at = excluded.updated_at;
  return public.safe_audience_counts(v_uid);
end
$$;

-- 3. Check in --------------------------------------------------------------------------------------
-- 0057's check_in plus p_report_id, one row per earthquake or report, and
-- the numbers of people told. The signature changes, so the 0057 version
-- is dropped first (old phones call it by name with three arguments, which
-- still works through the defaults).
-- Errors (message prefix "check_in: "): not_account (42501), event_not_found
-- (22023), event_too_old (22023), report_not_found (P0002, the report may
-- still be on its way: retried), report_too_old (22023), rate_limited
-- (54000), conflict (22023).
drop function if exists public.check_in(uuid, uuid, timestamptz);
create or replace function public.check_in(
  p_client_id uuid,
  p_event_id uuid default null,
  p_checked_in_at timestamptz default null,
  p_report_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_event uuid;
  v_origin timestamptz;
  v_report_event uuid;
  v_report_at timestamptz;
  v_floor timestamptz;
  v_at timestamptz;
  v_recent integer;
  v_repeat boolean := false;
  v_row public.safety_checkins%rowtype;
  v_counts jsonb;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'check_in: not_account' using errcode = '42501';
  end if;
  if p_client_id is null or (p_event_id is null and p_report_id is null) then
    raise exception 'check_in: event_not_found' using errcode = '22023';
  end if;

  select * into v_row from public.safety_checkins where client_id = p_client_id;
  if found then
    if v_row.user_id <> v_uid then
      raise exception 'check_in: conflict' using errcode = '22023';
    end if;
  else
    if p_report_id is not null then
      select r.event_id, r.created_at into v_report_event, v_report_at
        from public.felt_reports r
       where r.report_id = p_report_id and r.user_id = v_uid and r.withdrawn_at is null;
      if not found then
        raise exception 'check_in: report_not_found' using errcode = 'P0002';
      end if;
      if v_report_at < now() - interval '24 hours' then
        raise exception 'check_in: report_too_old' using errcode = '22023';
      end if;
      v_event := coalesce(p_event_id, v_report_event);
      if v_event is not null then
        select e.origin_time into v_origin
          from public.events e
         where e.event_id = v_event and e.review_status <> 'deleted';
        if v_origin is null then
          v_event := null;
        end if;
      end if;
      v_floor := greatest(least(coalesce(v_origin, v_report_at), now()), now() - interval '24 hours');
    else
      select e.origin_time into v_origin
        from public.events e
       where e.event_id = p_event_id and e.review_status <> 'deleted';
      if v_origin is null then
        raise exception 'check_in: event_not_found' using errcode = '22023';
      end if;
      if v_origin < now() - interval '72 hours' or v_origin > now() + interval '10 minutes' then
        raise exception 'check_in: event_too_old' using errcode = '22023';
      end if;
      v_event := p_event_id;
      v_floor := greatest(least(v_origin, now()), now() - interval '72 hours');
    end if;

    v_at := least(coalesce(p_checked_in_at, now()), now());
    v_at := greatest(v_at, v_floor);

    select * into v_row
      from public.safety_checkins c
     where c.user_id = v_uid
       and c.status = 'safe'
       and c.created_at > now() - interval '72 hours'
       and (
         (v_event is not null and c.event_id = v_event)
         or (v_event is null and p_report_id is not null and c.report_id = p_report_id)
       )
     order by c.created_at desc
     limit 1
     for update;
    if found then
      v_repeat := true;
      update public.safety_checkins
         set client_id = p_client_id,
             checked_in_at = greatest(checked_in_at, v_at)
       where checkin_id = v_row.checkin_id
      returning * into v_row;
    else
      select count(*) into v_recent
        from public.safety_checkins c
       where c.user_id = v_uid and c.created_at > now() - interval '1 hour';
      if v_recent >= 10 then
        raise exception 'check_in: rate_limited' using errcode = '54000';
      end if;
      insert into public.safety_checkins (client_id, user_id, event_id, report_id, status, checked_in_at)
      values (p_client_id, v_uid, v_event, p_report_id, 'safe', v_at)
      on conflict (client_id) do nothing;
      select * into v_row from public.safety_checkins where client_id = p_client_id;
      if v_row.user_id <> v_uid then
        raise exception 'check_in: conflict' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_row.status = 'safe' then
    select jsonb_build_object(
             'family', count(*) filter (where r.via = 'family'),
             'follows', count(*) filter (where r.via <> 'family'))
      into v_counts
      from public.safe_recipients(v_uid, v_row.created_at) r;
  end if;
  return jsonb_build_object(
    'client_id', v_row.client_id, 'status', v_row.status,
    'event_id', v_row.event_id, 'report_id', v_row.report_id,
    'checked_in_at', v_row.checked_in_at, 'repeat', v_repeat,
    'audience', public.safe_audience_of(v_uid),
    'told', coalesce(v_counts, jsonb_build_object('family', 0, 'follows', 0))
  );
end
$$;

-- 4. Telling people -----------------------------------------------------------------------------------
-- 0061's trigger, now for every reader safe_recipients() names. One row per
-- reader per earthquake (or report), never a place. Taking the check-in back
-- takes the rows back; a new tap on the same check-in moves its time on the
-- rows without marking them unread again.
create or replace function public.activity_on_checkins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_key text;
  v_meta jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'safe' or (new.event_id is null and new.report_id is null) then
      return new;
    end if;
    v_key := 'safe:' || new.user_id::text || ':'
             || coalesce(new.event_id::text, 'r:' || new.report_id::text);
    v_meta := jsonb_build_object('checked_in_at', new.checked_in_at);
    if new.event_id is null then
      v_meta := v_meta || jsonb_build_object(
        'felt_at', (select fr.created_at from public.felt_reports fr where fr.report_id = new.report_id));
    end if;
    for r in select * from public.safe_recipients(new.user_id, new.created_at) loop
      if r.via = 'family' then
        perform public.activity_add(r.user_id, 'family_safe', new.user_id, v_key,
          null, null, new.event_id, r.tag_id, null, v_meta);
      else
        perform public.activity_add(r.user_id, 'safe_checkin', new.user_id, v_key,
          null, null, new.event_id, null, null, v_meta);
      end if;
    end loop;
    -- PUSH HOOK (D83): when alerts are public, a push for each family_safe
    -- and safe_checkin row written above is queued here for send-alerts.
    -- Nothing is pushed before then.
  elsif old.event_id is not null or old.report_id is not null then
    v_key := 'safe:' || old.user_id::text || ':'
             || coalesce(old.event_id::text, 'r:' || old.report_id::text);
    if old.status = 'safe' and new.status = 'retracted' then
      delete from public.activity_items
       where kind in ('family_safe', 'safe_checkin')
         and dedupe_key = v_key;
    elsif new.status = 'safe' and new.checked_in_at is distinct from old.checked_in_at then
      update public.activity_items
         set meta = meta || jsonb_build_object('checked_in_at', new.checked_in_at)
       where kind in ('family_safe', 'safe_checkin')
         and dedupe_key = v_key;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists activity_on_checkins on public.safety_checkins;
create trigger activity_on_checkins
  after insert or update of status, checked_in_at on public.safety_checkins
  for each row execute function public.activity_on_checkins();

-- 5. Reading: family card, activity list --------------------------------------------------------------
-- 0057's family_checkins: a check-in tied to a report only shows too, with
-- empty event fields, and every row carries its report id.
create or replace function public.family_checkins(p_tag uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz;
begin
  if v_uid is null
     or not public.is_home_member(p_tag)
     or not exists (select 1 from public.home_tags t where t.tag_id = p_tag and t.status = 'active') then
    raise exception 'family_checkins: members only' using errcode = '42501';
  end if;
  select coalesce(m.decided_at, m.requested_at) into v_since
    from public.home_members m
   where m.tag_id = p_tag and m.user_id = v_uid;

  return jsonb_build_object(
    'my_share', (
      select m.share_checkins from public.home_members m
       where m.tag_id = p_tag and m.user_id = v_uid
    ),
    'sharing', coalesce((
      select jsonb_agg(m.user_id order by m.requested_at)
        from public.home_members m
       where m.tag_id = p_tag
         and m.status = 'approved'
         and (
           m.user_id = v_uid
           or (
             m.share_checkins
             and not exists (
               select 1 from public.blocks b
                where (b.blocker_id = v_uid and b.blocked_id = m.user_id)
                   or (b.blocker_id = m.user_id and b.blocked_id = v_uid)
             )
           )
         )
    ), '[]'::jsonb),
    'checkins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', x.user_id,
               'checked_in_at', x.checked_in_at,
               'event_id', x.event_id,
               'report_id', x.report_id,
               'bumelerze_id', x.bumelerze_id,
               'magnitude', x.magnitude,
               'place', x.place,
               'origin_time', x.origin_time
             ) order by x.checked_in_at desc)
        from (
          select c.user_id, c.checked_in_at, c.report_id, e.event_id, e.bumelerze_id, e.magnitude, e.place, e.origin_time,
                 row_number() over (partition by c.user_id order by c.checked_in_at desc) as n
            from public.safety_checkins c
            join public.home_members m
              on m.tag_id = p_tag and m.user_id = c.user_id and m.status = 'approved'
            left join public.events e0 on e0.event_id = c.event_id
            left join public.events e on e.event_id = coalesce(e0.merged_into, e0.event_id)
           where c.status = 'safe'
             and c.created_at > now() - interval '7 days'
             and (
               c.user_id = v_uid
               or (
                 m.share_checkins
                 and c.created_at >= v_since
                 and not exists (
                   select 1 from public.blocks b
                    where (b.blocker_id = v_uid and b.blocked_id = c.user_id)
                       or (b.blocker_id = c.user_id and b.blocked_id = v_uid)
                 )
               )
             )
        ) x
       where x.n <= 5
    ), '[]'::jsonb)
  );
end
$$;

-- 0063's activity_visible: a safe_checkin is shown from a suspended sender
-- too (not from one the reader muted), and check-in rows go after 30 days.
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
     and (a.kind not in ('family_safe', 'safe_checkin') or a.created_at > now() - interval '30 days')
     and (
       a.actor_id is null
       or (
         not public.blocked_between(p_user, a.actor_id)
         and (
           a.kind = 'family_safe'
           or (
             not public.has_muted(p_user, a.actor_id)
             and (a.kind = 'safe_checkin' or not public.is_suspended(a.actor_id))
           )
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

-- 0063's list plus event_time (the earthquake's time, else the felt
-- report's) and checked_in_at. The return shape changes, so it is dropped
-- and created again.
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
  source text,
  event_time timestamptz,
  checked_in_at timestamptz
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
           a.post_comment_id, pa.username::text, (a.meta ->> 'source')::text,
           coalesce(e.origin_time, (a.meta ->> 'felt_at')::timestamptz),
           (a.meta ->> 'checked_in_at')::timestamptz
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

-- 0057's nightly purge plus the check-in activity rows after 30 days.
create or replace function public.purge_safety_checkins()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_checkins integer;
  n_undo integer;
  n_activity integer;
begin
  delete from public.safety_checkins where created_at < now() - interval '30 days';
  get diagnostics n_checkins = row_count;
  delete from public.home_member_undo where removed_at < now() - interval '1 day';
  get diagnostics n_undo = row_count;
  delete from public.activity_items
   where kind in ('family_safe', 'safe_checkin') and created_at < now() - interval '30 days';
  get diagnostics n_activity = row_count;
  return jsonb_build_object('checkins', n_checkins, 'member_undo', n_undo, 'safe_activity', n_activity);
end
$$;

-- 6. Withdraw a felt report --------------------------------------------------------------------------
-- The owner: the report's account, or the phone that sent it (its report id
-- and device id together). Internal.
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
       and (
         (auth.uid() is not null and r.user_id = auth.uid())
         or (p_device_id is not null and char_length(p_device_id) >= 8 and r.device_id = p_device_id)
       )
  )
$$;

-- Not withdrawn (used by the public photo and comment policies, which cannot
-- read felt_reports themselves). Internal.
create or replace function public.felt_report_is_live(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.felt_reports r
     where r.report_id = p_report_id and r.withdrawn_at is null
  )
$$;

-- Tokens: not_found. Withdrawing twice is not an error.
create or replace function public.withdraw_felt_report(p_report_id uuid, p_device_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_at timestamptz;
begin
  if p_report_id is null or not public.owns_felt_report(p_report_id, p_device_id) then
    raise exception 'withdraw_felt_report: not_found' using errcode = 'P0002';
  end if;
  update public.felt_reports
     set withdrawn_at = now(),
         withdrawn_by = (select u.id from auth.users u where u.id = auth.uid())
   where report_id = p_report_id and withdrawn_at is null;
  select withdrawn_at into v_at from public.felt_reports where report_id = p_report_id;
  return jsonb_build_object('report_id', p_report_id, 'withdrawn_at', v_at);
end
$$;

-- Undo, within 10 minutes. Tokens: not_found, expired, conflict (the phone
-- has sent a new report for the same earthquake since).
create or replace function public.restore_felt_report(p_report_id uuid, p_device_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
begin
  if p_report_id is null or not public.owns_felt_report(p_report_id, p_device_id) then
    raise exception 'restore_felt_report: not_found' using errcode = 'P0002';
  end if;
  select r.report_id as report_id, r.device_id as device_id, r.event_id as event_id,
         r.withdrawn_at as withdrawn_at
    into v_row
    from public.felt_reports r
   where r.report_id = p_report_id
   for update;
  if v_row.withdrawn_at is null then
    return jsonb_build_object('report_id', p_report_id, 'withdrawn_at', null);
  end if;
  if v_row.withdrawn_at < now() - interval '10 minutes' then
    raise exception 'restore_felt_report: expired' using errcode = '22023';
  end if;
  if v_row.event_id is not null and exists (
    select 1 from public.felt_reports o
     where o.device_id = v_row.device_id
       and o.event_id = v_row.event_id
       and o.withdrawn_at is null
       and o.report_id <> p_report_id
  ) then
    raise exception 'restore_felt_report: conflict' using errcode = '22023';
  end if;
  update public.felt_reports
     set withdrawn_at = null, withdrawn_by = null, restored_at = now()
   where report_id = p_report_id;
  return jsonb_build_object('report_id', p_report_id, 'withdrawn_at', null);
end
$$;

-- 7. Readers of felt_reports leave withdrawn reports out --------------------------------------------
-- 0039: the phone forgets a withdrawn report.
create or replace function public.existing_report_ids(p_report_ids uuid[], p_device_id text)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select report_id from public.felt_reports
  where report_id = any(p_report_ids[1:500]) and device_id = p_device_id
    and withdrawn_at is null
$$;

-- 0056: "N people felt it", levels and the first report.
create or replace function public.event_hub_summary(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'reports', (select count(*) from public.felt_reports where event_id = p_event_id and withdrawn_at is null),
    'people', (select count(distinct coalesce(user_id::text, device_id)) from public.felt_reports where event_id = p_event_id and withdrawn_at is null),
    'levels', coalesce((
      select jsonb_object_agg(cartoon_level::text, n) from (
        select cartoon_level, count(*) as n from public.felt_reports
        where event_id = p_event_id and withdrawn_at is null group by cartoon_level
      ) l
    ), '{}'::jsonb),
    'first_report_at', (select min(created_at) from public.felt_reports where event_id = p_event_id and withdrawn_at is null),
    'comments', (select count(*) from public.event_comments c
                  where c.event_id = p_event_id and c.status = 'visible'
                    and c.account_deleted_at is null
                    and not public.is_suspended(c.user_id)),
    'featured', coalesce((select hub_featured from public.events where event_id = p_event_id), false)
  )
$$;

-- 0040: my own numbers.
create or replace function public.my_stats()
returns table (
  member_since timestamptz,
  reports integer,
  detailed_reports integer,
  photo_reports integer,
  comments integer,
  helpful_received integer,
  family_linked boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select p.created_at
       from public.profiles p
      where p.user_id = auth.uid()),
    (select count(*)::integer
       from public.felt_reports r
      where r.user_id = auth.uid()
        and r.withdrawn_at is null),
    (select count(*)::integer
       from public.felt_reports r
      where r.user_id = auth.uid()
        and r.withdrawn_at is null
        and exists (select 1 from public.felt_report_details d
                     where d.felt_report_id = r.report_id)),
    (select count(*)::integer
       from public.felt_reports r
      where r.user_id = auth.uid()
        and r.withdrawn_at is null
        and exists (select 1 from public.felt_photos ph
                     where ph.report_id = r.report_id)),
    (select count(*)::integer
       from public.event_comments c
      where c.user_id = auth.uid()
        and c.status = 'visible'),
    (select coalesce(sum(c.helpful_count), 0)::integer
       from public.event_comments c
      where c.user_id = auth.uid()
        and c.status = 'visible'),
    exists (
      select 1
        from public.home_members m
       where m.user_id = auth.uid()
         and m.status = 'approved'
         and (select count(*)
                from public.home_members o
               where o.tag_id = m.tag_id
                 and o.status = 'approved') >= 2
    )
$$;

-- 0058: the public milestones.
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
      'reports', (select count(*) from public.felt_reports r where r.user_id = v_id and r.withdrawn_at is null),
      'detailed_reports', (select count(*) from public.felt_reports r
         where r.user_id = v_id
           and r.withdrawn_at is null
           and exists (select 1 from public.felt_report_details d where d.felt_report_id = r.report_id)),
      'photo_reports', (select count(*) from public.felt_reports r
         where r.user_id = v_id
           and r.withdrawn_at is null
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

-- 0059: busy-time review counts reports in the first hour.
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
     and fr.withdrawn_at is null
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

-- 0034: crowd detection and assignment never use a withdrawn report.
create or replace function public.assign_unassigned_felt_reports()
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  with candidates as (
    select
      fr.report_id,
      fr.device_id,
      e.event_id,
      row_number() over (
        partition by fr.report_id
        order by abs(extract(epoch from (fr.created_at - e.origin_time)))
      ) as rn
    from public.felt_reports fr
    join public.events e
      on e.merged_into is null
     and e.status in ('published', 'possible')
     and e.review_status <> 'deleted'
     and (
       e.status = 'possible'
       or exists (
         select 1 from public.event_source_records esr
         where esr.event_id = e.event_id and esr.review_status <> 'deleted' and esr.verified_at is not null
       )
     )
     and fr.created_at >= e.origin_time
     and fr.created_at <= e.origin_time + interval '30 minutes'
     and ST_DWithin(
           geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
           geography(ST_SetSRID(ST_MakePoint(fr.lon, fr.lat), 4326)),
           300000
         )
    where fr.event_id is null
      and fr.withdrawn_at is null
      and fr.created_at >= now() - interval '48 hours'
      and not exists (
        select 1
        from public.felt_reports fr2
        where fr2.device_id = fr.device_id
          and fr2.event_id = e.event_id
          and fr2.withdrawn_at is null
      )
  ),
  nearest as (
    select report_id, device_id, event_id from candidates where rn = 1
  ),
  chosen as (
    select report_id, event_id
    from (
      select report_id, event_id,
        row_number() over (partition by device_id, event_id order by report_id) as device_event_rn
      from nearest
    ) deduped
    where device_event_rn = 1
  ),
  updated as (
    update public.felt_reports fr
    set event_id = chosen.event_id
    from chosen
    where fr.report_id = chosen.report_id
    returning fr.report_id
  )
  select count(*)::integer from updated;
$$;

create or replace function public.detect_possible_events()
returns setof uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_time_window constant interval := interval '10 minutes';
  v_live_window constant interval := interval '12 minutes';
  v_n_min_users constant integer := 8;
  v_min_cartoon_level constant smallint := 2;
  v_min_gps_share constant double precision := 0.5;
  v_min_cells constant integer := 3;
  v_cooldown constant interval := interval '30 minutes';
  v_cooldown_radius_m constant double precision := 100000;
  v_provider constant text := 'bumelerze-crowd';
  v_region_min_lat constant double precision := 33.0;
  v_region_max_lat constant double precision := 38.5;
  v_region_min_lon constant double precision := 41.0;
  v_region_max_lon constant double precision := 48.5;
  v_bucket bigint := floor(extract(epoch from now()) / 600);
  v_cell record;
  s record;
  v_provider_event_id text;
  v_existing uuid;
  v_new_event_id uuid;
  v_source_record_id uuid;
begin
  for v_cell in
    select left(fr.geohash_p5, 4) as p4, count(distinct fr.user_id) as n
    from public.felt_reports fr
    where fr.event_id is null
      and fr.withdrawn_at is null
      and fr.user_id is not null
      and fr.created_at >= now() - v_time_window
      and fr.submitted_at >= now() - v_live_window
      and fr.lat between v_region_min_lat and v_region_max_lat
      and fr.lon between v_region_min_lon and v_region_max_lon
    group by left(fr.geohash_p5, 4)
    order by n desc, p4 asc
  loop
    with cluster as (
      select fr.*,
        row_number() over (partition by fr.user_id order by fr.created_at asc) as user_rn
      from public.felt_reports fr
      where fr.event_id is null
        and fr.withdrawn_at is null
        and fr.user_id is not null
        and fr.created_at >= now() - v_time_window
        and fr.submitted_at >= now() - v_live_window
        and fr.lat between v_region_min_lat and v_region_max_lat
        and fr.lon between v_region_min_lon and v_region_max_lon
        and left(fr.geohash_p5, 4) = any (array[v_cell.p4] || public.geohash_neighbors(v_cell.p4))
    ),
    people as (select * from cluster where user_rn = 1)
    select
      (select count(*) from cluster) as reports,
      count(*) as users,
      count(*) filter (where cartoon_level >= v_min_cartoon_level) as felt,
      count(*) filter (where location_quality = 'gps') as gps,
      count(distinct geohash_p5) filter (where location_quality = 'gps') as cells,
      percentile_cont(0.5) within group (order by lat) filter (where location_quality = 'gps') as lat,
      percentile_cont(0.5) within group (order by lon) filter (where location_quality = 'gps') as lon,
      to_timestamp(percentile_cont(0.5) within group (order by extract(epoch from created_at)::double precision)) as origin_time,
      min(created_at) as first_at,
      array_agg(report_id) as report_ids
    into s
    from people;

    if s.users < v_n_min_users then continue; end if;
    if s.felt * 2 < s.users then continue; end if;
    if s.gps < v_min_gps_share * s.users then continue; end if;
    if s.cells < v_min_cells then continue; end if;

    select e.event_id into v_existing
    from public.events e
    where e.status = 'possible'
      and e.created_at >= now() - v_cooldown
      and ST_DWithin(
            geography(ST_SetSRID(ST_MakePoint(e.lon, e.lat), 4326)),
            geography(ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326)),
            v_cooldown_radius_m
          )
    limit 1;
    if v_existing is not null then continue; end if;

    v_provider_event_id := 'crowd-' || v_cell.p4 || '-' || v_bucket::text;
    perform pg_advisory_xact_lock(hashtext(v_provider || ':' || v_provider_event_id));
    select esr.event_id into v_existing
    from public.event_source_records esr
    where esr.provider = v_provider and esr.provider_event_id = v_provider_event_id;
    if v_existing is not null then continue; end if;

    insert into public.events (
      origin_time, lat, lon, depth_km, magnitude, mag_type, place, status, region_flag,
      crowd_first_report_at, crowd_user_count, crowd_report_count
    ) values (
      s.origin_time, s.lat, s.lon, null, null, null, null, 'possible',
      (s.lat between v_region_min_lat and v_region_max_lat and s.lon between v_region_min_lon and v_region_max_lon),
      s.first_at, s.users, s.reports
    )
    returning event_id into v_new_event_id;

    insert into public.event_source_records (
      event_id, provider, provider_event_id, raw_payload,
      parsed_origin_time, parsed_lat, parsed_lon, parsed_depth_km,
      parsed_magnitude, parsed_mag_type, parsed_place
    ) values (
      v_new_event_id, v_provider, v_provider_event_id,
      jsonb_build_object(
        'rule', 'crowd-v2', 'report_count', s.reports, 'user_count', s.users,
        'felt_count', s.felt, 'gps_count', s.gps, 'p5_cells', s.cells,
        'first_report_at', s.first_at, 'seed_cell', v_cell.p4
      ),
      s.origin_time, s.lat, s.lon, null, null, null, null
    )
    returning source_record_id into v_source_record_id;

    update public.events
    set origin_time_source_id = v_source_record_id, location_source_id = v_source_record_id
    where event_id = v_new_event_id;

    update public.felt_reports fr
    set event_id = v_new_event_id
    where fr.report_id = any (s.report_ids);

    return next v_new_event_id;
  end loop;
  return;
end
$$;

create or replace function public.merge_possible_event(p_possible uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.felt_reports fr
  set event_id = p_target
  where fr.event_id = p_possible
    and not exists (
      select 1 from public.felt_reports fr2
      where fr2.event_id = p_target
        and fr2.withdrawn_at is null
        and (fr2.device_id = fr.device_id or (fr.user_id is not null and fr2.user_id = fr.user_id))
    );
  update public.events
  set status = 'merged', merged_into = p_target, updated_at = now()
  where event_id = p_possible and status = 'possible';
  insert into public.event_merges (source_event_id, target_event_id, reason, merged_by)
  values (p_possible, p_target, 'crowd_reconciled', 'system');
end
$$;

-- 0056: a comment's area comes from a live report only.
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
    and fr.withdrawn_at is null
  order by fr.created_at desc
  limit 1;

  return new;
end
$$;

-- 8. Admins still see withdrawn reports, marked ------------------------------------------------------
-- 0055: the recent reports carry withdrawn_at.
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

  v_recent := jsonb_build_object(
    'felt_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'report_id', r.report_id,
               'created_at', r.created_at,
               'event', e.bumelerze_id,
               'intensity', r.cartoon_level,
               'withdrawn_at', r.withdrawn_at) order by r.created_at desc)
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

-- 0060: the photo queue says when the report was withdrawn. The return
-- shape changes, so it is dropped and created again.
drop function if exists public.admin_felt_photo_queue(text, timestamptz, integer);
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
  moderated_by_name text,
  report_withdrawn_at timestamptz
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
             e.magnitude::real, e.origin_time, ph.moderated_at, null::text, fr.withdrawn_at
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
             e.magnitude::real, e.origin_time, ph.moderated_at, mp.display_name, fr.withdrawn_at
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

-- 9. Public policies: photos, comments, felt map -------------------------------------------------------
drop policy if exists felt_photos_select_approved on public.felt_photos;
create policy felt_photos_select_approved on public.felt_photos
  for select to anon, authenticated
  using (moderation_status = 'approved' and public.felt_report_is_live(report_id));

drop policy if exists felt_comments_select_approved on public.felt_comments;
create policy felt_comments_select_approved on public.felt_comments
  for select to anon, authenticated
  using (moderation_status = 'approved' and public.felt_report_is_live(report_id));

-- A cell is public in its latest version only, and only with 3 reports or
-- more: a recompute that drops below 3 (a withdrawn report) hides it.
create or replace function public.felt_cell_is_latest(p_event_id uuid, p_geohash text, p_version integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.felt_cells c
     where c.event_id = p_event_id and c.geohash = p_geohash and c.version > p_version
  )
$$;

drop policy if exists felt_cells_public_select on public.felt_cells;
create policy felt_cells_public_select on public.felt_cells
  for select to anon, authenticated
  using (n_reports >= 3 and public.felt_cell_is_latest(event_id, geohash, version));

create or replace view public.felt_cells_public with (security_invoker = on) as
select x.event_id, x.geohash, x.precision, x.n_reports, x.n_tier2, x.cdi, x.version, x.computed_at
  from (
    select distinct on (fc.event_id, fc.geohash)
           fc.event_id, fc.geohash, fc.precision, fc.n_reports, fc.n_tier2, fc.cdi,
           fc.version, fc.computed_at
      from public.felt_cells fc
     order by fc.event_id, fc.geohash, fc.version desc
  ) x
 where x.n_reports >= 3;
grant select on public.felt_cells_public to anon, authenticated;

-- 10. Download my data: the setting and the check-ins ------------------------------------------------
-- The export live before this migration (0063's wrapper) becomes
-- export_my_data_0063 and is called unchanged; felt reports already come
-- whole (withdrawn_at included).
do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'export_my_data'
       and p.pronargs = 0
       and p.prosrc like '%export_my_data_0063%'
  ) then
    drop function if exists public.export_my_data_0063();
    alter function public.export_my_data() rename to export_my_data_0063;
  end if;
end
$$;
revoke all on function public.export_my_data_0063() from public, anon, authenticated;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  return public.export_my_data_0063()
    || jsonb_build_object(
      'safe_settings', jsonb_build_object(
        'audience', public.safe_audience_of(v_uid),
        'chosen_at', (select s.updated_at from public.safety_settings s where s.user_id = v_uid)
      ),
      'checkins', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'event_id', sc.event_id, 'report_id', sc.report_id, 'status', sc.status,
                 'checked_in_at', sc.checked_in_at, 'created_at', sc.created_at)
               order by sc.created_at)
          from public.safety_checkins sc where sc.user_id = v_uid
      ), '[]'::jsonb)
    );
end
$$;

-- 11. Who may call what ----------------------------------------------------------------------------
revoke all on function public.safe_audience_of(uuid) from public, anon, authenticated;
revoke all on function public.safe_recipients(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.safe_audience_counts(uuid) from public, anon, authenticated;
revoke all on function public.activity_on_checkins() from public, anon, authenticated;
revoke all on function public.activity_visible(uuid) from public, anon, authenticated;
revoke all on function public.owns_felt_report(uuid, text) from public, anon, authenticated;
revoke all on function public.felt_report_is_live(uuid) from public;
revoke all on function public.felt_cell_is_latest(uuid, text, integer) from public;
revoke all on function public.purge_safety_checkins() from public, anon, authenticated;
revoke all on function public.event_comments_before_insert() from public, anon, authenticated;
revoke all on function public.surge_state() from public, anon, authenticated;
revoke all on function public.assign_unassigned_felt_reports() from public, anon, authenticated;
revoke all on function public.detect_possible_events() from public, anon, authenticated;
revoke all on function public.merge_possible_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_safe_audience() from public, anon;
revoke all on function public.set_safe_audience(text) from public, anon;
revoke all on function public.check_in(uuid, uuid, timestamptz, uuid) from public, anon;
revoke all on function public.family_checkins(uuid) from public, anon;
revoke all on function public.my_activity(integer, timestamptz) from public, anon;
revoke all on function public.withdraw_felt_report(uuid, text) from public;
revoke all on function public.restore_felt_report(uuid, text) from public;
revoke all on function public.existing_report_ids(uuid[], text) from public;
revoke all on function public.event_hub_summary(uuid) from public;
revoke all on function public.my_stats() from public, anon;
revoke all on function public.public_profile(text) from public;
revoke all on function public.admin_person(uuid) from public, anon;
revoke all on function public.admin_felt_photo_queue(text, timestamptz, integer) from public, anon;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.felt_report_is_live(uuid) to anon, authenticated;
grant execute on function public.felt_cell_is_latest(uuid, text, integer) to anon, authenticated;
grant execute on function public.my_safe_audience() to authenticated;
grant execute on function public.set_safe_audience(text) to authenticated;
grant execute on function public.check_in(uuid, uuid, timestamptz, uuid) to authenticated;
grant execute on function public.family_checkins(uuid) to authenticated;
grant execute on function public.my_activity(integer, timestamptz) to authenticated;
grant execute on function public.withdraw_felt_report(uuid, text) to anon, authenticated;
grant execute on function public.restore_felt_report(uuid, text) to anon, authenticated;
grant execute on function public.existing_report_ids(uuid[], text) to anon, authenticated;
grant execute on function public.event_hub_summary(uuid) to anon, authenticated;
grant execute on function public.my_stats() to authenticated;
grant execute on function public.public_profile(text) to anon, authenticated;
grant execute on function public.admin_person(uuid) to authenticated;
grant execute on function public.admin_felt_photo_queue(text, timestamptz, integer) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.purge_safety_checkins() to service_role;
