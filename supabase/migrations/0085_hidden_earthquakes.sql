-- 0085: Hide an earthquake (pre-launch checklist B2.6, stage 2; owner
-- approval of the wording and the five choices 2026-11-27).
--
-- Pasted into the SQL editor as one line: full-line comments only, no
-- transaction statements, ASCII, no question marks, idempotent (safe to
-- run twice).
--
-- 1. hidden_events: one row per hidden earthquake, a published one or a
--    possible one (choice 3). Reason 'duplicate' (two cards for one
--    earthquake; kept_event_id is the card that stays, never the same one,
--    never a hidden one), 'not_real' or 'other' (a note is needed). The
--    note is at most 200 characters, cleaned like the Home message (0084).
--    Show again deletes the row; the history is in the activity log.
-- 2. hidden_event_moves: every felt report and I'm safe check-in a hide
--    moved to the card that stays (choice 2), so Show again moves back
--    exactly those rows.
-- 3. felt_cells_refresh, felt_cells_refresh_run() and the cron job
--    felt_cells_refresh (every 2 minutes; nothing to do when the table is
--    empty): after a hide or Show again that moved felt reports, both
--    earthquakes' felt maps are rebuilt by the existing per-event call of
--    aggregate-felt-cells (body eventId), repeated for 10 minutes so the
--    function's 60-second pause between rebuilds cannot skip one. The
--    5-minute sweep alone would miss a card left with no reports and
--    reports older than its 24 hours. No edge function changes.
-- 4. The three tables: RLS on, no client privileges.
-- 5. New permission events.hide, for the admin rank only (choice 1), with a
--    two-step session like every permission (0076). Activity log actions
--    event_hide and event_unhide.
-- 6. Admin functions, each refusing a caller without events.hide (42501):
--    admin_hidden_events(), admin_hide_find_events(query, limit) (the Home
--    screen search plus possible earthquakes and a hidden flag),
--    admin_hide_candidates(event) (within 10 minutes and 300 km, nearest
--    first), admin_hide_impact(event), admin_hide_event(event, reason,
--    kept, note), admin_unhide_event(event). Errors (22023): bad_reason,
--    event_not_found, already_hidden, is_kept_card (it is the card that
--    stays for another hidden one), kept_required, kept_is_same,
--    kept_not_found, kept_hidden, note_required, note_too_long, not_hidden.
-- 7. A duplicate hide moves the live felt reports and safe check-ins to the
--    card that stays, except for a person already on it (their row stays);
--    the family and follower notes of a moved check-in follow it, so taking
--    it back still removes them. Every hide takes the earthquake off Home.
--    Comments, likes and posts stay with the hidden card. Show again moves
--    nothing back when the earthquake has meanwhile been merged, deleted or
--    unpublished (the rows stay where they are); the row goes and it is logged.
-- 8. home_extras() gains 'hidden' (bumelerze id, provider ids, duplicate or
--    removed, the ids of the card that stays); a hidden earthquake is never
--    in 'pins'. admin_tool_counts() gains hidden_events.
--    admin_pin_home_event() refuses a hidden earthquake and does not count
--    one toward the 3 pins; admin_home_find_events() leaves them out.
-- 9. A hidden earthquake starts nothing new: no SHAKEmap start, no alert
--    queued or planned (its waiting pushes are skipped), not a main shock
--    for the aftershock rule, no busy time, no felt report assigned to it,
--    no possible earthquake merged into it, and a hidden possible one is
--    never merged. Its held-back pushes are skipped before summaries are
--    planned. A new felt report or I'm safe check-in naming a hidden second
--    card goes to the card that stays (a felt report never to a merged or
--    deleted one); a felt report naming a removed earthquake loses its event
--    link, as for an unknown event.
-- 10. Every replaced function is its live body (latest migration that
--    defines it) plus the hidden check. A last block checks the result and
--    fails the whole paste if a part is missing.
--
-- Needs 0052, 0062, 0064, 0066, 0074, 0076, 0077, 0080 and 0084 as applied live.

-- 1. Hidden earthquakes ----------------------------------------------------------------------------
create table if not exists public.hidden_events (
  event_id uuid primary key references public.events (event_id) on delete cascade,
  reason text not null,
  kept_event_id uuid references public.events (event_id) on delete cascade,
  note text,
  hidden_by uuid references auth.users (id) on delete set null,
  hidden_at timestamptz not null default now(),
  constraint hidden_events_reason check (reason in ('duplicate', 'not_real', 'other')),
  constraint hidden_events_kept check ((reason = 'duplicate') = (kept_event_id is not null)),
  constraint hidden_events_not_itself check (kept_event_id <> event_id),
  constraint hidden_events_note check (note is null or char_length(note) between 1 and 200),
  constraint hidden_events_other_note check (reason <> 'other' or note is not null)
);
create index if not exists hidden_events_kept_idx on public.hidden_events (kept_event_id) where kept_event_id is not null;
alter table public.hidden_events enable row level security;
revoke all on public.hidden_events from public, anon, authenticated;

-- 2. What a hide moved -----------------------------------------------------------------------------
create table if not exists public.hidden_event_moves (
  move_id uuid primary key default gen_random_uuid(),
  hidden_event_id uuid not null references public.hidden_events (event_id) on delete cascade,
  kept_event_id uuid not null references public.events (event_id) on delete cascade,
  report_id uuid references public.felt_reports (report_id) on delete cascade,
  checkin_id uuid references public.safety_checkins (checkin_id) on delete cascade,
  moved_at timestamptz not null default now(),
  constraint hidden_event_moves_one_row check (num_nonnulls(report_id, checkin_id) = 1)
);
create unique index if not exists hidden_event_moves_report_uq on public.hidden_event_moves (report_id, hidden_event_id) where report_id is not null;
create unique index if not exists hidden_event_moves_checkin_uq on public.hidden_event_moves (checkin_id, hidden_event_id) where checkin_id is not null;
create index if not exists hidden_event_moves_hidden_idx on public.hidden_event_moves (hidden_event_id);
alter table public.hidden_event_moves enable row level security;
revoke all on public.hidden_event_moves from public, anon, authenticated;

-- 3. Felt maps to rebuild --------------------------------------------------------------------------
create table if not exists public.felt_cells_refresh (
  event_id uuid primary key references public.events (event_id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table public.felt_cells_refresh enable row level security;
revoke all on public.felt_cells_refresh from public, anon, authenticated;

-- 4. The permission --------------------------------------------------------------------------------
insert into public.role_permissions (role, permission) values
  ('admin', 'events.hide')
on conflict do nothing;

-- 5. The activity log accepts the new actions (union with the live list, as in 0084) ---------------
do $$
declare
  c record;
  v_found text[];
  v_list text;
  v_actions text[] := array['event_hide', 'event_unhide'];
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

-- 6. Every provider id the registry knows for one earthquake, first seen first. Internal.
create or replace function public.event_provider_ids(p_event_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(s.provider_event_id order by s.fetched_at, s.provider_event_id), '{}'::text[])
    from public.event_source_records s
   where s.event_id = p_event_id
$$;

-- 7. What phones read: 0084 body, no hidden earthquake in pins, plus the hidden list ---------------
create or replace function public.home_extras()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'notice', (
      select jsonb_build_object(
               'notice_id', n.notice_id,
               'kind', n.kind,
               'texts', jsonb_strip_nulls(jsonb_build_object(
                 'en', n.text_en, 'ckb', n.text_ckb, 'kmr', n.text_kmr, 'ar', n.text_ar)),
               'starts_at', n.starts_at,
               'ends_at', n.ends_at)
        from public.home_notices n
       where n.removed_at is null
         and n.starts_at <= now()
         and n.ends_at > now()
       order by n.starts_at desc
       limit 1),
    'pins', coalesce((
      select jsonb_agg(public.home_event_json(x.event_id) || jsonb_build_object('pinned_at', x.pinned_at, 'ends_at', x.ends_at)
                       order by x.origin_time desc)
        from (
          select p.event_id, p.pinned_at, p.ends_at, e.origin_time
            from public.home_pins p
            join public.events e on e.event_id = p.event_id
           where p.removed_at is null
             and p.ends_at > now()
             and e.merged_into is null
             and e.review_status <> 'deleted'
             and e.status = 'published'
             and not exists (select 1 from public.hidden_events h where h.event_id = p.event_id)
           order by p.pinned_at desc
           limit 3
        ) x), '[]'::jsonb),
    'hidden', coalesce((
      select jsonb_agg(jsonb_build_object(
               'bumelerze_id', e.bumelerze_id,
               'provider_ids', public.event_provider_ids(h.event_id),
               'reason_kind', case when h.reason = 'duplicate' then 'duplicate' else 'removed' end,
               'kept', case when h.reason = 'duplicate' and k.event_id is not null then jsonb_build_object(
                         'bumelerze_id', k.bumelerze_id,
                         'provider_ids', public.event_provider_ids(k.event_id)) end)
             order by h.hidden_at desc, h.event_id)
        from public.hidden_events h
        join public.events e on e.event_id = h.event_id
        left join public.events k on k.event_id = h.kept_event_id), '[]'::jsonb)
  )
$$;

-- 8. Admin: the hidden earthquakes, newest hidden first --------------------------------------------
create or replace function public.admin_hidden_events()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_permission(v_uid, 'events.hide') then
    raise exception 'admin_hidden_events: not_allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'event_id', e.event_id,
             'bumelerze_id', e.bumelerze_id,
             'place', e.place,
             'magnitude', e.magnitude,
             'origin_time', e.origin_time,
             'status', e.status,
             'reason', h.reason,
             'note', h.note,
             'hidden_at', h.hidden_at,
             'hidden_by_name', coalesce(nullif(p.display_name::text, ''), p.username::text),
             'kept', case when k.event_id is null then null else jsonb_build_object(
                       'event_id', k.event_id, 'bumelerze_id', k.bumelerze_id, 'place', k.place,
                       'magnitude', k.magnitude, 'origin_time', k.origin_time) end)
           order by h.hidden_at desc, h.event_id)
      from public.hidden_events h
      join public.events e on e.event_id = h.event_id
      left join public.events k on k.event_id = h.kept_event_id
      left join public.profiles p on p.user_id = h.hidden_by), '[]'::jsonb);
end
$$;

-- Admin: find an earthquake (0084 admin_home_find_events search). Published and possible ones
-- (choice 3); with no search the latest regional ones; hidden ones are marked.
create or replace function public.admin_hide_find_events(p_query text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_id text;
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_found jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'events.hide') then
    raise exception 'admin_hide_find_events: not_allowed' using errcode = '42501';
  end if;
  v_id := regexp_replace(v_q, '[^a-z0-9]', '', 'g');
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) into v_found
    from (
      select e.origin_time as t, jsonb_build_object(
               'event_id', e.event_id, 'bumelerze_id', e.bumelerze_id, 'place', e.place,
               'magnitude', e.magnitude, 'origin_time', e.origin_time, 'status', e.status,
               'pinned_until', (select p.ends_at from public.home_pins p
                                 where p.event_id = e.event_id and p.removed_at is null and p.ends_at > now()),
               'hidden', exists (select 1 from public.hidden_events h where h.event_id = e.event_id)) as j
        from public.events e
       where e.merged_into is null
         and e.review_status <> 'deleted'
         and e.status in ('published', 'possible')
         and (
           (v_q = '' and e.region_flag and (e.bumelerze_id is not null or e.status = 'possible'))
           or (v_q <> '' and v_id <> '' and lower(e.bumelerze_id) like v_id || '%')
           or (v_q <> '' and e.place ilike v_like)
         )
       order by e.origin_time desc
       limit v_limit
    ) x;
  return v_found;
end
$$;

-- Admin: the cards that may stay (within 10 minutes and 300 km, not hidden, nearest first).
create or replace function public.admin_hide_candidates(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ev record;
begin
  if v_uid is null or not public.has_permission(v_uid, 'events.hide') then
    raise exception 'admin_hide_candidates: not_allowed' using errcode = '42501';
  end if;
  select e.event_id, e.lat, e.lon, e.origin_time into v_ev
    from public.events e
   where e.event_id = p_event_id;
  if not found then
    raise exception 'admin_hide_candidates: event_not_found' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'event_id', x.event_id, 'bumelerze_id', x.bumelerze_id, 'place', x.place,
             'magnitude', x.magnitude, 'origin_time', x.origin_time,
             'distance_km', round(x.km::numeric, 1),
             'minutes_apart', round(x.minutes::numeric, 1))
           order by x.km, x.minutes, x.event_id)
      from (
        select y.*
          from (
            select c.event_id, c.bumelerze_id, c.place, c.magnitude, c.origin_time,
                   public.alert_distance_km(v_ev.lat, v_ev.lon, c.lat, c.lon) as km,
                   abs(extract(epoch from (c.origin_time - v_ev.origin_time))) / 60.0 as minutes
              from public.events c
             where c.origin_time between v_ev.origin_time - interval '10 minutes'
                                     and v_ev.origin_time + interval '10 minutes'
               and c.event_id <> v_ev.event_id
               and c.merged_into is null
               and c.review_status <> 'deleted'
               and c.status in ('published', 'possible')
               and not exists (select 1 from public.hidden_events h where h.event_id = c.event_id)
          ) y
         where y.km <= 300
         order by y.km, y.minutes, y.event_id
         limit 20
      ) x), '[]'::jsonb);
end
$$;

-- Admin: what hiding would change (live felt reports, safe check-ins, on Home now).
create or replace function public.admin_hide_impact(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_permission(v_uid, 'events.hide') then
    raise exception 'admin_hide_impact: not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events e where e.event_id = p_event_id) then
    raise exception 'admin_hide_impact: event_not_found' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'felt_reports', (select count(*)::integer from public.felt_reports fr
                      where fr.event_id = p_event_id and fr.withdrawn_at is null),
    'safety_checkins', (select count(*)::integer from public.safety_checkins c
                         where c.event_id = p_event_id and c.status = 'safe'),
    'on_home', exists (select 1 from public.home_pins p
                        where p.event_id = p_event_id and p.removed_at is null and p.ends_at > now()));
end
$$;

-- 9. Admin: hide an earthquake for everyone --------------------------------------------------------
create or replace function public.admin_hide_event(
  p_event_id uuid,
  p_reason text,
  p_kept_event_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := public.home_notice_clean(p_note);
  v_bml text;
  v_kept uuid;
  v_kept_bml text;
  v_felt integer := 0;
  v_checkins integer := 0;
  v_users uuid[] := '{}';
  v_unpinned boolean := false;
begin
  if v_uid is null or not public.has_permission(v_uid, 'events.hide') then
    raise exception 'admin_hide_event: not_allowed' using errcode = '42501';
  end if;
  if coalesce(p_reason, '') not in ('duplicate', 'not_real', 'other') then
    raise exception 'admin_hide_event: bad_reason' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('hidden_events'));
  select e.bumelerze_id into v_bml
    from public.events e
   where e.event_id = p_event_id
     and e.merged_into is null
     and e.review_status <> 'deleted'
     and e.status in ('published', 'possible');
  if not found then
    raise exception 'admin_hide_event: event_not_found' using errcode = '22023';
  end if;
  if exists (select 1 from public.hidden_events h where h.event_id = p_event_id) then
    raise exception 'admin_hide_event: already_hidden' using errcode = '22023';
  end if;
  if exists (select 1 from public.hidden_events h where h.kept_event_id = p_event_id) then
    raise exception 'admin_hide_event: is_kept_card' using errcode = '22023';
  end if;
  if p_reason = 'duplicate' then
    if p_kept_event_id is null then
      raise exception 'admin_hide_event: kept_required' using errcode = '22023';
    end if;
    if p_kept_event_id = p_event_id then
      raise exception 'admin_hide_event: kept_is_same' using errcode = '22023';
    end if;
    select e.bumelerze_id into v_kept_bml
      from public.events e
     where e.event_id = p_kept_event_id
       and e.merged_into is null
       and e.review_status <> 'deleted'
       and e.status in ('published', 'possible');
    if not found then
      raise exception 'admin_hide_event: kept_not_found' using errcode = '22023';
    end if;
    if exists (select 1 from public.hidden_events h where h.event_id = p_kept_event_id) then
      raise exception 'admin_hide_event: kept_hidden' using errcode = '22023';
    end if;
    v_kept := p_kept_event_id;
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'admin_hide_event: note_required' using errcode = '22023';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'admin_hide_event: note_too_long' using errcode = '22023';
  end if;

  insert into public.hidden_events (event_id, reason, kept_event_id, note, hidden_by, hidden_at)
  values (p_event_id, p_reason, v_kept, v_note, v_uid, now());

  if v_kept is not null then
    with moved as (
      update public.felt_reports fr
         set event_id = v_kept
       where fr.event_id = p_event_id
         and fr.withdrawn_at is null
         and not exists (
           select 1 from public.felt_reports o
            where o.event_id = v_kept
              and o.withdrawn_at is null
              and (o.device_id = fr.device_id or (fr.user_id is not null and o.user_id = fr.user_id)))
      returning fr.report_id
    )
    insert into public.hidden_event_moves (hidden_event_id, kept_event_id, report_id)
    select p_event_id, v_kept, m.report_id from moved m;
    get diagnostics v_felt = row_count;

    with moved as (
      update public.safety_checkins c
         set event_id = v_kept
       where c.event_id = p_event_id
         and c.status = 'safe'
         and not exists (
           select 1 from public.safety_checkins o
            where o.event_id = v_kept
              and o.user_id = c.user_id
              and o.status = 'safe')
      returning c.checkin_id, c.user_id
    ), recorded as (
      insert into public.hidden_event_moves (hidden_event_id, kept_event_id, checkin_id)
      select p_event_id, v_kept, m.checkin_id from moved m
      returning checkin_id
    )
    select count(*)::integer, coalesce(array_agg(distinct m.user_id), '{}'::uuid[])
      into v_checkins, v_users
      from moved m;

    update public.activity_items a
       set event_id = v_kept,
           dedupe_key = 'safe:' || u.user_id::text || ':' || v_kept::text
      from unnest(v_users) as u(user_id)
     where a.kind in ('family_safe', 'safe_checkin')
       and a.dedupe_key = 'safe:' || u.user_id::text || ':' || p_event_id::text
       and not exists (
         select 1 from public.activity_items b
          where b.user_id = a.user_id
            and b.dedupe_key = 'safe:' || u.user_id::text || ':' || v_kept::text);

    if v_felt > 0 then
      insert into public.felt_cells_refresh (event_id, requested_at)
      values (p_event_id, now()), (v_kept, now())
      on conflict (event_id) do update set requested_at = excluded.requested_at;
    end if;
  end if;

  update public.home_pins
     set removed_at = now(), removed_by = v_uid
   where event_id = p_event_id
     and removed_at is null
     and ends_at > now();
  v_unpinned := found;

  perform public.write_audit(
    v_uid, 'event_hide', 'event', p_event_id::text,
    null, null, null, p_reason, v_bml,
    jsonb_build_object('bumelerze_id', v_bml, 'reason', p_reason, 'note', v_note,
                       'kept_event_id', v_kept, 'kept_bumelerze_id', v_kept_bml,
                       'moved_felt_reports', v_felt, 'moved_checkins', v_checkins,
                       'unpinned', v_unpinned));
  return jsonb_build_object('moved_felt_reports', v_felt, 'moved_checkins', v_checkins, 'unpinned', v_unpinned);
end
$$;

-- 10. Admin: show it again (the recorded rows still on the card that stays go back) ----------------
create or replace function public.admin_unhide_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.hidden_events%rowtype;
  v_bml text;
  v_recorded integer := 0;
  v_felt integer := 0;
  v_checkins integer := 0;
  v_users uuid[] := '{}';
  v_open boolean := false;
begin
  if v_uid is null or not public.has_permission(v_uid, 'events.hide') then
    raise exception 'admin_unhide_event: not_allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('hidden_events'));
  select * into v_row from public.hidden_events h where h.event_id = p_event_id;
  if not found then
    raise exception 'admin_unhide_event: not_hidden' using errcode = '22023';
  end if;
  select e.bumelerze_id,
         e.merged_into is null and e.review_status <> 'deleted' and e.status in ('published', 'possible')
    into v_bml, v_open
    from public.events e
   where e.event_id = p_event_id;
  select count(*)::integer into v_recorded from public.hidden_event_moves m where m.hidden_event_id = p_event_id;

  if v_recorded > 0 and v_open then
    with back as (
      update public.felt_reports fr
         set event_id = p_event_id
        from public.hidden_event_moves m
       where m.hidden_event_id = p_event_id
         and m.report_id = fr.report_id
         and fr.event_id = m.kept_event_id
         and (fr.withdrawn_at is not null or not exists (
           select 1 from public.felt_reports o
            where o.event_id = p_event_id
              and o.withdrawn_at is null
              and (o.device_id = fr.device_id or (fr.user_id is not null and o.user_id = fr.user_id))))
      returning fr.report_id
    )
    select count(*)::integer into v_felt from back;

    with back as (
      update public.safety_checkins c
         set event_id = p_event_id
        from public.hidden_event_moves m
       where m.hidden_event_id = p_event_id
         and m.checkin_id = c.checkin_id
         and c.event_id = m.kept_event_id
         and (c.status <> 'safe' or not exists (
           select 1 from public.safety_checkins o
            where o.event_id = p_event_id
              and o.user_id = c.user_id
              and o.status = 'safe'))
      returning c.checkin_id, c.user_id, c.status
    )
    select count(*)::integer, coalesce(array_agg(distinct b.user_id) filter (where b.status = 'safe'), '{}'::uuid[])
      into v_checkins, v_users
      from back b;

    update public.activity_items a
       set event_id = p_event_id,
           dedupe_key = 'safe:' || u.user_id::text || ':' || p_event_id::text
      from unnest(v_users) as u(user_id)
     where a.kind in ('family_safe', 'safe_checkin')
       and a.dedupe_key = 'safe:' || u.user_id::text || ':' || v_row.kept_event_id::text
       and not exists (
         select 1 from public.activity_items b
          where b.user_id = a.user_id
            and b.dedupe_key = 'safe:' || u.user_id::text || ':' || p_event_id::text);

    if v_felt > 0 then
      insert into public.felt_cells_refresh (event_id, requested_at)
      values (p_event_id, now()), (v_row.kept_event_id, now())
      on conflict (event_id) do update set requested_at = excluded.requested_at;
    end if;
  end if;

  delete from public.hidden_events where event_id = p_event_id;

  perform public.write_audit(
    v_uid, 'event_unhide', 'event', p_event_id::text,
    null, null, null, v_row.reason, v_bml,
    jsonb_build_object('bumelerze_id', v_bml, 'reason', v_row.reason, 'note', v_row.note,
                       'kept_event_id', v_row.kept_event_id, 'hidden_at', v_row.hidden_at,
                       'recorded_moves', v_recorded, 'moves_kept', not coalesce(v_open, false),
                       'moved_back_felt_reports', v_felt, 'moved_back_checkins', v_checkins));
  return jsonb_build_object('moved_back_felt_reports', v_felt, 'moved_back_checkins', v_checkins);
end
$$;

-- 11. Felt maps of moved reports: the per-event rebuild, repeated for 10 minutes (cron, below) -------
create or replace function public.felt_cells_refresh_run()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_n integer := 0;
begin
  delete from public.felt_cells_refresh where requested_at < now() - interval '10 minutes';
  for r in
    select f.event_id from public.felt_cells_refresh f order by f.requested_at, f.event_id limit 20
  loop
    begin
      perform public.call_edge_function('aggregate-felt-cells', jsonb_build_object('eventId', r.event_id), 30000);
      v_n := v_n + 1;
    exception when others then
      raise warning 'felt_cells_refresh_run: % (event %)', sqlerrm, r.event_id;
    end;
  end loop;
  return v_n;
end
$$;

-- 12. Admin launcher (0066 body): the number of hidden earthquakes for events.hide ----------------
create or replace function public.admin_tool_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := '{}'::jsonb;
  v_waiting integer;
begin
  if v_uid is null or not public.holds_admin_permission(v_uid) then
    raise exception 'admin_tool_counts: not_allowed' using errcode = '42501';
  end if;
  if public.has_permission(v_uid, 'people.view') then
    v_out := v_out || jsonb_build_object('accounts',
      (select count(*) from auth.users u where coalesce(u.is_anonymous, false) = false));
  end if;
  if public.has_permission(v_uid, 'comments.moderate') then
    v_waiting := (select count(*) from public.moderation_queue(200))
               + (select count(*) from public.post_queue(200))
               + (select count(*) from public.moderation_profile_reports())
               + (select count(*) from public.post_comment_queue(200));
    if public.has_permission(v_uid, 'photos.moderate') then
      v_waiting := v_waiting
        + (select count(*) from public.felt_photos f where f.moderation_status = 'pending');
    end if;
    v_out := v_out || jsonb_build_object('waiting', v_waiting);
  end if;
  if public.has_permission(v_uid, 'filter.manage') then
    v_out := v_out || jsonb_build_object('busy', public.surge_state() -> 'active');
  end if;
  if public.has_permission(v_uid, 'alerts.test') then
    v_out := v_out || jsonb_build_object(
      'alerts_mode', public.alert_mode(),
      'alert_devices', (select count(*) from public.push_subscriptions s where s.disabled_at is null));
  end if;
  if public.has_permission(v_uid, 'hubs.open') then
    v_out := v_out || jsonb_build_object('hubs_open',
      (select count(*) from public.events e where e.hub_featured));
  end if;
  if public.has_permission(v_uid, 'feedback.manage') then
    v_out := v_out || jsonb_build_object('feedback_new',
      (select count(*) from public.feedback f where f.status = 'unseen'));
  end if;
  if public.has_permission(v_uid, 'events.hide') then
    v_out := v_out || jsonb_build_object('hidden_events',
      (select count(*) from public.hidden_events h));
  end if;
  return v_out;
end
$$;

-- 13. Home screen pin (0084 body): a hidden earthquake cannot be chosen ------------------------------
create or replace function public.admin_pin_home_event(p_event_id uuid, p_days integer)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ends timestamptz;
  v_bml text;
  v_shown integer;
begin
  if v_uid is null or not public.has_permission(v_uid, 'home.manage') then
    raise exception 'admin_pin_home_event: not_allowed' using errcode = '42501';
  end if;
  if coalesce(p_days, 0) not in (1, 3, 7, 30) then
    raise exception 'admin_pin_home_event: bad_duration' using errcode = '22023';
  end if;
  select e.bumelerze_id into v_bml
    from public.events e
   where e.event_id = p_event_id
     and e.merged_into is null
     and e.review_status <> 'deleted'
     and e.status = 'published'
     and not exists (select 1 from public.hidden_events h where h.event_id = e.event_id);
  if not found then
    raise exception 'admin_pin_home_event: event_not_found' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('home_pins'));
  select count(*) into v_shown
    from public.home_pins p
    join public.events e on e.event_id = p.event_id
   where p.removed_at is null
     and p.ends_at > now()
     and p.event_id <> p_event_id
     and e.merged_into is null
     and e.review_status <> 'deleted'
     and e.status = 'published'
     and not exists (select 1 from public.hidden_events h where h.event_id = p.event_id);
  if v_shown >= 3 then
    raise exception 'admin_pin_home_event: too_many' using errcode = '22023';
  end if;
  v_ends := now() + make_interval(days => p_days);
  insert into public.home_pins (event_id, pinned_at, ends_at, pinned_by, removed_at, removed_by)
  values (p_event_id, now(), v_ends, v_uid, null, null)
  on conflict (event_id) do update
    set pinned_at = excluded.pinned_at,
        ends_at = excluded.ends_at,
        pinned_by = excluded.pinned_by,
        removed_at = null,
        removed_by = null;
  perform public.write_audit(
    v_uid, 'home_pin', 'event', p_event_id::text,
    null, null, null, null, v_bml,
    jsonb_build_object('days', p_days, 'ends_at', v_ends, 'bumelerze_id', v_bml));
  return v_ends;
end
$$;

-- 14. SHAKEmap worker start (0077 body): never for a hidden earthquake ------------------------------
create or replace function public.events_request_shake_worker()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := coalesce(new.bumelerze_id, new.event_id::text);
  v_was boolean;
begin
  if new.status is distinct from 'published'
     or new.merged_into is not null
     or new.review_status = 'deleted'
     or new.origin_time < now() - interval '14 days'
     or not public.shake_worker_wanted(new.lat, new.lon, new.magnitude)
     or exists (select 1 from public.hidden_events h where h.event_id = new.event_id) then
    return new;
  end if;
  if (tg_op = 'UPDATE' or public.request_is_client())
     and not exists (
       select 1
         from public.event_source_records esr
        where esr.event_id = new.event_id
          and esr.review_status <> 'deleted'
          and esr.verified_at is not null
     ) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.request_shake_worker('new ' || v_key);
    return new;
  end if;
  v_was := old.status = 'published'
       and old.merged_into is null
       and old.review_status <> 'deleted'
       and public.shake_worker_wanted(old.lat, old.lon, old.magnitude);
  if not coalesce(v_was, false) then
    perform public.request_shake_worker('now mapped ' || v_key);
  elsif abs(coalesce(new.magnitude, 0) - coalesce(old.magnitude, 0)) >= 0.1
     or public.alert_distance_km(old.lat, old.lon, new.lat, new.lon) >= 5
     or abs(coalesce(new.depth_km, 0) - coalesce(old.depth_km, 0))
        >= greatest(5, 0.25 * abs(coalesce(old.depth_km, 0))) then
    perform public.request_shake_worker('revised ' || v_key);
  end if;
  return new;
end
$$;

-- 15. Alert queue trigger (0062 body): nothing queued for a hidden earthquake ------------------------
create or replace function public.events_alert_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'published'
     and new.merged_into is null
     and new.review_status <> 'deleted'
     and new.magnitude is not null
     and new.region_flag
     and new.origin_time > now() - interval '6 hours'
     and not exists (select 1 from public.hidden_events h where h.event_id = new.event_id)
     and (
       tg_op = 'INSERT'
       or new.magnitude is distinct from old.magnitude
       or new.lat is distinct from old.lat
       or new.lon is distinct from old.lon
       or new.depth_km is distinct from old.depth_km
       or new.status is distinct from old.status
       or new.review_status is distinct from old.review_status
       or new.region_flag is distinct from old.region_flag
     ) then
    begin
      insert into public.alert_queue (kind, event_id) values ('event', new.event_id)
      on conflict do nothing;
    exception when others then
      raise warning 'events_alert_enqueue: % (event %)', sqlerrm, new.event_id;
    end;
  end if;
  return null;
end
$$;

-- 16. Alerts: a hidden earthquake is not confirmed (0062 body) ----------------------------------------
create or replace function public.alert_event_confirmed(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.events e
     where e.event_id = p_event
       and e.status = 'published'
       and e.merged_into is null
       and e.review_status <> 'deleted'
       and e.magnitude is not null
       and not exists (select 1 from public.hidden_events h where h.event_id = e.event_id)
       and exists (
         select 1 from public.event_source_records esr
          where esr.event_id = e.event_id
            and esr.review_status <> 'deleted'
            and esr.verified_at is not null
       )
  )
$$;

-- 17. Alert planning (0062 body): a hidden earthquake is not a main shock for the aftershock rule ----
create or replace function public.alert_plan_event(p_event uuid, p_mode text, p_run uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ev record;
  s record;
  v_band smallint;
  v_age interval;
  v_main numeric;
  v_new_main boolean;
  v_prev smallint;
  v_prev_mag numeric;
  v_kind text;
  v_supp text;
  v_recent integer;
  v_floor numeric;
  v_n integer := 0;
begin
  select e.event_id, e.origin_time, e.lat, e.lon, e.depth_km, e.magnitude
    into ev
    from public.events e
   where e.event_id = p_event;
  if not found then
    return 0;
  end if;
  v_band := public.alert_band(ev.magnitude);
  v_age := now() - ev.origin_time;
  if v_age > interval '6 hours' then
    return 0;
  end if;

  select max(m.magnitude) into v_main
    from public.events m
   where m.event_id <> ev.event_id
     and m.status = 'published'
     and m.merged_into is null
     and m.review_status <> 'deleted'
     and m.region_flag
     and m.magnitude >= 5.0
     and m.origin_time < ev.origin_time
     and m.origin_time >= ev.origin_time - interval '72 hours'
     and public.alert_distance_km(m.lat, m.lon, ev.lat, ev.lon) <= 100
     and not exists (select 1 from public.hidden_events h where h.event_id = m.event_id);
  v_new_main := ev.magnitude >= 5.0 and (v_main is null or ev.magnitude >= v_main);

  for s in
    select q.push_subscription_id, q.near_min, q.other_min
      from (
        select ps.push_subscription_id,
               public.alert_context_min(ns.near_me_tier, ns.near_me_lat, ns.near_me_lon,
                                        ev.lat, ev.lon, ev.depth_km, ev.magnitude) as near_min,
               public.alert_context_min(ns.homebase_tier, ns.homebase_lat, ns.homebase_lon,
                                        ev.lat, ev.lon, ev.depth_km, ev.magnitude) as other_min
          from public.push_subscriptions ps
          join public.notification_subscriptions ns on ns.user_id = ps.user_id
         where ps.disabled_at is null
           and public.alert_user_eligible(ps.user_id, p_mode)
      ) q
     where q.near_min is not null or q.other_min is not null
     order by q.push_subscription_id
  loop
    select d.mag_band, d.magnitude into v_prev, v_prev_mag
      from public.alert_deliveries d
     where d.push_subscription_id = s.push_subscription_id
       and d.kind in ('alert', 'upgrade')
       and d.status not in ('suppressed', 'skipped')
       and (d.event_id = ev.event_id
            or d.event_id in (select x.event_id from public.events x where x.merged_into = ev.event_id))
     order by d.mag_band desc, d.created_at desc
     limit 1;
    if not found then
      v_prev := null;
      v_prev_mag := null;
    end if;
    if v_prev is not null and v_band <= v_prev then
      continue;
    end if;
    v_kind := case when v_prev is null then 'alert' else 'upgrade' end;
    if v_kind = 'alert' and v_age > interval '60 minutes' then
      continue;
    end if;

    if exists (
      select 1
        from public.alert_deliveries d
        join public.events e2 on e2.event_id = d.event_id
       where d.push_subscription_id = s.push_subscription_id
         and d.kind in ('alert', 'upgrade')
         and d.status not in ('suppressed', 'skipped')
         and e2.event_id <> ev.event_id
         and e2.merged_into is distinct from ev.event_id
         and abs(extract(epoch from (e2.origin_time - ev.origin_time))) <= 16
         and public.alert_distance_km(e2.lat, e2.lon, ev.lat, ev.lon) <= 100
    ) then
      continue;
    end if;

    v_supp := null;
    v_floor := least(coalesce(s.near_min, 99), coalesce(s.other_min, 99));
    if v_main is not null
       and ev.magnitude < v_main
       and ev.magnitude < greatest(v_main - 0.5, v_floor + 1.0) then
      v_supp := 'aftershock';
    elsif not v_new_main then
      select count(*) into v_recent
        from public.alert_deliveries d
       where d.push_subscription_id = s.push_subscription_id
         and d.kind in ('alert', 'upgrade', 'summary')
         and d.status in ('pending', 'sending', 'sent', 'retry')
         and d.created_at > now() - interval '1 hour';
      if v_recent >= 3 then
        v_supp := 'rate_cap';
      end if;
    end if;

    insert into public.alert_deliveries (
      push_subscription_id, kind, event_id, mag_band, magnitude, previous_magnitude,
      context, status, suppressed_reason, run_id
    )
    values (
      s.push_subscription_id, v_kind, ev.event_id, v_band, ev.magnitude, v_prev_mag,
      case when s.near_min is not null then 'near_me' else 'another_place' end,
      case when v_supp is null then 'pending' else 'suppressed' end,
      v_supp, p_run
    )
    on conflict do nothing;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;

-- 18. Alert run (0062 body): a hidden earthquake is not eligible; its waiting pushes are skipped -----
create or replace function public.alert_plan_run(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text := public.alert_mode();
  v_run uuid := gen_random_uuid();
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  q record;
  v_events integer := 0;
  v_planned integer := 0;
  v_supp integer := 0;
  v_claimed integer := 0;
  v_n integer;
  v_items jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('bumelerze_alert_plan_run'));
  insert into public.alert_runs (run_id, mode) values (v_run, v_mode);

  for q in
    select aq.queue_id, aq.event_id, aq.queued_at
      from public.alert_queue aq
     where aq.processed_at is null and aq.kind = 'event'
     order by aq.queued_at
     limit 100
  loop
    if v_mode = 'off' then
      update public.alert_queue set processed_at = now(), outcome = 'off' where queue_id = q.queue_id;
      v_events := v_events + 1;
      continue;
    end if;
    if not exists (
      select 1 from public.events e
       where e.event_id = q.event_id
         and e.status = 'published' and e.merged_into is null
         and e.review_status <> 'deleted' and e.magnitude is not null and e.region_flag
         and not exists (select 1 from public.hidden_events h where h.event_id = e.event_id)
    ) then
      update public.alert_queue set processed_at = now(), outcome = 'not_eligible' where queue_id = q.queue_id;
      v_events := v_events + 1;
      continue;
    end if;
    if exists (select 1 from public.events e where e.event_id = q.event_id and e.origin_time < now() - interval '6 hours') then
      update public.alert_queue set processed_at = now(), outcome = 'stale' where queue_id = q.queue_id;
      v_events := v_events + 1;
      continue;
    end if;
    if not public.alert_event_confirmed(q.event_id) then
      if q.queued_at < now() - interval '60 minutes' then
        update public.alert_queue set processed_at = now(), outcome = 'unconfirmed' where queue_id = q.queue_id;
        v_events := v_events + 1;
      end if;
      continue;
    end if;
    v_n := public.alert_plan_event(q.event_id, v_mode, v_run);
    v_planned := v_planned + v_n;
    update public.alert_queue set processed_at = now(), outcome = 'planned' where queue_id = q.queue_id;
    v_events := v_events + 1;
  end loop;

  for q in
    select aq.queue_id, aq.user_id
      from public.alert_queue aq
     where aq.processed_at is null and aq.kind = 'test'
     order by aq.queued_at
     limit 100
  loop
    insert into public.alert_deliveries (push_subscription_id, kind, status, run_id)
    select ps.push_subscription_id, 'test', 'pending', v_run
      from public.push_subscriptions ps
     where ps.user_id = q.user_id and ps.disabled_at is null;
    get diagnostics v_n = row_count;
    v_planned := v_planned + v_n;
    update public.alert_queue set processed_at = now(), outcome = 'tested' where queue_id = q.queue_id;
  end loop;

  update public.alert_deliveries d
     set status = 'skipped'
   where d.kind in ('alert', 'upgrade')
     and (d.status in ('pending', 'retry') or (d.status = 'suppressed' and d.summarized_by is null))
     and exists (select 1 from public.hidden_events h where h.event_id = d.event_id);

  if v_mode <> 'off' then
    v_planned := v_planned + public.alert_plan_summaries(v_mode, v_run);
  end if;

  select count(*) into v_supp from public.alert_deliveries d where d.run_id = v_run and d.status = 'suppressed';

  update public.alert_deliveries d
     set status = 'skipped'
   where d.status in ('pending', 'retry')
     and d.kind <> 'test'
     and exists (
       select 1 from public.push_subscriptions ps
        where ps.push_subscription_id = d.push_subscription_id
          and not public.alert_user_eligible(ps.user_id, v_mode)
     );
  update public.alert_deliveries d
     set status = 'skipped'
   where d.status in ('pending', 'retry', 'sending')
     and d.created_at < now() - interval '30 minutes';
  update public.alert_deliveries d
     set status = 'failed', last_error = coalesce(d.last_error, 'no answer from the sender')
   where d.status = 'sending'
     and d.claimed_at < now() - interval '5 minutes'
     and d.attempts >= 3;

  with c as (
    select d.delivery_id
      from public.alert_deliveries d
      join public.push_subscriptions ps on ps.push_subscription_id = d.push_subscription_id
     where ps.disabled_at is null
       and (d.status = 'pending'
            or (d.status = 'retry' and d.next_attempt_at <= now())
            or (d.status = 'sending' and d.claimed_at < now() - interval '5 minutes'))
     order by d.created_at
     limit v_limit
     for update of d skip locked
  )
  update public.alert_deliveries d
     set status = 'sending', claimed_at = now(), attempts = d.attempts + 1, run_id = v_run
    from c
   where d.delivery_id = c.delivery_id;
  get diagnostics v_claimed = row_count;

  if v_events = 0 and v_planned = 0 and v_claimed = 0 then
    delete from public.alert_runs where run_id = v_run;
    return jsonb_build_object('run_id', null, 'mode', v_mode, 'deliveries', '[]'::jsonb);
  end if;

  update public.alert_runs
     set events = v_events, planned = v_planned, suppressed = v_supp, claimed = v_claimed
   where run_id = v_run;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.delivery_id,
           'kind', d.kind,
           'locale', coalesce(ps.locale, ns.language, 'en'),
           'context', d.context,
           'target', case ps.kind
             when 'web' then jsonb_build_object('kind', 'web', 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)
             else jsonb_build_object('kind', 'expo', 'token', ps.expo_token)
           end,
           'event', case when e.event_id is null then null else jsonb_build_object(
             'id', e.bumelerze_id,
             'magnitude', d.magnitude,
             'origin_time', e.origin_time,
             'lat', e.lat,
             'lon', e.lon,
             'depth_km', e.depth_km
           ) end,
           'previous_magnitude', d.previous_magnitude,
           'summary_count', d.summary_count,
           'attempt', d.attempts
         ) order by d.created_at), '[]'::jsonb)
    into v_items
    from public.alert_deliveries d
    join public.push_subscriptions ps on ps.push_subscription_id = d.push_subscription_id
    left join public.notification_subscriptions ns on ns.user_id = ps.user_id
    left join public.events e on e.event_id = d.event_id
   where d.run_id = v_run and d.status = 'sending';

  return jsonb_build_object('run_id', v_run, 'mode', v_mode, 'deliveries', v_items);
end
$$;

-- 19. Busy time (0077 body): never started by a hidden earthquake --------------------------------------
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
     and e.status = 'published'
     and e.magnitude >= 5.0
     and e.origin_time > now() - interval '24 hours'
     and e.origin_time <= now() + interval '10 minutes'
     and e.merged_into is null
     and e.review_status <> 'deleted'
     and not exists (select 1 from public.hidden_events h where h.event_id = e.event_id)
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
     and not exists (select 1 from public.hidden_events h where h.event_id = e.event_id)
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

-- 20. Felt report assignment (0064 body): never to a hidden earthquake ----------------------------------
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
     and not exists (select 1 from public.hidden_events h where h.event_id = e.event_id)
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

-- 21. Crowd reconcile (0034 body): no hidden earthquake on either side ----------------------------------
create or replace function public.crowd_match_ok(p_possible uuid, p_target uuid)
returns boolean
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  p record;
  t record;
  v_first timestamptz;
  v_epi_km double precision;
  v_rhyp_km double precision;
begin
  select * into p from public.events where event_id = p_possible and status = 'possible' and merged_into is null
    and not exists (select 1 from public.hidden_events h where h.event_id = p_possible);
  if not found then return false; end if;
  select * into t from public.events
  where event_id = p_target and status = 'published' and merged_into is null
    and review_status <> 'deleted' and magnitude is not null
    and not exists (select 1 from public.hidden_events h where h.event_id = p_target);
  if not found then return false; end if;
  if not exists (
    select 1 from public.event_source_records esr
    where esr.event_id = p_target and esr.review_status <> 'deleted' and esr.verified_at is not null
  ) then
    return false;
  end if;
  v_first := coalesce(p.crowd_first_report_at, p.origin_time);
  if t.origin_time > v_first + interval '60 seconds' or t.origin_time < v_first - interval '10 minutes' then
    return false;
  end if;
  v_epi_km := ST_Distance(
    geography(ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)),
    geography(ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))
  ) / 1000.0;
  if v_epi_km > 100 then return false; end if;
  v_rhyp_km := sqrt(v_epi_km ^ 2 + coalesce(t.depth_km, 10)::double precision ^ 2);
  return public.ipe_aww2012_mmi(t.magnitude::double precision, v_rhyp_km) >= 2.0;
end
$$;

-- 22. New felt reports (0077 body): a hidden second card means the card that stays; a removed one, none
create or replace function public.felt_reports_server_times()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_status text;
  v_review text;
  v_magnitude numeric;
  v_merged_into uuid;
  v_origin timestamptz;
  v_hidden_reason text;
  v_kept uuid;
begin
  new.submitted_at := now();
  if new.created_at is null or new.created_at > now() then
    new.created_at := now();
  elsif new.created_at < now() - interval '2 days' then
    new.created_at := now() - interval '2 days';
  end if;
  if new.user_id is null and v_uid is not null then
    new.user_id := v_uid;
  end if;
  if new.event_id is not null then
    select e.event_id, e.status, e.review_status, e.magnitude, e.merged_into, e.origin_time
      into v_target, v_status, v_review, v_magnitude, v_merged_into, v_origin
      from public.events e
     where e.event_id = new.event_id;
    if v_target is not null and v_merged_into is not null then
      select e.event_id, e.status, e.review_status, e.magnitude, e.origin_time
        into v_target, v_status, v_review, v_magnitude, v_origin
        from public.events e
       where e.event_id = v_merged_into;
    end if;
    for v_hop in 1..3 loop
      exit when v_target is null;
      select h.reason, h.kept_event_id into v_hidden_reason, v_kept
        from public.hidden_events h
       where h.event_id = v_target;
      exit when not found;
      if v_hidden_reason = 'duplicate' and v_hop < 3 then
        select e.event_id, e.status, e.review_status, e.magnitude, e.merged_into, e.origin_time
          into v_target, v_status, v_review, v_magnitude, v_merged_into, v_origin
          from public.events e
         where e.event_id = v_kept;
        if v_target is not null and v_merged_into is not null then
          select e.event_id, e.status, e.review_status, e.magnitude, e.origin_time
            into v_target, v_status, v_review, v_magnitude, v_origin
            from public.events e
           where e.event_id = v_merged_into;
        end if;
        if v_review = 'deleted' then
          v_target := null;
        end if;
      else
        v_target := null;
      end if;
    end loop;
    if v_target is null
       or coalesce(v_status, '') not in ('published', 'possible', 'unconfirmed')
       or (v_status = 'unconfirmed' and (v_review = 'deleted' or v_magnitude is null))
       or v_origin is null
       or new.created_at < v_origin - interval '10 minutes' then
      new.event_id := null;
    else
      new.event_id := v_target;
    end if;
  end if;
  return new;
end
$$;

-- 22a. Home screen finder (0084 body): hidden earthquakes are left out ----------------------------------
create or replace function public.admin_home_find_events(p_query text default null, p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_id text;
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_found jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'home.manage') then
    raise exception 'admin_home_find_events: not_allowed' using errcode = '42501';
  end if;
  v_id := regexp_replace(v_q, '[^a-z0-9]', '', 'g');
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) into v_found
    from (
      select e.origin_time as t, jsonb_build_object(
               'event_id', e.event_id, 'bumelerze_id', e.bumelerze_id, 'place', e.place,
               'magnitude', e.magnitude, 'origin_time', e.origin_time,
               'pinned_until', (select p.ends_at from public.home_pins p
                                 where p.event_id = e.event_id and p.removed_at is null and p.ends_at > now())) as j
        from public.events e
       where e.merged_into is null
         and e.review_status <> 'deleted'
         and e.status = 'published'
         and not exists (select 1 from public.hidden_events h where h.event_id = e.event_id)
         and (
           (v_q = '' and e.region_flag and e.bumelerze_id is not null)
           or (v_q <> '' and v_id <> '' and lower(e.bumelerze_id) like v_id || '%')
           or (v_q <> '' and e.place ilike v_like)
         )
       order by e.origin_time desc
       limit v_limit
    ) x;
  return v_found;
end
$$;

-- 22b. I'm safe (0064 body): a check-in naming a hidden second card goes to the card that stays ---------
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
  p_event_id := coalesce((select h.kept_event_id from public.hidden_events h
                           where h.event_id = p_event_id and h.reason = 'duplicate'), p_event_id);

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
      v_event := coalesce((select h.kept_event_id from public.hidden_events h
                            where h.event_id = v_event and h.reason = 'duplicate'), v_event);
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

-- 23. The rebuild job: every 2 minutes, only when a rebuild is waiting -----------------------------
-- cron.schedule with an existing name replaces that job's schedule and command.
select cron.schedule('felt_cells_refresh', '*/2 * * * *', $cron$select public.felt_cells_refresh_run() where exists (select 1 from public.felt_cells_refresh);$cron$);

-- 24. Who may call what ----------------------------------------------------------------------------
revoke all on function public.event_provider_ids(uuid) from public, anon, authenticated;
revoke all on function public.home_extras() from public;
grant execute on function public.home_extras() to anon, authenticated;
revoke all on function public.admin_hidden_events() from public, anon;
grant execute on function public.admin_hidden_events() to authenticated;
revoke all on function public.admin_hide_find_events(text, integer) from public, anon;
grant execute on function public.admin_hide_find_events(text, integer) to authenticated;
revoke all on function public.admin_hide_candidates(uuid) from public, anon;
grant execute on function public.admin_hide_candidates(uuid) to authenticated;
revoke all on function public.admin_hide_impact(uuid) from public, anon;
grant execute on function public.admin_hide_impact(uuid) to authenticated;
revoke all on function public.admin_hide_event(uuid, text, uuid, text) from public, anon;
grant execute on function public.admin_hide_event(uuid, text, uuid, text) to authenticated;
revoke all on function public.admin_unhide_event(uuid) from public, anon;
grant execute on function public.admin_unhide_event(uuid) to authenticated;
revoke all on function public.felt_cells_refresh_run() from public, anon, authenticated;
grant execute on function public.felt_cells_refresh_run() to service_role;
revoke all on function public.admin_tool_counts() from public, anon;
grant execute on function public.admin_tool_counts() to authenticated;
revoke all on function public.admin_pin_home_event(uuid, integer) from public, anon;
grant execute on function public.admin_pin_home_event(uuid, integer) to authenticated;
revoke all on function public.alert_event_confirmed(uuid) from public, anon, authenticated;
revoke all on function public.events_alert_enqueue() from public, anon, authenticated;
revoke all on function public.alert_plan_event(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.alert_plan_run(integer) from public, anon, authenticated;
grant execute on function public.alert_plan_run(integer) to service_role;
revoke all on function public.surge_state() from public, anon, authenticated;
revoke all on function public.felt_reports_server_times() from public, anon, authenticated;
revoke all on function public.events_request_shake_worker() from public, anon, authenticated;
revoke all on function public.assign_unassigned_felt_reports() from public, anon, authenticated;
revoke all on function public.crowd_match_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_home_find_events(text, integer) from public, anon;
grant execute on function public.admin_home_find_events(text, integer) to authenticated;
revoke all on function public.check_in(uuid, uuid, timestamptz, uuid) from public, anon;
grant execute on function public.check_in(uuid, uuid, timestamptz, uuid) to authenticated;

-- 25. Check ----------------------------------------------------------------------------------------
do $$
declare
  v_missing text[] := '{}';
  v_name text;
begin
  if to_regclass('public.hidden_events') is null
     or to_regclass('public.hidden_event_moves') is null
     or to_regclass('public.felt_cells_refresh') is null
     or has_table_privilege('anon', 'public.hidden_events', 'select')
     or has_table_privilege('authenticated', 'public.hidden_events', 'select')
     or has_table_privilege('authenticated', 'public.hidden_events', 'insert')
     or has_table_privilege('anon', 'public.hidden_event_moves', 'select')
     or has_table_privilege('authenticated', 'public.hidden_event_moves', 'select')
     or has_table_privilege('anon', 'public.felt_cells_refresh', 'select')
     or has_table_privilege('authenticated', 'public.felt_cells_refresh', 'insert') then
    v_missing := v_missing || 'tables closed to clients'::text;
  end if;
  if not exists (select 1 from pg_class where oid = 'public.hidden_events'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.hidden_event_moves'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.felt_cells_refresh'::regclass and relrowsecurity) then
    v_missing := v_missing || 'row level security'::text;
  end if;
  if not exists (select 1 from public.role_permissions where role = 'admin' and permission = 'events.hide')
     or exists (select 1 from public.role_permissions where role <> 'admin' and permission = 'events.hide') then
    v_missing := v_missing || 'events.hide for admin only'::text;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.moderation_log'::regclass
       and conname = 'moderation_log_action_check'
       and pg_get_constraintdef(oid) like '%event_hide%'
       and pg_get_constraintdef(oid) like '%event_unhide%'
       and pg_get_constraintdef(oid) like '%home_unpin%'
       and pg_get_constraintdef(oid) like '%hub_note%'
  ) then
    v_missing := v_missing || 'activity log actions'::text;
  end if;
  if not has_function_privilege('anon', 'public.home_extras()', 'execute')
     or not has_function_privilege('authenticated', 'public.home_extras()', 'execute')
     or has_function_privilege('anon', 'public.event_provider_ids(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.event_provider_ids(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.felt_cells_refresh_run()', 'execute') then
    v_missing := v_missing || 'home_extras and helper grants'::text;
  end if;
  if has_function_privilege('anon', 'public.admin_hidden_events()', 'execute')
     or has_function_privilege('anon', 'public.admin_hide_find_events(text, integer)', 'execute')
     or has_function_privilege('anon', 'public.admin_hide_candidates(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_hide_impact(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_hide_event(uuid, text, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.admin_unhide_event(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_hidden_events()', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_hide_event(uuid, text, uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_unhide_event(uuid)', 'execute') then
    v_missing := v_missing || 'admin function grants'::text;
  end if;
  foreach v_name in array array[
    'home_extras', 'admin_tool_counts', 'admin_pin_home_event', 'events_request_shake_worker',
    'events_alert_enqueue', 'alert_plan_run', 'alert_event_confirmed', 'alert_plan_event',
    'assign_unassigned_felt_reports', 'crowd_match_ok', 'surge_state', 'felt_reports_server_times',
    'admin_home_find_events', 'check_in']
  loop
    if not exists (
      select 1 from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = v_name
         and p.prosrc like '%hidden_events%'
    ) then
      v_missing := v_missing || ('hidden check in ' || v_name);
    end if;
  end loop;
  if (select count(*) from cron.job j
       where j.jobname = 'felt_cells_refresh'
         and position('public.felt_cells_refresh_run()' in j.command) > 0) <> 1 then
    v_missing := v_missing || 'felt_cells_refresh job'::text;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '0085: not in place: %', array_to_string(v_missing, ', ');
  end if;
end
$$;
