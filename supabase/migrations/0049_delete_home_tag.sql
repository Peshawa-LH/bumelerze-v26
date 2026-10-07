-- 0049: Delete a home tag (Tag my building).
-- Until now an owner could only "close" a home (leave_home archives it and
-- drops the owner's own membership), which left the answers, report, photos
-- and family links in the database with nobody able to reach them. This adds a
-- real delete:
--   * delete_home_tag(p_tag): owners only; removes the home_tags row. Secrets,
--     members, join attempts, surveys, assessments and home_photos rows all
--     reference it with ON DELETE CASCADE (0037, 0042), so they go with it.
--   * If the tag was the last one in its building complex, the complex row goes
--     too (building_complexes has no other owner; grouping is a server concern).
--
-- Photo FILES are not touched here: Supabase protects storage.objects from
-- direct SQL deletes. The app removes <tag_id>/* from the private home-photos
-- bucket first, through the Storage API, with the member delete policy of
-- 0037, and only then calls this function. Should a file survive (a partial
-- failure), it is an orphan under a folder no policy can read, because
-- membership is gone once this runs.

create or replace function public.delete_home_tag(p_tag uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_complex uuid;
begin
  if not public.is_home_owner(p_tag) then
    raise exception 'delete_home_tag: owners only' using errcode = '42501';
  end if;

  select complex_id into v_complex from public.home_tags where tag_id = p_tag;

  delete from public.home_tags where tag_id = p_tag;

  -- Last tag of its complex: drop the complex (others keep theirs).
  if v_complex is not null
     and not exists (select 1 from public.home_tags where complex_id = v_complex) then
    delete from public.building_complexes where complex_id = v_complex;
  end if;
end
$$;

revoke all on function public.delete_home_tag(uuid) from public, anon;
grant execute on function public.delete_home_tag(uuid) to authenticated;
