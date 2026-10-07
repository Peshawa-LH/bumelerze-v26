-- 0044: admin removal of comments (owner note N13, 2026-10-07).
--
-- Soft delete: status 'removed', body cleared, the area dropped, and a
-- moderation_log row (who, when, action, reason, comment). The thread keeps a
-- "Comment removed" placeholder so replies still make sense. A hard purge
-- stays a database-only operation for legal requests.
-- Needs 0043 (has_permission, moderation_log).

-- A removed comment has no text: let the body check allow an empty body for
-- removed rows only, and add the new status. Dropped by shape, not by name,
-- so a differently named constraint cannot linger.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.event_comments'::regclass
       and contype = 'c'
       and (pg_get_constraintdef(oid) like '%btrim(body)%'
            or pg_get_constraintdef(oid) like '%pending%')
  loop
    execute format('alter table public.event_comments drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.event_comments
  add constraint event_comments_status_check
  check (status in ('visible', 'pending', 'hidden', 'removed'));
alter table public.event_comments
  add constraint event_comments_body_check
  check (status = 'removed' or char_length(btrim(body)) between 1 and 1000);

-- Removed rows are readable by everyone (as an empty placeholder); pending and
-- hidden rows stay with their author and moderators.
drop policy if exists event_comments_read on public.event_comments;
create policy event_comments_read on public.event_comments
  for select to anon, authenticated
  using (
    status in ('visible', 'removed')
    or user_id = auth.uid()
    or public.is_moderator(auth.uid())
  );

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
begin
  if not public.has_permission(v_uid, 'comments.delete') then
    raise exception 'admin_delete_comment: not allowed' using errcode = '42501';
  end if;
  select c.user_id, c.status into v_author, v_status
    from public.event_comments c
   where c.comment_id = p_comment_id
   for update;
  if not found then
    raise exception 'admin_delete_comment: comment not found' using errcode = 'P0002';
  end if;
  if v_status = 'removed' then
    return;
  end if;
  update public.event_comments
  set status = 'removed',
      body = '',
      area_geohash = null,
      hidden_reason = v_reason,
      updated_at = now()
  where comment_id = p_comment_id;
  insert into public.moderation_log (actor_id, action, comment_id, target_user_id, reason)
  values (v_uid, 'comment_remove', p_comment_id, v_author, v_reason);
end
$$;

-- The review queue: comments waiting for a decision, then visible comments
-- that readers flagged. Moderators and admins only.
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
    raise exception 'moderation_queue: moderators only' using errcode = '42501';
  end if;
  return query
    select c.comment_id, c.event_id, e.bumelerze_id, c.parent_id, c.user_id,
           p.display_name, c.body, c.status, c.flag_count, c.created_at
      from public.event_comments c
      join public.events e on e.event_id = c.event_id
      left join public.profiles p on p.user_id = c.user_id
     where c.status = 'pending'
        or (c.status = 'visible' and c.flag_count > 0)
     order by (c.status = 'pending') desc, c.flag_count desc, c.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

revoke all on function public.admin_delete_comment(uuid, text) from public, anon;
revoke all on function public.moderation_queue(integer) from public, anon;
grant execute on function public.admin_delete_comment(uuid, text) to authenticated;
grant execute on function public.moderation_queue(integer) to authenticated;
