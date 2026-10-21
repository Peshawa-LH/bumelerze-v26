-- 0069: government officials see every account holder (owner decision D98).
--
-- Until now an official saw a person by name only after that person switched
-- on "Let government officials see my building's safety estimate and my I'm
-- safe status" (0066, default off). The owner decided that officials always
-- see it, for every account, and the switch is gone from the app.
--
--   1. authority_people() lists every account holder (auth.users that are
--      not anonymous) instead of the authority_sharing rows switched on.
--      Everything else is exactly as in 0066: only holders of authority.view
--      may call it, at most 500 people per call, the area of each home (a
--      town id, never a coordinate or an address) with its most likely class
--      and range, the latest I'm safe, never a device or an email, and every
--      call writes a row to the activity log with who was shown.
--   2. The authority_sharing table, my_authority_sharing(),
--      set_authority_sharing() and the field in Download my data stay as
--      they are: nothing reads the switch any more, and the rows people
--      already set are kept and still exported.
--
-- Needs 0066. Idempotent: safe to run twice. Written for the SQL editor as
-- one line: no transaction statements, only full-line comments, ASCII only,
-- no question marks.

-- 1. Every account holder ---------------------------------------------------------------------------
-- Their name, the area and class of each of their homes, their latest I'm
-- safe. Never a coordinate, an address, a device or an email. The log row
-- lists who was shown.
create or replace function public.authority_people(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
  v_ids jsonb;
begin
  if v_uid is null or not public.has_permission(v_uid, 'authority.view') then
    raise exception 'authority_people: not_allowed' using errcode = '42501';
  end if;

  with chosen as (
    select u.id as user_id, p.username, p.display_name,
           lower(coalesce(p.display_name, p.username, '')) as sort_key
      from auth.users u
      left join public.profiles p on p.user_id = u.id
     where coalesce(u.is_anonymous, false) = false
     order by sort_key, u.id
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', ch.user_id,
           'username', ch.username,
           'display_name', ch.display_name,
           'homes', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'area', public.area_town(h.lat, h.lon),
                      'kind', h.kind,
                      'vc', l.vc_most_likely,
                      'vc_range', l.vc_range)
                    order by h.created_at)
               from public.home_members m
               join public.home_tags h on h.tag_id = m.tag_id and h.status = 'active'
               left join lateral (
                 select a.vc_most_likely, a.vc_range
                   from public.home_assessments a
                  where a.tag_id = h.tag_id
                  order by a.created_at desc
                  limit 1
               ) l on true
              where m.user_id = ch.user_id and m.status = 'approved'
           ), '[]'::jsonb),
           'safe', (
             select jsonb_build_object(
                      'checked_in_at', c.checked_in_at,
                      'event_id', e.event_id,
                      'bumelerze_id', e.bumelerze_id,
                      'magnitude', e.magnitude,
                      'place', e.place,
                      'origin_time', e.origin_time)
               from public.safety_checkins c
               join public.events e on e.event_id = c.event_id
              where c.user_id = ch.user_id and c.status = 'safe'
              order by c.checked_in_at desc
              limit 1
           )) order by ch.sort_key, ch.user_id), '[]'::jsonb),
         coalesce(jsonb_agg(ch.user_id order by ch.sort_key, ch.user_id), '[]'::jsonb)
    into v_rows, v_ids
    from chosen ch;

  perform public.write_audit(
    v_uid, 'authority_people_view', 'system', null, null, null, null, null, null,
    jsonb_build_object('count', jsonb_array_length(v_rows), 'user_ids', v_ids)
  );
  return jsonb_build_object('people', v_rows);
end
$$;

-- 2. Who may call it (as in 0066) --------------------------------------------------------------------
revoke all on function public.authority_people(integer) from public, anon;
grant execute on function public.authority_people(integer) to authenticated;
